// Bao cao LUOT HIEN THI TUNG MUC cua danh sach phat trong vung (item_impression, bang ev_item_impression, migration 0029) — tab "Theo muc phat" cua Bao cao luot xem.
//   admin : GET /admin/v1/reports/views/items[/export.csv|/report.html|/report.pdf]
//   portal: GET /portal/v1/reports/views/items[...]  (khach/doi tac chi thay du lieu cua minh, loc TRONG SQL; id cua nguoi khac => 404; khong thay thiet bi)
// CHI BAO CAO: bang nay khong tinh tien, khong tru chi tieu, khong thay proof_of_play/impression (xem docs/PLAYLIST.md). Moi dong = mot lan muc hien thi on dinh tren man.
// Hop le = thiet bi hien dang duoc cap quyen (trust >= 1) va khong bi chan (tinh theo quyen HIEN TAI, nhu proof_of_play). Ngay tinh theo gio Viet Nam (UTC+7).
import { Hono } from 'hono';
import { notFound, unprocessable } from '../lib/errors.js';
import { getRt, num } from '../lib/http.js';
import type { Ctx, SqlFrag } from '../lib/http.js';
import { isDate } from '../lib/dates.js';
import { mediaScope } from '../lib/scope.js';
import { requireAnyPerm, requirePerm } from '../auth/middleware.js';
import { loadLogo } from '../contracts-doc/service.js';
import { renderItemsPdf } from './views-report-pdf.js';
import { vnDay, vnDayOfHour, renderTableHtml, csvCell, esc } from './views-report.js';
import type { AppEnv } from '../types.js';

const VN_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const DETAIL_CAP = 20_000;
const ROW_CAP = 500;
const vnDayStartMs = (d: string): number => Date.parse(`${d}T00:00:00Z`) - VN_MS;

export const ITEM_GROUPS = ['media', 'partner', 'program', 'zone', 'device', 'day'] as const;
export type ItemGroup = (typeof ITEM_GROUPS)[number];
export const ITEM_TYPES = ['video', 'image', 'text'] as const;

export interface ItemsQuery {
  from: string;
  to: string;
  groupBy: ItemGroup;
  customerId: string | null;
  programId: string | null;
  mediaId: string | null;
  zoneId: string | null;
  deviceId: string | null;
  itemType: string | null;
}

function parseQuery(c: Ctx, external: boolean, nowMs: number): ItemsQuery {
  const q = (k: string): string | null => c.req.query(k) || null;
  const to = q('to') ?? vnDay(nowMs);
  const from = q('from') ?? vnDay(nowMs - 29 * DAY_MS);
  if (!isDate(from) || !isDate(to)) throw unprocessable('Ngày lọc phải có dạng YYYY-MM-DD.', 'bad_date');
  if (from > to) throw unprocessable('"Từ ngày" phải trước hoặc bằng "Đến ngày".', 'bad_range');
  if ((vnDayStartMs(to) - vnDayStartMs(from)) / DAY_MS + 1 > MAX_DAYS) throw unprocessable(`Khoảng ngày tối đa ${MAX_DAYS} ngày.`, 'range_too_long');
  const g = (q('group_by') ?? 'media') as ItemGroup;
  if (!ITEM_GROUPS.includes(g)) throw unprocessable(`group_by phải là một trong: ${ITEM_GROUPS.join(', ')}.`, 'bad_group_by');
  if (external && g === 'device') throw unprocessable('Báo cáo của khách hàng không có nhóm theo thiết bị.', 'group_not_allowed');
  const t = q('item_type');
  if (t && !(ITEM_TYPES as readonly string[]).includes(t)) throw unprocessable('item_type phải là video, image hoặc text.', 'bad_item_type');
  return { from, to, groupBy: g, customerId: external ? null : q('customer_id'), programId: q('program_id'), mediaId: q('media_id'), zoneId: q('zone_id'), deviceId: external ? null : q('device_id'), itemType: t };
}

