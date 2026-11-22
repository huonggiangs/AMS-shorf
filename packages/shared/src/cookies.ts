// R1-24: tien to `__Host-` cho cookie phien/CSRF/MFA khi dung HTTPS (Secure, Path=/, khong Domain).
// HTTP local (Docker khong co TLS) khong the dat cookie Secure, nen ten khong co tien to. Doc cookie luon thu ca hai ten.
export const HOST_PREFIX = '__Host-';
/** Ten cookie dung khi GHI. */
export const cookieName = (base: string, secure: boolean): string => (secure ? HOST_PREFIX + base : base);
/** Cac ten co the doc (uu tien ten co tien to). Mot ten khong tien to ma ke tan cong tu subdomain dat van bi bo qua khi co ten `__Host-`. */
export const cookieReadNames = (base: string): [string, string] => [HOST_PREFIX + base, base];
/** Doc gia tri cookie tu header `Cookie`, uu tien ten `__Host-`. */
export function readCookieValue(header: string | null | undefined, base: string): string | undefined {
  if (!header) return undefined;
  const map = new Map<string, string>();
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!map.has(k)) map.set(k, part.slice(i + 1).trim());
  }
  for (const n of cookieReadNames(base)) {
    const v = map.get(n);
    if (v) { try { return decodeURIComponent(v); } catch { return v; } }
  }
  return undefined;
}
