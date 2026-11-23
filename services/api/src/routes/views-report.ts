// Bao cao LUOT XEM quang cao cho admin (/admin/v1/reports/views) va khach hang (/portal/v1/reports/views, loc theo khach TRONG SQL; khach khong thay thiet bi/doanh thu).
// Doc TRUC TIEP tu bang su kien (ev_ad_impression hop le + ev_proof_of_play hop le), KHONG phu thuoc bang tong hop impression_hourly / job nen,
// nen so lieu hien ngay sau khi ingest ghi xong. Gom theo ngay Asia/Ho_Chi_Minh (UTC+7) o tang ung dung (SQL chi gom theo gio UTC: chay dung tren SQLite, D1, Postgres).
// Mot luot xem hop le =
//   * impression: valid = 1 (thiet bi TV da cap quyen, xem >= 100%, dung gia chot, khong vuot tran gio) — thiet bi TV;
//   * proof_of_play: thiet bi da cap quyen (khong bi chan), phat >= 0,9 x thoi luong creative (khong co thoi luong: tinh), thiet bi KHONG phai TV
//     (TV tinh bang impression, khong dem trung). Xem docs/REPORTING.md.
import { Hono } from 'hono';
import { notFound, unprocessable } from '../lib/errors.js';
import { getRt, num } from '../lib/http.js';
import type { Ctx, SqlFrag } from '../lib/http.js';
import { isDate } from '../lib/dates.js';
import { campaignScope } from '../lib/scope.js';
import { requireAnyPerm, requirePerm } from '../auth/middleware.js';
import { renderViewsPdf } from './views-report-pdf.js';
import { loadLogo } from '../contracts-doc/service.js';
import type { AppEnv } from '../types.js';
import { POP_PENDING } from './history.js';

const VN_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const DETAIL_CAP = 20_000;

export const vnDay = (ms: number): string => new Date(ms + VN_MS).toISOString().slice(0, 10);
/** 'YYYY-MM-DDTHH' (gio UTC) -> ngay VN 'YYYY-MM-DD' */
export const vnDayOfHour = (h: string): string => vnDay(Date.parse(`${h.slice(0, 13)}:00:00Z`));
const vnDayStartMs = (d: string): number => Date.parse(`${d}T00:00:00Z`) - VN_MS;

/** Nguon "luot xem hop le" (xem dau file). Tham so: [from, to) cho impression roi cho PoP. */
const VIEWS_UNION = `
  SELECT e.ts AS ts, e.campaign_id AS campaign_id, e.creative_id AS creative_id, e.device_id AS device_id, COALESCE(cr0.duration_s, 0) * 1000 AS watched_ms, 'imp' AS src
    FROM ev_ad_impression e LEFT JOIN creatives cr0 ON cr0.id = e.creative_id
   WHERE e.valid = 1 AND e.ts >= ? AND e.ts < ?
  UNION ALL
  SELECT p.ts AS ts, COALESCE(p.campaign_id, cr.campaign_id) AS campaign_id, p.creative_id AS creative_id,
         COALESCE(p.device_id, (SELECT sc.device_id FROM screens sc WHERE sc.id = p.screen_id), p.screen_id) AS device_id, p.duration_ms AS watched_ms, 'pop' AS src
    FROM ev_proof_of_play p JOIN creatives cr ON cr.id = p.creative_id
   WHERE p.ts >= ? AND p.ts < ?
     AND NOT ${POP_PENDING}
     AND (COALESCE(cr.duration_s, 0) = 0 OR p.duration_ms * 10 >= cr.duration_s * 9000)
     AND NOT EXISTS (SELECT 1 FROM devices dk WHERE dk.id = COALESCE(p.device_id, p.screen_id) AND dk.kind = 'tv')`;

