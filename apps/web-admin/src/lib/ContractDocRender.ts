// Xem truoc van ban hop dong ngay tren trinh duyet (khi dang go): cung quy tac thay {{bien}} voi may chu (packages/shared/src/contract-doc.ts).
// May chu van la nguon su that: dau van tay (SHA-256) chi tinh o may chu sau khi luu.
export interface DocArticle { key: string; title: string; body: string; numbered: boolean; overridden?: boolean }
export const BLANK = '……………';
const PH = /\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g;

export function fill(text: string, vars: Record<string, string>, missing: Set<string>): string {
  return text.replace(PH, (_m, k: string) => {
    if (k === 'price_table') return '{{price_table}}';
    const v = vars[k];
    if (v === undefined || v.trim() === '') { missing.add(k); return BLANK; }
    return v;
  });
}

/** Van ban thuan de xem nhanh. `effective`: bien da gop (tu dong + da luu); `local`: bien dang go (chua luu). */
export function previewText(articles: DocArticle[], effective: Record<string, string>, local: Record<string, string>, priceLines: string[]): { text: string; missing: string[] } {
  const vars = { ...effective };
  for (const [k, v] of Object.entries(local)) if (v.trim() !== '') vars[k] = v;
  const missing = new Set<string>();
  let n = 0;
  const out: string[] = [];
  for (const a of articles) {
    const title = fill(a.title.replace(/`/g, ''), vars, missing);
    out.push(a.numbered === false ? title.toUpperCase() : `Điều ${++n}. ${title}`);
    const body = fill(a.body.replace(/`/g, ''), vars, missing).replace(/\*\*/g, '');
    out.push(body.replace(/\{\{price_table\}\}/g, priceLines.length ? ['[Bảng giá dịch vụ]', ...priceLines].join('\n') : '[Bảng giá dịch vụ: chưa có dòng giá]'));
    out.push('');
  }
  return { text: out.join('\n').trim(), missing: [...missing] };
}

export const DOC_STATUS: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  draft: { label: 'Bản nháp', tone: 'warn' }, final: { label: 'Đã chốt', tone: 'ok' }, superseded: { label: 'Đã thay thế', tone: 'info' },
};
export const TPL_STATUS: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  draft: { label: 'Chưa duyệt (nháp)', tone: 'warn' }, approved: { label: 'Luật sư đã duyệt', tone: 'ok' }, retired: { label: 'Ngừng dùng', tone: 'info' },
};
export const VAR_GROUP: Record<string, string> = { seller: 'Bên A (bên bán)', customer: 'Bên B (khách hàng)', contract: 'Hợp đồng', payment: 'Thanh toán', terms: 'Điều khoản thương mại' };
