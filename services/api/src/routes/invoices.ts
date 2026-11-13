// Hoa don VAT + chi tra thuong nguoi xem (payouts). Spec §8.2: hoa don VAT theo chinh sach ke toan; hoan tien co chung tu.
// An toan so cai:
//  - Hoa don KHONG bao gio cham wallet_entries/ad_wallets (vi quang cao tra truoc la dong tien rieng). Phat hanh chi tao 1 receivable (cong no).
//  - Moi chuyen trang thai la UPDATE co dieu kien (WHERE status IN (...)), kiem rowsAffected: bam dup/dua nhau -> 409 invalid_state, khong lam hai lan.
//  - Chi tra: tru vi thuong (wallet_ledger, bat bien) va doi trang thai trong cung mot giao dich; so du khong du -> 409, khong ghi gi.
// Tien la so nguyen dong (BIGINT); VAT = lam tron(amount * rate / 100) bang so nguyen.
import { Hono } from 'hono';
import { z } from 'zod';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { eq, getRt, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec, SqlFrag } from '../lib/http.js';
import { todayVn } from '../lib/dates.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

export const VAT_RATES = [0, 5, 8, 10] as const;
export const vatOf = (amount: number, rate: number): number => Math.floor((amount * rate + 50) / 100);
const MAX_AMOUNT = 1_000_000_000_000;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface InvRow {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  period: string;
  amount_vnd: number;
  vat_rate: number;
  status: string;
  einvoice_ref: string | null;
  created_at: string;
  rc_paid: number | null;
  rc_state: string | null;
  rc_due: string | null;
}
const I_SELECT = `i.id, i.customer_id, cu.short_name AS customer_name, cu.payment_code AS customer_code, i.period, i.amount_vnd, i.vat_rate, i.status, i.einvoice_ref, i.created_at,
  (SELECT r.paid_vnd FROM receivables r WHERE r.invoice_id = i.id LIMIT 1) AS rc_paid,
  (SELECT r.state FROM receivables r WHERE r.invoice_id = i.id LIMIT 1) AS rc_state,
  (SELECT r.due_date FROM receivables r WHERE r.invoice_id = i.id LIMIT 1) AS rc_due`;
const I_FROM = 'FROM invoices i JOIN customers cu ON cu.id = i.customer_id';

const present = (r: InvRow, internal: boolean) => {
  const amount = num(r.amount_vnd);
  const vat = vatOf(amount, num(r.vat_rate));
  return {
    id: r.id,
    ...(internal ? { customer_id: r.customer_id, customer: r.customer_name, customer_code: r.customer_code } : {}),
    period: r.period,
    amount_vnd: amount,
    vat_rate: num(r.vat_rate),
    vat_vnd: vat,
    total_vnd: amount + vat,
    status: r.status,
    einvoice_ref: r.einvoice_ref,
    created_at: r.created_at,
    due_date: r.rc_due,
    paid_vnd: r.rc_paid === null ? null : num(r.rc_paid),
    receivable_state: r.rc_state,
  };
};

const spec = (scope: SqlFrag[], internal: boolean): ListSpec => ({
  from: I_FROM,
  select: I_SELECT,
  where: scope,
  search: internal ? ['cu.short_name', 'cu.payment_code', 'i.period', 'i.einvoice_ref'] : ['i.period', 'i.einvoice_ref'],
  sorts: { period: 'i.period', created_at: 'i.created_at', amount_vnd: 'i.amount_vnd', status: 'i.status', customer: 'cu.short_name' },
  defaultSort: 'created_at:desc',
  tiebreak: 'i.id',
  filters: { status: eq('i.status'), period: eq('i.period'), ...(internal ? { customer_id: eq('i.customer_id') } : {}) },
});

async function loadInvoice(c: Ctx, id: string, scope?: SqlFrag): Promise<InvRow> {
  const sql = `SELECT ${I_SELECT} ${I_FROM} WHERE i.id = ?${scope ? ` AND (${scope.sql})` : ''}`;
  const r = (await getRt(c).db.query<InvRow>(sql, [id, ...(scope?.params ?? [])]))[0];
  if (!r) throw notFound('Không tìm thấy hóa đơn.'); // 404 chung cho "khong co" va "cua khach khac"
  return r;
}