const FROM = `FROM (${VIEWS_UNION}) v
  JOIN campaigns c ON c.id = v.campaign_id
  LEFT JOIN creatives cr ON cr.id = v.creative_id
  LEFT JOIN devices d ON d.id = v.device_id
  LEFT JOIN device_profiles dp ON dp.device_id = v.device_id
  LEFT JOIN locations l ON l.id = dp.location_id`;

/** So luot xem hop le 30 ngay gan nhat theo thiet bi (cot "Quang cao da xem" o /devices; truoc day doc devices.views_30d la cot tinh, khong ai cap nhat). */
export async function deviceViewCounts(rt: import('@ams/runtime').Runtime, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const now = rt.clock.now().getTime();
  const a = new Date(now - 30 * DAY_MS).toISOString();
  const b = new Date(now + 3600_000).toISOString();
  for (let i = 0; i < ids.length; i += 90) { // D1: <= 100 tham so/cau lenh (4 tham so cho khoang thoi gian)
    const part = ids.slice(i, i + 90);
    const rows = await rt.db.query<{ device_id: string; n: number }>(`SELECT v.device_id AS device_id, COUNT(*) AS n FROM (${VIEWS_UNION}) v WHERE v.device_id IN (${part.map(() => '?').join(',')}) GROUP BY v.device_id`, [a, b, a, b, ...part]);
    for (const r of rows) out.set(r.device_id, num(r.n));
  }
  return out;
}

export interface ViewsQuery {
  from: string; // ngay VN
  to: string; // ngay VN (gom ca ngay do)
  customerId: string | null;
  campaignId: string | null;
  deviceId: string | null;
  locationId: string | null;
}

function parseQuery(c: Ctx, external: boolean, nowMs: number): ViewsQuery {
  const today = vnDay(nowMs);
  const q = (k: string): string | null => {
    const v = c.req.query(k);
    return v ? v : null;
  };
  const to = q('to') ?? today;
  const from = q('from') ?? vnDay(nowMs - 29 * DAY_MS);
  if (!isDate(from) || !isDate(to)) throw unprocessable('Ngày lọc phải có dạng YYYY-MM-DD.', 'bad_date');
  if (from > to) throw unprocessable('"Từ ngày" phải trước hoặc bằng "Đến ngày".', 'bad_range');
  if ((vnDayStartMs(to) - vnDayStartMs(from)) / DAY_MS + 1 > MAX_DAYS) throw unprocessable(`Khoảng ngày tối đa ${MAX_DAYS} ngày.`, 'range_too_long');
  return {
    from,
    to,
    customerId: external ? null : q('customer_id'),
    campaignId: q('campaign_id'),
    deviceId: external ? null : q('device_id'),
    locationId: q('location_id'),
  };
}

function whereOf(vq: ViewsQuery, scope: SqlFrag | null, widen?: { fromMs: number; toMs: number }): { sql: string; params: unknown[] } {
  const fromMs = Math.min(vnDayStartMs(vq.from), widen?.fromMs ?? Infinity);
  const toMs = Math.max(vnDayStartMs(vq.to) + DAY_MS, widen?.toMs ?? 0);
  const a = new Date(fromMs).toISOString();
  const b = new Date(toMs).toISOString();
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [a, b, a, b];
  if (scope) {
    where.push(`(${scope.sql})`);
    params.push(...scope.params);
  }
  if (vq.customerId) (where.push('c.customer_id = ?'), params.push(vq.customerId));
  if (vq.campaignId) (where.push('v.campaign_id = ?'), params.push(vq.campaignId));
  if (vq.deviceId) (where.push('v.device_id = ?'), params.push(vq.deviceId));
  if (vq.locationId) (where.push('dp.location_id = ?'), params.push(vq.locationId));
  return { sql: where.join(' AND '), params };
}

