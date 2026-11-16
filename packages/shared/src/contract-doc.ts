// Soan hop dong tu mau: thay {{bien}}, dung cau truc dieu khoan, van ban thuan va dau van tay noi dung. Ham thuan: chay duoc tren Node, Workers va trinh duyet.
import { sha256Hex } from './hmac.js';

/** Mot dieu khoan cua mau. `body`: cac doan cach nhau dong trong; dong bat dau "- " la gach dau dong; dong chi co {{price_table}} chen bang gia. */
export interface ContractArticle {
  key: string;
  title: string;
  body: string;
  /** false: phan mo dau (khong danh so "Dieu n"). Mac dinh true. */
  numbered?: boolean;
}
export interface ArticleOverride {
  title?: string;
  body?: string;
}
export type ArticleOverrides = Record<string, ArticleOverride>;

export const PRICE_TABLE_TOKEN = '{{price_table}}';
export const BLANK = '……………';
export const PLACEHOLDER_RE = /\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g;
export const MAX_ARTICLES = 40;
export const MAX_ARTICLE_BODY = 20_000;
export const MAX_VAR_VALUE = 2_000;

export interface PriceLine {
  screen_type: string;
  region: string;
  daypart: string;
  frequency: string;
  duration_s: string;
  qty: number;
  /** don gia moi luot (VND, chuoi thap phan), '' neu dong chua co gia thoa thuan */
  impression_price_vnd: string;
}
export interface PriceTable {
  lines: PriceLine[];
  value_vnd: number;
  vat_rate: number;
  vat_vnd: number;
  total_vnd: number;
}

export type Block = { type: 'p'; text: string } | { type: 'bullet'; text: string } | { type: 'price_table' };
export interface RenderedArticle {
  key: string;
  /** so dieu (1..n) hoac null cho phan mo dau */
  no: number | null;
  title: string;
  blocks: Block[];
}
export interface RenderedContract {
  articles: RenderedArticle[];
  /** ten bien con trong (de trong hoac khong co) ma van ban dang dung */
  missing: string[];
}

export interface VariableDef {
  key: string;
  label: string;
  group: 'seller' | 'customer' | 'contract' | 'payment' | 'terms';
  /** auto: lay tu ho so/hop dong (nguoi soan co the ghi de); manual: nguoi soan nhap */
  source: 'auto' | 'manual';
  /** gia tri mac dinh de goi y (chi cho bien manual) */
  default?: string;
}

