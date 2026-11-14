import type { Runtime } from './types.js';

/** O 10 phut (ISO, phut dau o): khoa cua ops_counters. */
export function opsBucket(d: Date): string {
  const t = Math.floor(d.getTime() / 600_000) * 600_000;
  return new Date(t).toISOString().slice(0, 16);
}

/**
 * Tang bo dem van hanh (bang ops_counters, migration 0009). Chi goi tren duong LOI (5xx) nen khong anh huong duong nong.
 * Khong bao gio nem loi: dem hong khong duoc lam hong yeu cau.
 */
export async function bumpOpsCounter(rt: Pick<Runtime, 'db' | 'clock'>, name: string, by = 1): Promise<void> {
  try {
    await rt.db.run(
      'INSERT INTO ops_counters (name, bucket, n) VALUES (?, ?, ?) ON CONFLICT (name, bucket) DO UPDATE SET n = ops_counters.n + excluded.n',
      [name, opsBucket(rt.clock.now()), by],
    );
  } catch {
    /* bang chua co (chua migrate) hoac DB dang loi: bo qua */
  }
}