export interface ReportData {
  range: { from: string; to: string; tz: 'Asia/Ho_Chi_Minh' };
  scope: { customer: { id: string; name: string } | null };
  generated_at: string;
  totals: { views: number; watched_s: number; campaigns: number; devices: number; locations: number };
  windows: { today: number; d7: number; d30: number };
  by_day: { day: string; views: number; watched_s: number }[];
  by_campaign: { id: string; name: string | null; customer_id: string | null; views: number; watched_s: number }[];
  by_creative: { id: string; name: string | null; campaign_id: string | null; campaign_name: string | null; views: number; watched_s: number }[];
  by_location: { id: string | null; name: string; views: number; watched_s: number; devices: number }[];
  /** CHI noi bo */
  by_device?: { id: string; name: string | null; kind: string | null; location: string | null; views: number; watched_s: number; last_view_at: string | null }[];
  note: string;
}

const secs = (ms: unknown): number => Math.round(num(ms) / 1000);

export async function buildReport(c: Ctx, external: boolean): Promise<ReportData> {
  const rt = getRt(c);
  const u = c.get('user');
  const now = rt.clock.now();
  const nowMs = now.getTime();
  const vq = parseQuery(c, external, nowMs);
  const nowIso = now.toISOString();
  const scope = campaignScope(u, 'c', nowIso);
  if (external && vq.campaignId) {
    // IDOR: chien dich khong thuoc khach (hoac khong duoc giao cho doi tac) -> 404, khong phan biet "khong co" va "cua khach khac"
    const s = campaignScope(u, 'c', nowIso);
    const ok = await rt.db.query('SELECT 1 FROM campaigns c WHERE c.id = ? AND ' + (s ? `(${s.sql})` : '1 = 1'), [vq.campaignId, ...(s?.params ?? [])]);
    if (!ok.length) throw notFound('Không tìm thấy chiến dịch.');
  }
  const w = whereOf(vq, scope, { fromMs: nowMs - 29 * DAY_MS, toMs: nowMs + 1 }); // gio phu 30 ngay gan nhat de tinh "hom nay / 7 / 30 ngay" du khoang loc ngan
  const wRange = whereOf(vq, scope);
  const q = <T extends object>(sql: string, p: unknown[]): Promise<T[]> => rt.db.query<T>(sql, p);

  const hours = await q<{ h: string; n: number; ms: number }>(`SELECT substr(v.ts, 1, 13) AS h, COUNT(*) AS n, SUM(v.watched_ms) AS ms ${FROM} WHERE ${w.sql} GROUP BY substr(v.ts, 1, 13) ORDER BY h`, w.params);
  const dayMap = new Map<string, { views: number; ms: number }>();
  for (const r of hours) {
    const d = vnDayOfHour(r.h);
    const x = dayMap.get(d) ?? { views: 0, ms: 0 };
    x.views += num(r.n);
    x.ms += num(r.ms);
    dayMap.set(d, x);
  }
  const today = vnDay(nowMs);
  const sumFrom = (fromDay: string): number => [...dayMap].filter(([d]) => d >= fromDay && d <= today).reduce((s, [, x]) => s + x.views, 0);
  const windows = { today: sumFrom(today), d7: sumFrom(vnDay(nowMs - 6 * DAY_MS)), d30: sumFrom(vnDay(nowMs - 29 * DAY_MS)) };

  const by_day: ReportData['by_day'] = [];
  for (let t = vnDayStartMs(vq.from); t <= vnDayStartMs(vq.to); t += DAY_MS) {
    const d = vnDay(t + 1);
    const x = dayMap.get(d);
    by_day.push({ day: d, views: x?.views ?? 0, watched_s: secs(x?.ms) });
  }

  const tot = (await q<{ n: number; ms: number; camps: number; devs: number; locs: number }>(
    `SELECT COUNT(*) AS n, SUM(v.watched_ms) AS ms, COUNT(DISTINCT v.campaign_id) AS camps, COUNT(DISTINCT v.device_id) AS devs, COUNT(DISTINCT dp.location_id) AS locs ${FROM} WHERE ${wRange.sql}`,
    wRange.params,
  ))[0];
  const byCamp = await q<{ id: string; name: string | null; customer_id: string | null; n: number; ms: number }>(
    `SELECT v.campaign_id AS id, c.name AS name, c.customer_id AS customer_id, COUNT(*) AS n, SUM(v.watched_ms) AS ms ${FROM} WHERE ${wRange.sql} GROUP BY v.campaign_id, c.name, c.customer_id ORDER BY n DESC LIMIT 500`,
    wRange.params,
  );
  const byCre = await q<{ id: string; name: string | null; campaign_id: string | null; campaign_name: string | null; n: number; ms: number }>(
    `SELECT v.creative_id AS id, cr.name AS name, v.campaign_id AS campaign_id, c.name AS campaign_name, COUNT(*) AS n, SUM(v.watched_ms) AS ms ${FROM} WHERE ${wRange.sql} GROUP BY v.creative_id, cr.name, v.campaign_id, c.name ORDER BY n DESC LIMIT 500`,
    wRange.params,
  );
  const byLoc = await q<{ id: string | null; name: string | null; n: number; ms: number; devs: number }>(
    `SELECT dp.location_id AS id, l.name AS name, COUNT(*) AS n, SUM(v.watched_ms) AS ms, COUNT(DISTINCT v.device_id) AS devs ${FROM} WHERE ${wRange.sql} GROUP BY dp.location_id, l.name ORDER BY n DESC LIMIT 500`,
    wRange.params,
  );
  let by_device: ReportData['by_device'];
  if (!external) {
    const rows = await q<{ id: string; name: string | null; kind: string | null; loc: string | null; n: number; ms: number; last: string | null }>(
      `SELECT v.device_id AS id, d.name AS name, d.kind AS kind, l.name AS loc, COUNT(*) AS n, SUM(v.watched_ms) AS ms, MAX(v.ts) AS last ${FROM} WHERE ${wRange.sql} GROUP BY v.device_id, d.name, d.kind, l.name ORDER BY n DESC LIMIT 500`,
      wRange.params,
    );
    by_device = rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, location: r.loc, views: num(r.n), watched_s: secs(r.ms), last_view_at: r.last }));
  }
  let customer: ReportData['scope']['customer'] = null;
  const custId = external ? u.customerId : vq.customerId;
  if (custId) {
    const cu = (await q<{ id: string; name: string }>('SELECT id, COALESCE(short_name, legal_name) AS name FROM customers WHERE id = ?', [custId]))[0];
    if (cu) customer = { id: cu.id, name: cu.name };
  }
  return {
    range: { from: vq.from, to: vq.to, tz: 'Asia/Ho_Chi_Minh' },
    scope: { customer },
    generated_at: nowIso,
    totals: { views: num(tot?.n), watched_s: secs(tot?.ms), campaigns: num(tot?.camps), devices: num(tot?.devs), locations: num(tot?.locs) },
    windows,
    by_day,
    by_campaign: byCamp.map((r) => ({ id: r.id, name: r.name, customer_id: external ? null : r.customer_id, views: num(r.n), watched_s: secs(r.ms) })),
    by_creative: byCre.map((r) => ({ id: r.id, name: r.name, campaign_id: r.campaign_id, campaign_name: r.campaign_name, views: num(r.n), watched_s: secs(r.ms) })),
    by_location: byLoc.map((r) => ({ id: r.id, name: r.name ?? 'Chưa gán địa điểm', views: num(r.n), watched_s: secs(r.ms), devices: num(r.devs) })),
    ...(by_device ? { by_device } : {}),
    note: 'Lượt xem hợp lệ = màn đã cấp quyền phát đủ ≥ 90% thời lượng quảng cáo (hoặc xem hết với TV). Ngày tính theo giờ Việt Nam (UTC+7).',
  };
}

