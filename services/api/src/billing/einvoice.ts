// Dich vu hoa don dien tu: phat hanh / huy / dieu chinh / tra cuu / thu lai. Moi chung tu = 1 dong einvoice_documents co khoa idempotency.
// An toan: (1) chen dong TRUOC khi goi mang, bang INSERT co dieu kien theo idempotency_key => hai yeu cau song song/thu lai khong tao hai chung tu;
// (2) loi tam thoi => 'pending' + next_retry_at (lui 1p..12h, toi da 6 lan roi 'failed'); loi tu choi => 'failed' ngay; (3) khong bao gio cham so cai vi.
import type { Db, Runtime } from '@ams/runtime';
import { EINVOICE_MAX_ATTEMPTS, adjustmentAmounts, einvoiceIdempotencyKey, einvoiceRetryDelaySec } from '@ams/shared';
import type { EinvoiceKind } from '@ams/shared';
import { writeAudit } from '../lib/audit.js';
import { AAD, decField } from '../lib/crypto.js';
import { HttpError, conflict, notFound, unprocessable } from '../lib/errors.js';
import { jsonParse, num } from '../lib/http.js';
import { vatOf } from '../routes/invoices.js';
import {
  DEFAULT_EINVOICE, EINVOICE_SETTINGS_KEY, EinvoiceConfigError, EinvoiceRejectedError, EinvoiceTransientError, createProvider, providerConfigFromEnv, providerConfigured,
} from './einvoice-providers.js';
import type { EinvoiceProvider, EinvoiceRef, EinvoiceRequest, EinvoiceResult, EinvoiceSettings } from './einvoice-providers.js';

export interface DocRow {
  id: string;
  invoice_id: string;
  customer_id: string;
  provider: string;
  sandbox: number;
  kind: EinvoiceKind;
  status: 'pending' | 'issued' | 'failed' | 'cancelled';
  idempotency_key: string;
  einvoice_no: string | null;
  series: string | null;
  lookup_code: string | null;
  provider_ref: string | null;
  issue_date: string | null;
  tax_authority_code: string | null;
  amount_vnd: number;
  vat_vnd: number;
  total_vnd: number;
  adjusts_document_id: string | null;
  reason: string | null;
  refund_request_id: string | null;
  attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}
export const DOC_COLS = 'id, invoice_id, customer_id, provider, sandbox, kind, status, idempotency_key, einvoice_no, series, lookup_code, provider_ref, issue_date, tax_authority_code, amount_vnd, vat_vnd, total_vnd, adjusts_document_id, reason, refund_request_id, attempts, last_error, next_retry_at, created_at, updated_at';

export async function loadEinvoiceSettings(db: Db): Promise<EinvoiceSettings> {
  const raw = jsonParse<Partial<EinvoiceSettings>>((await db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [EINVOICE_SETTINGS_KEY]))[0]?.value, {});
  const provider = raw.provider === 'misa' || raw.provider === 'viettel' ? raw.provider : 'manual';
  return {
    provider,
    sandbox: raw.sandbox !== false, // an toan: mac dinh thu nghiem
    series: typeof raw.series === 'string' ? raw.series.slice(0, 20) : DEFAULT_EINVOICE.series,
    template_code: typeof raw.template_code === 'string' ? raw.template_code.slice(0, 20) : DEFAULT_EINVOICE.template_code,
    auto_issue: raw.auto_issue === true,
    auto_adjust_on_refund: raw.auto_adjust_on_refund !== false,
  };
}

export interface ProviderHooks {
  /** kiem thu: thay fetch that */
  fetchFn?: typeof fetch;
}
export const getProvider = (rt: Runtime, s: EinvoiceSettings, hooks: ProviderHooks = {}): EinvoiceProvider => createProvider(s, rt.config.env, () => rt.clock.now(), hooks.fetchFn);

/** Trang thai ket noi (KHONG tra bi mat): da cau hinh bien moi truong chua. */
export function connectionStatus(rt: Runtime, s: EinvoiceSettings): { provider: string; configured: boolean; missing: string[] } {
  if (s.provider === 'manual') return { provider: 'manual', configured: true, missing: [] };
  const c = providerConfigFromEnv(rt.config.env, s.provider, s.sandbox);
  const P = s.provider === 'misa' ? 'EINVOICE_MISA_' : 'EINVOICE_VIETTEL_';
  const missing: string[] = [];
  if (!c.baseUrl) missing.push(`${P}${s.sandbox ? 'SANDBOX_URL' : 'BASE_URL'}`);
  if (!c.clientId) missing.push(`${P}CLIENT_ID`);
  if (!c.signingSecret) missing.push(`${P}SECRET`);
  if (!c.sellerTaxCode) missing.push(`${P}SELLER_TAX_CODE`);
  return { provider: s.provider, configured: providerConfigured(c), missing };
}

