import { Hono } from 'hono';
import { getRt, num } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

export function revenueRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  // Doanh thu ad-network + chi thuong theo thang (12 thang gan nhat) tu bang gop impression_hourly.
  r.get('/', requirePerm('finance', 'view'), async (c) => {
    const rt = getRt(c);
    const now = rt.clock.now();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 7);
    const rows = await rt.db.query<{ m: string; rev: number; reward: number }>(
      'SELECT substr(hour, 1, 7) AS m, SUM(revenue_micro_vnd) AS rev, SUM(reward_vnd) AS reward FROM impression_hourly WHERE substr(hour, 1, 7) >= ? GROUP BY substr(hour, 1, 7) ORDER BY m',
      [start],
    );
    return c.json({ months: rows.map((x) => ({ label: `${x.m.slice(5)}/${x.m.slice(0, 4)}`, revenue_vnd: Math.round(num(x.rev) / 1e6), reward_vnd: num(x.reward) })) });
  });
  return r;
}
