import type { Runtime } from '@ams/runtime';
import { pruneOps, runOpsChecks, withJobRun } from './checks.js';

export * from './checks.js';
export * from './notifier.js';
export * from './status.js';

/** Diem vao cho bo lap lich (node.ts moi 5 phut, worker.ts moi 10 phut). Khong bao gio nem loi. */
export async function opsTick(rt: Runtime, opts: { prune?: boolean } = {}): Promise<void> {
  try {
    await withJobRun(rt, 'ops_checks', () => runOpsChecks(rt));
    if (opts.prune) await pruneOps(rt);
  } catch (e) {
    console.error('[ops] kiem tra van hanh loi:', (e as Error).message);
  }
}
