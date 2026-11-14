// Nhac no + tu tam dung + han muc cong no + canh bao so du thap qua email (P1-3).
// Chay lai an toan: moi viec ghi mot dong dunning_events voi dedupe_key UNIQUE (chiem cho truoc, gui sau; gui loi thi nha cho de lan sau thu lai).
import type { Db, Runtime } from '@ams/runtime';
import { DEFAULT_DUNNING, DUNNING_SETTINGS_KEY, exceedsCreditLimit, parseDunningConfig, planDunning, transitionCampaign } from '@ams/shared';
import type { CampaignState, DunningConfig } from '@ams/shared';
import { writeAudit } from '../lib/audit.js';
import { todayVn, } from '../lib/dates.js';
import { forbidden, unprocessable } from '../lib/errors.js';
import { jsonParse, num } from '../lib/http.js';
import { bumpManifest } from '../lib/manifest.js';
import { esc, trySend } from '../lib/mail.js';

export async function loadDunningConfig(db: Db): Promise<DunningConfig> {
  const raw = (await db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [DUNNING_SETTINGS_KEY]))[0]?.value;
  return parseDunningConfig(jsonParse<unknown>(raw, DEFAULT_DUNNING));
}

/** Cong no chua thu cua khach (tong con lai cua receivables chua 'paid'). */
export async function outstandingOf(db: Db, customerId: string): Promise<{ outstanding: number; overdue: number; overdueCount: number }> {
  const r = (await db.query<{ o: unknown; v: unknown; c: unknown }>(
    `SELECT COALESCE(SUM(amount_vnd - paid_vnd),0) AS o,
            COALESCE(SUM(CASE WHEN state = 'overdue' THEN amount_vnd - paid_vnd ELSE 0 END),0) AS v,
            COALESCE(SUM(CASE WHEN state = 'overdue' THEN 1 ELSE 0 END),0) AS c
       FROM receivables WHERE customer_id = ? AND state <> 'paid'`, [customerId]))[0];
  return { outstanding: num(r?.o), overdue: num(r?.v), overdueCount: num(r?.c) };
}

/** Han muc cong no tai thoi diem phat hanh hoa don: han muc > 0 va (cong no + hoa don moi) vuot han muc => 409. Han muc 0 = khach tra truoc, khong chan (hoa don VAT cua khoan nap). */
export async function assertCreditForInvoice(db: Db, customerId: string, newReceivableVnd: number): Promise<void> {
  const cfg = await loadDunningConfig(db);
  if (!cfg.enforce_credit_limit) return;
  const cu = (await db.query<{ credit_limit_vnd: unknown }>('SELECT credit_limit_vnd FROM customers WHERE id = ?', [customerId]))[0];
  const limit = num(cu?.credit_limit_vnd);
  if (limit <= 0) return;
  const { outstanding } = await outstandingOf(db, customerId);
  if (exceedsCreditLimit(limit, outstanding, newReceivableVnd)) {
    throw new CreditLimitError(limit, outstanding, newReceivableVnd);
  }
}
export class CreditLimitError extends Error {
  constructor(public limit: number, public outstanding: number, public requested: number) {
    super('Vượt hạn mức công nợ của khách hàng.');
  }
}

/** Duyet chien dich moi: khach co cong no QUA HAN, hoac cong no vuot han muc (khi han muc > 0) => khong duyet. Goi tu routes/campaigns.ts. */
export async function assertCreditForApproval(db: Db, customerId: string): Promise<void> {
  const cfg = await loadDunningConfig(db);
  if (!cfg.enforce_credit_limit) return;
  const { outstanding, overdue, overdueCount } = await outstandingOf(db, customerId);
  if (overdueCount > 0) throw unprocessable(`Khách hàng đang có công nợ quá hạn (${overdue.toLocaleString('vi-VN')} ₫). Thu nợ trước khi duyệt chiến dịch mới.`, 'receivable_overdue', { overdue_vnd: overdue });
  const limit = num((await db.query<{ credit_limit_vnd: unknown }>('SELECT credit_limit_vnd FROM customers WHERE id = ?', [customerId]))[0]?.credit_limit_vnd);
  if (limit > 0 && outstanding > limit) throw forbidden('Công nợ của khách hàng vượt hạn mức, không thể duyệt chiến dịch mới.', 'credit_limit_exceeded', { limit_vnd: limit, outstanding_vnd: outstanding });
}

interface RecvRow {
  id: string;
  customer_id: string;
  invoice_id: string | null;
  amount_vnd: number;
  paid_vnd: number;
  due_date: string | null;
  state: string;
  email: string | null;
  short_name: string | null;
  period: string | null;
}

