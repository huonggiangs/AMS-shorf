import { Hono } from 'hono';
import { z } from 'zod';
import { DEVICE_LOG_RETENTION_DAYS, REGIONS, signageModelClass } from '@ams/shared';
import { chunkForIn } from '@ams/runtime';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, forbidden, notFound, tooMany, unprocessable } from '../lib/errors.js';
import { redeemPairingCode } from '@ams/edge-gateway/pairing';
import { bumpManifest, dropDeviceCache } from '../lib/manifest.js';
import { eq, getRt, num, parseBody, placeholders, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { hasPerm, requirePerm } from '../auth/middleware.js';
import { deviceCommandRoutes, deliveryInfo } from './device-commands.js';
import { deviceViewCounts } from './views-report.js';
import type { AppEnv } from '../types.js';

// Signage Player: device_profiles (1-1 theo khoa chinh) + man hinh/dia diem da gan (subquery co ORDER BY ... LIMIT 1 de khong nhan doi dong khi du lieu cu co 2 man cung device_id)
const SCR_ID = '(SELECT sc.id FROM screens sc WHERE sc.device_id = d.id ORDER BY sc.id LIMIT 1)';
const D_SELECT = `d.id, d.name, d.kind, d.model, d.os, d.app_version, d.region_id, d.status, d.last_seen_at, d.views_30d, d.blocked, d.trust_level, d.paired_at, d.created_at, d.deleted_at, eu.display_name AS owner_name,
  p.px_w AS prof_px_w, p.px_h AS prof_px_h, p.orientation AS prof_orientation, p.source AS play_source, p.cache_mb, p.reported_at, p.approved_at, p.approved_by,
  ${SCR_ID} AS screen_id,
  (SELECT sc.venue_id FROM screens sc WHERE sc.device_id = d.id ORDER BY sc.id LIMIT 1) AS venue_id,
  (SELECT v.name FROM screens sc JOIN venues v ON v.id = sc.venue_id WHERE sc.device_id = d.id ORDER BY sc.id LIMIT 1) AS venue_name,
  (SELECT sc.px_w FROM screens sc WHERE sc.device_id = d.id ORDER BY sc.id LIMIT 1) AS screen_px_w,
  (SELECT sc.px_h FROM screens sc WHERE sc.device_id = d.id ORDER BY sc.id LIMIT 1) AS screen_px_h`;
const D_FROM = 'FROM devices d LEFT JOIN end_users eu ON eu.id = d.user_id LEFT JOIN device_profiles p ON p.device_id = d.id';
export const SIGNAGE_KINDS_SQL = "('elevator','led_p5')";
const isSignage = (kind: string): boolean => kind === 'elevator' || kind === 'led_p5';

interface DevRow {
  id: string;
  name: string | null;
  kind: string;
  model: string | null;
  os: string | null;
  app_version: string | null;
  region_id: string | null;
  status: string;
  last_seen_at: string | null;
  views_30d: number;
  blocked: number;
  trust_level: number;
  paired_at: string | null;
  created_at: string;
  deleted_at: string | null;
  owner_name: string | null;
  prof_px_w: number | null;
  prof_px_h: number | null;
  prof_orientation: string | null;
  play_source: string | null;
  cache_mb: number | null;
  reported_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  screen_id: string | null;
  venue_id: string | null;
  venue_name: string | null;
  screen_px_w: number | null;
  screen_px_h: number | null;
}

const REGION_BY_NAME = Object.fromEntries(Object.entries(REGIONS).map(([k, v]) => [v.toLowerCase(), k]));
export const regionCode = (v: string): string => REGION_BY_NAME[v.toLowerCase()] ?? v.toUpperCase();

const apiStatus = (d: Pick<DevRow, 'status' | 'blocked'> & { deleted_at?: string | null }) => (d.deleted_at ? 'deleted' : d.blocked ? 'blocked' : d.status === 'active' ? 'online' : d.status);

const spec: ListSpec = {
  from: D_FROM,
  select: D_SELECT,
  search: ['d.name', 'd.model', 'eu.display_name', 'd.id'],
  sorts: { name: 'd.name', owner_name: 'eu.display_name', region: 'd.region_id', views: 'd.views_30d', last_seen_at: 'd.last_seen_at', status: 'd.status', created_at: 'd.created_at', app_version: 'd.app_version', trust_level: 'd.trust_level', cache_mb: 'p.cache_mb', source: 'p.source' },
  defaultSort: 'created_at:desc',
  tiebreak: 'd.id',
  filters: {
    // 'signage' = thang may + LED (Signage Player); con lai khop dung kind
    kind: (v) => (v === 'signage' ? { sql: `d.kind IN ${SIGNAGE_KINDS_SQL}`, params: [] } : { sql: 'd.kind = ?', params: [v === 'unknown' ? 'virtual' : v] }),
    source: eq('p.source'),
    region: (v) => ({ sql: 'd.region_id = ?', params: [regionCode(v)] }),
    status: (v) => {
      if (v === 'blocked') return { sql: 'd.blocked = 1', params: [] };
      // 'unpaired' = TV cho nhap ma 6 so; thang may/LED khong ghep ma ma cho CAP QUYEN ('awaiting_approval')
      if (v === 'unpaired') return { sql: `d.blocked = 0 AND d.paired_at IS NULL AND d.kind NOT IN ${SIGNAGE_KINDS_SQL}`, params: [] };
      if (v === 'awaiting_approval') return { sql: `d.blocked = 0 AND d.trust_level = 0 AND d.kind IN ${SIGNAGE_KINDS_SQL}`, params: [] };
      if (v === 'online') return { sql: "d.status = 'active' AND d.blocked = 0", params: [] };
      return { sql: 'd.status = ? AND d.blocked = 0', params: [v] };
    },
  },
};

/** Cung quy tac voi gateway modelClassOf: TV = 'tv'; thang may/LED = `<loai>_<w>x<h>` neu biet do phan giai, nguoc lai `<loai>`. */
function classOf(d: DevRow): string {
  if (!isSignage(d.kind)) return 'tv';
  const w = num(d.screen_px_w ?? d.prof_px_w, 0);
  const h = num(d.screen_px_h ?? d.prof_px_h, 0);
  return signageModelClass(d.kind as 'elevator' | 'led_p5', w, h);
}

async function present(c: Ctx, rows: DevRow[]): Promise<Record<string, unknown>[]> {
  const rt = getRt(c);
  const recent = new Map<string, string[]>();
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const imp: { device_id: string; name: string; last: string }[] = [];
    for (const part of chunkForIn(ids)) { // D1: toi da 100 tham so/cau lenh; nhom theo device_id nen chia theo thiet bi la an toan
      imp.push(...(await rt.db.query<{ device_id: string; name: string; last: string }>(
        `SELECT e.device_id, c.name, MAX(e.ts) AS last FROM ev_ad_impression e JOIN campaigns c ON c.id = e.campaign_id
          WHERE e.device_id IN (${placeholders(part.length)}) AND e.valid = 1 GROUP BY e.device_id, c.name ORDER BY last DESC`,
        part,
      )));
    }
    imp.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
    for (const x of imp) {
      const a = recent.get(x.device_id) ?? [];
      if (a.length < 5) a.push(x.name);
      recent.set(x.device_id, a);
    }
  }
  const viewsBy = await deviceViewCounts(rt, rows.map((r) => r.id)).catch(() => new Map<string, number>());
  return rows.map((d) => ({
    id: d.id,
    name: d.name ?? d.id,
    kind: d.kind === 'virtual' ? 'unknown' : d.kind,
    model: d.model,
    os: d.os,
    owner_name: d.owner_name,
    app_version: d.app_version,
    region: d.region_id ? (REGIONS[d.region_id] ?? d.region_id) : null,
    region_id: d.region_id,
    status: apiStatus(d),
    trust_level: num(d.trust_level),
    // w-dev: ghep ma (trust 1) tach khoi Xac minh (trust 2): blocked > verified > paired > pending (TV da dang ky, chua nhap ma)
    // Thang may/LED (Signage Player): khong ghep ma; blocked > verified > approved (van hanh da cap quyen) > awaiting_approval
    pairing_state: d.blocked ? 'blocked' : num(d.trust_level) >= 2 ? 'verified' : isSignage(d.kind) ? (num(d.trust_level) >= 1 ? 'approved' : 'awaiting_approval') : d.paired_at ? 'paired' : 'pending',
    grant_state: isSignage(d.kind) ? (d.blocked ? 'blocked' : num(d.trust_level) >= 1 ? 'granted' : 'awaiting') : null,
    approved_at: d.approved_at,
    // nhom manifest: man hinh da gan uu tien, chua gan thi do phan giai thiet bi tu khai
    model_class: classOf(d),
    px_w: num(d.screen_px_w ?? d.prof_px_w, 0) || null,
    px_h: num(d.screen_px_h ?? d.prof_px_h, 0) || null,
    orientation: d.prof_orientation,
    play_source: d.play_source,
    cache_mb: d.cache_mb === null || d.cache_mb === undefined ? null : num(d.cache_mb),
    reported_at: d.reported_at,
    screen: d.screen_id ? { id: d.screen_id, venue_id: d.venue_id, venue_name: d.venue_name } : null,
    last_seen_at: d.last_seen_at,
    paired_at: d.paired_at,
    deleted_at: d.deleted_at ?? null,
    views: viewsBy.get(d.id) ?? 0,
    recent_ads: recent.get(d.id) ?? [],
  }));
}

