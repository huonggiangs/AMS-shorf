// Thong ke su kien theo thiet bi/gio cho "Chan doan dong bo" (api: GET /admin/v1/history/diagnostics). Bang device_event_stats (migration 0028).
// reason: 'accepted', 'valid', 'rej:<ly do>', 'flag:<ly do>', 'alias:<ten>' (so nhan = accepted + tong rej:*). Ghi it dong de tiet kiem row-write D1.
import type { Runtime } from '@ams/runtime';
import type { EventExtras, EventResult } from './events.js';

const KEEP_DAYS = 14;

export async function recordEventStats(rt: Runtime, deviceId: string, result: EventResult, extras: EventExtras): Promise<void> {
  const now = rt.clock.now();
  const at = now.toISOString();
  const hour = at.slice(0, 13);
  const rows = new Map<string, number>();
  const add = (k: string, n: number): void => void (n > 0 && rows.set(k, (rows.get(k) ?? 0) + n));
  add('accepted', result.accepted);
  add('valid', result.valid);
  for (const r of result.rejected) add(`rej:${r.reason}`, 1);
  for (const [k, n] of Object.entries(extras.flags)) add(`flag:${k}`, n);
  for (const [k, n] of Object.entries(extras.aliases)) add(`alias:${k}`, n);
  for (const [k, n] of Object.entries(extras.items ?? {})) add(`item:${k}`, n);
  if (rows.size === 0) return;
  await rt.db.batch(
    [...rows].map(([reason, n]) => ({
      sql: `INSERT INTO device_event_stats (device_id, hour, reason, n, last_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (device_id, hour, reason) DO UPDATE SET n = device_event_stats.n + excluded.n, last_at = excluded.last_at`,
      params: [deviceId, hour, reason, n, at],
    })),
  );
}

export async function sweepEventStats(rt: Runtime): Promise<void> {
  const cut = new Date(rt.clock.now().getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 13);
  await rt.db.run('DELETE FROM device_event_stats WHERE hour < ?', [cut]);
}
