export const vnd = (n: number | null | undefined): string => `${Number(n ?? 0).toLocaleString('vi-VN')} ₫`;
export const num = (n: number | null | undefined): string => Number(n ?? 0).toLocaleString('vi-VN');
export const mil = (n: number, digits = 1): string => (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: digits });

export const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
export const fmtDateTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Minutes since midnight -> "H:MM" */
export const fmtMin = (m: number): string => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/** Vietnamese amount in words (ported from prototype `vw`). */
export function vndInWords(n: number): string {
  const d = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const t3 = (x: number, full: boolean) => {
    const h = Math.floor(x / 100), t = Math.floor((x % 100) / 10), u = x % 10;
    let s = '';
    if (h || full) s += `${d[h]} trăm `;
    if (t > 1) {
      s += `${d[t]} mươi `;
      s += u === 1 ? 'mốt ' : u === 5 ? 'lăm ' : u ? `${d[u]} ` : '';
    } else if (t === 1) {
      s += 'mười ';
      s += u === 5 ? 'lăm ' : u ? `${d[u]} ` : '';
    } else if (u) {
      if (h || full) s += 'lẻ ';
      s += `${d[u]} `;
    }
    return s;
  };
  n = Math.round(n);
  if (!n) return 'Không đồng';
  const g: number[] = [];
  while (n > 0) { g.unshift(n % 1000); n = Math.floor(n / 1000); }
  const U = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ'];
  let s = '';
  g.forEach((x, i) => { if (x) s += `${t3(x, i > 0)}${U[g.length - 1 - i]!.trim()} `; });
  s = s.trim().replace(/\s+/g, ' ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} đồng chẵn`;
}
