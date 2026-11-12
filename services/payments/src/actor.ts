import type { Runtime } from '@ams/runtime';
import { can, type PermRow } from '@ams/config';
import { sha256Hex, timingSafeEqualStr } from '@ams/shared';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { FinanceError } from './port.js';

export interface FinanceActor {
  id: string;
  role: string;
  account_kind: 'internal' | 'customer' | 'partner';
  customer_id: string | null;
  perms: PermRow[];
  ip: string | null;
}

export type ActorResolver = (c: Context, rt: Runtime) => Promise<FinanceActor | null>;

function clientIp(c: Context): string | null {
  const h = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for');
  return h ? h.split(',')[0]!.trim() : null;
}

/**
 * Mac dinh: (1) middleware cua a1 da dat c.set('actor', {...}); (2) du phong: cookie `ams_session` doi chieu bang `sessions`
 * (token_hash = sha256 hex cua token; CHUA doi chieu voi ma cua a1 vi a1 chua co: a1 nen dung cach (1)).
 */
export const defaultResolveActor: ActorResolver = async (c, rt) => {
  const pre = (c as unknown as { get(k: string): unknown }).get('actor') as Partial<FinanceActor> | undefined;
  if (pre && pre.id && pre.role) {
    return { id: pre.id, role: pre.role, account_kind: (pre.account_kind ?? 'internal') as FinanceActor['account_kind'], customer_id: pre.customer_id ?? null, perms: pre.perms ?? [], ip: pre.ip ?? clientIp(c) };
  }
  // middleware auth cua a1 (services/api/src/auth/middleware.ts): c.get('user') = AuthUser
  const u = (c as unknown as { get(k: string): unknown }).get('user') as { id?: string; role?: string; kind?: string; customerId?: string | null; perms?: PermRow[] } | undefined;
  if (u && u.id && u.role) {
    const ip = (c as unknown as { get(k: string): unknown }).get('ip');
    return { id: u.id, role: u.role, account_kind: (u.kind ?? 'internal') as FinanceActor['account_kind'], customer_id: u.customerId ?? null, perms: u.perms ?? [], ip: typeof ip === 'string' ? ip : clientIp(c) };
  }
  const token = getCookie(c, 'ams_session');
  if (!token) return null;
  const s = (await rt.db.query<{ admin_id: string; csrf_token: string; mfa_verified: unknown }>(
    'SELECT admin_id, csrf_token, mfa_verified FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
    [await sha256Hex(token), rt.clock.now().toISOString()],
  ))[0];
  if (!s || Number(s.mfa_verified) !== 1) return null;
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const h = c.req.header('x-csrf-token');
    if (!h || !timingSafeEqualStr(h, s.csrf_token)) throw new FinanceError('csrf', 'Thiếu hoặc sai CSRF token', 403);
  }
  const a = (await rt.db.query<{ id: string; role: string; account_kind: string; customer_id: string | null; status: string }>(
    'SELECT id, role, account_kind, customer_id, status FROM admins WHERE id = ?', [s.admin_id]))[0];
  if (!a || a.status !== 'active') return null;
  const perms = await rt.db.query<{ module: string; action: string; allowed: number }>('SELECT module, action, allowed FROM admin_permissions WHERE admin_id = ?', [a.id]);
  return { id: a.id, role: a.role, account_kind: a.account_kind as FinanceActor['account_kind'], customer_id: a.customer_id, perms, ip: clientIp(c) };
};

export function requirePerm(a: FinanceActor | null, module: string, action: string, scope: 'internal' | 'external'): FinanceActor {
  if (!a) throw new FinanceError('unauthenticated', 'Chưa đăng nhập', 401);
  const external = a.account_kind !== 'internal';
  if (scope === 'internal' && external) throw new FinanceError('forbidden', 'Không có quyền', 403);
  if (scope === 'external' && (!external || !a.customer_id)) throw new FinanceError('forbidden', 'Chỉ dành cho tài khoản khách hàng', 403);
  if (!can(a.perms, a.role, module, action)) throw new FinanceError('forbidden', 'Không có quyền thực hiện thao tác này', 403);
  return a;
}
