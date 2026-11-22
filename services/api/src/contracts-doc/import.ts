// Nhap mau hop dong tu tep may tinh (.docx .txt .md .html .json) thanh danh sach dieu khoan cua mau (xem ContractArticle).
// Chay o may chu, khong them thu vien: .docx duoc giai nen bang DecompressionStream('deflate-raw') (co san tren Node >= 21 va Cloudflare Workers).
// Muc tieu an toan: dau ra CHI la van ban thuan (khong HTML/script), co gioi han kich thuoc; bien {{...}} sai ten duoc bao o `issues`.
import { CONTRACT_VARIABLE_KEYS, MAX_ARTICLES, PRICE_TABLE_TOKEN, validateArticles } from '@ams/shared';
import type { ContractArticle, ContractDocIssue } from '@ams/shared';

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const DOCX_XML_MAX = 12 * 1024 * 1024; // chan "bom nen": toi da 12 MB sau giai nen
export const IMPORT_EXTS = ['docx', 'txt', 'md', 'html', 'htm', 'json'] as const;
export type ImportKind = 'docx' | 'txt' | 'md' | 'html' | 'json';

export class ImportError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface ImportResult {
  source: ImportKind;
  name: string;
  articles: ContractArticle[];
  issues: ContractDocIssue[];
  warnings: string[];
  /** cac truong dang [...] / ten bien lech chuan da duoc doi sang {{bien}} */
  mapped: { from: string; to: string }[];
}

// ---------------------------------------------------------------- tien ich van ban
type Block = { kind: 'heading'; text: string } | { kind: 'para'; text: string } | { kind: 'bullet'; text: string } | { kind: 'table'; rows: string[][] };

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** Lam sach mot dong: bo ky tu dieu khien/zero-width, bo the HTML sot lai, gom khoang trang. */
export function cleanLine(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .replace(/<\/?[a-zA-Z!?][^>]*>/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim()
    .normalize('NFC');
}

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const ARTICLE_HEAD = /^(?:điều|dieu)\s+(\d{1,3})\s*[.:)\-–—]?\s*(.*)$/i;
const BULLET = /^(?:[-*•▪●○–—]|\d{1,2}[.)]\s|[a-z][.)]\s)\s*/;

// ---------------------------------------------------------------- .docx
function u16(b: Uint8Array, o: number): number { return b[o]! | (b[o + 1]! << 8); }
function u32(b: Uint8Array, o: number): number { return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0; }

async function inflateRaw(data: Uint8Array, max: number): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(data).catch(() => undefined);
  w.close().catch(() => undefined);
  const rd = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await rd.cancel().catch(() => undefined);
      throw new ImportError('docx_too_large', 'Tệp .docx giải nén ra quá lớn.');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

/** Doc mot muc trong tep zip (.docx). Tra null neu khong co. */
export async function readZipEntry(zip: Uint8Array, want: string, max = DOCX_XML_MAX): Promise<Uint8Array | null> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (u32(zip, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportError('bad_docx', 'Tệp không phải .docx hợp lệ (không đọc được cấu trúc nén).');
  const n = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  for (let i = 0; i < n; i++) {
    if (p + 46 > zip.length || u32(zip, p) !== 0x02014b50) break;
    const method = u16(zip, p + 10);
    const csize = u32(zip, p + 20);
    const usize = u32(zip, p + 24);
    const nl = u16(zip, p + 28), el = u16(zip, p + 30), cl = u16(zip, p + 32);
    const lho = u32(zip, p + 42);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nl));
    if (name === want) {
      if (usize > max) throw new ImportError('docx_too_large', 'Tệp .docx giải nén ra quá lớn.');
      if (lho + 30 > zip.length || u32(zip, lho) !== 0x04034b50) throw new ImportError('bad_docx', 'Tệp .docx bị hỏng.');
      const start = lho + 30 + u16(zip, lho + 26) + u16(zip, lho + 28);
      const raw = zip.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) {
        try {
          return await inflateRaw(raw, max);
        } catch (e) {
          if (e instanceof ImportError) throw e;
          throw new ImportError('bad_docx', 'Tệp .docx bị hỏng (không giải nén được).');
        }
      }
      throw new ImportError('bad_docx', 'Tệp .docx dùng kiểu nén không hỗ trợ.');
    }
    p += 46 + nl + el + cl;
  }
  return null;
}

const attr = (xml: string, tag: string): string | null => new RegExp(`<${tag}\\b[^>]*\\bw:val="([^"]*)"`).exec(xml)?.[1] ?? null;

