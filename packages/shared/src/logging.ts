// P2: che du lieu nhay cam truoc khi ghi log. Quy tac: log chi ghi ten loi + thong diep da che, KHONG ghi doi tuong loi nguyen ban
// (loi pg/SMTP/zod co the chua gia tri hang, email, so tai khoan). Khong bao gio log OTP, token, mat khau, so tai khoan.
const RULES: [RegExp, string][] = [
  [/(bearer|apikey|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 ***'],
  [/\b(password|passwd|secret|token|otp|code|authorization|api[_-]?key|signature|sig)(["']?\s*[:=]\s*)(["']?)[^\s,;"'&)}]+/gi, '$1$2$3***'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '***'],
  [/\d[\d .-]{6,}\d/g, (m: string) => (m.replace(/\D/g, '').length >= 8 ? '***' + m.replace(/\D/g, '').slice(-2) : m)] as unknown as [RegExp, string],
];
export function redactLog(text: string): string {
  let s = text;
  for (const [re, rep] of RULES) s = s.replace(re, rep as string);
  return s.length > 300 ? s.slice(0, 300) + '...' : s;
}
/** Ten loi + thong diep da che (do dai gioi han). Dung thay cho log nguyen doi tuong loi. */
export function safeErr(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${redactLog(e.message)}`;
  return redactLog(String(e));
}