const createBody = z.object({
  customer_id: z.string().min(1).max(64),
  period: z.string().regex(PERIOD_RE, 'Kỳ phải có dạng YYYY-MM'),
  amount_vnd: z.number().int().min(1).max(MAX_AMOUNT),
  vat_rate: z.number().int().refine((v) => (VAT_RATES as readonly number[]).includes(v), 'Thuế suất VAT phải là 0, 5, 8 hoặc 10'),
  /** cho phep hoa don thu 2 trong cung ky (dieu chinh/bo sung) */
  allow_additional: z.boolean().optional(),
});

export function invoiceRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('finance', 'view'), async (c) => {
    const res = await runList<InvRow>(c, spec([], true));
    return c.json({ ...res, items: res.items.map((x) => present(x, true)) });
  });
  r.get('/:id', requirePerm('finance', 'view'), async (c) => c.json(present(await loadInvoice(c, c.req.param('id')), true)));

  r.post('/', requirePerm('finance', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, createBody);
    const cu = (await rt.db.query<{ id: string }>('SELECT id FROM customers WHERE id = ?', [b.customer_id]))[0];
    if (!cu) throw notFound('Không tìm thấy khách hàng.');
    const id = rt.id();
    await rt.db.tx(async (db) => {
      // chen co dieu kien trong mot cau lenh: hai yeu cau dua nhau khong tao trung ky
      const ins = await db.run(
        `INSERT INTO invoices (id, customer_id, period, amount_vnd, vat_rate, status, einvoice_ref, created_at)
         SELECT ?, ?, ?, CAST(? AS BIGINT), CAST(? AS INTEGER), 'draft', NULL, ? WHERE CAST(? AS INTEGER) = 1 OR NOT EXISTS (SELECT 1 FROM invoices WHERE customer_id = ? AND period = ? AND status <> 'void')`,
        [id, b.customer_id, b.period, b.amount_vnd, b.vat_rate, rt.clock.now().toISOString(), b.allow_additional ? 1 : 0, b.customer_id, b.period],
      );
      if (ins.changes !== 1) throw conflict('Khách hàng đã có hóa đơn cho kỳ này. Đặt allow_additional nếu cần hóa đơn bổ sung.', 'duplicate_period');
      await auditCtx(c, db, { action: 'invoice.create', objectType: 'invoice', objectId: id, customerId: b.customer_id, diff: { period: b.period, amount_vnd: b.amount_vnd, vat_rate: b.vat_rate } });
    });
    return c.json(present(await loadInvoice(c, id), true), 201);
  });

  // Chi sua ban nhap
  r.put('/:id', requirePerm('finance', 'write'), async (c) => {
    const rt = getRt(c);
    const inv = await loadInvoice(c, c.req.param('id'));
    const b = await parseBody(c, createBody.pick({ amount_vnd: true, vat_rate: true }).partial());
    if (b.amount_vnd === undefined && b.vat_rate === undefined) throw unprocessable('Nhập số tiền hoặc thuế suất cần đổi.', 'nothing_to_update');
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE invoices SET amount_vnd = ?, vat_rate = ? WHERE id = ? AND status = 'draft'", [b.amount_vnd ?? inv.amount_vnd, b.vat_rate ?? inv.vat_rate, inv.id]);
      if (u.changes !== 1) throw conflict('Chỉ sửa được hóa đơn ở trạng thái nháp.', 'invalid_state');
      await auditCtx(c, db, { action: 'invoice.update', objectType: 'invoice', objectId: inv.id, customerId: inv.customer_id, diff: { amount_vnd: { from: num(inv.amount_vnd), to: b.amount_vnd ?? num(inv.amount_vnd) }, vat_rate: { from: num(inv.vat_rate), to: b.vat_rate ?? num(inv.vat_rate) } } });
    });
    return c.json(present(await loadInvoice(c, inv.id), true));
  });

  // draft -> issued: tao cong no (receivable) gia tri gom VAT; khong cham vi
  r.post('/:id/issue', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const inv = await loadInvoice(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ einvoice_ref: z.string().trim().min(1).max(64).optional() }));
    const total = num(inv.amount_vnd) + vatOf(num(inv.amount_vnd), num(inv.vat_rate));
    const due = new Date(new Date(`${todayVn(rt)}T00:00:00Z`).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE invoices SET status = 'issued', einvoice_ref = COALESCE(?, einvoice_ref) WHERE id = ? AND status = 'draft'", [b.einvoice_ref ?? null, inv.id]);
      if (u.changes !== 1) throw conflict('Hóa đơn không còn ở trạng thái nháp.', 'invalid_state');
      await db.run("INSERT INTO receivables (id, customer_id, contract_id, invoice_id, amount_vnd, due_date, paid_vnd, state) VALUES (?,?,NULL,?,?,?,0,'open')", [rt.id(), inv.customer_id, inv.id, total, due]);
      await auditCtx(c, db, { action: 'invoice.issue', objectType: 'invoice', objectId: inv.id, customerId: inv.customer_id, diff: { total_vnd: total, einvoice_ref: b.einvoice_ref ?? null } });
    });
    return c.json(present(await loadInvoice(c, inv.id), true));
  });

  // issued -> paid: dong cong no
  r.post('/:id/pay', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const inv = await loadInvoice(c, c.req.param('id'));
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE invoices SET status = 'paid' WHERE id = ? AND status = 'issued'", [inv.id]);
      if (u.changes !== 1) throw conflict('Hóa đơn chưa phát hành hoặc đã thanh toán.', 'invalid_state');
      await db.run("UPDATE receivables SET paid_vnd = amount_vnd, state = 'paid' WHERE invoice_id = ?", [inv.id]);
      await auditCtx(c, db, { action: 'invoice.pay', objectType: 'invoice', objectId: inv.id, customerId: inv.customer_id, diff: { status: { from: 'issued', to: 'paid' } } });
    });
    return c.json(present(await loadInvoice(c, inv.id), true));
  });

  // draft|issued -> void (da thu mot phan/het thi khong huy: phai lap chung tu dieu chinh)
  r.post('/:id/void', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const inv = await loadInvoice(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ reason: z.string().trim().min(3, 'Nhập lý do hủy').max(300) }));
    await rt.db.tx(async (db) => {
      const u = await db.run(
        "UPDATE invoices SET status = 'void' WHERE id = ? AND status IN ('draft','issued') AND NOT EXISTS (SELECT 1 FROM receivables WHERE invoice_id = ? AND paid_vnd > 0)",
        [inv.id, inv.id],
      );
      if (u.changes !== 1) throw conflict('Không hủy được: hóa đơn đã thanh toán/đã hủy hoặc đã có khoản thu.', 'invalid_state');
      await db.run('DELETE FROM receivables WHERE invoice_id = ? AND paid_vnd = 0', [inv.id]);
      await auditCtx(c, db, { action: 'invoice.void', objectType: 'invoice', objectId: inv.id, customerId: inv.customer_id, diff: { status: { from: inv.status, to: 'void' }, reason: b.reason } });
    });
    return c.json(present(await loadInvoice(c, inv.id), true));
  });
  return r;
}