const FROM = `FROM ev_item_impression e
  JOIN devices d ON d.id = e.device_id AND d.trust_level >= 1 AND d.blocked = 0
  LEFT JOIN creatives cr ON cr.id = e.media_id
  LEFT JOIN customers cu ON cu.id = e.customer_id
  LEFT JOIN broadcast_programs bp ON bp.id = e.program_id`;

/** Pham vi cua tai khoan ngoai (trong SQL): khach = customer_id cua minh; doi tac chi them tep minh tai len / thuoc chien dich duoc giao. */
function scopeOf(c: Ctx, external: boolean, nowIso: string): SqlFrag | null {
  if (!external) return null;
  const u = c.get('user');
  if (!u.customerId) return { sql: '1 = 0', params: [] };
  const own: SqlFrag = { sql: 'e.customer_id = ?', params: [u.customerId] };
  if (u.kind === 'customer') return own;
  const ms = mediaScope(u, 'cx', nowIso)!;
  return { sql: `${own.sql} AND e.media_id IN (SELECT cx.id FROM creatives cx WHERE ${ms.sql})`, params: [...own.params, ...ms.params] };
}

function whereOf(q: ItemsQuery, scope: SqlFrag | null): { sql: string; params: unknown[] } {
  const where = ['e.played_at >= ?', 'e.played_at < ?'];
  const params: unknown[] = [new Date(vnDayStartMs(q.from)).toISOString(), new Date(vnDayStartMs(q.to) + DAY_MS).toISOString()];
  if (scope) (where.push(`(${scope.sql})`), params.push(...scope.params));
  const add = (col: string, v: string | null): void => void (v && (where.push(`${col} = ?`), params.push(v)));
  add('e.customer_id', q.customerId);
  add('e.program_id', q.programId);
  add('e.media_id', q.mediaId);
  add('e.zone_id', q.zoneId);
  add('e.device_id', q.deviceId);
  add('e.item_type', q.itemType);
  return { sql: where.join(' AND '), params };
}

export interface ItemRowOut {
  key: string | null;
  label: string;
  impressions: number;
  share: number;
  devices?: number;
  program_id?: string | null;
  zone_id?: string | null;
  kind?: string | null;
}
export interface ItemsReport {
  range: { from: string; to: string; tz: 'Asia/Ho_Chi_Minh' };
  scope: { customer: { id: string; name: string } | null };
  generated_at: string;
  group_by: ItemGroup;
  filters: { customer_id: string | null; program_id: string | null; media_id: string | null; zone_id: string | null; device_id: string | null; item_type: string | null };
  totals: { impressions: number; media: number; programs: number; partners: number; zones: number; devices?: number };
  by_type: { item_type: string; impressions: number }[];
  by_day: { day: string; impressions: number }[];
  rows: ItemRowOut[];
  truncated: boolean;
  note: string;
}

const NOTE = 'Lượt hiển thị của từng mục (video/ảnh/văn bản) trong vùng danh sách phát, do app ghi khi mục đã hiện ổn định trên màn. Chỉ để báo cáo, không dùng để tính tiền. Ngày theo giờ Việt Nam (UTC+7).';

/** Khong co du lieu ben ngoai pham vi: id loc phai co it nhat mot dong trong pham vi cua khach, neu khong 404 (khong phan biet "khong co" va "cua khach khac"). */
async function assertVisible(c: Ctx, scope: SqlFrag | null, q: ItemsQuery): Promise<void> {
  if (!scope) return;
  for (const [col, v] of [['e.program_id', q.programId], ['e.media_id', q.mediaId], ['e.zone_id', q.zoneId]] as const) {
    if (!v) continue;
    const ok = await getRt(c).db.query(`SELECT 1 FROM ev_item_impression e WHERE ${col} = ? AND (${scope.sql}) LIMIT 1`, [v, ...scope.params]);
    if (!ok.length) throw notFound('Không tìm thấy dữ liệu.');
  }
}