function docxParagraph(xml: string): { text: string; heading: boolean; bullet: boolean } {
  let text = '';
  let boldAll = true;
  let anyRun = false;
  for (const m of xml.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
    const run = m[1]!;
    const t = [...run.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g)].map((x) => (x[1] !== undefined ? decodeEntities(x[1]) : x[0]!.startsWith('<w:tab') ? ' ' : '\n')).join('');
    if (!t.trim()) { text += t; continue; }
    anyRun = true;
    const rpr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? '';
    const bold = /<w:b\s*\/>|<w:b\s+w:val="(?:1|true|on)"/.test(rpr);
    if (!bold) boldAll = false;
    text += t;
  }
  const style = attr(xml, 'w:pStyle') ?? '';
  const styled = /^(heading\s?\d|title|tiêu\s?đề|subtitle)/i.test(style) || /^heading/i.test(style);
  const t = cleanLine(text.replace(/\n/g, ' '));
  const bullet = /<w:numPr>/.test(xml) && !styled;
  // dong in dam toan bo, ngan, khong ket thuc bang dau cau => tieu de (vd "Điều 3. Giá và thanh toán")
  const bold = anyRun && boldAll && t.length > 0 && t.length <= 140 && !/[,;:]$/.test(t);
  return { text: t, heading: styled || bold || ARTICLE_HEAD.test(t), bullet };
}

async function docxBlocks(bytes: Uint8Array): Promise<Block[]> {
  if (u32(bytes, 0) !== 0x04034b50) throw new ImportError('bad_docx', 'Tệp không phải .docx hợp lệ.');
  const xmlBytes = await readZipEntry(bytes, 'word/document.xml');
  if (!xmlBytes) throw new ImportError('bad_docx', 'Tệp không có word/document.xml (không phải văn bản Word).');
  const xml = new TextDecoder().decode(xmlBytes);
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const out: Block[] = [];
  for (const m of body.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\s*\/>/g)) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl')) {
      const rows: string[][] = [];
      for (const tr of chunk.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
        const cells: string[] = [];
        for (const tc of tr[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
          cells.push([...tc[0].matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((p) => docxParagraph(p[0]).text).filter(Boolean).join(' '));
        }
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length) out.push({ kind: 'table', rows });
      continue;
    }
    const p = docxParagraph(chunk);
    if (!p.text) { out.push({ kind: 'para', text: '' }); continue; } // dong trong = ngan doan
    out.push(p.heading ? { kind: 'heading', text: p.text } : p.bullet ? { kind: 'bullet', text: p.text } : { kind: 'para', text: p.text });
  }
  return out;
}

// ---------------------------------------------------------------- .txt / .md / .html
function textBlocks(text: string, md: boolean): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw;
    if (md) line = line.replace(/\[([^\]]+)\]\((?:https?:|mailto:)[^)]*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2');
    line = cleanLine(line);
    if (!line) { out.push({ kind: 'para', text: '' }); continue; }
    const mdHead = md ? /^#{1,6}\s+(.*)$/.exec(line) : null;
    if (mdHead) { out.push({ kind: 'heading', text: cleanLine(mdHead[1]!) }); continue; }
    if (/^[-=_*]{3,}$/.test(line)) continue;
    if (ARTICLE_HEAD.test(line)) { out.push({ kind: 'heading', text: line }); continue; }
    if (/^[-*•▪●]\s+/.test(line)) { out.push({ kind: 'bullet', text: line.replace(/^[-*•▪●]\s+/, '') }); continue; }
    out.push({ kind: 'para', text: line });
  }
  return out;
}

