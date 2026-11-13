import type { Runtime } from '@ams/runtime';

/** Khoa `settings` danh dau tai khoan phai doi mat khau (seed bootstrap ghi; xem packages/db seed-bootstrap FORCE_PW_CHANGE_KEY). */
export const forcePasswordChangeKey = (adminId: string): string => `force_password_change:${adminId}`;

export async function mustChangePassword(rt: Pick<Runtime, 'db'>, adminId: string): Promise<boolean> {
  const r = await rt.db.query('SELECT 1 AS x FROM settings WHERE key = ?', [forcePasswordChangeKey(adminId)]);
  return r.length > 0;
}

/** Chinh sach mat khau moi: >= 12 ky tu, co chu hoa, chu thuong, chu so; khong la mat khau cu, khong chua phan dau email. Tra thong bao loi hoac null. */
export function passwordPolicyError(pw: string, ctx: { current?: string; email?: string } = {}): string | null {
  if (pw.length < 12) return 'Mật khẩu mới tối thiểu 12 ký tự.';
  if (pw.length > 128) return 'Mật khẩu mới tối đa 128 ký tự.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Mật khẩu mới cần có chữ hoa, chữ thường và chữ số.';
  if (/CHANGE_ME|change-me|^password|^12345/i.test(pw)) return 'Mật khẩu mới là giá trị mẫu hoặc quá dễ đoán.';
  if (ctx.current !== undefined && pw === ctx.current) return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) return 'Mật khẩu mới không được chứa tên đăng nhập (phần đầu email).';
  return null;
}
