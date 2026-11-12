import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { can } from '@ams/config';
import { timingSafeEqualStr } from '@ams/shared';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { Action, Module } from '@ams/config';
import { SESSION_COOKIE, loadSession } from './session.js';
import type { AppEnv } from '../types.js';

/** Nap phien tu cookie `ams_session`; nem 401 neu thieu/het han. */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw unauthorized();
  c.set('user', await loadSession(c.get('rt'), token));
  await next();
};

/** CSRF: moi phuong thuc ghi tren phien phai gui X-CSRF-Token khop csrf cua phien. */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const sent = c.req.header('x-csrf-token');
    const want = c.get('user').csrf;
    if (!sent || !timingSafeEqualStr(sent, want)) throw forbidden('Thiếu hoặc sai mã CSRF. Hãy tải lại trang rồi thử lại.', 'csrf_invalid');
  }
  await next();
};

export const requireInternal: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').kind !== 'internal') throw forbidden('Tài khoản ngoài không được dùng API quản trị.', 'forbidden');
  await next();
};
export const requireExternal: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').kind === 'internal') throw forbidden('API cổng khách hàng chỉ dành cho tài khoản khách hàng/đối tác.', 'forbidden');
  await next();
};

/** requirePerm('campaigns','approve'): kiem tra o may chu theo admin_permissions + vai tro (packages/config/rbac). */
export const requirePerm = (module: Module, action: Action): MiddlewareHandler<AppEnv> => async (c, next) => {
  const u = c.get('user');
  if (!can(u.perms, u.role, module, action)) throw forbidden('Bạn không có quyền thực hiện thao tác này.', 'forbidden', { module, action });
  await next();
};

/** Cho phep neu co BAT KY quyen nao trong danh sach (vd Lich phat doc danh sach doi tac). */
export const requireAnyPerm = (...pairs: [Module, Action][]): MiddlewareHandler<AppEnv> => async (c, next) => {
  const u = c.get('user');
  if (!pairs.some(([m, a]) => can(u.perms, u.role, m, a))) throw forbidden('Bạn không có quyền thực hiện thao tác này.', 'forbidden', { any_of: pairs.map(([m, a]) => `${m}:${a}`) });
  await next();
};

export const hasPerm = (c: { get(k: 'user'): import('../types.js').AuthUser }, module: Module, action: Action): boolean => {
  const u = c.get('user');
  return can(u.perms, u.role, module, action);
};
