// Hoa don dien tu (admin) va hoa don dien tu cua chinh khach (portal). Cong no/nhac no: dunning-routes.ts.
import { Hono } from 'hono';
import { z } from 'zod';
import { EINVOICE_PROVIDERS } from '@ams/shared';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict } from '../lib/errors.js';
import { eq, getRt, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec, SqlFrag } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';
import { DOC_COLS, adjustEinvoice, cancelEinvoice, confirmManual, connectionStatus, issueEinvoice, loadDoc, loadEinvoiceSettings, refreshEinvoice, retryDueEinvoices } from './einvoice.js';
import type { DocRow, ProviderHooks } from './einvoice.js';
import { EINVOICE_SETTINGS_KEY } from './einvoice-providers.js';

const presentDoc = (d: DocRow) => ({ ...d, sandbox: num(d.sandbox) === 1, amount_vnd: num(d.amount_vnd), vat_vnd: num(d.vat_vnd), total_vnd: num(d.total_vnd), attempts: num(d.attempts) });
const actorOf = (c: Ctx) => ({ id: c.get('user').id as string | null, ip: c.get('ip') });

const docSpec = (scope: SqlFrag[], internal: boolean): ListSpec => ({
  from: 'FROM einvoice_documents d JOIN customers cu ON cu.id = d.customer_id JOIN invoices i ON i.id = d.invoice_id',
  select: `${DOC_COLS.split(', ').map((c) => `d.${c}`).join(', ')}, cu.short_name AS customer, i.period`,
  where: scope,
  search: internal ? ['cu.short_name', 'd.einvoice_no', 'i.period'] : ['d.einvoice_no', 'i.period'],
  sorts: { created_at: 'd.created_at', status: 'd.status', kind: 'd.kind', customer: 'cu.short_name', total_vnd: 'd.total_vnd' },
  defaultSort: 'created_at:desc',
  tiebreak: 'd.id',
  filters: { status: eq('d.status'), kind: eq('d.kind'), ...(internal ? { customer_id: eq('d.customer_id'), invoice_id: eq('d.invoice_id') } : {}) },
});

