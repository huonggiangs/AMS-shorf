import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errMsg } from './client';
import { useUi } from '../state/ui';
import { useAuth } from '../auth/AuthProvider';

/** Run a mutation, toast the result and refresh cached lists. */
export function useAct() {
  const qc = useQueryClient();
  const { notify } = useUi();
  return useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string), invalidate: string[] = ['/admin/v1']): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (ok) notify(typeof ok === 'function' ? ok(r) : ok);
        await Promise.all(invalidate.map((p) => qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(p) })));
        await qc.invalidateQueries({ queryKey: ['notif'] });
        return r;
      } catch (e) {
        notify(errMsg(e));
        return undefined;
      }
    },
    [qc, notify],
  );
}

/** Endpoint base: external accounts use the portal API (server scopes by customer). */
export function useBase() {
  const { isExternal } = useAuth();
  return {
    isExternal,
    campaigns: isExternal ? '/portal/v1/campaigns' : '/admin/v1/campaigns',
    media: isExternal ? '/portal/v1/media' : '/admin/v1/media',
    topups: isExternal ? '/portal/v1/topups' : '/admin/v1/topups',
  };
}