export const CONTRACT_VARIABLES: readonly VariableDef[] = [
  { key: 'seller.name', label: 'Bên A: tên pháp nhân', group: 'seller', source: 'auto' },
  { key: 'seller.tax_code', label: 'Bên A: mã số thuế', group: 'seller', source: 'auto' },
  { key: 'seller.address', label: 'Bên A: địa chỉ', group: 'seller', source: 'auto' },
  { key: 'seller.rep', label: 'Bên A: người đại diện', group: 'seller', source: 'auto' },
  { key: 'seller.rep_title', label: 'Bên A: chức vụ người đại diện', group: 'seller', source: 'manual', default: 'Giám đốc' },
  { key: 'seller.email', label: 'Bên A: email', group: 'seller', source: 'auto' },
  { key: 'seller.phone', label: 'Bên A: điện thoại', group: 'seller', source: 'auto' },
  { key: 'customer.legal_name', label: 'Bên B: tên pháp nhân', group: 'customer', source: 'auto' },
  { key: 'customer.tax_code', label: 'Bên B: mã số thuế', group: 'customer', source: 'auto' },
  { key: 'customer.address', label: 'Bên B: địa chỉ', group: 'customer', source: 'auto' },
  { key: 'customer.rep_name', label: 'Bên B: người đại diện', group: 'customer', source: 'auto' },
  { key: 'customer.rep_title', label: 'Bên B: chức vụ', group: 'customer', source: 'auto' },
  { key: 'customer.phone', label: 'Bên B: điện thoại', group: 'customer', source: 'auto' },
  { key: 'contract.no', label: 'Số hợp đồng', group: 'contract', source: 'auto' },
  { key: 'contract.title', label: 'Tên hợp đồng', group: 'contract', source: 'auto' },
  { key: 'contract.sign_date', label: 'Ngày ký (dạng chữ)', group: 'contract', source: 'auto' },
  { key: 'contract.place', label: 'Địa điểm ký', group: 'contract', source: 'manual', default: 'Thành phố Hồ Chí Minh' },
  { key: 'contract.start_date', label: 'Ngày bắt đầu', group: 'contract', source: 'auto' },
  { key: 'contract.end_date', label: 'Ngày kết thúc', group: 'contract', source: 'auto' },
  { key: 'contract.value_vnd', label: 'Giá trị trước thuế (VND)', group: 'contract', source: 'auto' },
  { key: 'contract.value_words', label: 'Giá trị trước thuế (bằng chữ)', group: 'contract', source: 'auto' },
  { key: 'contract.vat_rate', label: 'Thuế GTGT (%)', group: 'contract', source: 'auto' },
  { key: 'contract.vat_vnd', label: 'Tiền thuế GTGT (VND)', group: 'contract', source: 'auto' },
  { key: 'contract.total_vnd', label: 'Tổng thanh toán (VND)', group: 'contract', source: 'auto' },
  { key: 'contract.total_words', label: 'Tổng thanh toán (bằng chữ)', group: 'contract', source: 'auto' },
  { key: 'contract.advance_pct', label: 'Tạm ứng (%)', group: 'payment', source: 'auto' },
  { key: 'contract.advance_vnd', label: 'Tạm ứng (VND, đã gồm thuế)', group: 'payment', source: 'auto' },
  { key: 'contract.payment_terms', label: 'Điều kiện thanh toán phần còn lại', group: 'payment', source: 'auto' },
  { key: 'payment.days', label: 'Số ngày thanh toán tạm ứng kể từ ngày ký', group: 'payment', source: 'manual', default: '07' },
  { key: 'payment.account', label: 'Tài khoản nhận tiền của Bên A (số, ngân hàng, chủ tài khoản)', group: 'payment', source: 'manual' },
  { key: 'terms.makeup_days', label: 'Số ngày phát bù khi sự cố', group: 'terms', source: 'manual', default: '07' },
  { key: 'terms.liability_cap_pct', label: 'Trần bồi thường (% giá trị hợp đồng)', group: 'terms', source: 'manual', default: '100' },
  { key: 'terms.confidential_years', label: 'Thời hạn bảo mật sau chấm dứt (năm)', group: 'terms', source: 'manual', default: '03' },
  { key: 'terms.termination_notice_days', label: 'Số ngày báo trước khi đơn phương chấm dứt', group: 'terms', source: 'manual', default: '30' },
  { key: 'terms.dispute_venue', label: 'Nơi giải quyết tranh chấp', group: 'terms', source: 'manual', default: 'Tòa án nhân dân có thẩm quyền tại nơi đặt trụ sở của Bên A' },
];
export const CONTRACT_VARIABLE_KEYS: ReadonlySet<string> = new Set(CONTRACT_VARIABLES.map((v) => v.key));

/** Ten bien dung trong van ban (khong lap, theo thu tu xuat hien); bo {{price_table}}. */
export function extractPlaceholders(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) if (m[1] !== 'price_table') seen.add(m[1]!);
  return [...seen];
}

/** Thay {{bien}}; bien thieu/trong => BLANK va ghi vao `missing`. Khong de lo ten bien ra van ban. */
export function fillPlaceholders(text: string, vars: Record<string, string>, missing: Set<string>): string {
  return text.replace(PLACEHOLDER_RE, (_m, k: string) => {
    if (k === 'price_table') return PRICE_TABLE_TOKEN;
    const v = vars[k];
    if (v === undefined || v.trim() === '') {
      missing.add(k);
      return BLANK;
    }
    return v;
  });
}

