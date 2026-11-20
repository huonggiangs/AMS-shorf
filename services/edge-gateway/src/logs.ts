// Nhat ky thiet bi (POST /v1/logs): giu 7 ngay. Don dep chay trong sweep() cua gateway (cron moi phut tren Cloudflare, timer tren Node),
// nhung chi that su DELETE toi da moi 10 phut (co hieu kv) de khong quet bang moi phut.
import type { Runtime } from '@ams/runtime';
import { DEVICE_LOG_RETENTION_DAYS } from '@ams/shared';

export const LOG_RETENTION_DAYS = DEVICE_LOG_RETENTION_DAYS;
const SWEEP_EVERY_S = 600;

/** Xoa dong nhat ky qua han (received_at cu hon 7 ngay). Tra so dong da xoa (0 neu chua den luot don). */
export async function sweepDeviceLogs(rt: Runtime, force = false): Promise<number> {
  if (!force) {
    const bucket = Math.floor(rt.clock.now().getTime() / 1000 / SWEEP_EVERY_S);
    const n = await rt.kv.incr(`logsweep:${bucket}`, SWEEP_EVERY_S * 2).catch(() => 1);
    if (n !== 1) return 0;
  }
  const cutoff = new Date(rt.clock.now().getTime() - LOG_RETENTION_DAYS * 86400_000).toISOString();
  return (await rt.db.run('DELETE FROM device_logs WHERE received_at < ?', [cutoff])).changes;
}