export async function buildItemsReport(c: Ctx, external: boolean): Promise<ItemsReport> {
  const rt = getRt(c);
  const u = c.get('user');
  const now = rt.clock.now();
  const q = parseQuery(c, external, now.getTime());
  const nowIso = now.toISOString();
  const scope = scopeOf(c, external, nowIso);
  await assertVisible(c, scope, q);
  const w = whereOf(q, scope);
  const sel = <T extends object>(sql: string): Promise<T[]> => rt.db.query<T>(sql, w.params);

  const hours = await sel<{ h: string; n: number }>(`SELECT substr(e.played_at, 1, 13) AS h, COUNT(*) AS n ${FROM} WHERE ${w.sql} GROUP BY substr(e.played_at, 1, 13) ORDER BY h`);
  const dayMap = new Map<string, number>();
  for (const r of hours) dayMap.set(vnDayOfHour(r.h), (dayMap.get(vnDayOfHour(r.h)) ?? 0) + num(r.n));
  const by_day: ItemsReport['by_day'] = [];
  for (let t = vnDayStartMs(q.from); t <= vnDayStartMs(q.to); t += DAY_MS) by_day.push({ day: vnDay(t + 1), impressions: dayMap.get(vnDay(t + 1)) ?? 0 });

  const tot = (await sel<{ n: number; media: number; progs: number; partners: number; zones: number; devs: number }>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT e.media_id) AS media, COUNT(DISTINCT e.program_id) AS progs, COUNT(DISTINCT e.customer_id) AS partners, COUNT(DISTINCT e.program_id || '/' || e.zone_id) AS zones, COUNT(DISTINCT e.device_id) AS devs ${FROM} WHERE ${w.sql}`,
  ))[0];
  const total = num(tot?.n);
  const byType = await sel<{ t: string; n: number }>(`SELECT e.item_type AS t, COUNT(*) AS n ${FROM} WHERE ${w.sql} GROUP BY e.item_type ORDER BY n DESC`);

  let rows: ItemRowOut[] = [];
  const lim = ROW_CAP + 1;
  const share = (n: number): number => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  if (q.groupBy === 'day') rows = by_day.map((d) => ({ key: d.day, label: d.day, impressions: d.impressions, share: share(d.impressions) }));
  else if (q.groupBy === 'media') {
    const r = await sel<{ k: string | null; label: string | null; kind: string | null; n: number; devs: number }>(`SELECT e.media_id AS k, cr.name AS label, cr.kind AS kind, COUNT(*) AS n, COUNT(DISTINCT e.device_id) AS devs ${FROM} WHERE ${w.sql} GROUP BY e.media_id, cr.name, cr.kind ORDER BY n DESC LIMIT ${lim}`);
    rows = r.map((x) => ({ key: x.k, label: x.label ?? x.k ?? 'Văn bản / link ngoài (không có tệp trong kho)', kind: x.kind, impressions: num(x.n), devices: num(x.devs), share: share(num(x.n)) }));
  } else if (q.groupBy === 'partner') {
    const r = await sel<{ k: string | null; label: string | null; n: number; devs: number }>(`SELECT e.customer_id AS k, COALESCE(cu.short_name, cu.legal_name) AS label, COUNT(*) AS n, COUNT(DISTINCT e.device_id) AS devs ${FROM} WHERE ${w.sql} GROUP BY e.customer_id, cu.short_name, cu.legal_name ORDER BY n DESC LIMIT ${lim}`);
    rows = r.map((x) => ({ key: x.k, label: x.label ?? x.k ?? 'Chưa rõ đối tác', impressions: num(x.n), devices: num(x.devs), share: share(num(x.n)) }));
  } else if (q.groupBy === 'program') {
    const r = await sel<{ k: string; label: string | null; n: number; devs: number }>(`SELECT e.program_id AS k, bp.name AS label, COUNT(*) AS n, COUNT(DISTINCT e.device_id) AS devs ${FROM} WHERE ${w.sql} GROUP BY e.program_id, bp.name ORDER BY n DESC LIMIT ${lim}`);
    rows = r.map((x) => ({ key: x.k, label: x.label ?? `${x.k} (đã xoá)`, program_id: x.k, impressions: num(x.n), devices: num(x.devs), share: share(num(x.n)) }));
  } else if (q.groupBy === 'zone') {
    const r = await sel<{ pid: string; zid: string; label: string | null; n: number; devs: number }>(`SELECT e.program_id AS pid, e.zone_id AS zid, bp.name AS label, COUNT(*) AS n, COUNT(DISTINCT e.device_id) AS devs ${FROM} WHERE ${w.sql} GROUP BY e.program_id, e.zone_id, bp.name ORDER BY n DESC LIMIT ${lim}`);
    rows = r.map((x) => ({ key: `${x.pid}/${x.zid}`, label: `${x.label ?? x.pid} / ${x.zid}`, program_id: x.pid, zone_id: x.zid, impressions: num(x.n), devices: num(x.devs), share: share(num(x.n)) }));
  } else {
    const r = await sel<{ k: string; label: string | null; kind: string | null; n: number }>(`SELECT e.device_id AS k, d.name AS label, d.kind AS kind, COUNT(*) AS n ${FROM} WHERE ${w.sql} GROUP BY e.device_id, d.name, d.kind ORDER BY n DESC LIMIT ${lim}`);
    rows = r.map((x) => ({ key: x.k, label: x.label ?? x.k, kind: x.kind, impressions: num(x.n), share: share(num(x.n)) }));
  }
  const truncated = rows.length > ROW_CAP;
  if (truncated) rows = rows.slice(0, ROW_CAP);

  let customer: ItemsReport['scope']['customer'] = null;
  const custId = external ? u.customerId : q.customerId;
  if (custId) {
    const cu = (await rt.db.query<{ id: string; name: string }>('SELECT id, COALESCE(short_name, legal_name) AS name FROM customers WHERE id = ?', [custId]))[0];
    if (cu) customer = { id: cu.id, name: cu.name };
  }
  return {
    range: { from: q.from, to: q.to, tz: 'Asia/Ho_Chi_Minh' },
    scope: { customer },
    generated_at: nowIso,
    group_by: q.groupBy,
    filters: { customer_id: q.customerId, program_id: q.programId, media_id: q.mediaId, zone_id: q.zoneId, device_id: q.deviceId, item_type: q.itemType },
    totals: { impressions: total, media: num(tot?.media), programs: num(tot?.progs), partners: num(tot?.partners), zones: num(tot?.zones), ...(external ? {} : { devices: num(tot?.devs) }) },
    by_type: byType.map((x) => ({ item_type: x.t, impressions: num(x.n) })),
    by_day,
    rows,
    truncated,
    note: NOTE,
  };
}

const GROUP_TITLE: Record<ItemGroup, string> = { media: 'Theo tệp media', partner: 'Theo đối tác', program: 'Theo chương trình', zone: 'Theo vùng', device: 'Theo thiết bị', day: 'Theo ngày' };

async function detailCsv(c: Ctx, external: boolean): Promise<string> {
  const rt = getRt(c);
  const now = rt.clock.now();
  const q = parseQuery(c, external, now.getTime());
  const scope = scopeOf(c, external, now.toISOString());
  await assertVisible(c, scope, q);
  const w = whereOf(q, scope);
  const rows = await rt.db.query<{ h: string; cust: string | null; pid: string; pname: string | null; zid: string; mid: string | null; mname: string | null; t: string; did: string; dname: string | null; n: number }>(
    `SELECT substr(e.played_at, 1, 13) AS h, COALESCE(cu.short_name, cu.legal_name) AS cust, e.program_id AS pid, bp.name AS pname, e.zone_id AS zid, e.media_id AS mid, cr.name AS mname,
            e.item_type AS t, e.device_id AS did, d.name AS dname, COUNT(*) AS n
       ${FROM} WHERE ${w.sql}
      GROUP BY substr(e.played_at, 1, 13), cu.short_name, cu.legal_name, e.program_id, bp.name, e.zone_id, e.media_id, cr.name, e.item_type, e.device_id, d.name
      ORDER BY h LIMIT ${DETAIL_CAP}`,
    w.params,
  );
  const agg = new Map<string, { day: string; r: (typeof rows)[number]; n: number }>();
  for (const r of rows) {
    const day = vnDayOfHour(r.h);
    const k = [day, r.cust, r.pid, r.zid, r.mid, r.t, external ? '' : r.did].join('|');
    const x = agg.get(k);
    if (x) x.n += num(r.n);
    else agg.set(k, { day, r, n: num(r.n) });
  }
  const head = external ? ['Ngày', 'Đối tác', 'Chương trình', 'Vùng', 'Tệp media', 'Loại mục', 'Số lượt hiển thị'] : ['Ngày', 'Đối tác', 'Chương trình', 'Vùng', 'Tệp media', 'Loại mục', 'Thiết bị', 'Số lượt hiển thị'];
  const lines = [head.map(csvCell).join(',')];
  for (const { day, r, n } of [...agg.values()].sort((a, b) => a.day.localeCompare(b.day) || b.n - a.n)) {
    const base = [day, r.cust ?? '', r.pname ?? r.pid, r.zid, r.mname ?? r.mid ?? '', r.t];
    lines.push((external ? [...base, n] : [...base, r.dname ?? r.did, n]).map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function renderItemsHtml(d: ItemsReport, external: boolean): string {
  const who = d.scope.customer ? `Khách hàng: <b>${esc(d.scope.customer.name)}</b> · ` : '';
  const kpis: [string, string][] = [
    ['Tổng lượt hiển thị', d.totals.impressions.toLocaleString('vi-VN')],
    ['Tệp media', d.totals.media.toLocaleString('vi-VN')],
    ['Chương trình', d.totals.programs.toLocaleString('vi-VN')],
    [external ? 'Vùng' : 'Thiết bị', (external ? d.totals.zones : d.totals.devices ?? 0).toLocaleString('vi-VN')],
  ];
  return renderTableHtml({
    title: 'Báo cáo lượt hiển thị theo mục phát',
    sub: `${who}Từ ${d.range.from} đến ${d.range.to} (giờ Việt Nam) · Xuất lúc ${d.generated_at.slice(0, 16).replace('T', ' ')} UTC`,
    kpis,
    tables: [
      { title: 'Theo ngày', head: ['Ngày', 'Lượt hiển thị'], rows: d.by_day.map((x) => [x.day, x.impressions]) },
      { title: GROUP_TITLE[d.group_by], head: ['Tên', 'Tỷ lệ %', 'Lượt hiển thị'], rows: d.rows.map((x) => [x.label, x.share, x.impressions]) },
    ],
    note: d.note,
  });
}

function fileName(d: ItemsReport, ext: string): string {
  const who = (d.scope.customer?.name ?? 'tat-ca').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bao-cao';
  return `bao-cao-muc-phat-${d.group_by}-${who}-${d.range.from}_${d.range.to}.${ext}`;
}

function build(external: boolean): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('*', external ? requirePerm('campaigns', 'view') : requireAnyPerm(['finance', 'view'], ['devices', 'view'], ['campaigns', 'view']));
  r.get('/', async (c) => c.json(await buildItemsReport(c, external)));
  r.get('/export.csv', async (c) => {
    const body = await detailCsv(c, external);
    return c.body(body, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bao-cao-muc-phat-${vnDay(getRt(c).clock.now().getTime())}.csv"`, 'Cache-Control': 'no-store' });
  });
  r.get('/report.html', async (c) => {
    const d = await buildItemsReport(c, external);
    return c.body(renderItemsHtml(d, external), 200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName(d, 'html')}"`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" });
  });
  r.get('/report.pdf', async (c) => {
    const d = await buildItemsReport(c, external);
    const bytes = await renderItemsPdf(d, { external, groupTitle: GROUP_TITLE[d.group_by], logo: (await loadLogo(getRt(c))) ?? null });
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName(d, 'pdf')}"`, 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store' });
  });
  return r;
}

export const itemsReportRoutes = (): Hono<AppEnv> => build(false);
export const portalItemsReportRoutes = (): Hono<AppEnv> => build(true);