/** Cong khach hang: chi hoa don da phat hanh/da thanh toan cua CHINH khach (loc trong SQL); khong thay ban nhap/da huy. Doi tac khong co mo-dun finance. */
export function portalInvoiceRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('*', requirePerm('finance', 'view'));
  const scope = (c: Ctx): SqlFrag => {
    const u = c.get('user');
    return { sql: "i.customer_id = ? AND i.status IN ('issued','paid')", params: [u.customerId ?? ''] };
  };
  r.get('/', async (c) => {
    const res = await runList<InvRow>(c, spec([scope(c)], false));
    return c.json({ ...res, items: res.items.map((x) => present(x, false)) });
  });
  r.get('/:id', async (c) => c.json(present(await loadInvoice(c, c.req.param('id'), scope(c)), false)));
  return r;
}

// ---------------- chi tra thuong nguoi xem ----------------
interface PayRow {
  id: string;
  user_id: string;
  display_name: string | null;
  amount_vnd: number;
  channel: string | null;
  status: string;
  external_ref: string | null;
  requested_at: string;
  paid_at: string | null;
  balance_vnd: number;
}
const P_SELECT = `p.id, p.user_id, u.display_name, p.amount_vnd, p.channel, p.status, p.external_ref, p.requested_at, p.paid_at,
  COALESCE((SELECT SUM(l.amount_vnd) FROM wallet_ledger l WHERE l.user_id = p.user_id AND l.status = 'posted'), 0) AS balance_vnd`;
