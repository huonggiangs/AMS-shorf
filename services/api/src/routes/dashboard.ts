import { Hono } from 'hono';
import { getRt, num } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import { campaignSpec, presentCampaigns } from './campaigns.js';
import type { CampRow } from './campaigns.js';
import type { AppEnv } from '../types.js';

const RANGES = [7, 30, 90];

export function dashboardRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/overview', requirePerm('overview', 'view'), async (c) => {
    const rt = getRt(c);
    const q = Number(c.req.query('range'));
    const range = RANGES.includes(q) ? q : 30;
    const now = rt.clock.now();
    const since = new Date(now.getTime() - (range - 1) * 86400_000).toISOString().slice(0, 10);
    const sinceOnline = new Date(now.getTime() - 10 * 60_000).toISOString();

    const dev = (await rt.db.query<{ total: number; online: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' AND blocked = 0 AND last_seen_at >= ? THEN 1 ELSE 0 END) AS online FROM devices WHERE kind = 'tv'`,
      [sinceOnline],
    ))[0];
    const tot = (await rt.db.query<{ imps: number; rev: number; reward: number }>(
      'SELECT SUM(valid) AS imps, SUM(revenue_micro_vnd) AS rev, SUM(reward_vnd) AS reward FROM impression_hourly WHERE hour >= ?',
      [since],
    ))[0];
    const days = await rt.db.query<{ d: string; imps: number; rev: number }>(
      'SELECT substr(hour, 1, 10) AS d, SUM(valid) AS imps, SUM(revenue_micro_vnd) AS rev FROM impression_hourly WHERE hour >= ? GROUP BY substr(hour, 1, 10) ORDER BY d',
      [since],
    );
    const split = await rt.db.query<{ name: string | null; rev: number }>(
      `SELECT p.name AS name, SUM(h.revenue_micro_vnd) AS rev FROM impression_hourly h LEFT JOIN partners p ON p.id = h.partner_id WHERE h.hour >= ? GROUP BY p.name ORDER BY rev DESC`,
      [since],
    );
    const pending = num((await rt.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM campaigns WHERE state = 'pending_review'"))[0]?.n);
    const awaiting = num((await rt.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM campaigns WHERE state = 'awaiting_funds'"))[0]?.n);
    const media = num((await rt.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM creatives WHERE review_state = 'pending'"))[0]?.n);
    const offline = num((await rt.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM screens WHERE state = 'offline'"))[0]?.n);

    const alerts: { level: string; title: string; text?: string }[] = [];
    if (offline) alerts.push({ level: 'bad', title: `${offline} màn hình đang mất kết nối`, text: 'Kiểm tra mục Quản lý màn hình.' });
    if (pending) alerts.push({ level: 'warn', title: `${pending} chiến dịch chờ duyệt` });
    if (awaiting) alerts.push({ level: 'warn', title: `${awaiting} chiến dịch chờ số dư`, text: 'Khách hàng cần nạp thêm tiền.' });
    if (media) alerts.push({ level: 'warn', title: `${media} media chờ kiểm duyệt` });
    if (!alerts.length) alerts.push({ level: 'ok', title: 'Hệ thống hoạt động bình thường' });

    return c.json({
      range,
      kpi: {
        active_tvs: num(dev?.online),
        total_tvs: num(dev?.total),
        impressions: num(tot?.imps),
        revenue_vnd: Math.round(num(tot?.rev) / 1e6),
        reward_cost_vnd: num(tot?.reward),
        pending_approvals: pending,
      },
      trend: days.map((d) => ({ label: d.d.slice(5).replace('-', '/'), views: num(d.imps), revenue_vnd: Math.round(num(d.rev) / 1e6) })),
      revenue_split: split.map((s) => ({ name: s.name ?? 'Trực tiếp', value: Math.round(num(s.rev) / 1e6) })).filter((s) => s.value > 0),
      slot_fill: [],
      alerts,
      top_campaigns: await topCampaigns(c),
    });
  });

  return r;
}

async function topCampaigns(c: import('../lib/http.js').Ctx): Promise<Record<string, unknown>[]> {
  const rt = getRt(c);
  const rows = await rt.db.query<{ campaign_id: string }>('SELECT campaign_id FROM impression_hourly GROUP BY campaign_id ORDER BY SUM(valid) DESC LIMIT 5');
  if (!rows.length) return [];
  const spec = campaignSpec(c.get('user'), rt.clock.now().toISOString());
  const ids = rows.map((x) => x.campaign_id);
  const list = await rt.db.query<CampRow>(`SELECT ${spec.select} ${spec.from} WHERE c.id IN (${ids.map(() => '?').join(',')})`, ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return presentCampaigns(rt, list, false);
}