interface InvoiceCtx {
  id: string;
  customer_id: string;
  period: string;
  amount_vnd: number;
  vat_rate: number;
  status: string;
  einvoice_ref: string | null;
  legal_name: string;
  tax_code_enc: string | null;
  address: string | null;
  email: string | null;
}
async function loadInvoiceCtx(db: Db, invoiceId: string): Promise<InvoiceCtx> {
  const r = (await db.query<InvoiceCtx>(
    `SELECT i.id, i.customer_id, i.period, i.amount_vnd, i.vat_rate, i.status, i.einvoice_ref, cu.legal_name, cu.tax_code_enc, cu.address, cu.email
       FROM invoices i JOIN customers cu ON cu.id = i.customer_id WHERE i.id = ?`, [invoiceId]))[0];
  if (!r) throw notFound('Không tìm thấy hóa đơn.');
  return r;
}
async function buyerOf(rt: Runtime, inv: InvoiceCtx) {
  let tax: string | null = null;
  if (inv.tax_code_enc) {
    try {
      tax = await decField(rt, inv.tax_code_enc, AAD.taxCode);
    } catch {
      tax = null;
    }
  }
  return { legal_name: inv.legal_name, tax_code: tax, address: inv.address, email: inv.email };
}

const refOf = (d: Pick<DocRow, 'einvoice_no' | 'series' | 'lookup_code' | 'provider_ref' | 'issue_date'>): EinvoiceRef => ({ einvoice_no: d.einvoice_no, series: d.series, lookup_code: d.lookup_code, provider_ref: d.provider_ref, issue_date: d.issue_date });

export const loadDoc = async (db: Db, id: string): Promise<DocRow> => {
  const d = (await db.query<DocRow>(`SELECT ${DOC_COLS} FROM einvoice_documents WHERE id = ?`, [id]))[0];
  if (!d) throw notFound('Không tìm thấy chứng từ hóa đơn điện tử.');
  return d;
};

interface Actor {
  id: string | null;
  ip: string;
}

/** Tao chung tu (idempotent theo khoa). Tra ve {doc, created}. */
async function claimDocument(rt: Runtime, db: Db, a: Actor, p: {
  invoice: InvoiceCtx; kind: EinvoiceKind; key: string; settings: EinvoiceSettings; amount: number; vat: number; total: number;
  adjusts?: string | null; reason?: string | null; refundRequestId?: string | null;
}): Promise<{ doc: DocRow; created: boolean }> {
  const now = rt.clock.now().toISOString();
  const id = rt.id();
  const r = await db.run(
    `INSERT INTO einvoice_documents (id, invoice_id, customer_id, provider, sandbox, kind, status, idempotency_key, series, amount_vnd, vat_vnd, total_vnd, adjusts_document_id, reason, refund_request_id, attempts, created_by, created_at, updated_at)
     SELECT ?,?,?,?,?,?, 'pending', ?, ?, CAST(? AS BIGINT), CAST(? AS BIGINT), CAST(? AS BIGINT), ?,?,?, 0, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM einvoice_documents WHERE idempotency_key = ?)`,
    [id, p.invoice.id, p.invoice.customer_id, p.settings.provider, p.settings.sandbox ? 1 : 0, p.kind, p.key, p.settings.series || null, p.amount, p.vat, p.total, p.adjusts ?? null, p.reason ?? null, p.refundRequestId ?? null, a.id, now, now, p.key],
  );
  const doc = (await db.query<DocRow>(`SELECT ${DOC_COLS} FROM einvoice_documents WHERE idempotency_key = ?`, [p.key]))[0]!;
  return { doc, created: r.changes === 1 };
}

