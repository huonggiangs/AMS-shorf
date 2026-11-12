import type { Runtime } from '@ams/runtime';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export const appUrl = (rt: Runtime, external: boolean): string => {
  const e = rt.config.env;
  const u = external ? (e['PORTAL_PUBLIC_URL'] ?? e['PUBLIC_ADMIN_URL'] ?? e['APP_PUBLIC_URL']) : (e['PUBLIC_ADMIN_URL'] ?? e['APP_PUBLIC_URL']);
  return (u ?? 'http://localhost:5173').replace(/\/+$/, '');
};

/** Gui thu, khong lam hong luong chinh neu may chu thu loi: tra ve true/false. Khong ghi dia chi thu vao log. */
export async function trySend(rt: Runtime, m: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
  try {
    await rt.mail.send(m);
    return true;
  } catch (e) {
    console.error('[mail] gui that bai:', (e as Error).name);
    return false;
  }
}

export function inviteMail(link: string, name: string, role: string, hours = 72): { subject: string; html: string; text: string } {
  return {
    subject: 'Lời mời tham gia AMS: kích hoạt tài khoản',
    text: `Xin chào ${name},\n\nBạn được mời tham gia AMS (vai trò: ${role}). Mở liên kết sau để đặt mật khẩu và bật xác thực hai bước (hết hạn sau ${hours} giờ):\n${link}\n\nNếu bạn không mong đợi thư này, hãy bỏ qua.`,
    html: `<p>Xin chào ${esc(name)},</p><p>Bạn được mời tham gia <b>AMS</b> (vai trò: ${esc(role)}).</p><p><a href="${esc(link)}">Kích hoạt tài khoản</a> (liên kết hết hạn sau ${hours} giờ). Bạn sẽ đặt mật khẩu và bật xác thực hai bước (TOTP).</p><p>Nếu bạn không mong đợi thư này, hãy bỏ qua.</p>`,
  };
}
