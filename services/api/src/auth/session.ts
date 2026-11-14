import type { Runtime } from '@ams/runtime';
import type { PermRow } from '@ams/config';
import { deleteCookie, setCookie } from 'hono/cookie';
import { hashToken, newToken } from '../lib/crypto.js';
import { jsonParse } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { AccountKind, AuthUser } from '../types.js';

export const SESSION_COOKIE = 'ams_session';
export const CSRF_COOKIE = 'ams_csrf';
export const MFA_COOKIE = 'ams_mfa';
export const SESSION_TTL_SEC = 12 * 3600; // tuyet doi 12 gio
export const SESSION_IDLE_SEC = 2 * 3600; // khong hoat dong 2 gio
export const MFA_TTL_SEC = 300;

/** R1-24: cookie `Secure` khi URL cong khai la https HOAC moi truong la staging/production (khong tin rieng PUBLIC_ADMIN_URL), tru khi dat COOKIE_SECURE=0 (chi dev). */
export const isHttps = (rt: Runtime): boolean => {
  const env = rt.config.env;
  if (env['COOKIE_SECURE'] === '0') return false;
  if (/^https:/i.test(env['PUBLIC_ADMIN_URL'] ?? env['APP_PUBLIC_URL'] ?? '')) return true;
  const e = (env['AMS_ENV'] ?? '').trim().toLowerCase();
  return e === 'production' || e === 'staging';
};

export function setSessionCookies(c: Ctx, rt: Runtime, token: string, csrf: string): void {
  const secure = isHttps(rt);
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: SESSION_TTL_SEC });
  // doc duoc bang JS de gui header X-CSRF-Token (double-submit); khong chua bi mat dang nhap
  setCookie(c, CSRF_COOKIE, csrf, { httpOnly: false, sameSite: 'Lax', path: '/', secure, maxAge: SESSION_TTL_SEC });
}
export function clearSessionCookies(c: Ctx, rt: Runtime): void {
  const secure = isHttps(rt);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure });
  deleteCookie(c, CSRF_COOKIE, { path: '/', secure });
  deleteCookie(c, MFA_COOKIE, { path: '/', secure });
}

export async function createSession(rt: Runtime, adminId: string, ip: string, ua: string | undefined, mfaVerified: boolean): Promise<{ token: string; csrf: string; id: string }> {
  const { token, hash } = await newToken(32);
  const csrf = (await newToken(24)).token;
  const now = rt.clock.now();
  const id = rt.id();
  await rt.db.run(
    'INSERT INTO sessions (id, admin_id, token_hash, csrf_token, ip, user_agent, mfa_verified, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, adminId, hash, csrf, ip, (ua ?? '').slice(0, 200), mfaVerified ? 1 : 0, now.toISOString(), now.toISOString(), new Date(now.getTime() + SESSION_TTL_SEC * 1000).toISOString()],
  );
  await rt.db.run('UPDATE admins SET last_login_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [now.toISOString(), adminId]);
  return { token, csrf, id };
}

export async function revokeSession(rt: Runtime, sessionId: string): Promise<void> {
  await rt.db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [rt.clock.now().toISOString(), sessionId]);
}
export async function revokeAllSessions(rt: Runtime, adminId: string): Promise<void> {
  await rt.db.run('UPDATE sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL', [rt.clock.now().toISOString(), adminId]);
}

interface SessionRow {
  sid: string;
  csrf_token: string;
  mfa_verified: number;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: string;
  account_kind: AccountKind;
  customer_id: string | null;
  status: string;
  totp_secret_enc: string | null;
  mfa_required: number;
  last_login_at: string | null;
  acct_phone: string | null;
  acct_expires_at: string | null;
  customer_state: string | null;
}

export interface AdminProfile {
  phone?: string | null;
  expires_at?: string | null;
}

export async function loadPerms(rt: Runtime, adminId: string): Promise<PermRow[]> {
  return rt.db.query<PermRow>('SELECT module, action, allowed FROM admin_permissions WHERE admin_id = ?', [adminId]);
}

/** Tra ve nguoi dung neu phien hop le; nem 401 neu khong. */
export async function loadSession(rt: Runtime, token: string): Promise<AuthUser> {
  const hash = await hashToken(token);
  const rows = await rt.db.query<SessionRow>(
    `SELECT s.id AS sid, s.csrf_token, s.mfa_verified, s.expires_at, s.last_seen_at, s.revoked_at,
            a.id, a.tenant_id, a.email, a.name, a.role, a.account_kind, a.customer_id, a.status, a.totp_secret_enc, a.mfa_required, a.last_login_at,
            a.phone AS acct_phone, a.expires_at AS acct_expires_at, cu.state AS customer_state
       FROM sessions s
       JOIN admins a ON a.id = s.admin_id
       LEFT JOIN customers cu ON cu.id = a.customer_id
      WHERE s.token_hash = ?`,
    [hash],
  );
  const r = rows[0];
  const nowIso = rt.clock.now().toISOString();
  const nowMs = rt.clock.now().getTime();
  if (!r || r.revoked_at || r.expires_at <= nowIso) throw unauthorized('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'session_expired');
  if (nowMs - new Date(r.last_seen_at).getTime() > SESSION_IDLE_SEC * 1000) throw unauthorized('Phiên đăng nhập đã hết hạn do không hoạt động.', 'session_expired');
  if (r.status !== 'active') throw unauthorized('Tài khoản đã bị khóa hoặc chưa kích hoạt.', 'account_disabled');
  if (r.acct_expires_at && r.acct_expires_at <= nowIso) throw unauthorized('Tài khoản đã hết hạn sử dụng.', 'account_expired');
  if (r.account_kind !== 'internal' && r.customer_state === 'terminated') throw forbidden('Hợp đồng của khách hàng đã chấm dứt, tài khoản không còn truy cập.', 'customer_terminated');
  const needMfa = r.account_kind !== 'internal' || r.mfa_required === 1 || !!r.totp_secret_enc;
  if (needMfa && r.mfa_verified !== 1) throw unauthorized('Phiên chưa xác thực hai bước.', 'mfa_required');
  if (nowMs - new Date(r.last_seen_at).getTime() > 60_000) {
    await rt.db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [nowIso, r.sid]);
  }
  return {
    id: r.id, tenantId: r.tenant_id, email: r.email, name: r.name, role: r.role, kind: r.account_kind, customerId: r.customer_id, status: r.status,
    hasTotp: !!r.totp_secret_enc, lastLoginAt: r.last_login_at, perms: await loadPerms(rt, r.id), sessionId: r.sid, csrf: r.csrf_token, mfaVerified: r.mfa_verified === 1,
  };
}
