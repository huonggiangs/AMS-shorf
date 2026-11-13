import { Hono } from 'hono';
import { unprocessable } from '../lib/errors.js';
import { getRt, num } from '../lib/http.js';
import { isDate, todayVn } from '../lib/dates.js';
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

  // Doanh thu theo gio trong mot ngay (gio Viet Nam) tu impression_hourly. `freshness_at` = su kien moi nhat da vao bang gop:
  // nhin vao do de biet so lieu cap nhat toi dau (consumer tre thi so lieu gio gan nhat con thieu); `stale` = cham hon 2 gio.
  r.get('/hourly', requirePerm('finance', 'view'), async (c) => {
    const rt = getRt(c);
    const date = c.req.query('date') ?? todayVn(rt);
    if (!isDate(date)) throw unprocessable('Ngày phải có dạng YYYY-MM-DD.', 'bad_date');
    const startMs = new Date(`${date}T00:00:00+07:00`).getTime();
    const from = new Date(startMs).toISOString();
    const to = new Date(startMs + 86_400_000).toISOString();
    const rows = await rt.db.query<{ hour: string; imps: number; valid: number; rev: number; reward: number }>(
      'SELECT hour, SUM(impressions) AS imps, SUM(valid) AS valid, SUM(revenue_micro_vnd) AS rev, SUM(reward_vnd) AS reward FROM impression_hourly WHERE hour >= ? AND hour < ? GROUP BY hour ORDER BY hour',
      [from, to],
    );
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, impressions: 0, valid: 0, revenue_vnd: 0, reward_vnd: 0 }));
    for (const x of rows) {
      const vnHour = Math.floor((new Date(x.hour).getTime() - startMs) / 3_600_000);
      const slot = hours[vnHour];
      if (!slot) continue;
      slot.impressions += num(x.imps);
      slot.valid += num(x.valid);
      slot.revenue_vnd += Math.round(num(x.rev) / 1e6);
      slot.reward_vnd += num(x.reward);
    }
    const lastEvent = (await rt.db.query<{ t: string | null }>('SELECT MAX(ts) AS t FROM ev_ad_impression'))[0]?.t ?? null;
    const lastHour = (await rt.db.query<{ t: string | null }>('SELECT MAX(hour) AS t FROM impression_hourly'))[0]?.t ?? null;
    const freshness = lastEvent ?? lastHour;
    const now = rt.clock.now();
    return c.json({
      date,
      tz: 'Asia/Ho_Chi_Minh',
      hours,
      total: hours.reduce((a, h) => ({ impressions: a.impressions + h.impressions, valid: a.valid + h.valid, revenue_vnd: a.revenue_vnd + h.revenue_vnd, reward_vnd: a.reward_vnd + h.reward_vnd }), { impressions: 0, valid: 0, revenue_vnd: 0, reward_vnd: 0 }),
      freshness_at: freshness,
      generated_at: now.toISOString(),
      stale: freshness === null ? true : now.getTime() - new Date(freshness).getTime() > 2 * 3_600_000,
    });
  });
  return r;
}
