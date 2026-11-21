// Phat song noi bo — tong quan (Ban lam viec), phan phoi thong minh (de xuat theo LUAT, khong can khoa AI), hang doi lenh va nhat ky.
// Chi DOC du lieu san co (broadcast_programs, creatives, devices, device_commands, audit_log, device_logs, ev_heartbeat); duy nhat ghi: audit 'broadcast.recommend'.
import { Hono } from 'hono';
import { z } from 'zod';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { eq, getRt, jsonParse, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

const ONLINE_WINDOW_MS = 20 * 60_000; // heartbeat mac dinh 5-10 phut: im lang qua 20 phut = ngoai tuyen
const VN_OFFSET_MS = 7 * 3600_000;
const TARGET_KINDS: Record<string, string[]> = { tv: ['tv', 'phone', 'virtual'], elevator: ['elevator'], led: ['led_p5'], led_p5: ['led_p5'] };
const kindClass = (kind: string): string => (kind === 'elevator' ? 'elevator' : kind === 'led_p5' ? 'led_p5' : 'tv');

const vnNow = (now: Date) => new Date(now.getTime() + VN_OFFSET_MS);
const vnDay = (now: Date) => vnNow(now).toISOString().slice(0, 10);
const vnMinute = (now: Date) => {
  const d = vnNow(now);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const isOnline = (lastSeen: string | null, nowMs: number) => !!lastSeen && nowMs - Date.parse(lastSeen) <= ONLINE_WINDOW_MS;

// ---------------------------------------------------------------- luat de xuat
export const PLACES = ['building', 'office', 'hospital', 'school', 'mall', 'restaurant', 'street', 'home', 'other'] as const;
export const AUDIENCES = ['child', 'teen', 'adult', 'senior', 'mixed'] as const;
export const DENSITIES = ['low', 'medium', 'high'] as const;
export const WEATHERS = ['any', 'sunny', 'rain', 'hot', 'cold'] as const;
export const PLACE_LABEL: Record<(typeof PLACES)[number], string> = {
  building: 'Chung cư / tòa nhà', office: 'Văn phòng', hospital: 'Bệnh viện / phòng khám', school: 'Trường học', mall: 'Trung tâm thương mại', restaurant: 'Nhà hàng / quán cà phê', street: 'Ngoài trời / đường phố', home: 'Gia đình', other: 'Khác',
};
/** Loai man phu hop nhat voi tung dia diem (diem cong); loai thu hai nhan nua diem. */
const PLACE_TARGET: Record<(typeof PLACES)[number], string[]> = {
  building: ['elevator', 'tv'], office: ['elevator', 'tv'], hospital: ['elevator', 'tv'], school: ['tv'], mall: ['led_p5', 'elevator'], restaurant: ['tv'], street: ['led_p5'], home: ['tv'], other: [],
};
const PEAK_DENSITY_BONUS: Record<string, number> = { high: 5, medium: 2, low: 0 };

const recommendBody = z.object({
  place: z.enum(PLACES).default('other'),
  hour: z.coerce.number().int().min(0).max(23).optional(),
  audience: z.enum(AUDIENCES).default('mixed'),
  density: z.enum(DENSITIES).default('medium'),
  weather: z.enum(WEATHERS).default('any'),
  note: z.string().trim().max(200).default(''),
});

interface ProgRow {
  id: string;
  name: string;
  target_type: string;
  regions: string | null;
  start_date: string | null;
  end_date: string | null;
  start_min: number;
  end_min: number;
  priority: number;
  status: string;
  item_count: number;
  not_ready: number;
  not_kid: number;
}
interface DevAgg { region_id: string | null; kind: string; last_seen_at: string | null }

export interface Reco {
  program_id: string;
  name: string;
  status: string;
  target_type: string;
  score: number;
  reasons: string[];
  warnings: string[];
  regions: string[];
  groups: { region: string; online: number; total: number }[];
  online_total: number;
  device_total: number;
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

export function scoreProgram(p: ProgRow, ctx: z.infer<typeof recommendBody> & { hour: number }, devs: DevAgg[], nowMs: number, today: string): Reco {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 50;
  const regions = jsonParse<string[]>(p.regions, []);
  const hourMin = ctx.hour * 60;

  if (p.status === 'published') { score += 10; reasons.push('Đang xuất bản (+10).'); } else { score -= 15; warnings.push('Chương trình còn là bản nháp, cần xuất bản để thiết bị nhận.'); }

  const inWindow = p.start_min <= p.end_min ? hourMin >= p.start_min && hourMin < p.end_min : hourMin >= p.start_min || hourMin < p.end_min;
  if (inWindow) { score += 15; reasons.push(`Khung giờ ${fmtMin(p.start_min)}–${fmtMin(p.end_min)} bao trùm ${String(ctx.hour).padStart(2, '0')}h (+15).`); } else { score -= 20; reasons.push(`Ngoài khung giờ ${fmtMin(p.start_min)}–${fmtMin(p.end_min)} (−20).`); }

  if ((p.start_date && p.start_date > today) ) { score -= 10; warnings.push(`Chưa tới ngày bắt đầu (${p.start_date}).`); }

  const pref = PLACE_TARGET[ctx.place];
  const cls = p.target_type === 'led' ? 'led_p5' : p.target_type;
  const idx = pref.indexOf(cls);
  if (idx === 0) { score += 20; reasons.push(`Loại màn "${cls}" phù hợp nhất với ${PLACE_LABEL[ctx.place].toLowerCase()} (+20).`); }
  else if (idx > 0) { score += 10; reasons.push(`Loại màn "${cls}" phù hợp thứ hai với ${PLACE_LABEL[ctx.place].toLowerCase()} (+10).`); }
  else if (pref.length) { score -= 5; reasons.push(`Loại màn "${cls}" ít phù hợp với ${PLACE_LABEL[ctx.place].toLowerCase()} (−5).`); }

  if (ctx.audience === 'child' || ctx.audience === 'teen') {
    if (p.item_count > 0 && p.not_kid === 0) { score += 15; reasons.push('Mọi tệp đã được xác nhận an toàn cho trẻ em (+15).'); }
    else if (p.item_count > 0) { score -= 40; warnings.push(`${p.not_kid} tệp chưa xác nhận an toàn cho trẻ em (−40).`); }
  }

  const dens = PEAK_DENSITY_BONUS[ctx.density] ?? 0;
  if (ctx.density === 'high' && p.item_count >= 3) { score += dens; reasons.push('Đông người: chương trình nhiều tệp giữ nhịp tốt (+5).'); }
  else if (ctx.density === 'low' && p.item_count > 0 && p.item_count <= 2) { score += 5; reasons.push('Ít người: chương trình ngắn, lặp lại hợp lý (+5).'); }

  const words = stripAccents(`${ctx.note} ${ctx.weather === 'any' ? '' : ctx.weather}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const nameN = stripAccents(p.name);
  const hit = [...new Set(words)].filter((w) => nameN.includes(w)).slice(0, 2);
  if (hit.length) { score += hit.length * 10; reasons.push(`Tên chương trình khớp ghi chú: ${hit.join(', ')} (+${hit.length * 10}).`); }

  if (p.priority !== 3) { const d = (p.priority - 3) * 2; score += d; reasons.push(`Ưu tiên ${p.priority}/5 (${d > 0 ? '+' : ''}${d}).`); }

  if (p.item_count === 0) { score -= 30; warnings.push('Chương trình chưa có tệp nào (−30).'); }
  else if (p.not_ready > 0) { score -= 30; warnings.push(`${p.not_ready} tệp chưa duyệt/chưa sẵn sàng (−30).`); }

  const kinds = TARGET_KINDS[p.target_type] ?? [];
  const match = devs.filter((d) => kinds.includes(d.kind) && (regions.length === 0 || (d.region_id !== null && regions.includes(d.region_id))));
  const by = new Map<string, { online: number; total: number }>();
  for (const d of match) {
    const k = d.region_id ?? 'không rõ';
    const g = by.get(k) ?? { online: 0, total: 0 };
    g.total++;
    if (isOnline(d.last_seen_at, nowMs)) g.online++;
    by.set(k, g);
  }
  const groups = [...by.entries()].map(([region, g]) => ({ region, ...g })).sort((a, b) => b.online - a.online || a.region.localeCompare(b.region));
  const onlineTotal = groups.reduce((s, g) => s + g.online, 0);
  if (match.length === 0) { score -= 25; warnings.push('Chưa có thiết bị đã duyệt nào khớp loại màn/khu vực của chương trình (−25).'); }
  else if (onlineTotal === 0) { score -= 10; warnings.push('Các thiết bị khớp đang ngoại tuyến (−10).'); }
  else reasons.push(`${onlineTotal}/${match.length} thiết bị khớp đang trực tuyến.`);

  return { program_id: p.id, name: p.name, status: p.status, target_type: p.target_type, score: Math.max(0, Math.min(100, Math.round(score))), reasons, warnings, regions, groups, online_total: onlineTotal, device_total: match.length };
}

const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------- danh sach phan trang
const queueSpec: ListSpec = {
  from: 'FROM device_commands k JOIN devices d ON d.id = k.device_id',
  select: 'k.id, k.device_id, d.name AS device_name, d.kind AS device_kind, d.region_id, k.type, k.args, k.status, k.created_at, k.expires_at, k.delivered_at, k.deliveries, k.acked_at, k.result',
  search: ['k.type', 'd.name', 'k.device_id'],
  sorts: { created_at: 'k.created_at', type: 'k.type', status: 'k.status' },
  defaultSort: 'created_at:desc',
  tiebreak: 'k.id',
  filters: {
    status: eq('k.status'),
    type: eq('k.type'),
    device_id: eq('k.device_id'),
    kind: (v) => ({ sql: 'd.kind = ?', params: [v] }),
  },
};

const logSpec: ListSpec = {
  from: "FROM audit_log l LEFT JOIN admins a ON a.id = l.actor_id",
  select: 'l.id, l.ts, l.actor_id, a.name AS actor_name, l.action, l.object_type, l.object_id, l.diff',
  where: [{ sql: "l.action LIKE 'broadcast.%'", params: [] }],
  search: ['l.action', 'a.name', 'l.object_id', 'l.diff'],
  sorts: { at: 'l.ts', action: 'l.action', actor: 'a.name' },
  defaultSort: 'at:desc',
  tiebreak: 'l.id',
  filters: { action: eq('l.action'), object_id: eq('l.object_id') },
};

const devLogSpec: ListSpec = {
  from: 'FROM device_logs l LEFT JOIN devices d ON d.id = l.device_id',
  select: 'l.id, l.device_id, d.name AS device_name, d.region_id, l.ts, l.level, l.tag, l.message',
  search: ['l.message', 'l.tag', 'd.name', 'l.device_id'],
  sorts: { ts: 'l.ts', level: 'l.level' },
  defaultSort: 'ts:desc',
  tiebreak: 'l.id',
  filters: { level: eq('l.level'), device_id: eq('l.device_id') },
};

const hbSpec: ListSpec = {
  from: 'FROM ev_heartbeat h LEFT JOIN devices d ON d.id = h.device_id',
  select: 'h.device_id, d.name AS device_name, h.ts, h.region, h.app_ver, h.soc_temp, h.rssi, h.dl_mbps, h.cache_used_mb, h.cache_slots, h.state',
  search: ['d.name', 'h.device_id'],
  sorts: { ts: 'h.ts' },
  defaultSort: 'ts:desc',
  tiebreak: 'h.device_id',
  filters: { device_id: eq('h.device_id') },
};

const effState = (status: string, expiresAt: string, nowIso: string) => (status === 'pending' || status === 'delivered') && expiresAt < nowIso ? 'expired' : status;

export function broadcastInsightsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ---- Ban lam viec
  r.get('/summary', requirePerm('schedule', 'view'), async (c) => {
    const rt = getRt(c);
    const now = rt.clock.now();
    const today = vnDay(now);
    const nowMin = vnMinute(now);
    const progs = await rt.db.query<{ id: string; name: string; target_type: string; regions: string | null; status: string; start_date: string | null; end_date: string | null; start_min: number; end_min: number; updated_at: string; item_count: number }>(
      'SELECT p.id, p.name, p.target_type, p.regions, p.status, p.start_date, p.end_date, p.start_min, p.end_min, p.updated_at, (SELECT COUNT(*) FROM broadcast_program_items i WHERE i.program_id = p.id) AS item_count FROM broadcast_programs p ORDER BY p.updated_at DESC',
    );
    const expired = (p: { end_date: string | null }) => p.end_date !== null && p.end_date < today;
    const live = (p: (typeof progs)[number]) => p.status === 'published' && !expired(p) && (p.start_date === null || p.start_date <= today) && nowMin >= p.start_min && nowMin < p.end_min;
    const programs = {
      total: progs.length,
      live: progs.filter(live).length,
      published: progs.filter((p) => p.status === 'published' && !expired(p)).length,
      draft: progs.filter((p) => p.status === 'draft').length,
      expired: progs.filter((p) => p.status === 'ended' || (p.status === 'published' && expired(p))).length,
      recent: progs.slice(0, 5).map((p) => ({ id: p.id, name: p.name, target_type: p.target_type, status: p.status, live: live(p), item_count: num(p.item_count), updated_at: p.updated_at })),
    };
    const media = (await rt.db.query<{ review_state: string; n: number }>("SELECT review_state, COUNT(*) AS n FROM creatives WHERE campaign_id IS NULL GROUP BY review_state"));
    const mediaBy = Object.fromEntries(media.map((m) => [m.review_state, num(m.n)]));
    const devs = await rt.db.query<{ region_id: string | null; kind: string; last_seen_at: string | null; trust_level: number; blocked: number }>('SELECT region_id, kind, last_seen_at, trust_level, blocked FROM devices');
    const nowMs = now.getTime();
    const regions = new Map<string, { region: string; online: number; offline: number }>();
    let pendingApproval = 0;
    for (const d of devs) {
      if (num(d.blocked) === 1) continue;
      if (num(d.trust_level) < 1) { pendingApproval++; continue; }
      const k = d.region_id ?? 'không rõ';
      const g = regions.get(k) ?? { region: k, online: 0, offline: 0 };
      if (isOnline(d.last_seen_at, nowMs)) g.online++; else g.offline++;
      regions.set(k, g);
    }
    const regionList = [...regions.values()].sort((a, b) => b.online + b.offline - (a.online + a.offline));
    const notices = await rt.db.query<{ id: string; ts: string; diff: string | null }>("SELECT id, ts, diff FROM audit_log WHERE action = 'broadcast.notice' ORDER BY ts DESC, id DESC LIMIT 5");
    const cmds = await rt.db.query<{ status: string; expires_at: string; n: number }>("SELECT status, expires_at, COUNT(*) AS n FROM device_commands WHERE status IN ('pending','delivered','failed') GROUP BY status, expires_at");
    const nowIso = now.toISOString();
    const queue = { pending: 0, delivered: 0, failed: 0 };
    for (const k of cmds) {
      const s = effState(k.status, k.expires_at, nowIso);
      if (s === 'pending' || s === 'delivered' || s === 'failed') queue[s] += num(k.n);
    }
    return c.json({
      generated_at: nowIso,
      programs,
      media: { pending_review: num(mediaBy['pending']) + num(mediaBy['needs_review']), approved: num(mediaBy['approved']), rejected: num(mediaBy['rejected']) + num(mediaBy['returned']), by_state: mediaBy },
      devices: { online: regionList.reduce((s, g) => s + g.online, 0), offline: regionList.reduce((s, g) => s + g.offline, 0), awaiting_approval: pendingApproval, regions: regionList },
      notices: notices.map((n) => ({ id: n.id, at: n.ts, ...jsonParse<Record<string, unknown>>(n.diff, {}) })),
      queue,
    });
  });

  // ---- Phan phoi thong minh
  r.post('/recommend', requirePerm('schedule', 'view'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, recommendBody);
    const now = rt.clock.now();
    const ctx = { ...b, hour: b.hour ?? Math.floor(vnMinute(now) / 60) };
    const today = vnDay(now);
    const progs = await rt.db.query<ProgRow>(
      `SELECT p.id, p.name, p.target_type, p.regions, p.start_date, p.end_date, p.start_min, p.end_min, p.priority, p.status,
         (SELECT COUNT(*) FROM broadcast_program_items i WHERE i.program_id = p.id) AS item_count,
         (SELECT COUNT(*) FROM broadcast_program_items i JOIN creatives cr ON cr.id = i.creative_id
            WHERE i.program_id = p.id AND NOT (cr.review_state = 'approved' AND cr.state = 'ready' AND cr.scan_state NOT IN ('infected','failed','needs_manual_review','pending'))) AS not_ready,
         (SELECT COUNT(*) FROM broadcast_program_items i LEFT JOIN creative_security s ON s.creative_id = i.creative_id
            WHERE i.program_id = p.id AND COALESCE(s.kid_safe, 0) = 0) AS not_kid
       FROM broadcast_programs p WHERE p.status IN ('draft','published') AND (p.end_date IS NULL OR p.end_date >= ?)`,
      [today],
    );
    const devs = await rt.db.query<DevAgg>('SELECT region_id, kind, last_seen_at FROM devices WHERE trust_level >= 1 AND blocked = 0');
    const nowMs = now.getTime();
    const items = progs
      .map((p) => scoreProgram({ ...p, item_count: num(p.item_count), not_ready: num(p.not_ready), not_kid: num(p.not_kid), start_min: num(p.start_min), end_min: num(p.end_min), priority: num(p.priority, 3) }, ctx, devs, nowMs, today))
      .sort((a, c2) => c2.score - a.score || a.name.localeCompare(c2.name))
      .slice(0, 10);
    // Goi y tep chua dung trong chuong trinh nao (kho san sang) — de tao chuong trinh moi.
    const free = await rt.db.query<{ id: string; name: string | null; kind: string | null; target_type: string | null; kid_safe: number | null }>(
      `SELECT cr.id, cr.name, cr.kind, cr.target_type, s.kid_safe FROM creatives cr LEFT JOIN creative_security s ON s.creative_id = cr.id
       WHERE cr.campaign_id IS NULL AND cr.review_state = 'approved' AND cr.state = 'ready' AND cr.scan_state NOT IN ('infected','failed','needs_manual_review','pending')
         AND cr.id NOT IN (SELECT creative_id FROM broadcast_program_items) ORDER BY cr.created_at DESC LIMIT 30`,
    );
    const kidOnly = ctx.audience === 'child' || ctx.audience === 'teen';
    const mediaSuggestions = free.filter((m) => !kidOnly || num(m.kid_safe) === 1).slice(0, 8).map((m) => ({ id: m.id, name: m.name, kind: m.kind, target_type: m.target_type, kid_safe: num(m.kid_safe) === 1 }));
    const result = {
      engine: 'rules' as const,
      context: ctx,
      summary: items.length === 0 ? 'Chưa có chương trình nào để đề xuất. Hãy tạo chương trình phát sóng trước.' : `Đề xuất “${items[0]!.name}” (${items[0]!.score}/100) cho ${PLACE_LABEL[ctx.place].toLowerCase()} lúc ${String(ctx.hour).padStart(2, '0')}h.`,
      items,
      media_suggestions: mediaSuggestions,
    };
    await auditCtx(c, rt.db, { action: 'broadcast.recommend', objectType: 'broadcast_recommend', objectId: null, diff: { context: ctx, top: items.slice(0, 3).map((x) => ({ id: x.program_id, name: x.name, score: x.score })), engine: 'rules' } });
    return c.json(result);
  });

  r.get('/recommend', requirePerm('schedule', 'view'), async (c) => {
    const rows = await getRt(c).db.query<{ id: string; ts: string; actor_id: string | null; actor_name: string | null; diff: string | null }>(
      "SELECT l.id, l.ts, l.actor_id, a.name AS actor_name, l.diff FROM audit_log l LEFT JOIN admins a ON a.id = l.actor_id WHERE l.action = 'broadcast.recommend' ORDER BY l.ts DESC, l.id DESC LIMIT 30",
    );
    return c.json({ items: rows.map((x) => ({ id: x.id, at: x.ts, actor: x.actor_name ?? x.actor_id ?? 'system', ...jsonParse<Record<string, unknown>>(x.diff, {}) })), total: rows.length });
  });

  // ---- Hang doi lenh
  r.get('/queue', requirePerm('devices', 'view'), async (c: Ctx) => {
    const rt = getRt(c);
    const nowIso = rt.clock.now().toISOString();
    const res = await runList<{ id: string; device_id: string; device_name: string | null; device_kind: string; region_id: string | null; type: string; args: string | null; status: string; created_at: string; expires_at: string; delivered_at: string | null; deliveries: number; acked_at: string | null; result: string | null }>(c, queueSpec);
    const counts = await rt.db.query<{ status: string; expires_at: string; n: number }>('SELECT status, expires_at, COUNT(*) AS n FROM device_commands GROUP BY status, expires_at');
    const by: Record<string, number> = { pending: 0, delivered: 0, acked: 0, failed: 0, expired: 0 };
    for (const k of counts) { const s = effState(k.status, k.expires_at, nowIso); by[s] = (by[s] ?? 0) + num(k.n); }
    const types = await rt.db.query<{ type: string }>('SELECT DISTINCT type FROM device_commands ORDER BY type');
    return c.json({
      ...res,
      counts: by,
      types: types.map((t) => t.type),
      items: res.items.map((k) => {
        const state = effState(k.status, k.expires_at, nowIso);
        return { id: k.id, device_id: k.device_id, device_name: k.device_name, device_kind: k.device_kind, region: k.region_id, type: k.type, args: jsonParse<Record<string, unknown>>(k.args, {}), status: k.status, state, created_at: k.created_at, expires_at: k.expires_at, delivered_at: k.delivered_at, deliveries: num(k.deliveries), acked_at: k.acked_at, result: k.result, cancellable: state === 'pending' || state === 'delivered' };
      }),
    });
  });

  // ---- Nhat ky phat song (audit_log broadcast.*)
  r.get('/logs', requirePerm('schedule', 'view'), async (c) => {
    const res = await runList<{ id: string; ts: string; actor_id: string | null; actor_name: string | null; action: string; object_type: string | null; object_id: string | null; diff: string | null }>(c, logSpec);
    return c.json({ ...res, items: res.items.map((l) => ({ id: l.id, at: l.ts, actor: l.actor_name ?? l.actor_id ?? 'system', action: l.action, object_type: l.object_type, object_id: l.object_id, diff: jsonParse(l.diff, null) })) });
  });

  // ---- Su kien thiet bi gan day
  r.get('/events/logs', requirePerm('devices', 'view'), async (c) => {
    const res = await runList<{ id: string; device_id: string; device_name: string | null; region_id: string | null; ts: string; level: string; tag: string | null; message: string }>(c, devLogSpec);
    return c.json({ ...res, items: res.items.map((l) => ({ id: l.id, device_id: l.device_id, device_name: l.device_name, region: l.region_id, at: l.ts, level: l.level, tag: l.tag, message: l.message })) });
  });
  r.get('/events/heartbeat', requirePerm('devices', 'view'), async (c) => {
    const res = await runList<{ device_id: string; device_name: string | null; ts: string; region: string | null; app_ver: string | null; soc_temp: number | null; rssi: number | null; dl_mbps: number | null; cache_used_mb: number | null; cache_slots: number | null; state: number | null }>(c, hbSpec);
    return c.json({ ...res, items: res.items.map((h) => ({ id: `${h.device_id}@${h.ts}`, device_id: h.device_id, device_name: h.device_name, at: h.ts, region: h.region, app_ver: h.app_ver, soc_temp: h.soc_temp === null ? null : num(h.soc_temp), rssi: h.rssi === null ? null : num(h.rssi), dl_mbps: h.dl_mbps === null ? null : num(h.dl_mbps), cache_used_mb: h.cache_used_mb === null ? null : num(h.cache_used_mb), state: h.state === null ? null : num(h.state) })) });
  });

  return r;
}
