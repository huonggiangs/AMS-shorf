// Soan hop dong: nap mau mac dinh, dung bien tu ho so, dung mo hinh van ban (de xem truoc, chot, xuat PDF).
import type { Db, Runtime } from '@ams/runtime';
import {
  CONTRACT_VARIABLES,
  CONTRACT_VARIABLE_KEYS,
  contractContentHash,
  contractPlainText,
  extractPlaceholders,
  renderArticles,
  viDateWords,
  vndToWordsVi,
} from '@ams/shared';
import type { ArticleOverrides, ContractArticle, PriceLine, PriceTable, RenderedArticle } from '@ams/shared';
import { AAD, decField } from '../lib/crypto.js';
import { addMonths, fmtDmy, todayVn } from '../lib/dates.js';
import { jsonParse, num } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { DEFAULT_TEMPLATE_ARTICLES, DEFAULT_TEMPLATE_CODE, DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_NOTE } from './default-template.js';
import type { ContractPdfInput } from './pdf.js';

export interface TemplateRow {
  id: string;
  code: string;
  version: number;
  name: string;
  articles: string;
  status: 'draft' | 'approved' | 'retired';
  lawyer_ref: string | null;
  approved_by: string | null;
  approved_at: string | null;
  change_note: string | null;
  created_by: string | null;
  created_at: string;
}
export const TPL_COLS = 'id, code, version, name, articles, status, lawyer_ref, approved_by, approved_at, change_note, created_by, created_at';

