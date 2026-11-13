// Lich su xem quang cao / proof-of-play: doc ev_ad_impression + ev_proof_of_play (bang Postgres/SQLite; ban ClickHouse chua co duong doc).
// Phan quyen: noi bo = finance|devices|campaigns:view; tai khoan ngoai = campaigns:view va BI LOC TRONG SQL theo khach/campaign_grants
// (campaignScope/mediaScope). Truy cap theo id cua khach khac -> 404. Khach khong thay doanh thu, thuong, thiet bi, man hinh.
import { Hono } from 'hono';
import { notFound, unprocessable } from '../lib/errors.js';
import { eq, getRt, num, runList } from '../lib/http.js';
import type { Ctx, FilterDef, ListSpec, SqlFrag } from '../lib/http.js';
import { isDate } from '../lib/dates.js';
import { campaignScope, mediaScope } from '../lib/scope.js';
import { hasPerm, requireAnyPerm, requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';


const vnDayStartIso = (d: string): string => new Date(`${d}T00:00:00+07:00`).toISOString();
const dateFilter = (op: '>=' | '<', col: string): FilterDef => (v) => {
  if (!isDate(v)) throw unprocessable('Ngày lọc phải có dạng YYYY-MM-DD.', 'bad_date');
  if (op === '>=') return { sql: `${col} >= ?`, params: [vnDayStartIso(v)] };
  // "den ngay" bao gom ca ngay do (gio Viet Nam)
  return { sql: `${col} < ?`, params: [new Date(new Date(`${v}T00:00:00+07:00`).getTime() + 86_400_000).toISOString()] };
};
const bool01 = (col: string): FilterDef => (v) => ({ sql: `${col} = ?`, params: [v === 'true' || v === '1' ? 1 : 0] });

const IMP_FROM = `FROM ev_ad_impression e
  LEFT JOIN campaigns c ON c.id = e.campaign_id
  LEFT JOIN devices d ON d.id = e.device_id
  LEFT JOIN creatives cr ON cr.id = e.creative_id`;

interface ImpRow {
  event_id: string;
  ts: string;
  device_id: string | null;
  device_name: string | null;
  screen_id: string | null;
  campaign_id: string;
  campaign_name: string | null;
  customer_id: string | null;
  creative_id: string | null;
  creative_name: string | null;
  partner_id: string | null;
  vcr_pct: number;
  valid: number;
  reject_reason: string | null;
  revenue_micro_vnd: number;
  reward_vnd: number;
}
const IMP_SELECT = `e.event_id, e.ts, e.device_id, d.name AS device_name, e.screen_id, e.campaign_id, c.name AS campaign_name, c.customer_id, e.creative_id, cr.name AS creative_name,
  e.partner_id, e.vcr_pct, e.valid, e.reject_reason, e.revenue_micro_vnd, e.reward_vnd`;

function impSpec(external: boolean, scope: SqlFrag | null): ListSpec {
  const filters: Record<string, FilterDef> = {
    campaign_id: eq('e.campaign_id'),
    creative_id: eq('e.creative_id'),
    valid: bool01('e.valid'),
    from: dateFilter('>=', 'e.ts'),
    to: dateFilter('<', 'e.ts'),
  };
  if (!external) {
    filters['device_id'] = eq('e.device_id');
    filters['screen_id'] = eq('e.screen_id');
    filters['customer_id'] = eq('c.customer_id');
    filters['reject_reason'] = eq('e.reject_reason');
    filters['partner_id'] = eq('e.partner_id');
  }
  return {
    from: IMP_FROM,
    select: IMP_SELECT,
    where: scope ? [scope] : [],
    search: external ? ['c.name', 'cr.name'] : ['c.name', 'cr.name', 'd.name', 'e.event_id'],
    sorts: { ts: 'e.ts', vcr_pct: 'e.vcr_pct', campaign: 'c.name', valid: 'e.valid' },
    defaultSort: 'ts:desc',
    tiebreak: 'e.event_id',
    filters,
  };
}

function presentImp(r: ImpRow, internal: boolean, finance: boolean) {
  const base = {
    event_id: r.event_id,
    ts: r.ts,
    campaign: { id: r.campaign_id, name: r.campaign_name },
    creative: r.creative_id ? { id: r.creative_id, name: r.creative_name } : null,
    vcr_pct: num(r.vcr_pct),
    valid: !!num(r.valid),
    reject_reason: r.reject_reason,
  };
  if (!internal) return base;
  return {
    ...base,
    customer_id: r.customer_id,
    device: r.device_id ? { id: r.device_id, name: r.device_name } : null,
    screen_id: r.screen_id,
    partner_id: r.partner_id,
    ...(finance ? { revenue_vnd: Math.round(num(r.revenue_micro_vnd) / 1e6), reward_vnd: num(r.reward_vnd) } : {}),
  };
}

const POP_FROM = `FROM ev_proof_of_play p JOIN creatives cr ON cr.id = p.creative_id LEFT JOIN campaigns c ON c.id = cr.campaign_id`;
interface PopRow {
  ts: string;
  screen_id: string;
  creative_id: string;
  creative_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  duration_ms: number;
  source: string | null;
}
function popSpec(external: boolean, scope: SqlFrag | null): ListSpec {
  const filters: Record<string, FilterDef> = { creative_id: eq('p.creative_id'), campaign_id: eq('cr.campaign_id'), from: dateFilter('>=', 'p.ts'), to: dateFilter('<', 'p.ts') };
  if (!external) {
    filters['screen_id'] = eq('p.screen_id');
    filters['customer_id'] = eq('cr.customer_id');
  }
  return {
    from: POP_FROM,
    select: 'p.ts, p.screen_id, p.creative_id, cr.name AS creative_name, cr.campaign_id, c.name AS campaign_name, p.duration_ms, p.source',
    where: scope ? [scope] : [],
    search: ['cr.name', 'c.name'],
    sorts: { ts: 'p.ts', duration_ms: 'p.duration_ms' },
    defaultSort: 'ts:desc',
    tiebreak: 'p.creative_id',
    filters,
  };
}

function build(external: boolean): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('*', external ? requirePerm('campaigns', 'view') : requireAnyPerm(['finance', 'view'], ['devices', 'view'], ['campaigns', 'view']));
  const nowIso = (c: Ctx) => getRt(c).clock.now().toISOString();

  r.get('/', async (c) => {
    const u = c.get('user');
    const res = await runList<ImpRow>(c, impSpec(external, campaignScope(u, 'c', nowIso(c))));
    const fin = !external && hasPerm(c, 'finance', 'view');
    return c.json({ ...res, items: res.items.map((x) => presentImp(x, !external, fin)) });
  });

  r.get('/proof-of-play', async (c) => {
    const u = c.get('user');
    const res = await runList<PopRow>(c, popSpec(external, mediaScope(u, 'cr', nowIso(c))));
    return c.json({
      ...res,
      items: res.items.map((x) => ({
        ts: x.ts,
        creative: { id: x.creative_id, name: x.creative_name },
        campaign: x.campaign_id ? { id: x.campaign_id, name: x.campaign_name } : null,
        duration_ms: num(x.duration_ms),
        ...(external ? {} : { screen_id: x.screen_id, source: x.source }),
      })),
    });
  });

  r.get('/:eventId', async (c) => {
    const u = c.get('user');
    const scope = campaignScope(u, 'c', nowIso(c));
    const where = ['e.event_id = ?'];
    const params: unknown[] = [c.req.param('eventId')];
    if (scope) {
      where.push(`(${scope.sql})`);
      params.push(...scope.params);
    }
    const row = (await getRt(c).db.query<ImpRow>(`SELECT ${IMP_SELECT} ${IMP_FROM} WHERE ${where.join(' AND ')}`, params))[0];
    if (!row) throw notFound('Không tìm thấy lượt xem.'); // dung chung cho "khong co" va "thuoc khach khac"
    return c.json(presentImp(row, !external, !external && hasPerm(c, 'finance', 'view')));
  });
  return r;
}

export const historyRoutes = (): Hono<AppEnv> => build(false);
export const portalHistoryRoutes = (): Hono<AppEnv> => build(true);