export interface DecommissionResult { deleted: number; requested: number; skipped: string[]; ids: string[] }

/**
 * Xoa mem thiet bi: danh dau deleted_at, go khoa cong khai (gateway tra 410 device_deleted va cho phep dang ky lai thanh thiet bi MOI),
 * thu hoi cap quyen, go khoi man hinh/chuong trinh phat/ma ghep dang cho, huy lenh dang cho. KHONG xoa su kien, doanh thu, so cai.
 * Mot giao dich nguyen tu; D1 toi da 100 tham so/cau lenh nen chia cum bang chunkForIn.
 */
async function decommission(c: Ctx, ids: string[]): Promise<DecommissionResult> {
  const rt = getRt(c);
  const u = c.get('user');
  const live: { id: string; name: string | null; kind: string }[] = [];
  for (const part of chunkForIn(ids)) {
    live.push(...(await rt.db.query<{ id: string; name: string | null; kind: string }>(`SELECT id, name, kind FROM devices WHERE deleted_at IS NULL AND id IN (${placeholders(part.length)})`, part)));
  }
  const liveIds = live.map((d) => d.id);
  const skipped = ids.filter((id) => !liveIds.includes(id));
  if (!liveIds.length) return { deleted: 0, requested: ids.length, skipped, ids: [] };
  const nowIso = rt.clock.now().toISOString();
  // Chuong trinh phat chon thiet bi: khong con dong = phat theo loai man + khu vuc (RONG HON). Nen chi go thiet bi khoi chuong trinh khi van con thiet bi khac;
  // chuong trinh chi con thiet bi bi xoa thi GIU dong (thiet bi da xoa khong lay duoc manifest nen khong phat; admin tu sua/ket thuc chuong trinh).
  const progRows: { program_id: string; device_id: string }[] = [];
  for (const part of chunkForIn(liveIds)) progRows.push(...(await rt.db.query<{ program_id: string; device_id: string }>(`SELECT program_id, device_id FROM broadcast_program_devices WHERE device_id IN (${placeholders(part.length)})`, part)));
  const dropFrom = new Set<string>();
  const progIds = [...new Set(progRows.map((x) => x.program_id))];
  for (const part of chunkForIn(progIds)) {
    const all = await rt.db.query<{ program_id: string; device_id: string }>(`SELECT program_id, device_id FROM broadcast_program_devices WHERE program_id IN (${placeholders(part.length)})`, part);
    const liveSet = new Set(liveIds);
    for (const pid of part) if (all.some((x) => x.program_id === pid && !liveSet.has(x.device_id))) dropFrom.add(pid);
  }
  const progDeletes = progRows.filter((x) => dropFrom.has(x.program_id));
  await rt.db.tx(async (db) => {
    const parts = chunkForIn(liveIds);
    for (const x of progDeletes) await db.run('DELETE FROM broadcast_program_devices WHERE program_id = ? AND device_id = ?', [x.program_id, x.device_id]);
    const ph = (n: number) => placeholders(n);
    await db.batch(parts.flatMap((part) => [
      { sql: `UPDATE devices SET deleted_at = ?, deleted_by = ?, blocked = 1, trust_level = 0, pubkey_ed25519 = NULL WHERE deleted_at IS NULL AND id IN (${ph(part.length)})`, params: [nowIso, u.id, ...part] },
      { sql: `UPDATE screens SET device_id = NULL WHERE device_id IN (${ph(part.length)})`, params: part },
      { sql: `DELETE FROM pairing_codes WHERE used_at IS NULL AND device_id IN (${ph(part.length)})`, params: part },
      { sql: `UPDATE device_profiles SET approved_at = NULL, approved_by = NULL WHERE device_id IN (${ph(part.length)})`, params: part },
      { sql: `UPDATE device_commands SET status = 'failed', result = 'device_deleted' WHERE status IN ('pending','delivered') AND device_id IN (${ph(part.length)})`, params: part },
    ]));
    for (const d of live) await auditCtx(c, db, { action: 'device.delete', objectType: 'device', objectId: d.id, diff: { name: d.name, kind: d.kind, soft: true, by: u.id } });
    if (live.length > 1) await auditCtx(c, db, { action: 'device.bulk_delete', objectType: 'device', objectId: null, diff: { requested: ids.length, deleted: live.length, ids: liveIds.slice(0, 50) } });
  });
  await dropDeviceCache(rt, liveIds); // gateway: kv `dev:<id>` bi xoa nen lan goi sau doc DB va thay deleted_at
  await bumpManifest(rt);
  return { deleted: liveIds.length, requested: ids.length, skipped, ids: liveIds };
}

