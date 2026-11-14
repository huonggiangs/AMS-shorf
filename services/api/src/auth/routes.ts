import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { effectivePermissions } from '@ams/config';
import { generateTotpSecret, hashPassword, otpauthUri, passwordNeedsRehash, sha256Hex, timingSafeEqualStr, verifyPassword, verifyTotp } from '@ams/shared';
import type { Runtime } from '@ams/runtime';
import { AAD, decField, encField, hashToken, newToken } from '../lib/crypto.js';
import { HttpError, forbidden, notFound, unauthorized, unprocessable, tooMany } from '../lib/errors.js';
import { clientIp, jsonParse, parseBody } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';
import { writeAudit } from '../lib/audit.js';
import { authenticateAllowPasswordChange, csrfGuard } from './middleware.js';
import { mustChangePassword, forcePasswordChangeKey, passwordPolicyError } from './password-policy.js';
import {
  MFA_COOKIE, MFA_TTL_SEC, SESSION_COOKIE, clearSessionCookies, createSession, isHttps, loadSession, revokeSession, setSessionCookies,
} from './session.js';
import type { AppEnv } from '../types.js';

const MAX_FAILS = 5;
const LOCK_SEC = 15 * 60;
const MFA_MAX_ATTEMPTS = 5;

interface LoginRow {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: string;
  account_kind: string;
  customer_id: string | null;
  status: string;
  password_hash: string | null;
  totp_secret_enc: string | null;
  mfa_required: number;
  failed_logins: number;
  locked_until: string | null;
  acct_expires_at: string | null;
  customer_state: string | null;
}

export const scryptParams = (rt: Runtime) => {
  const n = Number(rt.config.env['SCRYPT_N']);
  return Number.isInteger(n) && n >= 1024 ? { N: n } : {};
};
let dummyHash: Promise<string> | null = null;
/** Bam gia de thoi gian phan hoi khong lo email co ton tai hay khong. */
const getDummy = (rt: Runtime) => (dummyHash ??= hashPassword('khong-ton-tai-0', scryptParams(rt)));

async function rateLimit(rt: Runtime, key: string, limit: number, windowSec: number): Promise<void> {
  const n = await rt.kv.incr(key, windowSec);
  if (n > limit) throw tooMany('Quá nhiều lần thử. Vui lòng thử lại sau ít phút.', windowSec);
}

const mfaTokenFrom = (c: Ctx, body: { mfa_token?: string | undefined }): string | undefined => body.mfa_token || getCookie(c, MFA_COOKIE) || undefined;