function htmlBlocks(html: string): Block[] {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|head|svg|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<(script|style|iframe|object|embed)\b[^>]*>/gi, ' '); // the khong dong
  const out: Block[] = [];
  const flush = (kind: 'para' | 'heading' | 'bullet', inner: string) => {
    const t = cleanLine(decodeEntities(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')));
    if (t) out.push({ kind: kind === 'para' && ARTICLE_HEAD.test(t) ? 'heading' : kind, text: t });
  };
  const re = /<table\b[\s\S]*?<\/table\s*>|<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>|<li\b[^>]*>([\s\S]*?)<\/li\s*>|<(?:p|div)\b[^>]*>([\s\S]*?)<\/(?:p|div)\s*>/gi;
  let last = 0;
  for (const m of s.matchAll(re)) {
    const tail = s.slice(last, m.index);
    if (cleanLine(tail.replace(/<[^>]*>/g, ' '))) flush('para', tail);
    last = (m.index ?? 0) + m[0].length;
    if (/^<table/i.test(m[0])) {
      const rows: string[][] = [];
      for (const tr of m[0].matchAll(/<tr\b[\s\S]*?<\/tr\s*>/gi)) {
        const cells = [...tr[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map((c) => cleanLine(decodeEntities(c[1]!.replace(/<[^>]*>/g, ' '))));
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length) out.push({ kind: 'table', rows });
    } else if (m[1] !== undefined) flush('heading', m[1]);
    else if (m[2] !== undefined) flush('bullet', m[2]);
    else flush('para', m[3] ?? '');
    out.push({ kind: 'para', text: '' });
  }
  const rest = s.slice(last);
  if (cleanLine(rest.replace(/<[^>]*>/g, ' '))) for (const l of decodeEntities(rest.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ')).split('\n')) flush('para', l);
  return out;
}

// ---------------------------------------------------------------- khop truong [...] va ten bien lech chuan
const BRACKET_MAP: [RegExp, string][] = [
  [/^(?:tên|ten)\s*(?:công ty|cong ty|doanh nghiệp|khách hàng|khach hang|bên b|ben b|đối tác)(?:\s*\(?bên b\)?)?$/i, 'customer.legal_name'],
  [/^(?:mã số thuế|mst|ma so thue)\s*(?:bên b|ben b|khách hàng)?$/i, 'customer.tax_code'],
  [/^(?:địa chỉ|dia chi)\s*(?:bên b|ben b|khách hàng)$/i, 'customer.address'],
  [/^(?:người đại diện|nguoi dai dien|đại diện)\s*(?:bên b|ben b|khách hàng)$/i, 'customer.rep_name'],
  [/^(?:chức vụ|chuc vu)\s*(?:bên b|ben b|khách hàng)$/i, 'customer.rep_title'],
  [/^(?:tên|ten)\s*(?:công ty|cong ty|bên a|ben a)\s*(?:bên a|ben a)?$/i, 'seller.name'],
  [/^(?:mã số thuế|mst)\s*(?:bên a|ben a)$/i, 'seller.tax_code'],
  [/^(?:địa chỉ|dia chi)\s*(?:bên a|ben a)$/i, 'seller.address'],
  [/^(?:người đại diện|nguoi dai dien|đại diện)\s*(?:bên a|ben a)$/i, 'seller.rep'],
  [/^(?:số hợp đồng|so hop dong|số hđ)$/i, 'contract.no'],
  [/^(?:ngày ký|ngay ky)$/i, 'contract.sign_date'],
  [/^(?:ngày bắt đầu|ngay bat dau|ngày hiệu lực)$/i, 'contract.start_date'],
  [/^(?:ngày kết thúc|ngay ket thuc)$/i, 'contract.end_date'],
  [/^(?:giá trị hợp đồng|gia tri hop dong|giá trị)$/i, 'contract.value_vnd'],
  [/^(?:giá trị bằng chữ|bằng chữ)$/i, 'contract.value_words'],
  [/^(?:tổng thanh toán|tong thanh toan)$/i, 'contract.total_vnd'],
  [/^(?:số tài khoản|so tai khoan|tài khoản ngân hàng)$/i, 'payment.account'],
];
const VAR_ALIAS: Record<string, string> = {
  'customer.name': 'customer.legal_name', 'customer.company': 'customer.legal_name', 'customer.tax': 'customer.tax_code', 'customer.mst': 'customer.tax_code',
  'customer.representative': 'customer.rep_name', 'customer.rep': 'customer.rep_name', 'customer.position': 'customer.rep_title',
  'seller.company': 'seller.name', 'seller.representative': 'seller.rep', 'seller.tax': 'seller.tax_code',
  'contract.number': 'contract.no', 'contract.code': 'contract.no', 'contract.value': 'contract.value_vnd', 'contract.total': 'contract.total_vnd',
  'contract.date': 'contract.sign_date', 'contract.start': 'contract.start_date', 'contract.end': 'contract.end_date',
};

function mapFields(text: string, mapped: { from: string; to: string }[]): string {
  // {{ten.bien}} lech chuan => bien trong danh muc (neu co ten tuong duong); {ten.bien} mot ngoac => {{ten.bien}}
  let s = text.replace(/\{\{\s*([A-Za-z][\w.]*)\s*\}\}|(?<!\{)\{\s*([A-Za-z][\w]*\.[\w.]+)\s*\}(?!\})/g, (m, a: string | undefined, b: string | undefined) => {
    const k = (a ?? b ?? '').toLowerCase();
    const to = CONTRACT_VARIABLE_KEYS.has(k) || k === 'price_table' ? k : VAR_ALIAS[k] ?? k;
    const out = `{{${to}}}`;
    if (out !== m && (CONTRACT_VARIABLE_KEYS.has(to) || to === 'price_table')) mapped.push({ from: m, to: out });
    return out;
  });
  s = s.replace(/\[([^\[\]{}\n]{2,60})\]/g, (m, label: string) => {
    const l = label.trim().replace(/\s+/g, ' ');
    for (const [re, key] of BRACKET_MAP) {
      if (re.test(l)) {
        mapped.push({ from: m, to: `{{${key}}}` });
        return `{{${key}}}`;
      }
    }
    return m; // cho trong luat su tu dien ([...], [ten]) giu nguyen de con duoc phat hien la ban nhap
  });
  return s;
}

// ---------------------------------------------------------------- khoi -> dieu khoan
const isPriceTable = (rows: string[][]): boolean => /đơn giá|don gia|loại màn hình|loai man hinh|tần suất|tan suat/i.test((rows[0] ?? []).join(' '));

function uniqKey(base: string, used: Set<string>): string {
  let k = base.slice(0, 36) || 'muc';
  if (!/^[a-z]/.test(k)) k = `m_${k}`;
  let out = k, n = 2;
  while (used.has(out)) out = `${k.slice(0, 34)}_${n++}`;
  used.add(out);
  return out;
}

export function blocksToArticles(blocks: Block[], warnings: string[], mapped: { from: string; to: string }[]): ContractArticle[] {
  const used = new Set<string>();
  const arts: { title: string; numbered: boolean; lines: string[] }[] = [];
  let cur: { title: string; numbered: boolean; lines: string[] } | null = null;
  const ensure = () => (cur ??= (arts.push({ title: 'Phần mở đầu', numbered: false, lines: [] }), arts[arts.length - 1]!));
  const push = (line: string) => ensure().lines.push(line);
  for (const b of blocks) {
    if (b.kind === 'heading') {
      const m = ARTICLE_HEAD.exec(b.text);
      const title = m ? (m[2] ? m[2].replace(/[.:]+$/, '').trim() : `Điều ${m[1]}`) : b.text.replace(/[.:]+$/, '');
      cur = { title: title.slice(0, 200) || 'Điều khoản', numbered: true, lines: [] };
      arts.push(cur);
    } else if (b.kind === 'para') {
      push(b.text);
    } else if (b.kind === 'bullet') {
      push(`- ${b.text.replace(BULLET, '').trim() || b.text}`);
    } else if (isPriceTable(b.rows)) {
      push('');
      push(PRICE_TABLE_TOKEN);
      push('');
      warnings.push('Bảng giá trong tệp đã được thay bằng {{price_table}} (bảng giá do hệ thống dựng từ dòng giá hợp đồng).');
    } else {
      warnings.push('Bảng trong tệp được chuyển thành các dòng gạch đầu dòng (mẫu hợp đồng chỉ gồm văn bản).');
      push('');
      for (const r of b.rows) push(`- ${r.filter(Boolean).join(': ')}`);
      push('');
    }
  }
  const articles: ContractArticle[] = [];
  for (const a of arts) {
    // gom dong: doan cach nhau 1 dong trong; "- " lien tiep giu nguyen dong
    const paras: string[] = [];
    let buf: string[] = [];
    const flush = () => { if (buf.length) paras.push(buf.join('\n')); buf = []; };
    for (const l of a.lines) {
      if (l === '') flush();
      else if (l === PRICE_TABLE_TOKEN) { flush(); paras.push(l); }
      else if (l.startsWith('- ')) buf.push(l);
      else { flush(); paras.push(l); } // moi dong/doan van ban la mot doan rieng
    }
    flush();
    const body = mapFields(paras.join('\n\n'), mapped).trim();
    if (!body) continue;
    const title = mapFields(a.title, mapped);
    articles.push({ key: uniqKey(a.numbered ? slug(a.title) || `dieu_${articles.length + 1}` : 'mo_dau', used), title, body, ...(a.numbered ? {} : { numbered: false }) });
  }
  return articles;
}

// ---------------------------------------------------------------- .json (xuat/nhap mau cua chinh he thong)
export const EXPORT_FORMAT = 'ams-contract-template';
function jsonArticles(text: string): { name: string | null; articles: ContractArticle[] } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new ImportError('bad_json', 'Tệp .json không đọc được (sai cú pháp).');
  }
  const o = (Array.isArray(j) ? { articles: j } : j) as { format?: unknown; name?: unknown; articles?: unknown } | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.articles)) throw new ImportError('bad_json', 'Tệp .json không phải mẫu hợp đồng (thiếu mảng "articles").');
  if (o.format !== undefined && o.format !== EXPORT_FORMAT) throw new ImportError('bad_json', 'Tệp .json không phải mẫu hợp đồng của AMS.');
  const used = new Set<string>();
  const articles: ContractArticle[] = [];
  for (const a of o.articles.slice(0, MAX_ARTICLES + 1) as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object' || typeof a.title !== 'string' || typeof a.body !== 'string') throw new ImportError('bad_json', 'Điều khoản trong tệp .json phải có "title" và "body" dạng chữ.');
    const title = cleanLine(a.title).slice(0, 200);
    const body = a.body.replace(/\r\n?/g, '\n').split('\n').map((l) => (l === PRICE_TABLE_TOKEN ? l : cleanLine(l))).join('\n').trim();
    articles.push({ key: uniqKey(typeof a.key === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(a.key) ? a.key : slug(title), used), title: title || 'Điều khoản', body, ...(a.numbered === false ? { numbered: false } : {}) });
  }
  return { name: typeof o.name === 'string' ? cleanLine(o.name).slice(0, 200) : null, articles };
}

// ---------------------------------------------------------------- vao chinh
export function kindOf(filename: string): ImportKind {
  const ext = /\.([a-z0-9]+)$/i.exec(filename.trim())?.[1]?.toLowerCase() ?? '';
  if (ext === 'htm') return 'html';
  if ((IMPORT_EXTS as readonly string[]).includes(ext)) return ext as ImportKind;
  throw new ImportError('unsupported_type', 'Chỉ nhập được tệp .docx, .txt, .md, .html hoặc .json.');
}

export async function parseTemplateFile(filename: string, bytes: Uint8Array): Promise<ImportResult> {
  if (bytes.length === 0) throw new ImportError('empty_file', 'Tệp rỗng.');
  if (bytes.length > IMPORT_MAX_BYTES) throw new ImportError('file_too_large', 'Tệp quá lớn (tối đa 2 MB).');
  const source = kindOf(filename);
  const warnings: string[] = [];
  const mapped: { from: string; to: string }[] = [];
  let articles: ContractArticle[];
  let name: string | null = null;
  if (source === 'json') {
    const r = jsonArticles(new TextDecoder().decode(bytes));
    articles = r.articles;
    name = r.name;
  } else {
    const blocks = source === 'docx' ? await docxBlocks(bytes) : source === 'html' ? htmlBlocks(new TextDecoder().decode(bytes)) : textBlocks(new TextDecoder().decode(bytes), source === 'md');
    articles = blocksToArticles(blocks, warnings, mapped);
  }
  if (!articles.length) throw new ImportError('no_content', 'Không tìm thấy nội dung văn bản trong tệp.');
  if (articles.length === 1 && articles[0]!.title === 'Phần mở đầu') {
    articles[0] = { key: 'noi_dung', title: 'Nội dung hợp đồng', body: articles[0]!.body };
    warnings.push('Không nhận ra tiêu đề "Điều ..." nào: toàn bộ nội dung được đưa vào một điều khoản. Hãy tách điều khoản trước khi dùng.');
  }
  if (/\[[\s.…]*\]|\[\.{2,}\]|\.{6,}|…{2,}/.test(articles.map((a) => a.body).join('\n'))) warnings.push('Mẫu còn chỗ trống dạng [...] / ……: luật sư cần điền trước khi duyệt.');
  const base = (filename.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim() || 'Mẫu nhập từ tệp').slice(0, 150);
  name = cleanLine(name ?? base);
  if (name.length < 3) name = `Mẫu ${name}`.trim().padEnd(3, '_');
  const issues = validateArticles(articles);
  const seen = new Set<string>();
  const uniq = mapped.filter((m) => (seen.has(m.from + m.to) ? false : (seen.add(m.from + m.to), true)));
  return { source, name, articles, issues, warnings: [...new Set(warnings)], mapped: uniq };
}
