import { Hono } from 'hono';
import { z } from 'zod';
import type { Db, Runtime } from '@ams/runtime';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { diffObjects } from '../lib/audit.js';
import { AAD, decField, encField, hashIndex } from '../lib/crypto.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { eqMapped, getRt, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { todayVn } from '../lib/dates.js';
import { hasPerm, requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

export const CUSTOMER_STATE_TO_API: Record<string, string> = { active: 'cooperating', paused: 'suspended' };
export const CUSTOMER_STATE_FROM_API: Record<string, string> = { cooperating: 'active', suspended: 'paused' };

const C_SELECT = `cu.id, cu.payment_code, cu.legal_name, cu.short_name, cu.tax_code_enc, cu.address, cu.industry, cu.rep_name, cu.rep_title, cu.phone, cu.email, cu.contact_name,
  cu.account_owner_id, cu.payment_terms, cu.credit_limit_vnd, cu.state, cu.since, cu.created_at, cu.notes, cu.archived_at, cu.updated_at, o.name AS owner_name,
  COALESCE((SELECT SUM(r.amount_vnd - r.paid_vnd) FROM receivables r WHERE r.customer_id = cu.id AND r.state <> 'paid'), 0) AS debt_vnd`;
const C_FROM = 'FROM customers cu LEFT JOIN admins o ON o.id = cu.account_owner_id';

interface CustRow {
  id: string;
  payment_code: string;
  legal_name: string;
  short_name: string;
  tax_code_enc: string | null;
  address: string | null;
  industry: string | null;
  rep_name: string | null;
  rep_title: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  account_owner_id: string | null;
  payment_terms: string | null;
  credit_limit_vnd: number;
  state: string;
  since: string | null;
  created_at: string;
  notes: string | null;
  archived_at: string | null;
  updated_at: string | null;
  owner_name: string | null;
  debt_vnd: number;
}

export async function presentCustomer(rt: Runtime, r: CustRow): Promise<Record<string, unknown>> {
  let tax: string | null = null;
  if (r.tax_code_enc) {
    try {
      tax = await decField(rt, r.tax_code_enc, AAD.taxCode);
    } catch {
      tax = null;
    }
  }
  return {
    id: r.id,
    code: r.payment_code,
    legal_name: r.legal_name,
    short_name: r.short_name,
    tax_code: tax,
    address: r.address,
    representative: r.rep_name,
    rep_title: r.rep_title,
    phone: r.phone,
    email: r.email,
    contact: r.contact_name,
    industry: r.industry,
    owner: r.owner_name,
    owner_id: r.account_owner_id,
    payment_terms: r.payment_terms,
    credit_limit_vnd: num(r.credit_limit_vnd),
    debt_vnd: num(r.debt_vnd),
    status: CUSTOMER_STATE_TO_API[r.state] ?? r.state,
    since: r.since,
    created_at: r.created_at,
    notes: r.notes,
    archived_at: r.archived_at,
    updated_at: r.updated_at ?? r.created_at,
  };
}

const spec: ListSpec = {
  from: C_FROM,
  select: C_SELECT,
  where: [{ sql: "cu.id <> 'cu_shared_pool'", params: [] }, { sql: 'cu.archived_at IS NULL', params: [] }], // 'Kho chung' (tep noi bo khong gan khach) khong phai khach hang
  search: ['cu.legal_name', 'cu.short_name', 'cu.payment_code', 'cu.contact_name', 'cu.industry', 'cu.phone'],
  sorts: { short_name: 'cu.short_name', code: 'cu.payment_code', debt_vnd: 'debt_vnd', created_at: 'cu.created_at', status: 'cu.state', owner: 'o.name', industry: 'cu.industry' },
  defaultSort: 'code:asc',
  tiebreak: 'cu.id',
  filters: {
    status: eqMapped('cu.state', CUSTOMER_STATE_FROM_API),
    owner_id: (v) => ({ sql: 'cu.account_owner_id = ?', params: [v] }),
    industry: (v) => ({ sql: 'cu.industry = ?', params: [v] }),
  },
};

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const body = z.object({
  legal_name: z.string().trim().min(1, 'Nhập tên pháp lý').max(300),
  short_name: opt(120),
  tax_code: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v === undefined ? undefined : v ? v : null))
    .refine((v) => v === undefined || v === null || /^\d{10}(-\d{3})?$/.test(v), 'Mã số thuế gồm 10 số (hoặc 10 số-3 số)'),
  address: opt(500),
  notes: opt(2000),
  representative: opt(120),
  rep_title: opt(120),
  phone: opt(40),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v ? v : null))
    .refine((v) => v === undefined || v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Email không hợp lệ'),
  contact: opt(120),
  industry: opt(120),
  payment_terms: opt(200),
  credit_limit_vnd: z.coerce.number().int().min(0).max(1e13).optional(),
  owner_id: z.string().max(64).nullish(),
  status: z.enum(['cooperating', 'suspended', 'pending_payment', 'terminated']).optional(),
});

const contactSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1, 'Nhập tên người liên hệ').max(120),
  title: opt(120),
  phone: opt(40),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Email người liên hệ không hợp lệ'),
  is_primary: z.boolean().optional(),
});

/** PATCH/PUT: moi truong tuy chon; `code`/`payment_code` chi de phat hien co y doi (bat bien); `if_updated_at` = khoa kiem soat sua dong thoi. */
const patchBody = body.partial().extend({
  contacts: z.array(contactSchema).max(20, 'Tối đa 20 người liên hệ').optional(),
  if_updated_at: z.string().max(40).optional(),
  code: z.string().max(40).optional(),
  payment_code: z.string().max(40).optional(),
});

/** Dieu kien chan xoa khach hang: chien dich dang chay, so du vi duong, hoa don/cong no chua thanh toan. Tra danh sach ly do bang tieng Viet. */
export async function customerDeleteBlockers(db: Db, id: string): Promise<{ code: string; message: string; count?: number; amount_vnd?: number }[]> {
  const out: { code: string; message: string; count?: number; amount_vnd?: number }[] = [];
  const camps = await db.query<{ name: string; state: string }>("SELECT name, state FROM campaigns WHERE customer_id = ? AND state IN ('pending_review','awaiting_funds','scheduled','active','paused') ORDER BY created_at LIMIT 50", [id]);
  if (camps.length) out.push({ code: 'active_campaigns', count: camps.length, message: `Còn ${camps.length} chiến dịch đang hoạt động/chờ duyệt: ${camps.slice(0, 5).map((x) => x.name).join(', ')}${camps.length > 5 ? '…' : ''}. Hãy kết thúc hoặc dừng chúng trước.` });
  const w = (await db.query<{ balance_vnd: number; reserved_vnd: number }>('SELECT balance_vnd, reserved_vnd FROM ad_wallets WHERE customer_id = ?', [id]))[0];
  const bal = w ? num(w.balance_vnd) : 0;
  if (bal > 0) out.push({ code: 'wallet_balance', amount_vnd: bal, message: `Ví quảng cáo còn số dư ${bal.toLocaleString('vi-VN')} ₫. Hãy hoàn tiền hoặc tất toán trước khi xóa.` });
  const rec = (await db.query<{ n: number; due: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(amount_vnd - paid_vnd), 0) AS due FROM receivables WHERE customer_id = ? AND state <> 'paid' AND amount_vnd > paid_vnd", [id]))[0];
  if (rec && num(rec.n) > 0) out.push({ code: 'unpaid_receivables', count: num(rec.n), amount_vnd: num(rec.due), message: `Còn ${num(rec.n)} khoản công nợ chưa thanh toán (${num(rec.due).toLocaleString('vi-VN')} ₫).` });
  const inv = (await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM invoices i WHERE i.customer_id = ? AND i.status NOT IN ('paid','cancelled','void','draft') AND NOT EXISTS (SELECT 1 FROM receivables r WHERE r.invoice_id = i.id AND r.state = 'paid')", [id]))[0];
  if (inv && num(inv.n) > 0) out.push({ code: 'unpaid_invoices', count: num(inv.n), message: `Còn ${num(inv.n)} hóa đơn chưa thanh toán.` });
  return out;
}

async function nextPaymentCode(db: Db): Promise<string> {
  // chi lay vai ma dai nhat/lon nhat (K999 < K1000 theo do dai truoc): khong keo ca bang khach hang ve de tim max
  const rows = await db.query<{ payment_code: string }>("SELECT payment_code FROM customers WHERE payment_code LIKE 'K%' ORDER BY LENGTH(payment_code) DESC, payment_code DESC LIMIT 20");
  let max = 0;
  for (const r of rows) {
    const n = Number(r.payment_code.slice(1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `K${String(max + 1).padStart(3, '0')}`;
}

async function loadCustomer(c: Ctx, id: string): Promise<CustRow> {
  const r = (await getRt(c).db.query<CustRow>(`SELECT ${C_SELECT} ${C_FROM} WHERE cu.id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy khách hàng.');
  return r;
}

export function customerRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    // khach da luu tru an khoi danh sach; ?archived=1 (chi nguoi co quyen xoa khach hang) de xem lai
    const archived = c.req.query('archived') === '1';
    if (archived && !hasPerm(c, 'customers', 'delete')) throw forbidden('Bạn không có quyền xem khách hàng đã xóa.', 'forbidden', { module: 'customers', action: 'delete' });
    const res = await runList<CustRow>(c, archived ? { ...spec, where: [{ sql: "cu.id <> 'cu_shared_pool'", params: [] }, { sql: 'cu.archived_at IS NOT NULL', params: [] }] } : spec);
    return c.json({ ...res, items: await Promise.all(res.items.map((x) => presentCustomer(rt, x))) });
  });

  r.get('/:id', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    const row = await loadCustomer(c, c.req.param('id'));
    const contacts = await rt.db.query('SELECT id, name, title, phone, email, is_primary FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC, id', [row.id]);
    return c.json({ ...(await presentCustomer(rt, row)), contacts });
  });

  r.post('/', requirePerm('customers', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, body);
    if (b.tax_code) {
      const h = await hashIndex(rt, AAD.taxCode, b.tax_code);
      if ((await rt.db.query('SELECT 1 FROM customers WHERE tax_code_hash = ?', [h])).length) throw conflict('Mã số thuế đã tồn tại ở khách hàng khác.', 'duplicate_tax_code');
    }
    const id = rt.id();
    const nowIso = rt.clock.now().toISOString();
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rt.db.tx(async (db) => {
          const code = await nextPaymentCode(db);
          await db.run(
            `INSERT INTO customers (id, tenant_id, legal_name, short_name, tax_code_enc, tax_code_hash, address, industry, rep_name, rep_title, phone, email, contact_name, account_owner_id, payment_terms, credit_limit_vnd, payment_code, state, since, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending_payment', ?, ?)`,
            [
              id, u.tenantId, b.legal_name, b.short_name ?? b.legal_name, b.tax_code ? await encField(rt, b.tax_code, AAD.taxCode) : null, b.tax_code ? await hashIndex(rt, AAD.taxCode, b.tax_code) : null,
              b.address ?? null, b.industry ?? null, b.representative ?? null, b.rep_title ?? null, b.phone ?? null, b.email ?? null, b.contact ?? null, b.owner_id ?? u.id,
              b.payment_terms ?? null, b.credit_limit_vnd ?? 0, code, todayVn(rt), nowIso,
            ],
          );
          await db.run('INSERT INTO ad_wallets (customer_id, balance_vnd, reserved_vnd, spent_vnd, low_balance_alert_pct, updated_at) VALUES (?,0,0,0,10,?)', [id, nowIso]);
          await db.run('INSERT INTO upload_quotas (customer_id, max_files_per_day, max_mb_per_file, max_total_gb) VALUES (?,20,30,5)', [id]);
          if (b.representative) await db.run('INSERT INTO customer_contacts (id, customer_id, name, title, phone, email, is_primary) VALUES (?,?,?,?,?,?,1)', [rt.id(), id, b.representative, b.rep_title ?? null, b.phone ?? null, b.email ?? null]);
          await auditCtx(c, db, { action: 'customer.create', objectType: 'customer', objectId: id, customerId: id, diff: { legal_name: b.legal_name, payment_code: code, tax_code: b.tax_code ? '***' : null } });
        });
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        if (!/unique|duplicate|constraint/i.test((e as Error).message ?? '')) throw e;
      }
    }
    if (lastErr) throw conflict('Không cấp được mã khách hàng, hãy thử lại.', 'code_conflict');
    return c.json(await presentCustomer(rt, await loadCustomer(c, id)), 201);
  });

  const update = async (c: Ctx) => {
    const rt = getRt(c);
    const row = await loadCustomer(c, c.req.param('id') ?? '');
    const b = await parseBody(c, patchBody);
    if (row.archived_at) throw conflict('Khách hàng đã bị xóa (lưu trữ), không sửa được.', 'customer_archived');
    if ((b.code !== undefined && b.code !== row.payment_code) || (b.payment_code !== undefined && b.payment_code !== row.payment_code)) throw unprocessable('Mã khách hàng (mã thanh toán) không thể thay đổi.', 'immutable_field');
    if (b.if_updated_at !== undefined && b.if_updated_at !== (row.updated_at ?? row.created_at)) throw conflict('Hồ sơ vừa được người khác cập nhật. Hãy tải lại rồi sửa tiếp.', 'stale_update');
    const sets: string[] = [];
    const params: unknown[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const put = (col: string, key: string, val: unknown, cur: unknown) => {
      if (val === undefined) return;
      sets.push(`${col} = ?`);
      params.push(val);
      before[key] = cur;
      after[key] = val;
    };
    put('legal_name', 'legal_name', b.legal_name, row.legal_name);
    put('short_name', 'short_name', b.short_name === null ? row.legal_name : b.short_name, row.short_name);
    put('address', 'address', b.address, row.address);
    put('notes', 'notes', b.notes, row.notes);
    put('industry', 'industry', b.industry, row.industry);
    put('rep_name', 'representative', b.representative, row.rep_name);
    put('rep_title', 'rep_title', b.rep_title, row.rep_title);
    put('phone', 'phone', b.phone, row.phone);
    put('email', 'email', b.email, row.email);
    put('contact_name', 'contact', b.contact, row.contact_name);
    put('payment_terms', 'payment_terms', b.payment_terms, row.payment_terms);
    put('credit_limit_vnd', 'credit_limit_vnd', b.credit_limit_vnd, num(row.credit_limit_vnd));
    if (b.owner_id !== undefined) put('account_owner_id', 'owner_id', b.owner_id, row.account_owner_id);
    if (b.tax_code !== undefined) {
      if (b.tax_code) {
        const h = await hashIndex(rt, AAD.taxCode, b.tax_code);
        const dup = await rt.db.query('SELECT 1 FROM customers WHERE tax_code_hash = ? AND id <> ?', [h, row.id]);
        if (dup.length) throw conflict('Mã số thuế đã tồn tại ở khách hàng khác.', 'duplicate_tax_code');
        put('tax_code_enc', 'tax_code', await encField(rt, b.tax_code, AAD.taxCode), '(cũ)');
        sets.push('tax_code_hash = ?');
        params.push(h);
      } else {
        put('tax_code_enc', 'tax_code', null, '(cũ)');
        sets.push('tax_code_hash = ?');
        params.push(null);
      }
    }
    if (b.status !== undefined) {
      const to = CUSTOMER_STATE_FROM_API[b.status] ?? b.status;
      if (to !== row.state) {
        // kich hoat tu cho thanh toan hoac cham dut chi nguoi co quyen duyet (kich hoat tu dong do tai chinh phu trach)
        // R1-08: roi khoi pending_payment (sang bat ky trang thai nao) va moi thao tac vao/ra terminated deu can quyen duyet: chan cach di vong qua paused
        if (row.state === 'pending_payment' || row.state === 'terminated' || to === 'terminated') {
          if (!hasPerm(c, 'customers', 'approve')) throw forbidden('Chỉ người có quyền duyệt khách hàng mới đổi sang trạng thái này.', 'forbidden', { module: 'customers', action: 'approve' });
        }
        put('state', 'state', to, row.state);
      }
    }
    if (!sets.length && b.contacts === undefined) return c.json(await presentCustomer(rt, row));
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      // khoa lac quan: chi ghi khi updated_at chua doi giua luc doc va luc ghi
      const guard = row.updated_at ?? null;
      const res = await db.run(`UPDATE customers SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ? AND archived_at IS NULL AND COALESCE(updated_at, '') = ?`, [...params, nowIso, row.id, guard ?? '']);
      if (res.changes !== 1) throw conflict('Hồ sơ vừa được người khác cập nhật. Hãy tải lại rồi sửa tiếp.', 'stale_update');
      if (b.contacts !== undefined) {
        const cur = await db.query<{ id: string }>('SELECT id FROM customer_contacts WHERE customer_id = ?', [row.id]);
        const have = new Set(cur.map((x) => x.id));
        const keep = new Set<string>();
        const primaryIdx = Math.max(0, b.contacts.findIndex((x) => x.is_primary));
        for (const [i, ct] of b.contacts.entries()) {
          const prim = i === primaryIdx ? 1 : 0;
          if (ct.id && have.has(ct.id)) {
            keep.add(ct.id);
            await db.run('UPDATE customer_contacts SET name = ?, title = ?, phone = ?, email = ?, is_primary = ? WHERE id = ? AND customer_id = ?', [ct.name, ct.title ?? null, ct.phone ?? null, ct.email, prim, ct.id, row.id]);
          } else {
            const nid = rt.id();
            keep.add(nid);
            await db.run('INSERT INTO customer_contacts (id, customer_id, name, title, phone, email, is_primary) VALUES (?,?,?,?,?,?,?)', [nid, row.id, ct.name, ct.title ?? null, ct.phone ?? null, ct.email, prim]);
          }
        }
        for (const id of have) if (!keep.has(id)) await db.run('DELETE FROM customer_contacts WHERE id = ? AND customer_id = ?', [id, row.id]);
        after['contacts'] = b.contacts.length;
        before['contacts'] = cur.length;
      }
      await auditCtx(c, db, { action: 'customer.update', objectType: 'customer', objectId: row.id, customerId: row.id, diff: diffObjects(before, after, ['tax_code']) });
    });
    return c.json(await presentCustomer(rt, await loadCustomer(c, row.id)));
  };
  r.put('/:id', requirePerm('customers', 'write'), update);
  r.patch('/:id', requirePerm('customers', 'write'), update);

  // Xoa (luu tru) khach hang: chan neu con chien dich dang chay / so du vi / hoa don, cong no chua thanh toan. Khong xoa du lieu tai chinh.
  // Luu tru = archived_at + state 'terminated' + khoa tai khoan cong cua khach (admins.status='disabled', thu hoi phien). Ma thanh toan va MST giu nguyen (khong tai su dung).
  r.delete('/:id', requirePerm('customers', 'delete'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const row = await loadCustomer(c, c.req.param('id'));
    if (row.id === 'cu_shared_pool') throw conflict('Không thể xóa kho chung.', 'protected');
    if (row.archived_at) throw notFound('Khách hàng đã được xóa trước đó.', 'customer_archived');
    const blockers = await customerDeleteBlockers(rt.db, row.id);
    if (blockers.length) throw conflict(`Không thể xóa khách hàng "${row.short_name}": ${blockers.map((b) => b.message).join(' ')}`, 'customer_has_blockers', { blockers });
    const nowIso = rt.clock.now().toISOString();
    let revoked = 0;
    await rt.db.tx(async (db) => {
      const res = await db.run("UPDATE customers SET archived_at = ?, archived_by = ?, state = 'terminated', updated_at = ? WHERE id = ? AND archived_at IS NULL", [nowIso, u.id, nowIso, row.id]);
      if (res.changes !== 1) throw conflict('Khách hàng đã được xóa trước đó.', 'customer_archived');
      const users = await db.query<{ id: string }>("SELECT id FROM admins WHERE customer_id = ? AND account_kind <> 'internal'", [row.id]);
      revoked = users.length;
      await db.run("UPDATE admins SET status = 'disabled' WHERE customer_id = ? AND account_kind <> 'internal'", [row.id]);
      for (const x of users) await db.run('UPDATE sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL', [nowIso, x.id]);
      await auditCtx(c, db, { action: 'customer.delete', objectType: 'customer', objectId: row.id, customerId: row.id, diff: { legal_name: row.legal_name, payment_code: row.payment_code, previous_state: row.state, portal_users_disabled: revoked, soft: true } });
    });
    return c.json({ id: row.id, archived: true, portal_users_disabled: revoked });
  });

  return r;
}
