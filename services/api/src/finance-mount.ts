// Diem noi duy nhat voi tai chinh (a2). a1 chi goi mountFinanceRoutes(app, rt); neu can thay the (vd. bo a2), chi sua file nay.
import type { Hono } from 'hono';
import type { Runtime } from '@ams/runtime';
import { loadSession, SESSION_COOKIE } from './auth/session.js';
import { mountFinance } from './finance/index.js';
import type { FinanceActor } from './finance/index.js';
import { timingSafeEqualStr } from '@ams/shared';
import { getCookie } from 'hono/cookie';
import type { FinancePort } from './ports.js';
import type { AppEnv } from './types.js';

/**
 * Route vi/nap tien/SePay cua a2. Actor duoc suy ra tu phien cua a1 (da qua authenticate/CSRF o /admin/v1 va /portal/v1;
 * webhook cong khai khong co phien). Tra ve FinancePort cho logic duyet chien dich.
 */
export function mountFinanceRoutes(app: Hono<AppEnv>, rt: Runtime): FinancePort {
  const res = mountFinance(app as unknown as Hono, rt, {
    resolveActor: async (c): Promise<FinanceActor | null> => {
      const pre = (c as unknown as { get(k: string): unknown }).get('user') as import('./types.js').AuthUser | undefined;
      let u = pre;
      if (!u) {
        const token = getCookie(c, SESSION_COOKIE);
        if (!token) return null;
        try {
          u = await loadSession(rt, token);
        } catch {
          return null;
        }
        const m = c.req.method;
        if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
          const sent = c.req.header('x-csrf-token');
          if (!sent || !timingSafeEqualStr(sent, u.csrf)) return null;
        }
      }
      return { id: u.id, role: u.role, account_kind: u.kind, customer_id: u.customerId, perms: u.perms, ip: (c as unknown as { get(k: string): unknown }).get('ip') as string | null };
    },
  });
  return res.port;
}