export interface DocRow {
  id: string;
  contract_id: string;
  template_id: string;
  version: number;
  status: 'draft' | 'final' | 'superseded';
  variables: string;
  article_overrides: string;
  snapshot: string | null;
  rendered_text: string | null;
  content_hash: string | null;
  finalized_by: string | null;
  finalized_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const DOC_COLS = 'id, contract_id, template_id, version, status, variables, article_overrides, snapshot, rendered_text, content_hash, finalized_by, finalized_at, created_by, created_at, updated_at';

/** Nap mau mac dinh (BAN NHAP) neu chua co mau nao. Idempotent, an toan khi chay song song. */
export async function ensureDefaultTemplate(rt: Runtime, db: Db = rt.db): Promise<void> {
  const exists = (await db.query('SELECT 1 AS x FROM contract_doc_templates WHERE code = ?', [DEFAULT_TEMPLATE_CODE]))[0];
  if (exists) return;
  await db.run(
    `INSERT INTO contract_doc_templates (id, code, version, name, articles, status, change_note, created_by, created_at)
     SELECT ?,?,?,?,?, 'draft', ?, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM contract_doc_templates WHERE code = ? AND version = ?)`,
    [rt.id(), DEFAULT_TEMPLATE_CODE, 1, DEFAULT_TEMPLATE_NAME, JSON.stringify(DEFAULT_TEMPLATE_ARTICLES), DEFAULT_TEMPLATE_NOTE, rt.clock.now().toISOString(), DEFAULT_TEMPLATE_CODE, 1],
  );
}

export const parseArticles = (s: string): ContractArticle[] => jsonParse<ContractArticle[]>(s, []);

export async function loadTemplate(db: Db, id: string): Promise<TemplateRow> {
  const t = (await db.query<TemplateRow>(`SELECT ${TPL_COLS} FROM contract_doc_templates WHERE id = ?`, [id]))[0];
  if (!t) throw notFound('Không tìm thấy mẫu hợp đồng.');
  return t;
}

/** Mau dung khi tao ban soan moi: ban da duyet moi nhat, neu chua co thi ban nhap moi nhat (ban soan se mang dau BAN NHAP). */
export async function pickDefaultTemplate(rt: Runtime): Promise<TemplateRow> {
  await ensureDefaultTemplate(rt);
  const t =
    (await rt.db.query<TemplateRow>(`SELECT ${TPL_COLS} FROM contract_doc_templates WHERE status = 'approved' ORDER BY version DESC, created_at DESC LIMIT 1`))[0] ??
    (await rt.db.query<TemplateRow>(`SELECT ${TPL_COLS} FROM contract_doc_templates WHERE status = 'draft' ORDER BY version DESC, created_at DESC LIMIT 1`))[0];
  if (!t) throw notFound('Chưa có mẫu hợp đồng.', 'template_not_found');
  return t;
}

const SCREEN_LABEL: Record<string, string> = { tv: 'Smart TV', elevator: 'Màn hình thang máy', led_p5: 'Bảng LED P5' };
const DAYPART_LABEL: Record<string, string> = { peak: 'Cao điểm', off_peak: 'Thấp điểm', all_day: 'Cả ngày' };
const isAny = (v: string | null | undefined): boolean => v === null || v === undefined || v === '' || v === '*';
const label = (map: Record<string, string>, v: string | null | undefined, any: string): string => (isAny(v) ? any : (map[v as string] ?? (v as string)));
const fmtNum = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export interface ContractContext {
  contractNo: string;
  contractId: string;
  customerId: string;
  title: string;
  state: string;
  price: PriceTable;
  auto: Record<string, string>;
  seller: { name: string; tax_code: string; address: string; phone: string; email: string };
}

/** Du lieu tu hop dong + khach + cai dat ben ban + dong gia, dung cho bien tu dong. */
export async function loadContext(rt: Runtime, contractId: string): Promise<ContractContext> {
  const ct = (
    await rt.db.query<{ id: string; no: string; customer_id: string; title: string; value_vnd: number; vat_rate: number; start_date: string | null; end_date: string | null; advance_pct: number; payment_terms: string | null; state: string }>(
      'SELECT id, no, customer_id, title, value_vnd, vat_rate, start_date, end_date, advance_pct, payment_terms, state FROM contracts WHERE id = ?',
      [contractId],
    )
  )[0];
  if (!ct) throw notFound('Không tìm thấy hợp đồng.');
  const cu = (
    await rt.db.query<{ legal_name: string; tax_code_enc: string | null; address: string | null; rep_name: string | null; rep_title: string | null; phone: string | null }>(
      'SELECT legal_name, tax_code_enc, address, rep_name, rep_title, phone FROM customers WHERE id = ?',
      [ct.customer_id],
    )
  )[0];
  if (!cu) throw notFound('Không tìm thấy khách hàng của hợp đồng.');
  const seller = jsonParse<Record<string, string>>((await rt.db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'seller'"))[0]?.value, {});
  let tax = '';
  if (cu.tax_code_enc) {
    try {
      tax = await decField(rt, cu.tax_code_enc, AAD.taxCode);
    } catch {
      tax = '';
    }
  }
  const raw = await rt.db.query<{ screen_type: string | null; region_id: string | null; daypart: string | null; frequency: number | null; duration_s: number | null; qty: number; impression_price_micro_vnd: unknown }>(
    'SELECT cl.screen_type, cl.region_id, cl.daypart, cl.frequency, cl.duration_s, cl.qty, p.impression_price_micro_vnd FROM contract_lines cl LEFT JOIN contract_line_prices p ON p.contract_line_id = cl.id WHERE cl.contract_id = ? ORDER BY cl.id',
    [ct.id],
  );
  const lines: PriceLine[] = raw.map((l) => {
    const micro = l.impression_price_micro_vnd === null || l.impression_price_micro_vnd === undefined ? null : num(l.impression_price_micro_vnd);
    return {
      screen_type: label(SCREEN_LABEL, l.screen_type, 'Tất cả'),
      region: isAny(l.region_id) ? 'Tất cả' : String(l.region_id),
      daypart: label(DAYPART_LABEL, l.daypart, 'Cả ngày'),
      frequency: l.frequency === null ? '—' : String(num(l.frequency)),
      duration_s: l.duration_s === null ? '—' : String(num(l.duration_s)),
      qty: num(l.qty, 1),
      impression_price_vnd: micro === null ? '' : (micro / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: false }),
    };
  });
  const value = num(ct.value_vnd);
  const vatRate = num(ct.vat_rate);
  const vat = Math.round((value * vatRate) / 100);
  const total = value + vat;
  const adv = num(ct.advance_pct);
  const start = ct.start_date ?? todayVn(rt);
  const end = ct.end_date ?? addMonths(start, 12);
  const auto: Record<string, string> = {
    'seller.name': seller['name'] ?? '',
    'seller.tax_code': seller['tax_code'] ?? '',
    'seller.address': seller['address'] ?? '',
    'seller.rep': seller['rep'] ?? '',
    'seller.email': seller['email'] ?? '',
    'seller.phone': seller['phone'] ?? '',
    'customer.legal_name': cu.legal_name,
    'customer.tax_code': tax,
    'customer.address': cu.address ?? '',
    'customer.rep_name': cu.rep_name ?? '',
    'customer.rep_title': cu.rep_title ?? '',
    'customer.phone': cu.phone ?? '',
    'contract.no': ct.no,
    'contract.title': ct.title,
    'contract.sign_date': viDateWords(todayVn(rt)),
    'contract.start_date': fmtDmy(start),
    'contract.end_date': fmtDmy(end),
    'contract.value_vnd': fmtNum(value),
    'contract.value_words': vndToWordsVi(value, { capitalize: true }),
    'contract.vat_rate': String(vatRate),
    'contract.vat_vnd': fmtNum(vat),
    'contract.total_vnd': fmtNum(total),
    'contract.total_words': vndToWordsVi(total, { capitalize: true }),
    'contract.advance_pct': String(adv),
    'contract.advance_vnd': fmtNum((total * adv) / 100),
    'contract.payment_terms': ct.payment_terms ?? 'theo thỏa thuận',
  };
  return {
    contractNo: ct.no,
    contractId: ct.id,
    customerId: ct.customer_id,
    title: ct.title,
    state: ct.state,
    price: { lines, value_vnd: value, vat_rate: vatRate, vat_vnd: vat, total_vnd: total },
    auto,
    seller: { name: seller['name'] ?? '', tax_code: seller['tax_code'] ?? '', address: seller['address'] ?? '', phone: seller['phone'] ?? '', email: seller['email'] ?? '' },
  };
}

/** Chi giu bien co trong danh muc, gia tri chuoi gioi han do dai (du lieu nguoi dung khong duoc dua ten bien la vao). */
export function cleanVariables(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (CONTRACT_VARIABLE_KEYS.has(k) && typeof v === 'string') out[k] = v.slice(0, 2000);
  return out;
}

export interface DocModel {
  title: string;
  subtitle: string;
  contractNo: string;
  rendered: RenderedArticle[];
  price: PriceTable;
  vars: Record<string, string>;
  missing: string[];
  text: string;
  hash: string;
  seller: ContractContext['seller'];
  partyA: { name: string; rep: string; title: string };
  partyB: { name: string; rep: string; title: string };
  template: { id: string; code: string; version: number; name: string; status: string };
}

export function manualDefaults(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const v of CONTRACT_VARIABLES) if (v.source === 'manual' && v.default !== undefined) o[v.key] = v.default;
  return o;
}

/** Dung mo hinh van ban moi nhat tu mau + ho so hien tai + phan nguoi dung sua. Khong ghi DB. */
export async function buildModel(rt: Runtime, ctx: ContractContext, tpl: TemplateRow, docVersion: number, userVars: Record<string, string>, overrides: ArticleOverrides): Promise<DocModel> {
  const vars: Record<string, string> = { ...manualDefaults(), ...ctx.auto };
  for (const [k, v] of Object.entries(userVars)) if (v.trim() !== '') vars[k] = v; // o trong = dung gia tri tu dong
  const r = renderArticles(parseArticles(tpl.articles), overrides, vars);
  const text = contractPlainText(r.articles, ctx.price);
  const hash = await contractContentHash({ contractNo: ctx.contractNo, docVersion, templateCode: tpl.code, templateVersion: tpl.version }, text, ctx.price);
  void rt;
  return {
    title: 'Hợp đồng dịch vụ quảng cáo',
    subtitle: vars['contract.title'] ?? '',
    contractNo: ctx.contractNo,
    rendered: r.articles,
    price: ctx.price,
    vars,
    missing: r.missing,
    text,
    hash,
    seller: ctx.seller,
    partyA: { name: vars['seller.name'] ?? '', rep: vars['seller.rep'] ?? '', title: vars['seller.rep_title'] ?? '' },
    partyB: { name: vars['customer.legal_name'] ?? '', rep: vars['customer.rep_name'] ?? '', title: vars['customer.rep_title'] ?? '' },
    template: { id: tpl.id, code: tpl.code, version: tpl.version, name: tpl.name, status: tpl.status },
  };
}

/** Ten bien khong co trong danh muc trong ghi de dieu khoan => loi (chan chen bien la). */
export function unknownVariablesIn(overrides: ArticleOverrides): string[] {
  const bad = new Set<string>();
  for (const o of Object.values(overrides)) for (const k of extractPlaceholders(`${o.title ?? ''}\n${o.body ?? ''}`)) if (!CONTRACT_VARIABLE_KEYS.has(k)) bad.add(k);
  return [...bad];
}

export function pdfInputFrom(m: DocModel, o: { docVersion: number; status: 'draft' | 'final'; templateApproved: boolean; stampIso: string; logo: ContractPdfInput['logo'] }): ContractPdfInput {
  return {
    title: m.title,
    subtitle: m.subtitle,
    contractNo: m.contractNo,
    docVersion: o.docVersion,
    status: o.status,
    templateApproved: o.templateApproved,
    articles: m.rendered,
    price: m.price,
    seller: m.seller,
    partyA: m.partyA,
    partyB: m.partyB,
    contentHash: m.hash,
    stampIso: o.stampIso,
    logo: o.logo,
  };
}

// ---------- logo watermark ----------
export interface LogoMeta {
  key: string;
  content_type: 'image/png' | 'image/jpeg';
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  uploaded_by: string | null;
  uploaded_at: string;
}
export const LOGO_SETTING = 'contract_logo';
export const LOGO_MAX_BYTES = 600 * 1024;

export async function getLogoMeta(db: Db): Promise<LogoMeta | null> {
  const row = (await db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [LOGO_SETTING]))[0];
  const m = jsonParse<LogoMeta | null>(row?.value, null);
  return m && typeof m.key === 'string' && m.key.startsWith('branding/') ? m : null;
}

export async function loadLogo(rt: Runtime): Promise<ContractPdfInput['logo']> {
  const m = await getLogoMeta(rt.db);
  if (!m) return null;
  const bytes = await rt.objects.get(m.key);
  if (!bytes) return null;
  return { bytes, type: m.content_type === 'image/png' ? 'png' : 'jpg' };
}
