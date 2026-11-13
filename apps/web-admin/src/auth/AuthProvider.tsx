import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, onPasswordChangeRequired, onUnauthorized, setCsrfToken } from '../api/client';
import { enrollSchema, loginSchema, meSchema, EXTERNAL_MODULES, EXTERNAL_ROLES, type Action, type LoginResult, type Me, type Module } from '../api/schemas';

type Status = 'loading' | 'anon' | 'authed';
interface AuthCtx {
  status: Status;
  me: Me | null;
  expired: boolean;
  isExternal: boolean;
  /** forced password change pending: only the Profile page works until the password is changed */
  mustChangePassword: boolean;
  /** permission check mirrors server RBAC (server stays authoritative) */
  can: (m: Module, a?: Action) => boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  enrollMfa: () => Promise<z.infer<typeof enrollSchema>>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}
import type { z } from 'zod';
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [expired, setExpired] = useState(false);
  const [pwForced, setPwForced] = useState(false);

  const apply = useCallback((m: Me) => {
    if (m.csrf_token) setCsrfToken(m.csrf_token);
    setMe(m);
    setPwForced(false);
    setStatus('authed');
    setExpired(false);
  }, []);

  const reload = useCallback(async () => {
    try {
      apply(await api.get('/auth/me', { schema: meSchema, quiet401: true }));
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) {
        // backend unreachable: stay anonymous but the login page will show the error on submit
      }
      setMe(null);
      setStatus('anon');
    }
  }, [apply]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Session expired / switched elsewhere: drop caches, return to login with a notice.
  useEffect(() => {
    const off = onUnauthorized(() => {
      setMe(null);
      setStatus('anon');
      setExpired(true);
      qc.clear();
    });
    return () => {
      off();
    };
  }, [qc]);

  // Any request answered 403 password_change_required (e.g. flag set by an admin while the session is open) locks navigation to Profile too.
  useEffect(() => onPasswordChangeRequired(() => setPwForced(true)), []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post('/auth/login', { body: { email, password }, schema: loginSchema, quiet401: true });
    if (!r.mfa_required) await reload();
    return r;
  }, [reload]);

  const verifyMfa = useCallback(async (mfa_token: string, code: string) => {
    await api.post('/auth/mfa/verify', { body: { mfa_token, code }, quiet401: true });
    await reload();
  }, [reload]);

  const enrollMfa = useCallback(() => api.post('/auth/mfa/enroll', { schema: enrollSchema, quiet401: true }), []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', { quiet401: true });
    } finally {
      setCsrfToken(null);
      qc.clear();
      setMe(null);
      setStatus('anon');
      setExpired(false);
    }
  }, [qc]);

  const mustChangePassword = !!me && (me.must_change_password === true || pwForced);
  const isExternal = !!me && EXTERNAL_ROLES.includes(me.user.role);
  const can = useCallback(
    (m: Module, a: Action = 'view') => {
      if (!me) return false;
      if (isExternal && !EXTERNAL_MODULES.includes(m)) return false;
      if (isExternal && (a === 'approve' || a === 'delete')) return false;
      return !!me.permissions[m]?.includes(a);
    },
    [me, isExternal],
  );

  const value = useMemo<AuthCtx>(
    () => ({ status, me, expired, isExternal, mustChangePassword, can, login, verifyMfa, enrollMfa, logout, reload }),
    [status, me, expired, isExternal, mustChangePassword, can, login, verifyMfa, enrollMfa, logout, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
};