async function issueMfa(c: Ctx, rt: Runtime, adminId: string, kind: 'challenge' | 'enroll'): Promise<string> {
  const { token, hash } = await newToken(32);
  const now = rt.clock.now();
  await rt.db.run('INSERT INTO mfa (id, admin_id, kind, token_hash, attempts, expires_at, created_at) VALUES (?,?,?,?,0,?,?)', [
    rt.id(), adminId, kind, hash, new Date(now.getTime() + MFA_TTL_SEC * 1000).toISOString(), now.toISOString(),
  ]);
  setCookie(c, MFA_COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/', secure: isHttps(rt), maxAge: MFA_TTL_SEC });
  return token;
}

interface MfaRow {
  id: string;
  admin_id: string;
  kind: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
}
async function findMfa(rt: Runtime, token: string, kinds: string[]): Promise<MfaRow> {
  const rows = await rt.db.query<MfaRow>('SELECT id, admin_id, kind, attempts, expires_at, consumed_at FROM mfa WHERE token_hash = ?', [await hashToken(token)]);
  const r = rows[0];
  if (!r || !kinds.includes(r.kind) || r.consumed_at || r.expires_at <= rt.clock.now().toISOString() || r.attempts >= MFA_MAX_ATTEMPTS) {
    throw unauthorized('Phiên xác thực hai bước đã hết hạn. Vui lòng đăng nhập lại.', 'mfa_expired');
  }
  return r;
}

async function checkTotp(rt: Runtime, adminId: string, secret: string, code: string): Promise<boolean> {
  const r = await verifyTotp(secret, code, { timeMs: rt.clock.now().getTime() });
  if (!r.ok) return false;
  const k = `totp:used:${adminId}:${r.counter}`; // chong dung lai cung mot ma trong cua so
  return (await rt.kv.incr(k, 120)) === 1; // chiem nguyen tu (R1-12): get+set khong nguyen tu tren Cloudflare
}

export function meBody(rt: Runtime, u: import('../types.js').AuthUser, scope: { code: string | null; name: string | null; grants?: string[] } | null, mustChangePw = false) {
  return {
    must_change_password: mustChangePw,
    user: {
      id: u.id, email: u.email, name: u.name, role: u.role, kind: u.kind, customer_id: u.customerId, mfa_enabled: u.hasTotp, last_login_at: u.lastLoginAt,
    },
    permissions: effectivePermissions(u.perms, u.role),
    customer_scope: u.customerId ? { customer_id: u.customerId, code: scope?.code ?? null, name: scope?.name ?? null, ...(scope?.grants ? { campaign_grants: scope.grants } : {}) } : null,
    dev_mode: rt.config.runtime === 'docker' && rt.config.env['SEPAY_MODE'] !== 'production',
    csrf_token: u.csrf,
  };
}

export function authRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post('/login', async (c) => {
    const rt = c.get('rt');
    const ip = c.get('ip');
    const body = await parseBody(c, z.object({ email: z.string().trim().toLowerCase().max(254), password: z.string().min(1).max(256) }));
    await rateLimit(rt, `rl:login:ip:${ip}`, 40, 900);
    // R1-19: bo dem theo (email, IP): ke tan cong khong the can kiet bo dem cua nan nhan tu IP khac
    const emKey = `rl:login:em:${await sha256Hex(`${body.email}|${ip}`)}`;
    await rateLimit(rt, emKey, 12, 900);

    const row = (
      await rt.db.query<LoginRow>(
        `SELECT a.id, a.tenant_id, a.email, a.name, a.role, a.account_kind, a.customer_id, a.status, a.password_hash, a.totp_secret_enc, a.mfa_required, a.failed_logins, a.locked_until,
                a.expires_at AS acct_expires_at, cu.state AS customer_state
           FROM admins a LEFT JOIN customers cu ON cu.id = a.customer_id WHERE a.email = ?`,
        [body.email],
      )
    )[0];
    const now = rt.clock.now();
    const nowIso = now.toISOString();
    const invalid = () => unauthorized('Sai email hoặc mật khẩu.', 'invalid_credentials');

    if (!row || !row.password_hash) {
      await verifyPassword(body.password, await getDummy(rt));
      throw invalid();
    }
    // R1-19: luon bam mat khau truoc (thoi gian dong nhat) va KHONG tra 429 rieng cho tai khoan bi khoa (khong lo email ton tai).
    // Dang khoa => 401 giong het sai mat khau, khong cong don so lan sai (ke tan cong khong keo dai khoa vo han).
    const lockedNow = !!(row.locked_until && row.locked_until > nowIso);
    const pwOk = await verifyPassword(body.password, row.password_hash);
    if (lockedNow) {
      if (pwOk) await writeAudit(rt.db, { rt, ip, actorId: row.id }, { action: 'auth.login_while_locked', objectType: 'admin', objectId: row.id, customerId: row.customer_id });
      throw invalid();
    }
    if (!pwOk) {
      const fails = row.failed_logins + 1;
      const lock = fails >= MAX_FAILS;
      await rt.db.run('UPDATE admins SET failed_logins = ?, locked_until = ? WHERE id = ?', [lock ? 0 : fails, lock ? new Date(now.getTime() + LOCK_SEC * 1000).toISOString() : null, row.id]);
      await writeAudit(rt.db, { rt, ip, actorId: row.id }, { action: lock ? 'auth.account_locked' : 'auth.login_failed', objectType: 'admin', objectId: row.id, customerId: row.customer_id, diff: { failed_logins: fails } });
      throw invalid();
    }
    if (row.status !== 'active') throw forbidden('Tài khoản đã bị khóa hoặc ngừng hoạt động. Liên hệ quản trị viên.', 'account_disabled');
    if (row.acct_expires_at && row.acct_expires_at <= nowIso) throw unauthorized('Tài khoản đã hết hạn sử dụng.', 'account_expired');
    if (row.account_kind !== 'internal' && row.customer_state === 'terminated') throw forbidden('Hợp đồng của khách hàng đã chấm dứt, tài khoản không còn truy cập.', 'customer_terminated');

    // R1-21: nang cap bam mat khau cu len tham so hien hanh (loi khong chan dang nhap)
    if (passwordNeedsRehash(row.password_hash, scryptParams(rt))) {
      try {
        await rt.db.run('UPDATE admins SET password_hash = ? WHERE id = ?', [await hashPassword(body.password, scryptParams(rt)), row.id]);
      } catch (e) {
        console.error('[auth] rehash mat khau loi:', (e as Error).name);
      }
    }
    await rt.kv.del(emKey);
    const needMfa = row.account_kind !== 'internal' || row.mfa_required === 1 || !!row.totp_secret_enc;
    if (needMfa) {
      const enrolled = !!row.totp_secret_enc;
      const token = await issueMfa(c, rt, row.id, enrolled ? 'challenge' : 'enroll');
      return c.json({ mfa_required: true, mfa_token: token, ...(enrolled ? {} : { mfa_enroll_required: true }) });
    }
    const s = await createSession(rt, row.id, ip, c.req.header('user-agent'), false);
    setSessionCookies(c, rt, s.token, s.csrf);
    await writeAudit(rt.db, { rt, ip, actorId: row.id }, { action: 'auth.login', objectType: 'admin', objectId: row.id, customerId: row.customer_id, diff: { mfa: false } });
    return c.json({ mfa_required: false, csrf_token: s.csrf, must_change_password: await mustChangePassword(rt, row.id) });
  });

  r.post('/mfa/enroll', async (c) => {
    const rt = c.get('rt');
    const raw = await parseBody(c, z.object({ mfa_token: z.string().max(200).optional() }));
    let rowId: string;
    let adminId: string;
    let email: string;
    let token = mfaTokenFrom(c, raw);
    if (token) {
      const m = await findMfa(rt, token, ['enroll']);
      rowId = m.id;
      adminId = m.admin_id;
    } else {
      // da dang nhap (noi bo chua bat 2FA) muon bat TOTP
      const st = getCookie(c, SESSION_COOKIE);
      if (!st) throw unauthorized();
      const u = await loadSession(rt, st);
      assertCsrf(c, u.csrf);
      if (u.hasTotp) throw new HttpError(409, 'mfa_already_enabled', 'Tài khoản đã bật xác thực hai bước.');
      adminId = u.id;
      token = await issueMfa(c, rt, adminId, 'enroll');
      const m = await findMfa(rt, token, ['enroll']);
      rowId = m.id;
    }
    const a = (await rt.db.query<{ email: string }>('SELECT email FROM admins WHERE id = ? AND status = ?', [adminId, 'active']))[0];
    if (!a) throw unauthorized();
    email = a.email;
    const secret = generateTotpSecret();
    await rt.kv.set(`mfa:enroll:${rowId}`, await encField(rt, secret, AAD.totp), 600);
    return c.json({ secret, otpauth_url: otpauthUri(secret, email, 'AMS'), mfa_token: token });
  });

  r.post('/mfa/verify', async (c) => {
    const rt = c.get('rt');
    const ip = c.get('ip');
    const body = await parseBody(c, z.object({ mfa_token: z.string().max(200).optional(), code: z.string().trim().max(16) }));
    const token = mfaTokenFrom(c, body);
    if (!token) throw unauthorized('Thiếu mã phiên xác thực hai bước.', 'mfa_expired');
    const m = await findMfa(rt, token, ['challenge', 'enroll']);
    await rateLimit(rt, `rl:mfa:${m.admin_id}`, 15, 900);
    const a = (
      await rt.db.query<{ id: string; email: string; customer_id: string | null; status: string; totp_secret_enc: string | null }>(
        'SELECT id, email, customer_id, status, totp_secret_enc FROM admins WHERE id = ?',
        [m.admin_id],
      )
    )[0];
    if (!a || a.status !== 'active') throw unauthorized('Tài khoản không còn hoạt động.', 'account_disabled');

    let secret: string | null = null;
    if (m.kind === 'challenge') {
      if (!a.totp_secret_enc) throw unauthorized('Tài khoản chưa thiết lập xác thực hai bước.', 'mfa_expired');
      secret = await decField(rt, a.totp_secret_enc, AAD.totp);
    } else {
      const pending = await rt.kv.get(`mfa:enroll:${m.id}`);
      if (!pending) throw new HttpError(409, 'enroll_not_started', 'Hãy lấy khóa thiết lập (mfa/enroll) trước khi nhập mã.');
      secret = await decField(rt, pending, AAD.totp);
    }
    if (!(await checkTotp(rt, a.id, secret, body.code))) {
      await rt.db.run('UPDATE mfa SET attempts = attempts + 1 WHERE id = ?', [m.id]);
      await writeAudit(rt.db, { rt, ip, actorId: a.id }, { action: 'auth.mfa_failed', objectType: 'admin', objectId: a.id, customerId: a.customer_id });
      throw unauthorized('Mã xác thực không đúng hoặc đã hết hạn.', 'invalid_code');
    }
    const used = await rt.db.run('UPDATE mfa SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', [rt.clock.now().toISOString(), m.id]);
    if (used.changes === 0) throw unauthorized('Phiên xác thực hai bước đã được dùng.', 'mfa_expired');
    if (m.kind === 'enroll') {
      await rt.db.run('UPDATE admins SET totp_secret_enc = ?, mfa_required = 1 WHERE id = ?', [await encField(rt, secret, AAD.totp), a.id]);
      await rt.kv.del(`mfa:enroll:${m.id}`);
      await writeAudit(rt.db, { rt, ip, actorId: a.id }, { action: 'auth.mfa_enrolled', objectType: 'admin', objectId: a.id, customerId: a.customer_id });
    }
    const s = await createSession(rt, a.id, ip, c.req.header('user-agent'), true);
    setSessionCookies(c, rt, s.token, s.csrf);
    setCookie(c, MFA_COOKIE, '', { path: '/', maxAge: 0 });
    await writeAudit(rt.db, { rt, ip, actorId: a.id }, { action: 'auth.login', objectType: 'admin', objectId: a.id, customerId: a.customer_id, diff: { mfa: true } });
    return c.json({ ok: true, csrf_token: s.csrf, must_change_password: await mustChangePassword(rt, a.id) });
  });

  r.post('/logout', async (c) => {
    const rt = c.get('rt');
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      let u;
      try {
        u = await loadSession(rt, token);
      } catch {
        u = null; // phien da het han: van xoa cookie
      }
      if (u) {
        assertCsrf(c, u.csrf);
        await revokeSession(rt, u.sessionId);
        await writeAudit(rt.db, { rt, ip: c.get('ip'), actorId: u.id }, { action: 'auth.logout', objectType: 'admin', objectId: u.id, customerId: u.customerId });
      }
    }
    clearSessionCookies(c, rt);
    return c.json({ ok: true });
  });

  r.get('/me', authenticateAllowPasswordChange, async (c) => {
    const rt = c.get('rt');
    const u = c.get('user');
    let scope: { code: string | null; name: string | null; grants?: string[] } | null = null;
    if (u.customerId) {
      const cu = (await rt.db.query<{ payment_code: string; short_name: string }>('SELECT payment_code, short_name FROM customers WHERE id = ?', [u.customerId]))[0];
      scope = { code: cu?.payment_code ?? null, name: cu?.short_name ?? null };
      if (u.kind === 'partner') {
        const g = await rt.db.query<{ campaign_id: string }>('SELECT campaign_id FROM campaign_grants WHERE admin_id = ? AND (expires_at IS NULL OR expires_at > ?)', [u.id, rt.clock.now().toISOString()]);
        scope.grants = g.map((x) => x.campaign_id);
      }
    }
    return c.json(meBody(rt, u, scope, await mustChangePassword(rt, u.id)));
  });

  // Doi mat khau (bat buoc hoac tu nguyen). Dong thoi la loi thoat duy nhat cua co force_password_change.
  const changePassword = async (c: Ctx) => {
    const rt = c.get('rt');
    const ip = c.get('ip');
    const u = c.get('user');
    const raw = await parseBody(
      c,
      z.object({
        current_password: z.string().max(256).optional(),
        current: z.string().max(256).optional(),
        new_password: z.string().max(256).optional(),
        new: z.string().max(256).optional(),
      }),
    );
    const current = raw.current_password ?? raw.current;
    const next = raw.new_password ?? raw.new;
    if (!current) throw unprocessable('Nhập mật khẩu hiện tại.', 'current_password_required');
    if (!next) throw unprocessable('Nhập mật khẩu mới.', 'new_password_required');
    await rateLimit(rt, `rl:pwchange:${u.id}`, 8, 900);
    const row = (await rt.db.query<{ password_hash: string | null; email: string; customer_id: string | null }>('SELECT password_hash, email, customer_id FROM admins WHERE id = ?', [u.id]))[0];
    if (!row?.password_hash || !(await verifyPassword(current, row.password_hash))) {
      await writeAudit(rt.db, { rt, ip, actorId: u.id }, { action: 'auth.password_change_failed', objectType: 'admin', objectId: u.id, customerId: row?.customer_id ?? null });
      throw unprocessable('Mật khẩu hiện tại không đúng.', 'invalid_current_password');
    }
    const bad = passwordPolicyError(next, { current, email: row.email });
    if (bad) throw unprocessable(bad, 'weak_password');
    const hash = await hashPassword(next, scryptParams(rt));
    const nowIso = rt.clock.now().toISOString();
    let revoked = 0;
    await rt.db.tx(async (db) => {
      await db.run('UPDATE admins SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [hash, u.id]);
      await db.run('DELETE FROM settings WHERE key = ?', [forcePasswordChangeKey(u.id)]);
      revoked = (await db.run('UPDATE sessions SET revoked_at = ? WHERE admin_id = ? AND id <> ? AND revoked_at IS NULL', [nowIso, u.id, u.sessionId])).changes;
      await writeAudit(db, { rt, ip, actorId: u.id }, { action: 'auth.password_changed', objectType: 'admin', objectId: u.id, customerId: row.customer_id, diff: { other_sessions_revoked: revoked } });
    });
    return c.json({ ok: true, must_change_password: false, other_sessions_revoked: revoked });
  };
  r.post('/change-password', authenticateAllowPasswordChange, csrfGuard, changePassword);
  r.post('/password/change', authenticateAllowPasswordChange, csrfGuard, changePassword); // ten thay the (d1-seed-prod.requests.md)

  // Thong tin loi moi cho trang Kich hoat/Moi (khong tieu thu token, khong lo bi mat). Token sai/het han/da dung: 404 chung.
  r.get('/invite/info', async (c) => {
    const rt = c.get('rt');
    const ip = c.get('ip');
    await rateLimit(rt, `rl:invite-info:ip:${ip}`, 30, 900);
    const token = c.req.query('token') ?? '';
    if (token.length < 10 || token.length > 200) throw notFound('Liên kết không hợp lệ hoặc đã hết hạn.', 'invite_not_found');
    const row = (
      await rt.db.query<{ name: string; email: string; role: string; account_kind: string; customer_name: string | null; expires_at: string; accepted_at: string | null; status: string }>(
        `SELECT a.name AS name, a.email AS email, a.role AS role, a.account_kind AS account_kind, cu.short_name AS customer_name, i.expires_at AS expires_at, i.accepted_at AS accepted_at, a.status AS status
           FROM invites i JOIN admins a ON a.id = i.admin_id LEFT JOIN customers cu ON cu.id = a.customer_id WHERE i.token_hash = ?`,
        [await hashToken(token)],
      )
    )[0];
    if (!row || row.accepted_at || row.status !== 'invited' || row.expires_at <= rt.clock.now().toISOString()) throw notFound('Liên kết không hợp lệ hoặc đã hết hạn.', 'invite_not_found');
    return c.json({ email: row.email, name: row.name, role: row.role, account_kind: row.account_kind, customer_name: row.customer_name, expires_at: row.expires_at });
  });

  r.post('/invite/accept', async (c) => {
    const rt = c.get('rt');
    const ip = c.get('ip');
    const body = await parseBody(c, z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(128) }));
    await rateLimit(rt, `rl:invite:ip:${ip}`, 20, 900);
    const hash = await hashToken(body.token);
    const inv = (
      await rt.db.query<{ id: string; admin_id: string; expires_at: string; accepted_at: string | null }>('SELECT id, admin_id, expires_at, accepted_at FROM invites WHERE token_hash = ?', [hash])
    )[0];
    const nowIso = rt.clock.now().toISOString();
    if (!inv || inv.accepted_at || inv.expires_at <= nowIso) throw unprocessable('Liên kết kích hoạt không hợp lệ hoặc đã hết hạn (72 giờ). Hãy nhờ quản trị viên gửi lại lời mời.', 'invite_invalid');
    const a = (await rt.db.query<{ id: string; status: string; customer_id: string | null }>('SELECT id, status, customer_id FROM admins WHERE id = ?', [inv.admin_id]))[0];
    if (!a || a.status !== 'invited') throw unprocessable('Tài khoản không ở trạng thái chờ kích hoạt.', 'invite_invalid');
    // cung chinh sach voi doi mat khau (>= 12 ky tu, hoa/thuong/so, khong chua phan dau email)
    const owner = (await rt.db.query<{ email: string }>('SELECT email FROM admins WHERE id = ?', [a.id]))[0];
    const policy = passwordPolicyError(body.password, owner ? { email: owner.email } : {});
    if (policy) throw unprocessable(policy.replace('Mật khẩu mới', 'Mật khẩu'), 'weak_password');
    const pw = await hashPassword(body.password, scryptParams(rt));
    // nguyen tu: chi mot lan chap nhan thanh cong
    const claimed = await rt.db.run('UPDATE invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL', [nowIso, inv.id]);
    if (claimed.changes === 0) throw unprocessable('Liên kết kích hoạt đã được sử dụng.', 'invite_invalid');
    await rt.db.run("UPDATE admins SET password_hash = ?, status = 'active', failed_logins = 0, locked_until = NULL WHERE id = ? AND status = 'invited'", [pw, a.id]);
    await writeAudit(rt.db, { rt, ip, actorId: a.id }, { action: 'auth.invite_accepted', objectType: 'admin', objectId: a.id, customerId: a.customer_id });
    const token = await issueMfa(c, rt, a.id, 'enroll');
    return c.json({ ok: true, mfa_required: true, mfa_enroll_required: true, mfa_token: token });
  });

  return r;
}

function assertCsrf(c: Ctx, want: string): void {
  const sent = c.req.header('x-csrf-token');
  if (!sent || !timingSafeEqualStr(sent, want)) throw forbidden('Thiếu hoặc sai mã CSRF. Hãy tải lại trang rồi thử lại.', 'csrf_invalid');
}