const money = (v: number) => `${v.toLocaleString('vi-VN')} ₫`;

/** Ghi su kien (chiem cho theo dedupe_key). true neu lan nay chiem duoc. */
async function claim(rt: Runtime, e: { customer: string; receivable?: string | null; kind: string; stage?: string | null; detail?: string | null; key: string }): Promise<string | null> {
  const id = rt.id();
  const r = await rt.db.run(
    `INSERT INTO dunning_events (id, customer_id, receivable_id, kind, stage, detail, mail_sent, created_at, dedupe_key)
     SELECT ?,?,?,?,?,?,0,?,? WHERE NOT EXISTS (SELECT 1 FROM dunning_events WHERE dedupe_key = ?)`,
    [id, e.customer, e.receivable ?? null, e.kind, e.stage ?? null, e.detail ?? null, rt.clock.now().toISOString(), e.key, e.key],
  );
  return r.changes === 1 ? id : null;
}
const release = (rt: Runtime, id: string) => rt.db.run('DELETE FROM dunning_events WHERE id = ?', [id]);

async function customerEmails(db: Db, customerId: string): Promise<string[]> {
  const rows = await db.query<{ email: string | null }>(
    `SELECT email FROM customers WHERE id = ? UNION SELECT email FROM customer_contacts WHERE customer_id = ? AND is_primary = 1
     UNION SELECT email FROM admins WHERE customer_id = ? AND account_kind = 'customer' AND status = 'active'`, [customerId, customerId, customerId]);
  return [...new Set(rows.map((r) => (r.email ?? '').trim().toLowerCase()).filter((e) => e.includes('@')))].slice(0, 5);
}

async function sendMails(rt: Runtime, db: Db, customerId: string, subject: string, html: string, text: string): Promise<boolean> {
  const to = await customerEmails(db, customerId);
  if (!to.length) return false;
  let ok = true;
  for (const t of to) ok = (await trySend(rt, { to: t, subject, html, text })) && ok;
  return ok;
}

export interface DunningSummary {
  today: string;
  overdue_marked: number;
  reminders_sent: number;
  reminders_failed: number;
  campaigns_paused: number;
  customers_paused: number;
  credit_limit_events: number;
  low_balance_emails: number;
}