/** Bo dau ` bao quanh cho trong `[...]` cua luat su (van giu [..] de nhin thay). */
const unTick = (s: string): string => s.replace(/`([^`]*)`/g, '$1');

function parseBody(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split(/\n{2,}/)) {
    const part = raw.trim();
    if (!part) continue;
    if (part === PRICE_TABLE_TOKEN) {
      out.push({ type: 'price_table' });
      continue;
    }
    // trong mot khoi, dong "- " la gach dau dong; cac dong khac noi lai thanh mot doan
    let para: string[] = [];
    const flush = () => {
      if (para.length) out.push({ type: 'p', text: para.join(' ') });
      para = [];
    };
    for (const line of part.split('\n')) {
      const l = line.trim();
      if (l === PRICE_TABLE_TOKEN) {
        flush();
        out.push({ type: 'price_table' });
      } else if (l.startsWith('- ')) {
        flush();
        out.push({ type: 'bullet', text: l.slice(2).trim() });
      } else if (l) para.push(l);
    }
    flush();
  }
  return out;
}

/** Ap ghi de dieu khoan, thay bien, tach khoi. Dieu danh so tu 1 theo thu tu, phan `numbered:false` khong danh so. */
export function renderArticles(articles: readonly ContractArticle[], overrides: ArticleOverrides, vars: Record<string, string>): RenderedContract {
  const missing = new Set<string>();
  let n = 0;
  const out: RenderedArticle[] = [];
  for (const a of articles) {
    const o = overrides[a.key];
    const no = a.numbered === false ? null : ++n;
    const title = fillPlaceholders(unTick(o?.title ?? a.title), vars, missing);
    const body = fillPlaceholders(unTick(o?.body ?? a.body), vars, missing);
    out.push({ key: a.key, no, title, blocks: parseBody(body) });
  }
  return { articles: out, missing: [...missing] };
}

export function priceRowText(l: PriceLine, i: number): string {
  return [i + 1, l.screen_type, l.region, l.daypart, l.frequency, l.duration_s, l.qty, l.impression_price_vnd || '—'].join(' | ');
}

/** Van ban thuan cua ban hop dong (dung de xem truoc va lam dau vao cho dau van tay). */
export function contractPlainText(articles: readonly RenderedArticle[], price: PriceTable): string {
  const lines: string[] = [];
  for (const a of articles) {
    lines.push(a.no === null ? a.title.toUpperCase() : `Điều ${a.no}. ${a.title}`);
    for (const b of a.blocks) {
      if (b.type === 'p') lines.push(b.text);
      else if (b.type === 'bullet') lines.push(`- ${b.text}`);
      else {
        lines.push('BẢNG GIÁ DỊCH VỤ');
        lines.push('STT | Loại màn hình | Khu vực | Khung giờ | Tần suất | Thời lượng (giây) | Số lượng | Đơn giá/lượt (VND)');
        price.lines.forEach((l, i) => lines.push(priceRowText(l, i)));
        lines.push(`Giá trị trước thuế: ${price.value_vnd} | Thuế GTGT ${price.vat_rate}%: ${price.vat_vnd} | Tổng thanh toán: ${price.total_vnd}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\*\*/g, '').trim();
}

/** Dau van tay SHA-256 cua noi dung chot: so hop dong, phien ban, mau + van ban + bang gia. Doi bat ky ky tu nao deu doi dau van tay. */
export async function contractContentHash(meta: { contractNo: string; docVersion: number; templateCode: string; templateVersion: number }, text: string, price: PriceTable): Promise<string> {
  const material = JSON.stringify([meta.contractNo, meta.docVersion, meta.templateCode, meta.templateVersion, text, price]);
  return sha256Hex(material);
}

/** Ngay ISO yyyy-mm-dd => "ngày dd tháng mm năm yyyy". */
export function viDateWords(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `ngày ${m[3]} tháng ${m[2]} năm ${m[1]}`;
}

export interface ContractDocIssue {
  code: 'unknown_variable' | 'too_long' | 'too_many' | 'bad_key' | 'duplicate_key' | 'empty_body';
  message: string;
}
/** Kiem tra danh sach dieu khoan cua mau/ban sua (dung chung cho API va giao dien). */
export function validateArticles(articles: readonly ContractArticle[]): ContractDocIssue[] {
  const issues: ContractDocIssue[] = [];
  if (articles.length > MAX_ARTICLES) issues.push({ code: 'too_many', message: `Tối đa ${MAX_ARTICLES} điều khoản.` });
  const keys = new Set<string>();
  for (const a of articles) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(a.key)) issues.push({ code: 'bad_key', message: `Mã điều khoản "${a.key}" không hợp lệ.` });
    if (keys.has(a.key)) issues.push({ code: 'duplicate_key', message: `Mã điều khoản "${a.key}" bị trùng.` });
    keys.add(a.key);
    if (!a.body.trim()) issues.push({ code: 'empty_body', message: `Điều khoản "${a.title}" chưa có nội dung.` });
    if (a.body.length > MAX_ARTICLE_BODY) issues.push({ code: 'too_long', message: `Điều khoản "${a.title}" quá dài.` });
    for (const k of extractPlaceholders(`${a.title}\n${a.body}`)) {
      if (!CONTRACT_VARIABLE_KEYS.has(k)) issues.push({ code: 'unknown_variable', message: `Biến {{${k}}} trong "${a.title}" không có trong danh mục biến.` });
    }
  }
  return issues;
}
