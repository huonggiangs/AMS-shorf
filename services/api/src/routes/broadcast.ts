// Chuong trinh phat song NOI BO: van hanh chon media trong kho + loai man + khu vuc + khung gio roi xuat ban, KHONG qua hop dong/thanh toan.
// Gateway dua chuong trinh 'published' vao manifest (campaign_id = 'bp_<id>', khong co gia chot nen khong tinh tien). Xem migrations/0020.
import { chunkForIn } from '@ams/runtime';
import { Hono } from 'hono';
import { z } from 'zod';
import { CommandError, enqueueCommand } from '@ams/edge-gateway';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { dbTarget, fitsTarget } from '../lib/creative.js';
import { SIGNAGE_LIMITS, validateDisplayText, type FieldError } from '@ams/shared';
import { conflict, notFound, tooMany, unprocessable } from '../lib/errors.js';
import { eq, getRt, jsonParse, num, parseBody, placeholders, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { bumpManifest } from '../lib/manifest.js';
import { layoutSchema, MEDIA_ZONE_TYPES, type Layout, type Zone } from '../lib/layout.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

interface ProgramRow {
  id: string;
  name: string;
  target_type: string;
  regions: string | null;
  start_date: string | null;
  end_date: string | null;
  start_min: number;
  end_min: number;
  priority: number;
  header: string | null;
  footer: string | null;
  status: string;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  item_count?: number;
  device_count?: number;
}

interface ItemRow {
  creative_id: string;
  position: number;
  name: string | null;
  kind: string | null;
  px_w: number | null;
  px_h: number | null;
  duration_s: number | null;
  review_state: string;
  state: string;
  scan_state: string;
  campaign_id: string | null;
  target_type: string | null;
}

const P_SELECT = `p.id, p.name, p.target_type, p.regions, p.start_date, p.end_date, p.start_min, p.end_min, p.priority, p.header, p.footer, p.status, p.version,
  p.created_by, p.created_at, p.updated_at, p.published_at, (SELECT COUNT(*) FROM broadcast_program_items i WHERE i.program_id = p.id) AS item_count,
  (SELECT COUNT(*) FROM broadcast_program_devices d WHERE d.program_id = p.id) AS device_count`;
const P_FROM = 'FROM broadcast_programs p';

const present = (p: ProgramRow) => ({
  id: p.id,
  name: p.name,
  target_type: p.target_type,
  regions: jsonParse<string[]>(p.regions, []),
  start_date: p.start_date,
  end_date: p.end_date,
  start_min: num(p.start_min),
  end_min: num(p.end_min),
  priority: num(p.priority),
  header: p.header,
  footer: p.footer,
  status: p.status,
  version: num(p.version, 1),
  item_count: num(p.item_count),
  device_count: num(p.device_count),
  created_at: p.created_at,
  updated_at: p.updated_at,
  published_at: p.published_at,
});

const spec: ListSpec = {
  from: P_FROM,
  select: P_SELECT,
  search: ['p.name'],
  sorts: { updated_at: 'p.updated_at', name: 'p.name', status: 'p.status' },
  defaultSort: 'updated_at:desc',
  tiebreak: 'p.id',
  filters: { status: eq('p.status'), target_type: eq('p.target_type') },
};

const minute = z.coerce.number().int().min(0).max(1440).refine((n) => n % 30 === 0, 'Phải là bội số của 30 phút');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD').nullable();
const fields = z.object({
  name: z.string().trim().min(1).max(120),
  target_type: z.enum(['tv', 'elevator', 'led', 'led_p5']),
  regions: z.array(z.string().trim().min(1).max(16)).max(30).default([]),
  start_date: day.optional(),
  end_date: day.optional(),
  start_min: minute.default(0),
  end_min: minute.default(1440),
  priority: z.coerce.number().int().min(1).max(5).default(3),
  header: z.string().nullable().optional(),
  footer: z.string().nullable().optional(),
  creative_ids: z.array(z.string().min(1).max(64)).max(100).default([]),
  // Bo cuc da vung (null = man don) va tep nao phat o vung nao (creative_id -> zone_id). Xem migrations/0021.
  layout: layoutSchema.nullable().optional(),
  item_zones: z.record(z.string().min(1).max(64), z.string().min(1).max(32)).optional(),
  // Chon rieng tung thiet bi (rong = theo loai man + khu vuc). Xem migrations/0022.
  device_ids: z.array(z.string().min(1).max(64)).max(500).optional(),
});

async function loadProgram(c: Ctx, id: string): Promise<ProgramRow> {
  const r = (await getRt(c).db.query<ProgramRow>(`SELECT ${P_SELECT} ${P_FROM} WHERE p.id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy chương trình phát sóng.');
  return r;
}

const ITEM_SQL = `SELECT i.creative_id, i.position, cr.name, cr.kind, cr.px_w, cr.px_h, cr.duration_s, cr.review_state, cr.state, cr.scan_state, cr.campaign_id, cr.target_type
  FROM broadcast_program_items i JOIN creatives cr ON cr.id = i.creative_id WHERE i.program_id = ? ORDER BY i.position, i.creative_id`;

const presentItem = (i: ItemRow) => ({
  creative_id: i.creative_id,
  position: num(i.position),
  name: i.name,
  kind: i.kind,
  width: i.px_w === null ? null : num(i.px_w),
  height: i.px_h === null ? null : num(i.px_h),
  duration_s: i.duration_s === null ? null : num(i.duration_s),
  review_state: i.review_state,
  state: i.state,
  ready: i.review_state === 'approved' && i.state === 'ready' && !['infected', 'failed', 'needs_manual_review', 'pending'].includes(i.scan_state),
  in_campaign: i.campaign_id !== null,
});

async function loadLayout(c: Ctx, id: string): Promise<{ template_id: string | null; orientation: string; zones: Zone[] } | null> {
  const r = (await getRt(c).db.query<{ template_id: string | null; orientation: string; zones: string | null }>('SELECT template_id, orientation, zones FROM broadcast_program_layouts WHERE program_id = ?', [id]))[0];
  return r ? { template_id: r.template_id, orientation: r.orientation, zones: jsonParse<Zone[]>(r.zones, []) } : null;
}

async function presentFull(c: Ctx, id: string) {
  const p = await loadProgram(c, id);
  const rt = getRt(c);
  const items = await rt.db.query<ItemRow>(ITEM_SQL, [id]);
  const zrows = await rt.db.query<{ creative_id: string; zone_id: string }>('SELECT creative_id, zone_id FROM broadcast_item_zones WHERE program_id = ?', [id]);
  const zoneOf = new Map(zrows.map((z) => [z.creative_id, z.zone_id]));
  const devices = await loadDevices(c, id);
  return { ...present(p), layout: await loadLayout(c, id), devices, device_ids: devices.map((d) => d.id), items: items.map((i) => ({ ...presentItem(i), zone_id: zoneOf.get(i.creative_id) ?? null })) };
}

const ONLINE_MS = 20 * 60_000;
interface DevRow { id: string; name: string | null; kind: string; region_id: string | null; last_seen_at: string | null }
const presentDevice = (c: Ctx, d: DevRow) => ({
  id: d.id,
  name: d.name ?? d.id,
  kind: d.kind,
  region: d.region_id,
  last_seen_at: d.last_seen_at,
  online: d.last_seen_at !== null && getRt(c).clock.now().getTime() - new Date(d.last_seen_at).getTime() < ONLINE_MS,
});

async function loadDevices(c: Ctx, id: string) {
  const rows = await getRt(c).db.query<DevRow>(
    'SELECT d.id, d.name, d.kind, d.region_id, d.last_seen_at FROM broadcast_program_devices bd JOIN devices d ON d.id = bd.device_id AND d.deleted_at IS NULL WHERE bd.program_id = ? ORDER BY d.name, d.id',
    [id],
  );
  return rows.map((d) => presentDevice(c, d));
}

/** Thiet bi duoc chon phai ton tai, da duyet, khong bi khoa va dung loai man cua chuong trinh. */
async function checkDevices(c: Ctx, target: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (new Set(ids).size !== ids.length) throw unprocessable('Danh sách thiết bị có thiết bị trùng.', 'duplicate_devices');
  const rows: { id: string; name: string | null; kind: string; trust_level: number; blocked: number }[] = [];
  for (const part of chunkForIn(ids)) { // D1: toi da 100 tham so/cau lenh (device_ids toi da 500)
    rows.push(...(await getRt(c).db.query<{ id: string; name: string | null; kind: string; trust_level: number; blocked: number }>(
      `SELECT id, name, kind, trust_level, blocked FROM devices WHERE id IN (${placeholders(part.length)})`,
      part,
    )));
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kinds = NOTICE_KINDS[target] ?? [];
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) throw unprocessable('Có thiết bị không còn trong hệ thống.', 'device_not_found');
    if (num(d.trust_level) < 1 || num(d.blocked) === 1) throw unprocessable(`Thiết bị "${d.name ?? id}" chưa được duyệt hoặc đang bị khóa.`, 'device_not_approved');
    if (!kinds.includes(d.kind)) throw unprocessable(`Thiết bị "${d.name ?? id}" không đúng loại màn của chương trình.`, 'device_kind_mismatch');
  }
}

async function saveDevices(db: { run: (sql: string, p: unknown[]) => Promise<unknown> }, id: string, ids: string[]): Promise<void> {
  await db.run('DELETE FROM broadcast_program_devices WHERE program_id = ?', [id]);
  for (const d of ids) await db.run('INSERT INTO broadcast_program_devices (program_id, device_id) VALUES (?,?)', [id, d]);
}

/**
 * Day lenh `refresh_manifest` toi thiet bi dich de noi dung len man hinh ngay (khong cho chu ky dong bo).
 * Dich: thiet bi da chon trong chuong trinh; neu khong co thi thiet bi da duyet cung loai man + khu vuc. `extraIds` = thiet bi vua bi go khoi chuong trinh.
 */
async function pushRefresh(c: Ctx, p: { id: string; target_type: string; regions: string | null }, version: number, extraIds: string[] = []): Promise<{ matched: number; pushed: number; skipped: number }> {
  const rt = getRt(c);
  const u = c.get('user');
  const chosen = (await rt.db.query<{ device_id: string }>('SELECT device_id FROM broadcast_program_devices WHERE program_id = ?', [p.id])).map((x) => x.device_id);
  const ids = new Set<string>(extraIds);
  if (chosen.length) chosen.forEach((x) => ids.add(x));
  else for (const d of await noticeDevices(c, p.target_type, jsonParse<string[]>(p.regions, []))) ids.add(d.id);
  const list = [...ids].slice(0, NOTICE_MAX_DEVICES);
  let pushed = 0;
  let skipped = 0;
  for (const id of list) {
    try {
      await enqueueCommand(rt, id, { type: 'refresh_manifest', args: {} }, { ttlS: NOTICE_TTL_S, createdBy: u.id, ip: c.get('ip') ?? null, idempotencyKey: `bp:${p.id}:v${version}` });
      pushed++;
    } catch (e) {
      if (e instanceof CommandError) skipped++;
      else throw e;
    }
  }
  return { matched: ids.size, pushed, skipped: skipped + Math.max(0, ids.size - list.length) };
}

/** Kiem tra gan tep vao vung: vung phai ton tai trong bo cuc, kieu video/image, tep thuoc chuong trinh. */
function checkItemZones(layout: Layout | null, itemZones: Record<string, string> | undefined, ids: string[]): void {
  if (!itemZones || Object.keys(itemZones).length === 0) return;
  if (!layout) throw unprocessable('Chưa chọn bố cục nên không thể gán tệp vào vùng.', 'no_layout');
  const byId = new Map(layout.zones.map((z) => [z.id, z]));
  for (const [cid, zid] of Object.entries(itemZones)) {
    if (!ids.includes(cid)) throw unprocessable('Có tệp gán vùng nhưng không nằm trong chương trình.', 'bad_item_zone');
    const z = byId.get(zid);
    if (!z) throw unprocessable(`Vùng "${zid}" không có trong bố cục.`, 'bad_item_zone');
    if (!(MEDIA_ZONE_TYPES as readonly string[]).includes(z.type)) throw unprocessable(`Vùng "${z.name ?? zid}" không phát được video/ảnh.`, 'bad_item_zone');
  }
}

async function saveLayout(db: { run: (sql: string, p: unknown[]) => Promise<unknown> }, id: string, layout: Layout | null, replaceLayout: boolean, itemZones: Record<string, string>, ids: string[], now: string): Promise<void> {
  if (replaceLayout) {
    await db.run('DELETE FROM broadcast_program_layouts WHERE program_id = ?', [id]);
    // bo thoi luong cua tu lieu khong con trong chuong trinh
    const zones = layout?.zones.map((z) => { const d = (z as { durations?: Record<string, number> }).durations; return d ? { ...z, durations: Object.fromEntries(Object.entries(d).filter(([cid]) => ids.includes(cid))) } : z; });
    if (layout) await db.run('INSERT INTO broadcast_program_layouts (program_id, template_id, orientation, zones, updated_at) VALUES (?,?,?,?,?)', [id, layout.template_id ?? null, layout.orientation, JSON.stringify(zones), now]);
  }
  await db.run('DELETE FROM broadcast_item_zones WHERE program_id = ?', [id]);
  const zoneIds = new Set((layout?.zones ?? []).map((z) => z.id));
  for (const [cid, zid] of Object.entries(itemZones)) if (ids.includes(cid) && zoneIds.has(zid)) await db.run('INSERT INTO broadcast_item_zones (program_id, creative_id, zone_id) VALUES (?,?,?)', [id, cid, zid]);
}

/** Kiem tra danh sach tep: ton tai, chua gan chien dich (tranh tinh tien nham), khop loai man. Tra ve loi dau tien (tieng Viet). */
async function checkItems(c: Ctx, target: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (new Set(ids).size !== ids.length) throw unprocessable('Danh sách tệp có tệp trùng.', 'duplicate_items');
  const rows: (ItemRow & { id: string })[] = [];
  for (const part of chunkForIn(ids)) { // D1: toi da 100 tham so/cau lenh
    rows.push(...(await getRt(c).db.query<ItemRow & { id: string }>(
      `SELECT id, id AS creative_id, 0 AS position, name, kind, px_w, px_h, duration_s, review_state, state, scan_state, campaign_id, target_type FROM creatives WHERE id IN (${placeholders(part.length)})`,
      part,
    )));
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) throw unprocessable('Có tệp không còn trong kho media.', 'media_not_found');
    if (r.campaign_id !== null) throw unprocessable(`Tệp "${r.name ?? id}" đang gắn với chiến dịch quảng cáo. Chỉ chọn tệp trong kho chưa gắn chiến dịch.`, 'media_in_campaign');
    if (r.state === 'uploading' || r.state === 'importing' || r.state === 'invalid') throw unprocessable(`Tệp "${r.name ?? id}" chưa tải xong hoặc không hợp lệ.`, 'media_not_ready');
    if (r.review_state === 'rejected' || r.review_state === 'returned') throw unprocessable(`Tệp "${r.name ?? id}" đã bị trả lại.`, 'media_rejected');
    const w = num(r.px_w);
    const h = num(r.px_h);
    if (target === 'led_p5') {
      if (r.target_type && r.target_type !== 'led_p5') throw unprocessable(`Tệp "${r.name ?? id}" không dành cho màn LED.`, 'creative_size_mismatch');
    } else if (w && h) {
      const fit = fitsTarget(target as 'tv' | 'elevator', w, h);
      if (!fit.ok) throw unprocessable(`Tệp "${r.name ?? id}": ${fit.message}`, 'creative_size_mismatch');
    }
  }
}

function checkText(target: string, b: { header?: string | null; footer?: string | null }, cur: { header: string | null; footer: string | null }) {
  const errs: FieldError[] = [];
  const signage = target === 'elevator' || target === 'led_p5';
  if (!signage && ((b.header ?? null) !== null || (b.footer ?? null) !== null)) {
    throw unprocessable('Chữ header/footer chỉ áp dụng cho chương trình thang máy / LED.', 'slot_not_signage');
  }
  const header = b.header === undefined ? cur.header : b.header === null ? null : validateDisplayText(b.header, SIGNAGE_LIMITS.header, 'header', errs);
  const footer = b.footer === undefined ? cur.footer : b.footer === null ? null : validateDisplayText(b.footer, SIGNAGE_LIMITS.footer, 'footer', errs);
  if (errs.length) throw unprocessable(`Chữ không hợp lệ (${errs[0]!.path}): ${errs[0]!.message}`, 'validation_error', { errors: errs });
  return { header, footer };
}


// ---------------------------------------------------------------- Thong bao khan (chu chay gui ngay xuong thiet bi da duyet)
const NOTICE_MAX_DEVICES = 500;
const NOTICE_TTL_S = 600; // thong bao qua han thi bo, khong hien muon
const noticeBody = z.object({
  text: z.string().trim().min(1, 'Nhập nội dung thông báo').max(200, 'Tối đa 200 ký tự'),
  duration_s: z.coerce.number().int().min(3, 'Từ 3 đến 120 giây').max(120, 'Từ 3 đến 120 giây').default(30),
  target: z.enum(['all', 'tv', 'elevator', 'led_p5']).default('all'),
  regions: z.array(z.string().trim().min(1).max(16)).max(30).default([]),
});
const NOTICE_KINDS: Record<string, string[]> = { tv: ['tv', 'phone', 'virtual'], elevator: ['elevator'], led_p5: ['led_p5'] };
const SIGNAGE_KINDS = ['elevator', 'led_p5'];

async function noticeDevices(c: Ctx, target: string, regions: string[]): Promise<{ id: string; kind: string }[]> {
  const kinds = NOTICE_KINDS[target];
  const where = ['trust_level >= 1', 'blocked = 0'];
  const params: unknown[] = [];
  if (kinds) { where.push(`kind IN (${placeholders(kinds.length)})`); params.push(...kinds); }
  if (regions.length) { where.push(`region_id IN (${placeholders(regions.length)})`); params.push(...regions); }
  return getRt(c).db.query<{ id: string; kind: string }>(`SELECT id, kind FROM devices WHERE ${where.join(' AND ')} ORDER BY id LIMIT ${NOTICE_MAX_DEVICES + 1}`, params);
}

/** Tai lieu goi USB: playlist.json (dinh dang app Signage Player doc: items[{id,type,url,duration,checksum,header,footer,fit}]) + tep kem URL ky co han. */
const USB_URL_TTL_S = 3600;
const IMAGE_DEFAULT_S = 10;
const extOf = (name: string | null, mime: string | null, kind: string | null): string => {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(name ?? '');
  if (m) return m[1]!.toLowerCase();
  if (mime === 'video/quicktime') return 'mov';
  if (mime?.startsWith('image/')) return mime.slice(6).replace('jpeg', 'jpg');
  return kind === 'image' ? 'jpg' : 'mp4';
};

export function broadcastRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('schedule', 'view'), async (c) => {
    const res = await runList<ProgramRow>(c, spec);
    return c.json({ ...res, items: res.items.map(present) });
  });


  // Thong bao khan: dat lenh `message` (chu chay) vao hang doi cua tung thiet bi da duyet; thiet bi nhan o lan dong bo/heartbeat ke tiep.
  r.get('/notice', requirePerm('schedule', 'view'), async (c) => {
    const rows = await getRt(c).db.query<{ id: string; ts: string; actor_id: string | null; actor_name: string | null; diff: string | null }>(
      "SELECT l.id, l.ts, l.actor_id, a.name AS actor_name, l.diff FROM audit_log l LEFT JOIN admins a ON a.id = l.actor_id WHERE l.action = 'broadcast.notice' ORDER BY l.ts DESC, l.id DESC LIMIT 30",
    );
    return c.json({ items: rows.map((x) => ({ id: x.id, at: x.ts, actor: x.actor_name ?? x.actor_id ?? 'system', ...jsonParse<Record<string, unknown>>(x.diff, {}) })), total: rows.length });
  });

  r.post('/notice', requirePerm('schedule', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, noticeBody);
    const bucket = Math.floor(rt.clock.now().getTime() / 600_000);
    if ((await rt.kv.incr(`rl:notice:u:${u.id}:${bucket}`, 600)) > 10) throw tooMany('Bạn gửi thông báo quá nhiều, thử lại sau ít phút.', 300);
    const devices = await noticeDevices(c, b.target, b.regions);
    if (devices.length === 0) throw unprocessable('Không có thiết bị đã duyệt nào khớp loại màn / khu vực đã chọn.', 'no_devices');
    if (devices.length > NOTICE_MAX_DEVICES) throw unprocessable(`Có hơn ${NOTICE_MAX_DEVICES} thiết bị khớp. Hãy chọn thêm khu vực hoặc loại màn để gửi theo đợt.`, 'too_many_devices', { max: NOTICE_MAX_DEVICES });
    let queued = 0;
    let skipped = 0;
    const batchId = rt.id();
    for (const d of devices) {
      const args = SIGNAGE_KINDS.includes(d.kind) ? { text: b.text, duration_s: b.duration_s } : { text: b.text, seconds: Math.max(5, b.duration_s) };
      try {
        await enqueueCommand(rt, d.id, { type: 'message', args }, { ttlS: NOTICE_TTL_S, createdBy: u.id, ip: c.get('ip') ?? null, idempotencyKey: `notice-${batchId}` });
        queued++;
      } catch (e) {
        if (e instanceof CommandError) skipped++;
        else throw e;
      }
    }
    await auditCtx(c, rt.db, { action: 'broadcast.notice', objectType: 'broadcast_notice', objectId: null, diff: { batch_id: batchId, text: b.text, duration_s: b.duration_s, target: b.target, regions: b.regions, matched: devices.length, queued, skipped } });
    return c.json({ batch_id: batchId, matched: devices.length, queued, skipped, ttl_s: NOTICE_TTL_S }, 201);
  });

  // Trang thai nhan tin khan theo lo: thiet bi nao da nhan/xac nhan, do tre (xac nhan - luc tao). Thiet bi dang long-poll nhan trong ~2 giay.
  r.get('/notice/:batch/status', requirePerm('schedule', 'view'), async (c) => {
    const key = `notice-${c.req.param('batch')}`;
    const rows = await getRt(c).db.query<{ device_id: string; status: string; created_at: string; delivered_at: string | null; acked_at: string | null }>(
      'SELECT device_id, status, created_at, delivered_at, acked_at FROM device_commands WHERE idempotency_key = ? ORDER BY device_id LIMIT 501', [key]);
    const ms = (a: string | null, b: string) => (a ? Math.max(0, Date.parse(a) - Date.parse(b)) : null);
    const items = rows.slice(0, NOTICE_MAX_DEVICES).map((x) => ({ device_id: x.device_id, status: x.status, delivery_ms: ms(x.delivered_at, x.created_at), ack_ms: ms(x.acked_at, x.created_at) }));
    const count = (st: string[]) => items.filter((x) => st.includes(x.status)).length;
    const lat = items.flatMap((x) => (x.delivery_ms === null ? [] : [x.delivery_ms]));
    return c.json({ total: items.length, pending: count(['pending']), delivered: count(['delivered']), acked: count(['acked']), failed: count(['failed', 'expired']), avg_delivery_ms: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null, items });
  });

  // Goi USB cho Signage Player (thu muc ANIO tren o USB): chi chuong trinh co tep san sang.
  r.get('/:id/usb-package', requirePerm('schedule', 'view'), async (c) => {
    const rt = getRt(c);
    const p = await loadProgram(c, c.req.param('id'));
    const rows = await rt.db.query<ItemRow & { storage_key: string | null; mime: string | null; sha256: string | null; size_bytes: number | null }>(
      `SELECT i.creative_id, i.position, cr.name, cr.kind, cr.px_w, cr.px_h, cr.duration_s, cr.review_state, cr.state, cr.scan_state, cr.campaign_id, cr.target_type, cr.storage_key, cr.mime, cr.sha256, cr.size_bytes
       FROM broadcast_program_items i JOIN creatives cr ON cr.id = i.creative_id WHERE i.program_id = ? ORDER BY i.position, i.creative_id`,
      [p.id],
    );
    if (rows.length === 0) throw unprocessable('Chương trình chưa có tệp nào.', 'no_items');
    const bad = rows.find((i) => !presentItem(i).ready || !i.storage_key);
    if (bad) throw unprocessable(`Tệp "${bad.name ?? bad.creative_id}" chưa sẵn sàng để chép ra USB.`, 'media_not_ready', { creative_id: bad.creative_id });
    const signage = p.target_type === 'elevator' || p.target_type === 'led_p5';
    const items: Record<string, unknown>[] = [];
    const files: { name: string; url: string; sha256: string | null; size_bytes: number }[] = [];
    for (const [i, x] of rows.entries()) {
      const isVideo = x.kind === 'video' || (x.mime ?? '').startsWith('video/');
      const name = `${String(i + 1).padStart(3, '0')}-${x.creative_id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24)}.${extOf(x.name, x.mime, x.kind)}`;
      const size = x.size_bytes === null ? (await rt.objects.head(x.storage_key!))?.size ?? 0 : num(x.size_bytes);
      files.push({ name, url: await rt.objects.getSigned(x.storage_key!, USB_URL_TTL_S), sha256: x.sha256 ?? null, size_bytes: size });
      items.push({ id: x.creative_id, type: isVideo ? 'video' : 'image', url: name, file: name, duration: isVideo ? num(x.duration_s, IMAGE_DEFAULT_S) : IMAGE_DEFAULT_S, ...(x.sha256 ? { checksum: x.sha256 } : {}) });
    }
    const playlist = { version: `bp${p.id}-v${num(p.version, 1)}`, name: p.name, ...(signage && p.header ? { header: p.header } : {}), ...(signage && p.footer ? { footer: p.footer } : {}), items };
    return c.json({ program_id: p.id, name: p.name, folder: 'ANIO', playlist, files, expires_in_s: USB_URL_TTL_S, total_bytes: files.reduce((a, f) => a + f.size_bytes, 0) });
  });

  // Danh sach thiet bi de chon o buoc 3 cua trinh tao chuong trinh: da duyet, khong bi khoa, dung loai man.
  r.get('/devices-pick', requirePerm('schedule', 'view'), async (c) => {
    const target = dbTarget(c.req.query('target') ?? 'elevator');
    const regions = (c.req.query('regions') ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30);
    const q = (c.req.query('q') ?? '').trim().slice(0, 60);
    const kinds = NOTICE_KINDS[target] ?? [];
    const where = ['trust_level >= 1', 'blocked = 0', `kind IN (${placeholders(kinds.length)})`];
    const params: unknown[] = [...kinds];
    if (regions.length) { where.push(`region_id IN (${placeholders(regions.length)})`); params.push(...regions); }
    if (q) { where.push('(LOWER(COALESCE(name, \'\')) LIKE ? OR LOWER(id) LIKE ?)'); params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`); }
    const rows = await getRt(c).db.query<DevRow>(`SELECT id, name, kind, region_id, last_seen_at FROM devices WHERE ${where.join(' AND ')} ORDER BY region_id, name, id LIMIT 501`, params);
    return c.json({ items: rows.slice(0, 500).map((d) => presentDevice(c, d)), truncated: rows.length > 500 });
  });

  // Tinh trang giao tung thiet bi: lenh refresh_manifest moi nhat + lan thay thiet bi gan nhat.
  r.get('/:id/delivery', requirePerm('schedule', 'view'), async (c) => {
    const rt = getRt(c);
    const p = await loadProgram(c, c.req.param('id'));
    const chosen = await loadDevices(c, p.id);
    const targets = chosen.length ? chosen : (await noticeDevices(c, p.target_type, jsonParse<string[]>(p.regions, []))).slice(0, NOTICE_MAX_DEVICES).map((d) => ({ id: d.id, name: d.id, kind: d.kind, region: null, last_seen_at: null, online: false }));
    const out = [];
    for (const d of targets) {
      const cmd = (await rt.db.query<{ status: string; created_at: string; acked_at: string | null }>("SELECT status, created_at, acked_at FROM device_commands WHERE device_id = ? AND type = 'refresh_manifest' ORDER BY created_at DESC LIMIT 1", [d.id]))[0];
      const dev = chosen.length ? d : (await rt.db.query<DevRow>('SELECT id, name, kind, region_id, last_seen_at FROM devices WHERE id = ?', [d.id]))[0];
      const pd = dev && !chosen.length ? presentDevice(c, dev as DevRow) : d;
      out.push({ ...pd, command: cmd ? { status: cmd.status, at: cmd.created_at, acked_at: cmd.acked_at } : null });
    }
    return c.json({ program_id: p.id, status: p.status, version: num(p.version, 1), items: out, total: out.length });
  });

  r.get('/:id', requirePerm('schedule', 'view'), async (c) => c.json(await presentFull(c, c.req.param('id'))));

  r.post('/', requirePerm('schedule', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, fields);
    if (b.end_min <= b.start_min) throw unprocessable('Giờ kết thúc phải sau giờ bắt đầu.', 'bad_times');
    if (b.start_date && b.end_date && b.end_date < b.start_date) throw unprocessable('Ngày kết thúc phải sau ngày bắt đầu.', 'bad_dates');
    const target = dbTarget(b.target_type);
    const text = checkText(target, b, { header: null, footer: null });
    await checkItems(c, target, b.creative_ids);
    checkItemZones(b.layout ?? null, b.item_zones, b.creative_ids);
    await checkDevices(c, target, b.device_ids ?? []);
    const id = rt.id();
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run(
        `INSERT INTO broadcast_programs (id, name, target_type, regions, start_date, end_date, start_min, end_min, priority, header, footer, status, version, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',1,?,?,?)`,
        [id, b.name, target, JSON.stringify(b.regions), b.start_date ?? null, b.end_date ?? null, b.start_min, b.end_min, b.priority, text.header, text.footer, u.id, now, now],
      );
      for (const [i, cid] of b.creative_ids.entries()) await db.run('INSERT INTO broadcast_program_items (program_id, creative_id, position) VALUES (?,?,?)', [id, cid, i]);
      if (b.layout) await saveLayout(db, id, b.layout, true, b.item_zones ?? {}, b.creative_ids, now);
      if (b.device_ids?.length) await saveDevices(db, id, b.device_ids);
      await auditCtx(c, db, { action: 'broadcast.create', objectType: 'broadcast_program', objectId: id, diff: { name: b.name, target_type: target, items: b.creative_ids.length } });
    });
    return c.json(await presentFull(c, id), 201);
  });

  r.put('/:id', requirePerm('schedule', 'write'), async (c) => {
    const rt = getRt(c);
    const p = await loadProgram(c, c.req.param('id'));
    const b = await parseBody(c, fields.partial({ target_type: true, creative_ids: true, name: true }).extend({ regions: fields.shape.regions.optional(), start_min: fields.shape.start_min.optional(), end_min: fields.shape.end_min.optional(), priority: fields.shape.priority.optional() }));
    const target = b.target_type ? dbTarget(b.target_type) : p.target_type;
    const start = b.start_min ?? num(p.start_min);
    const end = b.end_min ?? num(p.end_min);
    if (end <= start) throw unprocessable('Giờ kết thúc phải sau giờ bắt đầu.', 'bad_times');
    const sd = b.start_date === undefined ? p.start_date : b.start_date;
    const ed = b.end_date === undefined ? p.end_date : b.end_date;
    if (sd && ed && ed < sd) throw unprocessable('Ngày kết thúc phải sau ngày bắt đầu.', 'bad_dates');
    const text = checkText(target, b, { header: p.header, footer: p.footer });
    const ids = b.creative_ids ?? (await rt.db.query<{ creative_id: string }>('SELECT creative_id FROM broadcast_program_items WHERE program_id = ? ORDER BY position', [p.id])).map((x) => x.creative_id);
    await checkItems(c, target, ids);
    const effLayout = (b.layout === undefined ? await loadLayout(c, p.id) : b.layout) as Layout | null;
    const existingZones = b.layout === null ? {} : Object.fromEntries((await rt.db.query<{ creative_id: string; zone_id: string }>('SELECT creative_id, zone_id FROM broadcast_item_zones WHERE program_id = ?', [p.id])).map((z) => [z.creative_id, z.zone_id]));
    const effItemZones: Record<string, string> = b.item_zones ?? existingZones;
    if (b.item_zones) checkItemZones(effLayout, b.item_zones, ids);
    if (b.device_ids !== undefined) await checkDevices(c, target, b.device_ids);
    const oldDevs = b.device_ids !== undefined ? (await rt.db.query<{ device_id: string }>('SELECT device_id FROM broadcast_program_devices WHERE program_id = ?', [p.id])).map((x) => x.device_id) : [];
    const now = rt.clock.now().toISOString();
    const live = p.status === 'published';
    await rt.db.tx(async (db) => {
      await db.run(
        'UPDATE broadcast_programs SET name = ?, target_type = ?, regions = ?, start_date = ?, end_date = ?, start_min = ?, end_min = ?, priority = ?, header = ?, footer = ?, version = version + 1, updated_at = ? WHERE id = ?',
        [b.name ?? p.name, target, JSON.stringify(b.regions ?? jsonParse<string[]>(p.regions, [])), sd ?? null, ed ?? null, start, end, b.priority ?? p.priority, text.header, text.footer, now, p.id],
      );
      if (b.creative_ids) {
        await db.run('DELETE FROM broadcast_program_items WHERE program_id = ?', [p.id]);
        for (const [i, cid] of ids.entries()) await db.run('INSERT INTO broadcast_program_items (program_id, creative_id, position) VALUES (?,?,?)', [p.id, cid, i]);
      }
      if (b.layout !== undefined || b.item_zones !== undefined || b.creative_ids) await saveLayout(db, p.id, effLayout, b.layout !== undefined, effItemZones, ids, now);
      if (b.device_ids !== undefined) await saveDevices(db, p.id, b.device_ids);
      await auditCtx(c, db, { action: 'broadcast.update', objectType: 'broadcast_program', objectId: p.id, diff: { name: b.name ?? p.name, items: ids.length, live } });
    });
    if (live) await bumpManifest(rt);
    const push = live ? await pushRefresh(c, p, num(p.version, 1) + 1, oldDevs) : null;
    return c.json({ ...(await presentFull(c, p.id)), push });
  });

  r.post('/:id/publish', requirePerm('schedule', 'write'), async (c) => {
    const rt = getRt(c);
    const p = await loadProgram(c, c.req.param('id'));
    const items = await rt.db.query<ItemRow>(ITEM_SQL, [p.id]);
    if (items.length === 0) throw unprocessable('Chương trình chưa có tệp nào để phát.', 'no_items');
    const bad = items.find((i) => !presentItem(i).ready);
    if (bad) throw unprocessable(`Tệp "${bad.name ?? bad.creative_id}" chưa được duyệt hoặc chưa sẵn sàng. Duyệt tệp trong trang Nội dung & Media trước khi xuất bản.`, 'media_not_ready', { creative_id: bad.creative_id });
    const inCamp = items.find((i) => i.campaign_id !== null);
    if (inCamp) throw unprocessable(`Tệp "${inCamp.name ?? inCamp.creative_id}" đã gắn vào chiến dịch quảng cáo.`, 'media_in_campaign');
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run("UPDATE broadcast_programs SET status = 'published', published_at = ?, updated_at = ?, version = version + 1 WHERE id = ?", [now, now, p.id]);
      await auditCtx(c, db, { action: 'broadcast.publish', objectType: 'broadcast_program', objectId: p.id, diff: { status: { from: p.status, to: 'published' }, items: items.length } });
    });
    await bumpManifest(rt);
    const push = await pushRefresh(c, p, num(p.version, 1) + 1);
    return c.json({ ...(await presentFull(c, p.id)), push });
  });

  r.post('/:id/unpublish', requirePerm('schedule', 'write'), async (c) => {
    const rt = getRt(c);
    const p = await loadProgram(c, c.req.param('id'));
    if (p.status !== 'published') throw conflict('Chương trình chưa được xuất bản.', 'invalid_state');
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run("UPDATE broadcast_programs SET status = 'draft', updated_at = ?, version = version + 1 WHERE id = ?", [now, p.id]);
      await auditCtx(c, db, { action: 'broadcast.unpublish', objectType: 'broadcast_program', objectId: p.id, diff: { status: { from: 'published', to: 'draft' } } });
    });
    await bumpManifest(rt);
    const push = await pushRefresh(c, p, num(p.version, 1) + 1);
    return c.json({ ...(await presentFull(c, p.id)), push });
  });

  r.delete('/:id', requirePerm('schedule', 'delete'), async (c) => {
    const rt = getRt(c);
    const p = await loadProgram(c, c.req.param('id'));
    const pushTargets = p.status === 'published' ? (await rt.db.query<{ device_id: string }>('SELECT device_id FROM broadcast_program_devices WHERE program_id = ?', [p.id])).map((x) => x.device_id) : [];
    await rt.db.tx(async (db) => {
      await db.run('DELETE FROM broadcast_program_devices WHERE program_id = ?', [p.id]);
      await db.run('DELETE FROM broadcast_item_zones WHERE program_id = ?', [p.id]);
      await db.run('DELETE FROM broadcast_program_layouts WHERE program_id = ?', [p.id]);
      await db.run('DELETE FROM broadcast_program_items WHERE program_id = ?', [p.id]);
      await db.run('DELETE FROM broadcast_programs WHERE id = ?', [p.id]);
      await auditCtx(c, db, { action: 'broadcast.delete', objectType: 'broadcast_program', objectId: p.id, diff: { name: p.name } });
    });
    let push: { matched: number; pushed: number; skipped: number } | null = null;
    if (p.status === 'published') {
      await bumpManifest(rt);
      push = await pushRefresh(c, p, num(p.version, 1) + 1, pushTargets);
    }
    return c.json({ ok: true, push });
  });

  return r;
}