/** Job nhac no (goi hang ngay). `today` cho kiem thu. */
export async function runDunning(rt: Runtime, opts: { today?: string } = {}): Promise<DunningSummary> {
  const cfg = await loadDunningConfig(rt.db);
  const today = opts.today ?? todayVn(rt);
  const s: DunningSummary = { today, overdue_marked: 0, reminders_sent: 0, reminders_failed: 0, campaigns_paused: 0, customers_paused: 0, credit_limit_events: 0, low_balance_emails: 0 };

  const rows = await rt.db.query<RecvRow>(
    `SELECT r.id, r.customer_id, r.invoice_id, r.amount_vnd, r.paid_vnd, r.due_date, r.state, cu.email, cu.short_name, i.period
       FROM receivables r JOIN customers cu ON cu.id = r.customer_id LEFT JOIN invoices i ON i.id = r.invoice_id
      WHERE r.state <> 'paid' AND r.due_date IS NOT NULL ORDER BY r.due_date, r.id LIMIT 2000`);
  const pauseCustomers = new Map<string, { receivable: string; days: number; amount: number }>();

  for (const r of rows) {
    const remaining = num(r.amount_vnd) - num(r.paid_vnd);
    const sent = (await rt.db.query<{ stage: string | null }>("SELECT stage FROM dunning_events WHERE receivable_id = ? AND kind = 'reminder'", [r.id])).map((x) => Number(x.stage)).filter((x) => Number.isFinite(x));
    const plan = planDunning({ due_date: r.due_date, remaining_vnd: remaining }, today, cfg, sent);

    if (plan.markOverdue && r.state !== 'overdue') {
      const u = await rt.db.run("UPDATE receivables SET state = 'overdue' WHERE id = ? AND state IN ('open','partial')", [r.id]);
      if (u.changes) {
        s.overdue_marked++;
        await claim(rt, { customer: r.customer_id, receivable: r.id, kind: 'overdue', stage: String(plan.daysPastDue), detail: `Quá hạn ${plan.daysPastDue} ngày, còn ${money(remaining)}`, key: `overdue:${r.id}` });
        await writeAudit(rt.db, { rt, ip: 'job', actorId: null }, { action: 'billing.receivable.overdue', objectType: 'receivable', objectId: r.id, customerId: r.customer_id, diff: { days_past_due: plan.daysPastDue, remaining_vnd: remaining } });
      }
    }

    if (plan.reminderOffset !== null) {
      const off = plan.reminderOffset;
      const evId = await claim(rt, { customer: r.customer_id, receivable: r.id, kind: 'reminder', stage: String(off), detail: off < 0 ? `Nhắc trước hạn ${-off} ngày` : off === 0 ? 'Nhắc đúng hạn' : `Nhắc quá hạn ${off} ngày`, key: `reminder:${r.id}:${off}` });
      if (evId) {
        const label = plan.daysPastDue < 0 ? `sẽ đến hạn sau ${-plan.daysPastDue} ngày` : plan.daysPastDue === 0 ? 'đến hạn hôm nay' : `đã quá hạn ${plan.daysPastDue} ngày`;
        const ref = r.period ? `hóa đơn kỳ ${r.period}` : 'khoản phải thu';
        const subject = plan.daysPastDue > 0 ? `[AMS] Nhắc thanh toán: ${ref} đã quá hạn ${plan.daysPastDue} ngày` : `[AMS] Nhắc thanh toán: ${ref} ${label}`;
        const text = `Kính gửi ${r.short_name ?? 'Quý khách'},\n\nKhoản thanh toán ${ref} (còn ${money(remaining)}, hạn ${r.due_date}) ${label}. Vui lòng thanh toán để tránh gián đoạn dịch vụ quảng cáo.\n\nNếu đã thanh toán, xin bỏ qua thư này.`;
        const html = `<p>Kính gửi ${esc(r.short_name ?? 'Quý khách')},</p><p>Khoản thanh toán <b>${esc(ref)}</b> (còn <b>${esc(money(remaining))}</b>, hạn ${esc(r.due_date)}) ${esc(label)}.</p><p>Vui lòng thanh toán để tránh gián đoạn dịch vụ quảng cáo. Nếu đã thanh toán, xin bỏ qua thư này.</p>`;
        const inApp = () => rt.db.run('INSERT INTO notifications (id, admin_id, customer_id, kind, title, body, ref_type, ref_id, created_at) VALUES (?,NULL,?,?,?,?,?,?,?)', [rt.id(), r.customer_id, 'payment_reminder', `Nhắc thanh toán: ${ref} ${label}`, `Còn ${money(remaining)}, hạn ${r.due_date}.`, 'receivable', r.id, rt.clock.now().toISOString()]);
        if (!cfg.send_emails) {
          await rt.db.run("UPDATE dunning_events SET detail = COALESCE(detail,'') || ' (không gửi email: tắt trong cài đặt)' WHERE id = ?", [evId]);
          await inApp();
        } else if (await sendMails(rt, rt.db, r.customer_id, subject, html, text)) {
          await rt.db.run('UPDATE dunning_events SET mail_sent = 1 WHERE id = ?', [evId]);
          await inApp();
          s.reminders_sent++;
        } else {
          await release(rt, evId); // lan chay sau thu lai (SMTP loi / khach chua co email)
          s.reminders_failed++;
        }
      }
    }
    if (plan.autoPause) {
      const cur = pauseCustomers.get(r.customer_id);
      if (!cur || plan.daysPastDue > cur.days) pauseCustomers.set(r.customer_id, { receivable: r.id, days: plan.daysPastDue, amount: remaining });
    }
  }

  // tu tam dung chien dich dang chay/da len lich cua khach qua han vuot nguong (giu nguyen tien da giu; mo lai thu cong sau khi thu no)
  for (const [customerId, v] of pauseCustomers) {
    const camps = await rt.db.query<{ id: string; state: string }>("SELECT id, state FROM campaigns WHERE customer_id = ? AND state IN ('active','scheduled')", [customerId]);
    if (!camps.length) continue;
    const evId = await claim(rt, { customer: customerId, receivable: v.receivable, kind: 'auto_pause', stage: String(v.days), detail: `Tự tạm dừng ${camps.length} chiến dịch: nợ quá hạn ${v.days} ngày`, key: `autopause:${v.receivable}` });
    if (!evId) continue;
    const nowIso = rt.clock.now().toISOString();
    let paused = 0;
    for (const c of camps) {
      const n = await rt.db.tx(async (db) => {
        const ch = await transitionCampaign(db, { id: c.id, from: c.state as CampaignState, to: 'paused', nowIso, allowNone: true });
        if (ch) await writeAudit(db, { rt, ip: 'job', actorId: null }, { action: 'campaign.pause', objectType: 'campaign', objectId: c.id, customerId, diff: { state: { from: c.state, to: 'paused' }, reason: 'dunning_auto_pause', days_past_due: v.days } });
        return ch;
      });
      paused += n;
    }
    if (paused) {
      s.campaigns_paused += paused;
      s.customers_paused++;
      await bumpManifest(rt);
      await rt.db.run('INSERT INTO notifications (id, admin_id, customer_id, kind, title, body, ref_type, ref_id, created_at) VALUES (?,NULL,?,?,?,?,?,?,?)', [rt.id(), customerId, 'campaign_auto_paused', 'Chiến dịch tạm dừng do công nợ quá hạn', `Đã tạm dừng ${paused} chiến dịch vì công nợ quá hạn ${v.days} ngày (còn ${money(v.amount)}). Thanh toán xong, liên hệ AMS để mở lại.`, 'receivable', v.receivable, nowIso]);
      if (cfg.send_emails) {
        const t = `Đã tạm dừng ${paused} chiến dịch quảng cáo của quý khách vì công nợ quá hạn ${v.days} ngày (còn ${money(v.amount)}). Sau khi thanh toán, liên hệ AMS để mở lại chiến dịch.`;
        if (await sendMails(rt, rt.db, customerId, '[AMS] Chiến dịch tạm dừng do công nợ quá hạn', `<p>${esc(t)}</p>`, t)) await rt.db.run('UPDATE dunning_events SET mail_sent = 1 WHERE id = ?', [evId]);
      }
    } else {
      await release(rt, evId);
    }
  }

  // han muc cong no: cong no > han muc (han muc > 0) => su kien + thong bao (mot lan moi ngay)
  if (cfg.enforce_credit_limit) {
    const custs = await rt.db.query<{ id: string; credit_limit_vnd: number }>("SELECT id, credit_limit_vnd FROM customers WHERE credit_limit_vnd > 0 AND state <> 'terminated'");
    for (const c of custs) {
      const o = await outstandingOf(rt.db, c.id);
      if (!exceedsCreditLimit(num(c.credit_limit_vnd), o.outstanding)) continue;
      const evId = await claim(rt, { customer: c.id, kind: 'credit_limit', stage: today, detail: `Công nợ ${money(o.outstanding)} vượt hạn mức ${money(num(c.credit_limit_vnd))}`, key: `credit_limit:${c.id}:${today}` });
      if (evId) {
        s.credit_limit_events++;
        await rt.db.run('INSERT INTO notifications (id, admin_id, customer_id, kind, title, body, ref_type, ref_id, created_at) VALUES (?,NULL,NULL,?,?,?,?,?,?)', [rt.id(), 'credit_limit_exceeded', 'Khách vượt hạn mức công nợ', `Công nợ ${money(o.outstanding)} vượt hạn mức ${money(num(c.credit_limit_vnd))}.`, 'customer', c.id, rt.clock.now().toISOString()]);
      }
    }
  }

  // canh bao so du thap qua email (cung dieu kien voi thong bao trong ung dung cua payments: kha dung <= nguong% tong da nap)
  if (cfg.low_balance_email) {
    const ws = await rt.db.query<{ customer_id: string; pct: unknown; bal: unknown; res: unknown; funded: unknown }>(
      `SELECT w.customer_id, w.low_balance_alert_pct AS pct, w.balance_vnd AS bal, w.reserved_vnd AS res,
         COALESCE((SELECT SUM(amount_vnd) FROM topups t WHERE t.customer_id = w.customer_id AND t.status = 'credited'),0) AS funded FROM ad_wallets w`);
    for (const w of ws) {
      const funded = num(w.funded);
      const avail = num(w.bal) - num(w.res);
      if (funded <= 0 || avail * 100 >= funded * num(w.pct)) continue;
      const evId = await claim(rt, { customer: w.customer_id, kind: 'low_balance', stage: today, detail: `Khả dụng ${money(avail)} < ${num(w.pct)}% đã nạp`, key: `lowbal:${w.customer_id}:${today}` });
      if (!evId) continue;
      if (!cfg.send_emails) continue;
      const t = `Số dư khả dụng ví quảng cáo của quý khách còn ${money(avail)} (dưới ${num(w.pct)}% tổng đã nạp). Vui lòng nạp thêm để chiến dịch không bị gián đoạn.`;
      if (await sendMails(rt, rt.db, w.customer_id, '[AMS] Số dư ví quảng cáo sắp hết', `<p>${esc(t)}</p>`, t)) {
        await rt.db.run('UPDATE dunning_events SET mail_sent = 1 WHERE id = ?', [evId]);
        s.low_balance_emails++;
      } else await release(rt, evId);
    }
  }
  return s;
}