export function deviceRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('devices', 'view'), async (c) => {
    // thiet bi da xoa mem an khoi danh sach; chi super_admin xem duoc bang ?deleted=1 (loc 'đã xóa')
    const onlyDeleted = c.req.query('deleted') === '1';
    if (onlyDeleted && c.get('user').role !== 'super_admin') throw forbidden('Chỉ quản trị cấp cao xem được thiết bị đã xóa.', 'forbidden', { module: 'devices', action: 'view_deleted' });
    const res = await runList<DevRow>(c, { ...spec, where: [{ sql: onlyDeleted ? 'd.deleted_at IS NOT NULL' : 'd.deleted_at IS NULL', params: [] }] });
    return c.json({ ...res, items: await present(c, res.items) });
  });

  // khai bao truoc :id de 'bulk' khong bi hieu la id
  r.post('/bulk', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ action: z.enum(['verify', 'block', 'unblock']), ids: z.array(z.string().min(1).max(64)).min(1, 'Chọn ít nhất một thiết bị').max(500, 'Tối đa 500 thiết bị mỗi lần') }));
    // R1-26: dat trust_level=2 lam thiet bi tinh tien => can quyen devices:approve (tach nhiem vu voi device_ops), khong chi devices:write
    if (b.action === 'verify' && !hasPerm(c, 'devices', 'approve')) throw forbidden('Xác minh thiết bị (cho phép tính tiền) cần quyền duyệt thiết bị.', 'forbidden', { module: 'devices', action: 'approve' });
    const ids = [...new Set(b.ids)];
    const sqlFor = (n: number): string =>
      b.action === 'verify'
        ? `UPDATE devices SET trust_level = 2, blocked = 0, status = CASE WHEN status = 'checking' THEN 'active' ELSE status END WHERE id IN (${placeholders(n)}) AND deleted_at IS NULL`
        : b.action === 'block'
          ? `UPDATE devices SET blocked = 1, trust_level = 0 WHERE id IN (${placeholders(n)}) AND deleted_at IS NULL`
          // mo chan: TV 0 -> 1 nhu cu; thang may/LED KHONG tu len muc 1 (phai qua "Cap quyen" co quyen devices:approve)
          : `UPDATE devices SET blocked = 0, trust_level = CASE WHEN trust_level = 0 AND kind NOT IN ${SIGNAGE_KINDS_SQL} THEN 1 ELSE trust_level END WHERE id IN (${placeholders(n)}) AND deleted_at IS NULL`;
    let updated = 0;
    await rt.db.tx(async (db) => {
      // D1: toi da 100 tham so/cau lenh -> chia cum, chay trong MOT batch (nguyen tu)
      const parts = chunkForIn(ids);
      const res = await db.batch(parts.map((part) => ({ sql: sqlFor(part.length), params: part })));
      updated = res.reduce((a, x) => a + x.changes, 0);
      if (b.action === 'block') await db.batch(parts.map((part) => ({ sql: `UPDATE device_profiles SET approved_at = NULL, approved_by = NULL WHERE device_id IN (${placeholders(part.length)})`, params: part }))); // chan = thu hoi cap quyen
      await auditCtx(c, db, { action: `device.bulk_${b.action}`, objectType: 'device', objectId: ids.length === 1 ? ids[0]! : null, diff: { requested: ids.length, updated, ids: ids.slice(0, 50) } });
    });
    // gateway cache thiet bi o kv `dev:<id>` (5 phut): xoa de khoa/mo/xac minh co hieu luc ngay
    await dropDeviceCache(rt, ids);
    return c.json({ updated, requested: ids.length });
  });

  // Nhap ma 6 so hien tren TV thay cho nguoi dung (van hanh/cua hang): tao end_user, goi redeemPairingCode cua gateway (nguyen tu, dung 1 lan).
  r.post('/pair', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Mã ghép đôi gồm 6 chữ số'), owner_name: z.string().trim().max(100).optional() }));
    const bucket = Math.floor(rt.clock.now().getTime() / 600_000);
    // han muc: moi lan nhap (30/10 phut/nguoi) VA rieng so lan nhap SAI (10/10 phut/nguoi, 200/10 phut toan he thong) de chan do ma 6 so
    if ((await rt.kv.incr(`rl:pair:${u.id}:${bucket}`, 600)) > 30) throw tooMany('Nhập mã quá nhiều lần, thử lại sau ít phút.', 300);
    const failKeyU = `rl:pairfail:${u.id}:${bucket}`;
    const failKeyG = `rl:pairfail:all:${bucket}`;
    const fails = Number((await rt.kv.get(failKeyU).catch(() => null)) ?? 0);
    const failsAll = Number((await rt.kv.get(failKeyG).catch(() => null)) ?? 0);
    if (fails >= 10 || failsAll >= 200) throw tooMany('Nhập sai mã quá nhiều lần, thử lại sau ít phút.', 300, 'pair_locked');
    const fail = async (reason: string): Promise<void> => {
      await rt.kv.incr(failKeyU, 600);
      await rt.kv.incr(failKeyG, 600);
      await auditCtx(c, rt.db, { action: 'device.pair_failed', objectType: 'device', objectId: null, diff: { reason } });
    };
    const nowIso = rt.clock.now().toISOString();
    // kiem tra truoc (khong tao end_user rac): ma co that, con han, chua dung, thiet bi khong bi chan
    const pre = (await rt.db.query<{ device_id: string; expires_at: string; used_at: string | null; blocked: number }>('SELECT p.device_id, p.expires_at, p.used_at, d.blocked FROM pairing_codes p JOIN devices d ON d.id = p.device_id WHERE p.code = ?', [b.code]))[0];
    if (!pre) {
      await fail('not_found');
      throw notFound('Mã ghép đôi không đúng.', 'pair_code_not_found');
    }
    if (pre.used_at) {
      await fail('used');
      throw conflict('Mã này đã được dùng.', 'pair_code_used');
    }
    if (pre.expires_at <= nowIso) {
      await fail('expired');
      throw unprocessable('Mã đã hết hạn (5 phút). Hãy lấy mã mới trên màn hình TV.', 'pair_code_expired');
    }
    if (Number(pre.blocked) === 1) {
      await fail('device_blocked');
      throw conflict('Thiết bị này đang bị chặn nên không ghép được.', 'device_blocked');
    }
    const userId = rt.id();
    await rt.db.run('INSERT INTO end_users (id, phone_hash, email_enc, display_name, created_at) VALUES (?, NULL, NULL, ?, ?)', [userId, b.owner_name || `Ghép bởi ${u.name}`, nowIso]);
    const res = await redeemPairingCode(rt, b.code, userId); // cung xoa kv `dev:<id>`
    if (!res.ok) {
      await rt.db.run('DELETE FROM end_users WHERE id = ?', [userId]);
      await fail(res.reason);
      if (res.reason === 'not_found') throw notFound('Mã ghép đôi không đúng.', 'pair_code_not_found');
      if (res.reason === 'expired') throw unprocessable('Mã đã hết hạn (5 phút). Hãy lấy mã mới trên màn hình TV.', 'pair_code_expired');
      throw conflict('Mã này đã được dùng.', 'pair_code_used');
    }
    await auditCtx(c, rt.db, { action: 'device.pair', objectType: 'device', objectId: res.deviceId, diff: { end_user_id: userId, owner_name: b.owner_name ?? null, trust_level: 1 } });
    return c.json({ device_id: res.deviceId, paired: true, trust_level: 1 });
  });

  // Gan/doi chu so huu (khach hang) cho thiet bi DA ghep ma. Tao end_user moi va tro device toi do (khong sua end_user cu vi co the dung chung).
  r.put('/:id/owner', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const id = c.req.param('id');
    const b = await parseBody(c, z.object({ owner_name: z.string().trim().min(1, 'Nhập tên chủ sở hữu / khách hàng').max(100) }).strict());
    const d = (await rt.db.query<{ id: string; user_id: string | null; paired_at: string | null; blocked: number }>('SELECT id, user_id, paired_at, blocked FROM devices WHERE id = ? AND deleted_at IS NULL', [id]))[0];
    if (!d) throw notFound('Không tìm thấy thiết bị.');
    if (!d.paired_at) throw conflict('Thiết bị chưa ghép mã nên chưa gán chủ sở hữu được. Hãy ghép mã hiển thị trên TV trước.', 'device_not_paired');
    const nowIso = rt.clock.now().toISOString();
    const userId = rt.id();
    await rt.db.tx(async (db) => {
      await db.run('INSERT INTO end_users (id, phone_hash, email_enc, display_name, created_at) VALUES (?, NULL, NULL, ?, ?)', [userId, b.owner_name, nowIso]);
      await db.run('UPDATE devices SET user_id = ? WHERE id = ?', [userId, id]);
      await auditCtx(c, db, { action: 'device.owner_assign', objectType: 'device', objectId: id, diff: { owner_name: b.owner_name, previous_user_id: d.user_id, end_user_id: userId, by: u.id } });
    });
    await dropDeviceCache(rt, [id]);
    return c.json({ device_id: id, owner_name: b.owner_name });
  });

  // ---------------------------------------------------------------- Cap quyen thiet bi thang may / LED (Signage Player)
  // Thiet bi khong-TV KHONG ghep bang ma 6 so: tu dang ky (trust 0), hien o trang Thiet bi "Cho cap quyen"; van hanh co quyen devices:approve
  // bam "Cap quyen" (trust >= 1), tuy chon gan vao mot man hinh (screens) + dia diem (venues). TV van ghep bang ma 6 so (POST /pair).
  r.post('/:id/approve', requirePerm('devices', 'approve'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const id = c.req.param('id');
    const b = await parseBody(c, z.object({ screen_id: z.string().trim().min(1).max(64).optional(), venue_id: z.string().trim().min(1).max(64).optional(), name: z.string().trim().min(1).max(100).optional() }).strict());
    const d = (await rt.db.query<{ id: string; kind: string; blocked: number; trust_level: number; region_id: string | null }>('SELECT id, kind, blocked, trust_level, region_id FROM devices WHERE id = ? AND deleted_at IS NULL', [id]))[0];
    if (!d) throw notFound('Không tìm thấy thiết bị.');
    if (!isSignage(d.kind)) throw conflict('Chỉ cấp quyền cho thiết bị thang máy / LED. TV được ghép bằng mã 6 số hiện trên màn hình.', 'use_pairing_code');
    if (Number(d.blocked) === 1) throw conflict('Thiết bị đang bị chặn. Bỏ chặn trước khi cấp quyền.', 'device_blocked');
    // man hinh: phai cung loai (thang may <-> elevator, LED <-> led_p5), chua gan cho thiet bi KHAC; neu co venue_id thi phai thuoc dia diem do
    let screen: { id: string; venue_id: string; type: string; device_id: string | null; region_id: string | null } | undefined;
    if (b.screen_id || b.venue_id) {
      const rows = await rt.db.query<{ id: string; venue_id: string; type: string; device_id: string | null; region_id: string | null }>(
        `SELECT sc.id, sc.venue_id, sc.type, sc.device_id, v.region_id FROM screens sc JOIN venues v ON v.id = sc.venue_id
          WHERE ${b.screen_id ? 'sc.id = ?' : 'sc.venue_id = ? AND sc.type = ? AND (sc.device_id IS NULL OR sc.device_id = ?)'} ORDER BY CASE WHEN sc.device_id = ? THEN 0 ELSE 1 END, sc.id`,
        b.screen_id ? [b.screen_id, d.id] : [b.venue_id, d.kind, d.id, d.id],
      );
      screen = rows[0];
      if (!screen) throw b.screen_id ? notFound('Không tìm thấy màn hình.') : conflict('Địa điểm này không còn màn hình trống đúng loại.', 'no_free_screen');
      if (b.venue_id && screen.venue_id !== b.venue_id) throw unprocessable('Màn hình không thuộc địa điểm đã chọn.', 'screen_venue_mismatch');
      if (screen.type !== d.kind) throw unprocessable(`Màn hình loại "${screen.type}" không khớp thiết bị loại "${d.kind}".`, 'screen_kind_mismatch');
      if (screen.device_id && screen.device_id !== d.id) throw conflict('Màn hình này đã gắn với thiết bị khác.', 'screen_taken');
    }
    const nowIso = rt.clock.now().toISOString();
    const prevTrust = num(d.trust_level);
    await rt.db.tx(async (db) => {
      await db.run('UPDATE devices SET trust_level = CASE WHEN trust_level >= 1 THEN trust_level ELSE 1 END, status = CASE WHEN status = \'checking\' THEN \'active\' ELSE status END, name = COALESCE(?, name), region_id = ? WHERE id = ?', [b.name ?? null, screen?.region_id ?? d.region_id, d.id]);
      if (screen) {
        await db.run('UPDATE screens SET device_id = NULL WHERE device_id = ? AND id <> ?', [d.id, screen.id]); // moi thiet bi mot man hinh
        await db.run('UPDATE screens SET device_id = ?, state = CASE WHEN state = \'checking\' THEN \'active\' ELSE state END WHERE id = ?', [d.id, screen.id]);
      }
      await db.run(
        `INSERT INTO device_profiles (device_id, approved_at, approved_by) VALUES (?,?,?)
         ON CONFLICT (device_id) DO UPDATE SET approved_at = excluded.approved_at, approved_by = excluded.approved_by`,
        [d.id, nowIso, u.id],
      );
      await auditCtx(c, db, { action: 'device.approve', objectType: 'device', objectId: d.id, diff: { kind: d.kind, previous_trust: prevTrust, trust_level: Math.max(prevTrust, 1), screen_id: screen?.id ?? null, venue_id: screen?.venue_id ?? null, name: b.name ?? null } });
    });
    await dropDeviceCache(rt, [d.id]); // gateway doc trust/man hinh moi ngay (khong cho het bo nho dem)
    await bumpManifest(rt);
    const row = (await rt.db.query<DevRow>(`SELECT ${D_SELECT} ${D_FROM} WHERE d.id = ?`, [d.id]))[0]!;
    return c.json((await present(c, [row]))[0]);
  });

  // Thu hoi cap quyen: ve trust 0 (proof_of_play moi => pending_trust), go khoi man hinh. Khong xoa du lieu da ghi.
  r.post('/:id/revoke-approval', requirePerm('devices', 'approve'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('id');
    const d = (await rt.db.query<{ id: string; kind: string; trust_level: number }>('SELECT id, kind, trust_level FROM devices WHERE id = ? AND deleted_at IS NULL', [id]))[0];
    if (!d) throw notFound('Không tìm thấy thiết bị.');
    if (!isSignage(d.kind)) throw conflict('Chỉ thu hồi quyền của thiết bị thang máy / LED.', 'use_pairing_code');
    let unassigned = 0;
    await rt.db.tx(async (db) => {
      await db.run('UPDATE devices SET trust_level = 0 WHERE id = ?', [d.id]);
      unassigned = (await db.run('UPDATE screens SET device_id = NULL WHERE device_id = ?', [d.id])).changes;
      await db.run('UPDATE device_profiles SET approved_at = NULL, approved_by = NULL WHERE device_id = ?', [d.id]);
      await auditCtx(c, db, { action: 'device.revoke_approval', objectType: 'device', objectId: d.id, diff: { previous_trust: num(d.trust_level), screens_unassigned: unassigned } });
    });
    await dropDeviceCache(rt, [d.id]);
    await bumpManifest(rt);
    const row = (await rt.db.query<DevRow>(`SELECT ${D_SELECT} ${D_FROM} WHERE d.id = ?`, [d.id]))[0]!;
    return c.json((await present(c, [row]))[0]);
  });

  // ---------------------------------------------------------------- Xoa thiet bi (xoa mem / go khoi van hanh)
  const DEVICE_DELETE_MAX = 200;
  // khai bao truoc :id de 'bulk-delete' khong bi hieu la id
  r.post('/bulk-delete', requirePerm('devices', 'delete'), async (c) => {
    const b = await parseBody(c, z.object({ ids: z.array(z.string().min(1).max(64)).min(1, 'Chọn ít nhất một thiết bị').max(DEVICE_DELETE_MAX, `Tối đa ${DEVICE_DELETE_MAX} thiết bị mỗi lần`) }).strict());
    return c.json(await decommission(c, [...new Set(b.ids)]));
  });
  r.delete('/:id', requirePerm('devices', 'delete'), async (c) => {
    const res = await decommission(c, [c.req.param('id')]);
    if (!res.deleted) throw notFound('Không tìm thấy thiết bị (hoặc đã được xóa trước đó).', 'device_not_found');
    return c.json(res);
  });

  // Nhat ky thiet bi (POST /v1/logs cua gateway), giu 7 ngay. Chi doc: devices:view.
  r.get('/:id/logs', requirePerm('devices', 'view'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('id');
    if (!(await rt.db.query('SELECT 1 AS x FROM devices WHERE id = ?', [id]))[0]) throw notFound('Không tìm thấy thiết bị.');
    const cutoff = new Date(rt.clock.now().getTime() - DEVICE_LOG_RETENTION_DAYS * 86400_000).toISOString();
    const res = await runList<{ id: string; ts: string; received_at: string; level: string; tag: string | null; message: string }>(
      c,
      {
        from: 'FROM device_logs l',
        select: 'l.id, l.ts, l.received_at, l.level, l.tag, l.message',
        where: [{ sql: 'l.device_id = ?', params: [id] }, { sql: 'l.ts >= ?', params: [cutoff] }], // chi ma thiet bi nay (khong the doc log thiet bi khac qua id trong URL)
        search: ['l.message', 'l.tag'],
        sorts: { ts: 'l.ts' },
        defaultSort: 'ts:desc',
        tiebreak: 'l.id',
        filters: { level: eq('l.level'), tag: eq('l.tag') },
      },
    );
    return c.json({ ...res, retention_days: DEVICE_LOG_RETENTION_DAYS });
  });

  r.route('/:id/commands', deviceCommandRoutes());

  r.get('/:id', requirePerm('devices', 'view'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('id');
    const row = (await rt.db.query<DevRow>(`SELECT ${D_SELECT} ${D_FROM} WHERE d.id = ?`, [id]))[0];
    if (!row || (row.deleted_at && c.get('user').role !== 'super_admin')) throw notFound('Không tìm thấy thiết bị.');
    const base = (await present(c, [row]))[0]!;
    const seen = await rt.db.query<{ name: string; brand: string | null; views: number }>(
      `SELECT c.name, adv.name AS brand, COUNT(*) AS views FROM ev_ad_impression e JOIN campaigns c ON c.id = e.campaign_id LEFT JOIN advertisers adv ON adv.id = c.advertiser_id
        WHERE e.device_id = ? AND e.valid = 1 GROUP BY c.id, c.name, adv.name ORDER BY views DESC LIMIT 10`,
      [id],
    );
    const since = new Date(rt.clock.now().getTime() - 6 * 86400_000).toISOString().slice(0, 10);
    const days = await rt.db.query<{ d: string; n: number }>('SELECT substr(ts, 1, 10) AS d, COUNT(*) AS n FROM ev_ad_impression WHERE device_id = ? AND valid = 1 AND ts >= ? GROUP BY substr(ts, 1, 10)', [id, since]);
    const popDays = await rt.db.query<{ d: string; n: number }>('SELECT substr(ts, 1, 10) AS d, COUNT(*) AS n FROM ev_proof_of_play WHERE device_id = ? AND ts >= ? GROUP BY substr(ts, 1, 10)', [id, since]).catch(() => []);
    for (const x of popDays) { const e = days.find((y) => y.d === x.d); if (e) e.n = num(e.n) + num(x.n); else days.push(x); }
    const dm = new Map(days.map((x) => [x.d, num(x.n)]));
    const views7 = Array.from({ length: 7 }, (_, i) => dm.get(new Date(rt.clock.now().getTime() - (6 - i) * 86400_000).toISOString().slice(0, 10)) ?? 0);
    return c.json({ ...base, delivery: deliveryInfo(rt.config.env), seen_ads: seen.map((s) => ({ name: s.name, brand: s.brand, views: num(s.views) })), views_7d: views7 });
  });

  return r;
}
