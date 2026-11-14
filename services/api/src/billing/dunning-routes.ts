// Cong no + nhac no (admin): khoan phai thu, cai dat nhac no, lich su, chay ngay.
import { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_DUNNING, DUNNING_SETTINGS_KEY, daysPastDue, parseDunningConfig } from '@ams/shared';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { notFound } from '../lib/errors.js';
import { eq, getRt, num, parseBody, runList } from '../lib/http.js';
import type { ListSpec } from '../lib/http.js';
import { todayVn } from '../lib/dates.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';
import { retryDueEinvoices } from './einvoice.js';
import { loadDunningConfig, outstandingOf, runDunning } from './dunning.js';

// ---------------- cong no + nhac no ----------------
const recvSpec: ListSpec = {
  from: 'FROM receivables r JOIN customers cu ON cu.id = r.customer_id LEFT JOIN invoices i ON i.id = r.invoice_id',
  select: 'r.id, r.customer_id, cu.short_name AS customer, cu.credit_limit_vnd, r.invoice_id, i.period, r.amount_vnd, r.paid_vnd, r.due_date, r.state',
  search: ['cu.short_name', 'i.period'],
  sorts: { due_date: 'r.due_date', amount_vnd: 'r.amount_vnd', state: 'r.state', customer: 'cu.short_name' },
  defaultSort: 'due_date:asc',
  tiebreak: 'r.id',
  filters: { state: eq('r.state'), customer_id: eq('r.customer_id'), unpaid: () => ({ sql: "r.state <> 'paid'", params: [] }) },
};

export function dunningRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/settings', requirePerm('finance', 'view'), async (c) => c.json({ settings: await loadDunningConfig(getRt(c).db), defaults: DEFAULT_DUNNING }));
  r.put('/settings', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({
      reminder_offsets_days: z.array(z.number().int().min(-30).max(120)).max(12), auto_pause_after_days: z.number().int().min(0).max(365),
      enforce_credit_limit: z.boolean(), low_balance_email: z.boolean(), send_emails: z.boolean(),
    }));
    const val = parseDunningConfig(b);
    const before = await loadDunningConfig(rt.db);
    await rt.db.tx(async (db) => {
      await db.run(
        'INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        [DUNNING_SETTINGS_KEY, JSON.stringify(val), c.get('user').id, rt.clock.now().toISOString()],
      );
      await auditCtx(c, db, { action: 'billing.dunning.settings', objectType: 'settings', objectId: DUNNING_SETTINGS_KEY, diff: { before, after: val } });
    });
    return c.json({ settings: val });
  });

  r.get('/receivables', requirePerm('finance', 'view'), async (c) => {
    const rt = getRt(c);
    const today = todayVn(rt);
    const res = await runList<{ id: string; customer_id: string; customer: string; credit_limit_vnd: number; invoice_id: string | null; period: string | null; amount_vnd: number; paid_vnd: number; due_date: string | null; state: string }>(c, recvSpec);
    return c.json({
      ...res,
      items: res.items.map((x) => ({ ...x, amount_vnd: num(x.amount_vnd), paid_vnd: num(x.paid_vnd), remaining_vnd: num(x.amount_vnd) - num(x.paid_vnd), credit_limit_vnd: num(x.credit_limit_vnd), days_past_due: x.due_date && x.state !== 'paid' ? daysPastDue(x.due_date, today) : 0 })),
    });
  });
  r.get('/summary', requirePerm('finance', 'view'), async (c) => {
    const rt = getRt(c);
    const rows = await rt.db.query<{ state: string; n: unknown; s: unknown }>("SELECT state, COUNT(*) AS n, COALESCE(SUM(amount_vnd - paid_vnd),0) AS s FROM receivables WHERE state <> 'paid' GROUP BY state");
    const by = Object.fromEntries(rows.map((x) => [x.state, { count: num(x.n), remaining_vnd: num(x.s) }]));
    const paused = num((await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM dunning_events WHERE kind = 'auto_pause'"))[0]?.n);
    return c.json({ by_state: by, total_outstanding_vnd: Object.values(by).reduce((a, b) => a + b.remaining_vnd, 0), auto_pause_events: paused });
  });
  r.get('/customers/:id', requirePerm('finance', 'view'), async (c) => {
    const rt = getRt(c);
    const cu = (await rt.db.query<{ id: string; short_name: string; credit_limit_vnd: unknown }>('SELECT id, short_name, credit_limit_vnd FROM customers WHERE id = ?', [c.req.param('id')]))[0];
    if (!cu) throw notFound('Không tìm thấy khách hàng.');
    return c.json({ customer_id: cu.id, customer: cu.short_name, credit_limit_vnd: num(cu.credit_limit_vnd), ...(await outstandingOf(rt.db, cu.id)) });
  });
  r.get('/events', requirePerm('finance', 'view'), async (c) => {
    const res = await runList<Record<string, unknown>>(c, {
      from: 'FROM dunning_events e JOIN customers cu ON cu.id = e.customer_id',
      select: 'e.id, e.customer_id, cu.short_name AS customer, e.receivable_id, e.kind, e.stage, e.detail, e.mail_sent, e.created_at',
      search: ['cu.short_name', 'e.detail'],
      sorts: { created_at: 'e.created_at', kind: 'e.kind', customer: 'cu.short_name' },
      defaultSort: 'created_at:desc',
      tiebreak: 'e.id',
      filters: { kind: eq('e.kind'), customer_id: eq('e.customer_id') },
    });
    return c.json({ ...res, items: res.items.map((x) => ({ ...x, mail_sent: num(x['mail_sent']) === 1 })) });
  });
  // Chay ngay (cung logic job hang ngay): dung de kiem tra / sau khi doi cai dat
  r.post('/run', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const summary = await runDunning(rt);
    const einv = await retryDueEinvoices(rt);
    await auditCtx(c, rt.db, { action: 'billing.dunning.run', objectType: 'job', diff: { summary, einvoice_retry: einv } });
    return c.json({ summary, einvoice_retry: einv });
  });
  return r;
}