const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // chong CSV injection khi mo bang Excel
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function detailCsv(c: Ctx, external: boolean): Promise<string> {
  const rt = getRt(c);
  const u = c.get('user');
  const now = rt.clock.now();
  const vq = parseQuery(c, external, now.getTime());
  const scope = campaignScope(u, 'c', now.toISOString());
  if (external && vq.campaignId) {
    const ok = await rt.db.query('SELECT 1 FROM campaigns c WHERE c.id = ? AND ' + (scope ? `(${scope.sql})` : '1 = 1'), [vq.campaignId, ...(scope?.params ?? [])]);
    if (!ok.length) throw notFound('Không tìm thấy chiến dịch.');
  }
  const w = whereOf(vq, scope);
  const rows = await rt.db.query<{ h: string; cid: string; cname: string | null; custname: string | null; crid: string | null; crname: string | null; did: string | null; dname: string | null; lname: string | null; n: number; ms: number }>(
    `SELECT substr(v.ts, 1, 13) AS h, v.campaign_id AS cid, c.name AS cname, cu.short_name AS custname, v.creative_id AS crid, cr.name AS crname, v.device_id AS did, d.name AS dname, l.name AS lname,
            COUNT(*) AS n, SUM(v.watched_ms) AS ms
       ${FROM} LEFT JOIN customers cu ON cu.id = c.customer_id WHERE ${w.sql}
      GROUP BY substr(v.ts, 1, 13), v.campaign_id, c.name, cu.short_name, v.creative_id, cr.name, v.device_id, d.name, l.name
      ORDER BY h LIMIT ${DETAIL_CAP}`,
    w.params,
  );
  type Agg = { day: string; r: (typeof rows)[number]; n: number; ms: number };
  const agg = new Map<string, Agg>();
  for (const r of rows) {
    const day = vnDayOfHour(r.h);
    const k = [day, r.cid, r.crid, r.did].join('|');
    const x = agg.get(k);
    if (x) {
      x.n += num(r.n);
      x.ms += num(r.ms);
    } else agg.set(k, { day, r, n: num(r.n), ms: num(r.ms) });
  }
  const head = external
    ? ['Ngày', 'Chiến dịch', 'Creative', 'Địa điểm', 'Số lượt xem', 'Thời lượng xem (giây)']
    : ['Ngày', 'Khách hàng', 'Chiến dịch', 'Creative', 'Thiết bị', 'Địa điểm', 'Số lượt xem', 'Thời lượng xem (giây)'];
  const lines = [head.map(csvCell).join(',')];
  for (const { day, r, n, ms } of [...agg.values()].sort((a, b) => a.day.localeCompare(b.day) || b.n - a.n)) {
    const cells = external
      ? [day, r.cname ?? r.cid, r.crname ?? r.crid ?? '', r.lname ?? '', n, secs(ms)]
      : [day, r.custname ?? '', r.cname ?? r.cid, r.crname ?? r.crid ?? '', r.dname ?? r.did ?? '', r.lname ?? '', n, secs(ms)];
    lines.push(cells.map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const fmtN = (n: number): string => n.toLocaleString('vi-VN');
export const fmtDur = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} giờ ${m} phút` : m > 0 ? `${m} phút ${s % 60} giây` : `${s} giây`;
};

export function renderViewsHtml(d: ReportData, external: boolean): string {
  const tbl = (title: string, head: string[], rows: (string | number)[][]): string =>
    rows.length === 0
      ? ''
      : `<h2>${esc(title)}</h2><table><thead><tr>${head.map((h, i) => `<th${i >= head.length - 2 ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((x, i) => `<td${i >= r.length - 2 ? ' class="n"' : ''}>${esc(typeof x === 'number' ? fmtN(x) : x)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`;
  const who = d.scope.customer ? `Khách hàng: <b>${esc(d.scope.customer.name)}</b> · ` : '';
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Báo cáo lượt xem quảng cáo</title>
<style>body{font:14px/1.5 "Be Vietnam Pro",system-ui,sans-serif;color:#14141a;max-width:900px;margin:24px auto;padding:0 16px;position:relative}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 6px}.sub{color:#666}.kpis{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.kpi{flex:1;min-width:150px;border:1px solid #d9dde3;border-radius:8px;padding:10px 14px}.kpi b{display:block;font-size:22px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e5e8ec;padding:5px 8px;text-align:left}th{background:#f3f5f8}.n{text-align:right}.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:140px;font-weight:800;color:rgba(26,64,115,.07);transform:rotate(-40deg);pointer-events:none;z-index:-1}
.foot{margin-top:24px;color:#666;font-size:12px}@media print{body{margin:0}}</style></head><body><div class="wm">ANIO</div>
<h1>Báo cáo lượt xem quảng cáo</h1><div class="sub">${who}Từ ${esc(d.range.from)} đến ${esc(d.range.to)} (giờ Việt Nam) · Xuất lúc ${esc(d.generated_at.slice(0, 16).replace('T', ' '))} UTC</div>
<div class="kpis"><div class="kpi">Tổng lượt xem<b>${fmtN(d.totals.views)}</b></div><div class="kpi">Tổng thời lượng phát<b>${esc(fmtDur(d.totals.watched_s))}</b></div><div class="kpi">Chiến dịch<b>${fmtN(d.totals.campaigns)}</b></div><div class="kpi">${external ? 'Địa điểm' : 'Thiết bị'}<b>${fmtN(external ? d.totals.locations : d.totals.devices)}</b></div></div>
${tbl('Theo ngày', ['Ngày', 'Lượt xem', 'Thời lượng (giây)'], d.by_day.map((x) => [x.day, x.views, x.watched_s]))}
${tbl('Theo chiến dịch', ['Chiến dịch', 'Lượt xem', 'Thời lượng (giây)'], d.by_campaign.map((x) => [x.name ?? x.id, x.views, x.watched_s]))}
${tbl('Quảng cáo (creative) xem nhiều nhất', ['Creative', 'Chiến dịch', 'Lượt xem', 'Thời lượng (giây)'], d.by_creative.slice(0, 20).map((x) => [x.name ?? x.id, x.campaign_name ?? '', x.views, x.watched_s]))}
${tbl('Theo địa điểm', ['Địa điểm', 'Lượt xem', 'Thời lượng (giây)'], d.by_location.map((x) => [x.name, x.views, x.watched_s]))}
${external ? '' : tbl('Theo thiết bị', ['Thiết bị', 'Địa điểm', 'Lượt xem', 'Thời lượng (giây)'], (d.by_device ?? []).map((x) => [x.name ?? x.id, x.location ?? '', x.views, x.watched_s]))}
<p class="foot">${esc(d.note)}</p></body></html>`;
}

function fileName(d: ReportData, ext: string): string {
  const who = (d.scope.customer?.name ?? 'tat-ca').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bao-cao';
  return `bao-cao-luot-xem-${who}-${d.range.from}_${d.range.to}.${ext}`;
}

function build(external: boolean): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('*', external ? requirePerm('campaigns', 'view') : requireAnyPerm(['finance', 'view'], ['devices', 'view'], ['campaigns', 'view']));
  r.get('/', async (c) => c.json(await buildReport(c, external)));
  r.get('/export.csv', async (c) => {
    const body = await detailCsv(c, external);
    return c.body(body, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bao-cao-luot-xem-${vnDay(getRt(c).clock.now().getTime())}.csv"`, 'Cache-Control': 'no-store' });
  });
  r.get('/report.html', async (c) => {
    const d = await buildReport(c, external);
    return c.body(renderViewsHtml(d, external), 200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName(d, 'html')}"`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" });
  });
  r.get('/report.pdf', async (c) => {
    const d = await buildReport(c, external);
    const bytes = await renderViewsPdf(d, { external, logo: (await loadLogo(getRt(c))) ?? null });
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName(d, 'pdf')}"`, 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store' });
  });
  return r;
}

export const viewReportRoutes = (): Hono<AppEnv> => build(false);
export const portalViewReportRoutes = (): Hono<AppEnv> => build(true);