const P_FROM = 'FROM payouts p JOIN end_users u ON u.id = p.user_id';
const presentPayout = (p: PayRow) => ({
  id: p.id,
  user_id: p.user_id,
  user: p.display_name,
  amount_vnd: num(p.amount_vnd),
  channel: p.channel,
  status: p.status,
  external_ref: p.external_ref,
  requested_at: p.requested_at,
  paid_at: p.paid_at,
  user_balance_vnd: num(p.balance_vnd),
});
const payoutSpec: ListSpec = {
  from: P_FROM,
  select: P_SELECT,
  search: ['u.display_name', 'p.external_ref'],
  sorts: { requested_at: 'p.requested_at', amount_vnd: 'p.amount_vnd', status: 'p.status' },
  defaultSort: 'requested_at:desc',
  tiebreak: 'p.id',
  filters: { status: eq('p.status'), channel: eq('p.channel'), user_id: eq('p.user_id') },
};
async function loadPayout(c: Ctx, id: string): Promise<PayRow> {
  const r = (await getRt(c).db.query<PayRow>(`SELECT ${P_SELECT} ${P_FROM} WHERE p.id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy lệnh chi trả.');
  return r;
}

export function payoutRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/', requirePerm('finance', 'view'), async (c) => {
    const res = await runList<PayRow>(c, payoutSpec);
    return c.json({ ...res, items: res.items.map(presentPayout) });
  });
  r.get('/:id', requirePerm('finance', 'view'), async (c) => c.json(presentPayout(await loadPayout(c, c.req.param('id')))));

  // pending -> paid: tru vi thuong (so cai bat bien) + doi trang thai trong mot giao dich; thieu so du thi khong ghi gi
  r.post('/:id/pay', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const p = await loadPayout(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ external_ref: z.string().trim().min(1, 'Nhập mã giao dịch ngân hàng/ví').max(80) }));
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      // Khoa hang nguoi dung bang UPDATE (khong FOR UPDATE): hai lenh dong thoi cung nguoi dung xep hang tai day; lenh sau chay cau INSERT co dieu kien
      // SAU KHI lenh truoc commit (READ COMMITTED lay snapshot moi moi cau lenh) => so du luon duoc doc lai, khong the chi vuot.
      await db.run('UPDATE end_users SET created_at = created_at WHERE id = ?', [p.user_id]);
      const u = await db.run("UPDATE payouts SET status = 'paid', paid_at = ?, external_ref = ? WHERE id = ? AND status = 'pending'", [now, b.external_ref, p.id]);
      if (u.changes !== 1) throw conflict('Lệnh chi trả không còn chờ xử lý.', 'invalid_state');
      const l = await db.run(
        `INSERT INTO wallet_ledger (id, user_id, kind, amount_vnd, ref_type, ref_id, status, created_at)
         SELECT ?, ?, 'payout', CAST(? AS BIGINT), 'payout', ?, 'posted', ?
         WHERE COALESCE((SELECT SUM(amount_vnd) FROM wallet_ledger WHERE user_id = ? AND status = 'posted'), 0) >= ?`,
        [rt.id(), p.user_id, -num(p.amount_vnd), p.id, now, p.user_id, num(p.amount_vnd)],
      );
      if (l.changes !== 1) throw conflict('Số dư ví thưởng của người dùng không đủ để chi trả.', 'insufficient_balance');
      await auditCtx(c, db, { action: 'payout.pay', objectType: 'payout', objectId: p.id, diff: { amount_vnd: num(p.amount_vnd), channel: p.channel, external_ref: b.external_ref } });
    });
    return c.json(presentPayout(await loadPayout(c, p.id)));
  });

  r.post('/:id/reject', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const p = await loadPayout(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ reason: z.string().trim().min(3, 'Nhập lý do từ chối').max(300) }));
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE payouts SET status = 'rejected' WHERE id = ? AND status = 'pending'", [p.id]);
      if (u.changes !== 1) throw conflict('Lệnh chi trả không còn chờ xử lý.', 'invalid_state');
      await auditCtx(c, db, { action: 'payout.reject', objectType: 'payout', objectId: p.id, diff: { amount_vnd: num(p.amount_vnd), reason: b.reason } });
    });
    return c.json(presentPayout(await loadPayout(c, p.id)));
  });
  return r;
}