/** Goi nha cung cap cho mot chung tu va ghi ket qua. KHONG nem loi nha cung cap: tra doc moi nhat (loi nam trong doc.last_error). */
async function dispatch(rt: Runtime, doc: DocRow, a: Actor, opts: { manualRef?: string | null; hooks?: ProviderHooks } = {}): Promise<DocRow> {
  if (doc.status === 'issued' || doc.status === 'cancelled') return doc;
  const settings = await loadEinvoiceSettings(rt.db);
  const provider = getProvider(rt, { ...settings, provider: doc.provider as EinvoiceSettings['provider'], sandbox: doc.sandbox === 1 }, opts.hooks);
  const inv = await loadInvoiceCtx(rt.db, doc.invoice_id);
  const original = doc.adjusts_document_id ? await loadDoc(rt.db, doc.adjusts_document_id) : null;
  const req: EinvoiceRequest = {
    idempotencyKey: doc.idempotency_key, kind: doc.kind, invoiceId: doc.invoice_id, period: inv.period, buyer: await buyerOf(rt, inv),
    amount_vnd: num(doc.amount_vnd), vat_rate: num(inv.vat_rate), vat_vnd: num(doc.vat_vnd), total_vnd: num(doc.total_vnd),
    series: doc.series ?? (settings.series || null), templateCode: settings.template_code || null, reason: doc.reason, original: original ? refOf(original) : null, manualRef: opts.manualRef ?? null,
  };
  const now = rt.clock.now();
  const attempts = num(doc.attempts) + 1;
  let res: EinvoiceResult | null = null;
  let error: string | null = null;
  let terminal = false;
  try {
    res = doc.kind === 'adjustment' ? await provider.adjust(req) : doc.kind === 'cancellation' ? await provider.cancel(req) : await provider.issue(req);
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
    // thieu cau hinh / bi tu choi: khong thu lai (can nguoi); loi tam thoi: lui roi thu lai
    terminal = e instanceof EinvoiceRejectedError || e instanceof EinvoiceConfigError;
    if (!(e instanceof EinvoiceTransientError) && !terminal) throw e;
  }
  const nowIso = now.toISOString();
  if (res && res.status === 'failed') {
    res = null;
    error = 'Nhà cung cấp báo chứng từ thất bại.';
    terminal = true;
  }
  if (res) {
    const status = res.status === 'issued' || res.status === 'cancelled' ? (doc.kind === 'cancellation' ? 'cancelled' : res.status === 'cancelled' ? 'cancelled' : 'issued') : 'pending';
    await rt.db.tx(async (db) => {
      await db.run(
        `UPDATE einvoice_documents SET status = ?, einvoice_no = COALESCE(?, einvoice_no), series = COALESCE(?, series), lookup_code = COALESCE(?, lookup_code), provider_ref = COALESCE(?, provider_ref),
           issue_date = COALESCE(?, issue_date), tax_authority_code = COALESCE(?, tax_authority_code), attempts = ?, last_error = NULL, next_retry_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        [status, res!.einvoice_no, res!.series, res!.lookup_code, res!.provider_ref, res!.issue_date ?? (status === 'pending' ? null : nowIso.slice(0, 10)), res!.tax_authority_code, attempts, nowIso, doc.id],
      );
      if (status === 'issued' && doc.kind === 'original' && res!.einvoice_no) {
        // dong bo cot einvoice_ref cu (cong khach/hoa don noi bo van doc cot nay)
        await db.run('UPDATE invoices SET einvoice_ref = ? WHERE id = ?', [[res!.series, res!.einvoice_no].filter(Boolean).join('-'), doc.invoice_id]);
      }
      await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: `einvoice.${doc.kind}.${status}`, objectType: 'einvoice', objectId: doc.id, customerId: doc.customer_id, diff: { invoice_id: doc.invoice_id, provider: doc.provider, sandbox: doc.sandbox === 1, einvoice_no: res!.einvoice_no, total_vnd: num(doc.total_vnd) } });
    });
  } else {
    const delay = terminal ? null : einvoiceRetryDelaySec(attempts);
    const failed = terminal || delay === null || attempts >= EINVOICE_MAX_ATTEMPTS;
    await rt.db.run(
      "UPDATE einvoice_documents SET status = ?, attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      [failed ? 'failed' : 'pending', attempts, error, failed ? null : new Date(now.getTime() + (delay ?? 0) * 1000).toISOString(), nowIso, doc.id],
    );
    await writeAudit(rt.db, { rt, ip: a.ip, actorId: a.id }, { action: `einvoice.${doc.kind}.${failed ? 'failed' : 'retry_scheduled'}`, objectType: 'einvoice', objectId: doc.id, customerId: doc.customer_id, diff: { attempts, error } });
  }
  return loadDoc(rt.db, doc.id);
}

/** Phat hanh hoa don dien tu cho hoa don noi bo da issued/paid. Idempotent: da co chung tu goc con hieu luc thi tra lai chung tu do. */
export async function issueEinvoice(rt: Runtime, invoiceId: string, a: Actor, opts: { manualRef?: string | null; hooks?: ProviderHooks } = {}): Promise<{ doc: DocRow; created: boolean }> {
  const inv = await loadInvoiceCtx(rt.db, invoiceId);
  if (!['issued', 'paid'].includes(inv.status)) throw conflict('Chỉ phát hành hóa đơn điện tử cho hóa đơn đã phát hành.', 'invalid_state');
  const settings = await loadEinvoiceSettings(rt.db);
  const amount = num(inv.amount_vnd);
  const vat = vatOf(amount, num(inv.vat_rate));
  const { doc, created } = await claimDocument(rt, rt.db, a, { invoice: inv, kind: 'original', key: einvoiceIdempotencyKey(invoiceId, 'original'), settings, amount, vat, total: amount + vat });
  if (doc.status === 'issued' || doc.status === 'cancelled') return { doc, created: false };
  if (doc.status === 'failed') {
    // bam "thu lai" thu cong: dua ve pending de dispatch chay lai
    await rt.db.run("UPDATE einvoice_documents SET status = 'pending', next_retry_at = NULL, updated_at = ? WHERE id = ? AND status = 'failed'", [rt.clock.now().toISOString(), doc.id]);
    doc.status = 'pending';
  }
  return { doc: await dispatch(rt, doc, a, opts), created };
}

/** Hoa don dieu chinh giam khi hoan tien (refund gom VAT). Idempotent theo refund_request_id (hoac `ref` do nguoi goi dat). */
export async function adjustEinvoice(rt: Runtime, p: { invoiceId: string; refundTotalVnd: number; reason: string; refundRequestId?: string | null; ref?: string }, a: Actor, hooks?: ProviderHooks): Promise<{ doc: DocRow; created: boolean }> {
  const inv = await loadInvoiceCtx(rt.db, p.invoiceId);
  const orig = (await rt.db.query<DocRow>(`SELECT ${DOC_COLS} FROM einvoice_documents WHERE invoice_id = ? AND kind = 'original' AND status = 'issued' ORDER BY created_at LIMIT 1`, [inv.id]))[0];
  if (!orig) throw conflict('Hóa đơn này chưa có hóa đơn điện tử đã phát hành để điều chỉnh.', 'no_original_einvoice');
  const maxRefund = num(orig.total_vnd);
  const already = num((await rt.db.query<{ s: unknown }>("SELECT COALESCE(SUM(-total_vnd),0) AS s FROM einvoice_documents WHERE adjusts_document_id = ? AND kind = 'adjustment' AND status IN ('pending','issued')", [orig.id]))[0]?.s);
  if (p.refundTotalVnd <= 0 || p.refundTotalVnd + already > maxRefund) throw unprocessable('Số tiền điều chỉnh vượt tổng hóa đơn gốc.', 'adjustment_exceeds_original', { original_total_vnd: maxRefund, already_adjusted_vnd: already });
  const settings = await loadEinvoiceSettings(rt.db);
  const amt = adjustmentAmounts(p.refundTotalVnd, num(inv.vat_rate));
  const key = einvoiceIdempotencyKey(inv.id, 'adjustment', p.refundRequestId ?? p.ref ?? `${p.refundTotalVnd}`);
  const { doc, created } = await claimDocument(rt, rt.db, a, { invoice: inv, kind: 'adjustment', key, settings: { ...settings, provider: orig.provider as EinvoiceSettings['provider'], sandbox: orig.sandbox === 1 }, amount: amt.amount_vnd, vat: amt.vat_vnd, total: amt.total_vnd, adjusts: orig.id, reason: p.reason, refundRequestId: p.refundRequestId ?? null });
  return { doc: await dispatch(rt, doc, a, hooks ? { hooks } : {}), created };
}

/** Huy hoa don dien tu da phat hanh (khi huy hoa don noi bo da co chung tu CQT). */
export async function cancelEinvoice(rt: Runtime, docId: string, reason: string, a: Actor, hooks?: ProviderHooks): Promise<DocRow> {
  const orig = await loadDoc(rt.db, docId);
  if (orig.kind !== 'original' || orig.status !== 'issued') throw conflict('Chỉ hủy được hóa đơn điện tử gốc đã phát hành.', 'invalid_state');
  const inv = await loadInvoiceCtx(rt.db, orig.invoice_id);
  const settings = await loadEinvoiceSettings(rt.db);
  const { doc } = await claimDocument(rt, rt.db, a, { invoice: inv, kind: 'cancellation', key: einvoiceIdempotencyKey(inv.id, 'cancellation', orig.id), settings: { ...settings, provider: orig.provider as EinvoiceSettings['provider'], sandbox: orig.sandbox === 1 }, amount: num(orig.amount_vnd), vat: num(orig.vat_vnd), total: num(orig.total_vnd), adjusts: orig.id, reason });
  const done = await dispatch(rt, doc, a, hooks ? { hooks } : {});
  if (done.status === 'cancelled') await rt.db.run("UPDATE einvoice_documents SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'issued'", [rt.clock.now().toISOString(), orig.id]);
  return done;
}

/** Ke toan nhap so hoa don (che do thu cong) cho chung tu dang cho: pending -> issued. */
export async function confirmManual(rt: Runtime, docId: string, v: { einvoice_no: string; series?: string | null; lookup_code?: string | null; issue_date?: string | null }, a: Actor): Promise<DocRow> {
  const doc = await loadDoc(rt.db, docId);
  if (doc.status !== 'pending' && doc.status !== 'failed') throw conflict('Chứng từ không còn chờ nhập số.', 'invalid_state');
  const now = rt.clock.now().toISOString();
  await rt.db.tx(async (db) => {
    const u = await db.run(
      "UPDATE einvoice_documents SET status = ?, einvoice_no = ?, series = COALESCE(?, series), lookup_code = COALESCE(?, lookup_code), issue_date = ?, last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ? AND status IN ('pending','failed')",
      [doc.kind === 'cancellation' ? 'cancelled' : 'issued', v.einvoice_no, v.series ?? null, v.lookup_code ?? null, v.issue_date ?? now.slice(0, 10), now, doc.id],
    );
    if (u.changes !== 1) throw conflict('Chứng từ vừa được xử lý.', 'invalid_state');
    if (doc.kind === 'original') await db.run('UPDATE invoices SET einvoice_ref = ? WHERE id = ?', [[v.series, v.einvoice_no].filter(Boolean).join('-'), doc.invoice_id]);
    if (doc.kind === 'cancellation' && doc.adjusts_document_id) await db.run("UPDATE einvoice_documents SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'issued'", [now, doc.adjusts_document_id]);
    await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: `einvoice.${doc.kind}.manual_confirmed`, objectType: 'einvoice', objectId: doc.id, customerId: doc.customer_id, diff: { einvoice_no: v.einvoice_no, series: v.series ?? null } });
  });
  return loadDoc(rt.db, docId);
}

/** Tra cuu trang thai tai nha cung cap va cap nhat ma CQT/trang thai. Che do thu cong: khong lam gi. */
export async function refreshEinvoice(rt: Runtime, docId: string, a: Actor, hooks?: ProviderHooks): Promise<DocRow> {
  const doc = await loadDoc(rt.db, docId);
  if (doc.provider === 'manual') return doc;
  const provider = getProvider(rt, { ...(await loadEinvoiceSettings(rt.db)), provider: doc.provider as EinvoiceSettings['provider'], sandbox: doc.sandbox === 1 }, hooks);
  try {
    const s = await provider.fetchStatus(refOf(doc));
    await rt.db.run('UPDATE einvoice_documents SET tax_authority_code = COALESCE(?, tax_authority_code), status = CASE WHEN ? = \'cancelled\' AND status = \'issued\' THEN \'cancelled\' ELSE status END, updated_at = ? WHERE id = ?', [s.tax_authority_code, s.status, rt.clock.now().toISOString(), doc.id]);
    await writeAudit(rt.db, { rt, ip: a.ip, actorId: a.id }, { action: 'einvoice.refresh', objectType: 'einvoice', objectId: doc.id, customerId: doc.customer_id, diff: { provider_status: s.status } });
  } catch (e) {
    if (e instanceof EinvoiceTransientError || e instanceof EinvoiceRejectedError || e instanceof EinvoiceConfigError) throw new HttpError(502, 'einvoice_provider_error', e.message);
    throw e;
  }
  return loadDoc(rt.db, docId);
}

/** Job: thu lai cac chung tu pending den han. */
export async function retryDueEinvoices(rt: Runtime, hooks?: ProviderHooks): Promise<{ retried: number; issued: number; failed: number }> {
  const now = rt.clock.now().toISOString();
  const due = await rt.db.query<DocRow>(`SELECT ${DOC_COLS} FROM einvoice_documents WHERE status = 'pending' AND next_retry_at IS NOT NULL AND next_retry_at <= ? ORDER BY next_retry_at LIMIT 50`, [now]);
  let issued = 0;
  let failed = 0;
  for (const d of due) {
    const r = await dispatch(rt, d, { id: null, ip: 'job' }, hooks ? { hooks } : {});
    if (r.status === 'issued' || r.status === 'cancelled') issued++;
    else if (r.status === 'failed') failed++;
  }
  return { retried: due.length, issued, failed };
}

/** Job: hoan tien da chi (refund_requests.status = 'paid') chua co hoa don dieu chinh => tao (neu bat auto_adjust_on_refund va co hoa don dien tu goc du lon).
 *  Khong tim duoc hoa don goc: gui thong bao cho tai chinh (khong lam mat dau vet). */
export async function adjustPaidRefunds(rt: Runtime, hooks?: ProviderHooks): Promise<{ adjusted: number; unmatched: number }> {
  const settings = await loadEinvoiceSettings(rt.db);
  if (!settings.auto_adjust_on_refund) return { adjusted: 0, unmatched: 0 };
  const refunds = await rt.db.query<{ id: string; customer_id: string; amount_vnd: number }>(
    `SELECT r.id, r.customer_id, r.amount_vnd FROM refund_requests r
      WHERE r.status = 'paid' AND NOT EXISTS (SELECT 1 FROM einvoice_documents d WHERE d.refund_request_id = r.id) ORDER BY r.created_at LIMIT 50`);
  let adjusted = 0;
  let unmatched = 0;
  for (const r of refunds) {
    const orig = (await rt.db.query<DocRow>(
      `SELECT ${DOC_COLS} FROM einvoice_documents WHERE customer_id = ? AND kind = 'original' AND status = 'issued' AND total_vnd >= ? ORDER BY issue_date DESC, created_at DESC LIMIT 1`, [r.customer_id, num(r.amount_vnd)]))[0];
    if (!orig) {
      unmatched++;
      const dedupe = `einvoice_adjust_unmatched:${r.id}`;
      const claim = await rt.db.run('INSERT INTO dunning_events (id, customer_id, receivable_id, kind, stage, detail, mail_sent, created_at, dedupe_key) SELECT ?,?,NULL,?,?,?,0,?,? WHERE NOT EXISTS (SELECT 1 FROM dunning_events WHERE dedupe_key = ?)', [rt.id(), r.customer_id, 'einvoice_adjust', 'unmatched', `Hoàn tiền ${r.id} chưa có hóa đơn điện tử gốc để điều chỉnh`, rt.clock.now().toISOString(), dedupe, dedupe]);
      if (claim.changes) await rt.db.run('INSERT INTO notifications (id, admin_id, customer_id, kind, title, body, ref_type, ref_id, read_at, created_at) VALUES (?,NULL,NULL,?,?,?,?,?,NULL,?)', [rt.id(), 'einvoice_adjust_needed', 'Hoàn tiền cần hóa đơn điều chỉnh', `Hoàn tiền ${r.id} (${num(r.amount_vnd).toLocaleString('vi-VN')} ₫) chưa khớp hóa đơn điện tử gốc. Kế toán xử lý thủ công.`, 'refund_request', r.id, rt.clock.now().toISOString()]);
      continue;
    }
    try {
      const x = await adjustEinvoice(rt, { invoiceId: orig.invoice_id, refundTotalVnd: num(r.amount_vnd), reason: 'Hoàn tiền ví quảng cáo chưa sử dụng', refundRequestId: r.id }, { id: null, ip: 'job' }, hooks);
      if (x.created) adjusted++;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      unmatched++;
    }
  }
  return { adjusted, unmatched };
}