/** `hooks` chi de kiem thu (thay fetch that). */
export function einvoiceRoutes(hooks: ProviderHooks = {}): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/settings', requirePerm('finance', 'view'), async (c) => {
    const rt = getRt(c);
    const s = await loadEinvoiceSettings(rt.db);
    return c.json({ settings: s, providers: EINVOICE_PROVIDERS, connection: connectionStatus(rt, s) });
  });
  r.put('/settings', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({
      provider: z.enum(EINVOICE_PROVIDERS), sandbox: z.boolean(), series: z.string().trim().max(20).default(''), template_code: z.string().trim().max(20).default(''),
      auto_issue: z.boolean().default(false), auto_adjust_on_refund: z.boolean().default(true),
      confirm_production: z.boolean().optional(),
    }));
    // tat sandbox voi nha cung cap that = phat hanh hoa don co gia tri phap ly: phai xac nhan ro rang
    if (b.provider !== 'manual' && !b.sandbox && b.confirm_production !== true) throw conflict('Bật chế độ thật (không phải sandbox) cần xác nhận kế toán đã kiểm thử và đăng ký mẫu số/ký hiệu hóa đơn.', 'confirm_production_required');
    const before = await loadEinvoiceSettings(rt.db);
    const { confirm_production: _cp, ...val } = b;
    void _cp;
    await rt.db.tx(async (db) => {
      await db.run(
        'INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        [EINVOICE_SETTINGS_KEY, JSON.stringify(val), c.get('user').id, rt.clock.now().toISOString()],
      );
      await auditCtx(c, db, { action: 'einvoice.settings.update', objectType: 'settings', objectId: EINVOICE_SETTINGS_KEY, diff: { before, after: val } });
    });
    const s = await loadEinvoiceSettings(rt.db);
    return c.json({ settings: s, connection: connectionStatus(rt, s) });
  });

  r.get('/', requirePerm('finance', 'view'), async (c) => {
    const res = await runList<DocRow>(c, docSpec([], true));
    return c.json({ ...res, items: res.items.map(presentDoc) });
  });
  r.get('/:id', requirePerm('finance', 'view'), async (c) => c.json(presentDoc(await loadDoc(getRt(c).db, c.req.param('id')))));

  // Gui hoa don noi bo (da issued/paid) sang nha cung cap. Idempotent: da phat hanh thi tra lai chung tu cu.
  r.post('/invoice/:invoiceId/issue', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ manual_ref: z.string().trim().min(1).max(64).optional() }));
    const { doc, created } = await issueEinvoice(rt, c.req.param('invoiceId'), actorOf(c), { manualRef: b.manual_ref ?? null, hooks });
    return c.json({ ...presentDoc(doc), created }, created ? 201 : 200);
  });
  r.post('/adjust', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({
      invoice_id: z.string().min(1).max(64), refund_total_vnd: z.number().int().min(1).max(1_000_000_000_000), reason: z.string().trim().min(3).max(300),
      refund_request_id: z.string().max(64).optional(), manual_ref: z.string().trim().min(1).max(64).optional(),
    }));
    const { doc, created } = await adjustEinvoice(rt, { invoiceId: b.invoice_id, refundTotalVnd: b.refund_total_vnd, reason: b.reason, ...(b.refund_request_id ? { refundRequestId: b.refund_request_id } : {}) }, actorOf(c), hooks);
    if (b.manual_ref && doc.status === 'pending') return c.json({ ...presentDoc(await confirmManual(rt, doc.id, { einvoice_no: b.manual_ref }, actorOf(c))), created }, created ? 201 : 200);
    return c.json({ ...presentDoc(doc), created }, created ? 201 : 200);
  });
  r.post('/:id/cancel', requirePerm('finance', 'approve'), async (c) => {
    const b = await parseBody(c, z.object({ reason: z.string().trim().min(3).max(300) }));
    return c.json(presentDoc(await cancelEinvoice(getRt(c), c.req.param('id'), b.reason, actorOf(c), hooks)));
  });
  r.post('/:id/confirm', requirePerm('finance', 'approve'), async (c) => {
    const b = await parseBody(c, z.object({ einvoice_no: z.string().trim().min(1).max(64), series: z.string().trim().max(20).optional(), lookup_code: z.string().trim().max(64).optional(), issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
    return c.json(presentDoc(await confirmManual(getRt(c), c.req.param('id'), { einvoice_no: b.einvoice_no, series: b.series ?? null, lookup_code: b.lookup_code ?? null, issue_date: b.issue_date ?? null }, actorOf(c))));
  });
  r.post('/:id/refresh', requirePerm('finance', 'approve'), async (c) => c.json(presentDoc(await refreshEinvoice(getRt(c), c.req.param('id'), actorOf(c), hooks))));
  r.post('/:id/retry', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const d = await loadDoc(rt.db, c.req.param('id'));
    if (d.status !== 'failed' && d.status !== 'pending') throw conflict('Chỉ thử lại chứng từ đang chờ hoặc lỗi.', 'invalid_state');
    if (d.kind === 'original') return c.json(presentDoc((await issueEinvoice(rt, d.invoice_id, actorOf(c), { hooks })).doc));
    await rt.db.run("UPDATE einvoice_documents SET status = 'pending', next_retry_at = ? WHERE id = ? AND status IN ('failed','pending')", [rt.clock.now().toISOString(), d.id]);
    await retryDueEinvoices(rt, hooks);
    return c.json(presentDoc(await loadDoc(rt.db, d.id)));
  });
  return r;
}

/** Khach hang: chung tu hoa don dien tu da phat hanh cua chinh minh (loc trong SQL). */
export function portalEinvoiceRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('*', requirePerm('finance', 'view'));
  const scope = (c: Ctx): SqlFrag => ({ sql: "d.customer_id = ? AND d.status = 'issued'", params: [c.get('user').customerId ?? ''] });
  r.get('/', async (c) => {
    const res = await runList<DocRow>(c, docSpec([scope(c)], false));
    return c.json({ ...res, items: res.items.map((d) => { const p = presentDoc(d); return { id: p.id, invoice_id: p.invoice_id, kind: p.kind, einvoice_no: p.einvoice_no, series: p.series, lookup_code: p.lookup_code, issue_date: p.issue_date, total_vnd: p.total_vnd, period: (d as unknown as { period: string }).period }; }) });
  });
  return r;
}
