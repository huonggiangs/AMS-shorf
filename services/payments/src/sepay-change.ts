import type { Runtime } from '@ams/runtime';
import { decryptField, verifyTotp } from '@ams/shared';
import { FinanceError } from './port.js';
import { iso, notify } from './util.js';

export const TOTP_AAD = 'admins.totp_secret'; // trung voi services/api/src/lib/crypto.ts AAD.totp
export const CHANGE_TTL_MS = 24 * 3600_000;
export const CHANGE_PREFIX = 'sepay_change:';

/** Step-up: nhap lai ma TOTP hien tai cua chinh nguoi thao tac. Ma da dung khong dung lai (chung khoa voi dang nhap cua a1). */
export async function requireStepUp(rt: Runtime, adminId: string, code: unknown): Promise<void> {
  if (typeof code !== 'string' || !code.trim()) throw new FinanceError('step_up_required', 'Cần nhập lại mã xác thực 6 số (TOTP) để thực hiện thay đổi này', 403);
  const row = (await rt.db.query<{ totp_secret_enc: string | null }>('SELECT totp_secret_enc FROM admins WHERE id = ?', [adminId]))[0];
  const key = rt.config.env['FIELD_ENC_KEY'];
  if (!row?.totp_secret_enc || !key) throw new FinanceError('mfa_not_enrolled', 'Tài khoản chưa bật xác thực hai bước nên không thể thực hiện thay đổi nhạy cảm', 403);
  let secret: string;
  try {
    secret = await decryptField(key, row.totp_secret_enc, TOTP_AAD);
  } catch {
    throw new FinanceError('mfa_not_enrolled', 'Không đọc được khóa xác thực hai bước', 403);
  }
  const r = await verifyTotp(secret, code, { timeMs: rt.clock.now().getTime() });
  const bad = () => new FinanceError('step_up_invalid', 'Mã xác thực không đúng hoặc đã dùng', 403);
  if (!r.ok) throw bad();
  const k = `totp:used:${adminId}:${r.counter}`;
  if (await rt.kv.get(k)) throw bad();
  await rt.kv.set(k, '1', 120);
}

/** Bao moi nguoi co quyen tai chinh (thong bao trong he thong + email, loi email khong chan thao tac). Khong bao gio chua bi mat. */
export async function alertFinance(rt: Runtime, o: { title: string; body: string; refId: string }): Promise<void> {
  await notify(rt.db, rt, { kind: 'sepay_config_change', title: o.title, body: o.body, refType: 'settings', refId: o.refId });
  try {
    const to = await rt.db.query<{ email: string }>("SELECT email FROM admins WHERE account_kind = 'internal' AND status = 'active' AND role IN ('super_admin','finance')");
    for (const t of to) {
      await rt.mail.send({ to: t.email, subject: `[AMS] ${o.title}`, text: `${o.body}\nNếu không phải bạn hoặc đồng nghiệp tin cậy thực hiện, hãy báo quản trị ngay.`, html: `<p>${o.body}</p><p>Nếu không phải bạn hoặc đồng nghiệp tin cậy thực hiện, hãy báo quản trị ngay.</p>` });
    }
  } catch {
    /* gui email that bai: da co thong bao trong he thong va audit */
  }
}

export const changeExpired = (rt: Runtime, requestedAt: string): boolean => rt.clock.now().getTime() - Date.parse(requestedAt) > CHANGE_TTL_MS;
export const nowIso = iso;
