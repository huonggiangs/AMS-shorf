import type { Runtime } from '@ams/runtime';
import type { PermRow } from '@ams/config';
import type { FinancePort } from './ports.js';

export type AccountKind = 'internal' | 'customer' | 'partner';

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  kind: AccountKind;
  /** null voi tai khoan noi bo */
  customerId: string | null;
  status: string;
  hasTotp: boolean;
  lastLoginAt: string | null;
  perms: PermRow[];
  sessionId: string;
  csrf: string;
  mfaVerified: boolean;
}

export type AppEnv = {
  Variables: {
    rt: Runtime;
    ip: string;
    user: AuthUser;
    finance: () => Promise<FinancePort>;
  };
};

export const isExternalUser = (u: Pick<AuthUser, 'kind'>): boolean => u.kind !== 'internal';
