// Cay phan nhom thiet bi + dia diem dat thiet bi + am luong tu xa (d-tree).
// Quyen: dung module `devices` (view cho doc, write cho sua). Thiet bi thuoc DUNG MOT nhom / toi da MOT dia diem (device_profiles.group_id/location_id).
// Am luong: dung co che lenh san co (device_commands, giao o heartbeat ke tiep, TV ack) voi lenh `set_volume` {percent}. KHONG realtime.
import { Hono } from 'hono';
import { z } from 'zod';
import { CommandError, enqueueCommand } from '@ams/edge-gateway';
import { chunkForIn } from '@ams/runtime';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, notFound, tooMany, unprocessable } from '../lib/errors.js';
import { eq, getRt, num, parseBody, placeholders, runList } from '../lib/http.js';
import type { Ctx, ListSpec, SqlFrag } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import { CANCEL_RESULT, deliveryInfo } from './device-commands.js';
import { dropDeviceCache } from '../lib/manifest.js';
import type { AppEnv } from '../types.js';

export const VENUE_TYPES = ['supermarket', 'airport', 'elevator', 'fnb', 'hospital', 'hotel', 'other'] as const;
export const MAX_GROUP_DEPTH = 6;
const MAX_ASSIGN = 500;

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const name80 = z.string().trim().min(1, 'Nhập tên').max(80, 'Tên tối đa 80 ký tự');
const idStr = z.string().min(1).max(64);
const optText = (n: number) => z.string().trim().max(n).nullish().transform((v) => (v ? v : null));

interface GroupRow { id: string; parent_id: string | null; name: string; sort: number; created_at: string }
interface CountRow { group_id: string; n: number; online: number }

const ONLINE_SQL = "(d.status = 'active' AND d.blocked = 0)";

async function liveGroups(db: { query: <T>(sql: string, p?: unknown[]) => Promise<T[]> }): Promise<GroupRow[]> {
  return db.query<GroupRow>('SELECT id, parent_id, name, sort, created_at FROM device_groups WHERE deleted_at IS NULL ORDER BY sort, name, id');
}
/** Tat ca id hậu duệ (kèm chính nó). */
export function subtreeIds(groups: GroupRow[], root: string): string[] {
  const kids = new Map<string | null, string[]>();
  for (const g of groups) kids.set(g.parent_id, [...(kids.get(g.parent_id) ?? []), g.id]);
  const out: string[] = [];
  const stack = [root];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}
function depthOf(groups: GroupRow[], id: string | null): number {
  const by = new Map(groups.map((g) => [g.id, g]));
  let d = 0;
  let cur = id;
  while (cur && d <= 50) { d++; cur = by.get(cur)?.parent_id ?? null; }
  return d;
}
const pathOf = (by: Map<string, GroupRow>, id: string): string => {
  const parts: string[] = [];
  let cur: string | null = id;
  for (let i = 0; cur && i < 50; i++) { const g = by.get(cur); if (!g) break; parts.unshift(g.name); cur = g.parent_id; }
  return parts.join(' › ');
};

async function treePayload(c: Ctx) {
  const rt = getRt(c);
  const groups = await liveGroups(rt.db);
  const by = new Map(groups.map((g) => [g.id, g]));
  const counts = await rt.db.query<CountRow>(
    `SELECT p.group_id AS group_id, COUNT(*) AS n, SUM(CASE WHEN ${ONLINE_SQL} THEN 1 ELSE 0 END) AS online FROM devices d JOIN device_profiles p ON p.device_id = d.id WHERE p.group_id IS NOT NULL GROUP BY p.group_id`,
  );
  const direct = new Map(counts.map((x) => [x.group_id, { n: num(x.n), online: num(x.online) }]));
  const total = num((await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM devices'))[0]?.n);
  const totalOnline = num((await rt.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM devices d WHERE ${ONLINE_SQL}`))[0]?.n);
  let assigned = 0;
  const items = groups.map((g) => {
    const own = direct.get(g.id) ?? { n: 0, online: 0 };
    let n = 0;
    let online = 0;
    for (const id of subtreeIds(groups, g.id)) { const x = direct.get(id); if (x) { n += x.n; online += x.online; } }
    assigned += own.n;
    return { id: g.id, parent_id: g.parent_id, name: g.name, sort: num(g.sort), path: pathOf(by, g.id), depth: depthOf(groups, g.id), direct_count: own.n, device_count: n, online_count: online };
  });
  return { items, total, total_online: totalOnline, unassigned: Math.max(0, total - assigned), max_depth: MAX_GROUP_DEPTH };
}

async function requireGroup(rt: ReturnType<typeof getRt>, id: string): Promise<GroupRow> {
  const g = (await rt.db.query<GroupRow>('SELECT id, parent_id, name, sort, created_at FROM device_groups WHERE id = ? AND deleted_at IS NULL', [id]))[0];
  if (!g) throw notFound('Không tìm thấy nhóm thiết bị.', 'group_not_found');
  return g;
}
async function requireLocation(rt: ReturnType<typeof getRt>, id: string): Promise<{ id: string; name: string }> {
  const l = (await rt.db.query<{ id: string; name: string }>('SELECT id, name FROM locations WHERE id = ? AND deleted_at IS NULL', [id]))[0];
  if (!l) throw notFound('Không tìm thấy địa điểm.', 'location_not_found');
  return l;
}
async function requireDevices(rt: ReturnType<typeof getRt>, ids: string[]): Promise<void> {
  let found = 0;
  for (const part of chunkForIn(ids)) found += num((await rt.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM devices WHERE id IN (${placeholders(part.length)})`, part))[0]?.n);
  if (found !== ids.length) throw unprocessable('Có thiết bị không tồn tại trong danh sách chọn.', 'device_not_found', { requested: ids.length, found });
}
const UPSERT_COL = (col: 'group_id' | 'location_id') => `INSERT INTO device_profiles (device_id, ${col}) VALUES (?,?) ON CONFLICT (device_id) DO UPDATE SET ${col} = excluded.${col}`;
async function assignColumn(c: Ctx, col: 'group_id' | 'location_id', ids: string[], value: string | null, action: string): Promise<number> {
  const rt = getRt(c);
  await rt.db.tx(async (db) => {
    for (let i = 0; i < ids.length; i += 100) await db.batch(ids.slice(i, i + 100).map((id) => ({ sql: UPSERT_COL(col), params: [id, value] })));
    await auditCtx(c, db, { action, objectType: col === 'group_id' ? 'device_group' : 'location', objectId: value, diff: { count: ids.length, [col]: value, ids: ids.slice(0, 50) } });
  });
  return ids.length;
}

/* ------------------------------------------------------------------ danh sach thiet bi cho trang Nhom / Dia diem */
const DEV_SELECT = `d.id, d.name, d.kind, d.model, d.app_version, d.status, d.blocked, d.trust_level, d.paired_at, d.last_seen_at,
  p.px_w, p.px_h, p.orientation, p.mac, p.serial, p.volume, p.volume_at, p.group_id, p.location_id, g.name AS group_name, l.name AS location_name, l.address AS location_address,
  (SELECT sc.px_w FROM screens sc WHERE sc.device_id = d.id ORDER BY sc.id LIMIT 1) AS screen_px_w,
  (SELECT sc.px_h FROM screens sc WHERE sc.device_id = d.id ORDER BY sc.id LIMIT 1) AS screen_px_h`;
const DEV_FROM = `FROM devices d LEFT JOIN device_profiles p ON p.device_id = d.id
  LEFT JOIN device_groups g ON g.id = p.group_id AND g.deleted_at IS NULL LEFT JOIN locations l ON l.id = p.location_id AND l.deleted_at IS NULL`;
interface DevRow {
  id: string; name: string | null; kind: string; model: string | null; app_version: string | null; status: string; blocked: number; trust_level: number; paired_at: string | null; last_seen_at: string | null;
  px_w: number | null; px_h: number | null; orientation: string | null; mac: string | null; serial: string | null; volume: number | null; volume_at: string | null;
  group_id: string | null; location_id: string | null; group_name: string | null; location_name: string | null; location_address: string | null; screen_px_w: number | null; screen_px_h: number | null;
}
const devSpec = (groupIds: string[] | 'none' | null): ListSpec => ({
  from: DEV_FROM,
  select: DEV_SELECT,
  where: groupIds === null ? [] : groupIds === 'none' ? [{ sql: 'g.id IS NULL', params: [] }] : [{ sql: `p.group_id IN (${placeholders(groupIds.length)})`, params: groupIds }],
  search: ['d.name', 'd.id', 'p.mac', 'p.serial', 'l.name', 'l.address', 'd.model'],
  sorts: { name: 'd.name', status: 'd.status', last_seen_at: 'd.last_seen_at', volume: 'p.volume', created_at: 'd.created_at' },
  defaultSort: 'name:asc',
  tiebreak: 'd.id',
  filters: {
    status: (v) => (v === 'online' ? { sql: ONLINE_SQL, params: [] } : v === 'offline' ? { sql: `NOT ${ONLINE_SQL}`, params: [] } : null),
    location_id: (v) => (v === 'none' ? { sql: 'l.id IS NULL', params: [] } : { sql: 'p.location_id = ?', params: [v] }),
    kind: eq('d.kind'),
  },
});

interface VolCmd { id: string; device_id: string; status: string; args: string | null; expires_at: string; result: string | null; created_at: string }
export type VolState = 'pending' | 'delivered' | 'acked' | 'failed' | 'expired' | 'cancelled';
export function volState(r: Pick<VolCmd, 'status' | 'result' | 'expires_at'>, nowIso: string): VolState {
  if (r.status === 'failed' && r.result === CANCEL_RESULT) return 'cancelled';
  if ((r.status === 'pending' || r.status === 'delivered') && r.expires_at <= nowIso) return 'expired';
  return r.status as VolState;
}

async function presentDevices(c: Ctx, rows: DevRow[]) {
  const rt = getRt(c);
  const nowIso = rt.clock.now().toISOString();
  const last = new Map<string, VolCmd>();
  for (const part of chunkForIn(rows.map((r) => r.id))) {
    const cmds = await rt.db.query<VolCmd>(
      `SELECT k.id, k.device_id, k.status, k.args, k.expires_at, k.result, k.created_at FROM device_commands k WHERE k.type = 'set_volume' AND k.device_id IN (${placeholders(part.length)}) ORDER BY k.created_at DESC, k.id DESC`,
      part,
    );
    for (const k of cmds) if (!last.has(k.device_id)) last.set(k.device_id, k);
  }
  return rows.map((d) => {
    const k = last.get(d.id);
    let percent: number | null = null;
    try { percent = k?.args ? (JSON.parse(k.args) as { percent?: number }).percent ?? null : null; } catch { percent = null; }
    const w = num(d.screen_px_w ?? d.px_w, 0);
    const h = num(d.screen_px_h ?? d.px_h, 0);
    let applied: number | null = null;
    let mode: string | null = null;
    try {
      const rs = k?.result ? (JSON.parse(k.result) as { applied_percent?: unknown; mode?: unknown }) : null;
      if (rs && Number.isInteger(rs.applied_percent)) applied = rs.applied_percent as number;
      if (rs && (rs.mode === 'system' || rs.mode === 'player')) mode = rs.mode;
    } catch { /* result khong phai JSON */ }
    return {
      id: d.id,
      name: d.name ?? d.id,
      kind: d.kind === 'virtual' ? 'unknown' : d.kind,
      model: d.model,
      app_version: d.app_version,
      status: d.blocked ? 'blocked' : d.status === 'active' ? 'online' : 'offline',
      online: !d.blocked && d.status === 'active',
      controllable: !d.blocked && num(d.trust_level) >= 1,
      synced: !!d.last_seen_at,
      last_seen_at: d.last_seen_at,
      px_w: w || null,
      px_h: h || null,
      orientation: d.orientation,
      mac: d.mac,
      serial: d.serial,
      group_id: d.group_id,
      group_name: d.group_name,
      location_id: d.location_id,
      location_name: d.location_name,
      location_address: d.location_address,
      volume: d.volume === null || d.volume === undefined ? null : num(d.volume),
      volume_at: d.volume_at,
      volume_cmd: k ? { id: k.id, state: volState(k, nowIso), percent, applied_percent: applied, mode, created_at: k.created_at } : null,
    };
  });
}

const volumeBody = z.object({ percent: z.number().int().min(0, 'Âm lượng từ 0 đến 100').max(100, 'Âm lượng từ 0 đến 100'), include_children: z.boolean().default(true) }).strict();

export function deviceGroupRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('devices', 'view'), async (c) => c.json(await treePayload(c)));

  // Thiet bi theo nhom (kem nhom con): group_id=<id> | none (chua xep nhom) | vang = tat ca
  r.get('/devices', requirePerm('devices', 'view'), async (c) => {
    const rt = getRt(c);
    const gid = c.req.query('group_id');
    let ids: string[] | 'none' | null = null;
    if (gid === 'none') ids = 'none';
    else if (gid) {
      await requireGroup(rt, gid);
      const groups = await liveGroups(rt.db);
      ids = c.req.query('include_children') === '0' ? [gid] : subtreeIds(groups, gid);
    }
    const res = await runList<DevRow>(c, devSpec(ids));
    return c.json({ ...res, items: await presentDevices(c, res.items), delivery: deliveryInfo(rt.config.env) });
  });

  r.post('/', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ name: name80, parent_id: idStr.nullish() }).strict());
    const groups = await liveGroups(rt.db);
    const parent = b.parent_id ?? null;
    if (parent) await requireGroup(rt, parent);
    if (depthOf(groups, parent) + 1 > MAX_GROUP_DEPTH) throw unprocessable(`Cây nhóm tối đa ${MAX_GROUP_DEPTH} cấp.`, 'group_too_deep');
    if (groups.some((g) => g.parent_id === parent && g.name.toLowerCase() === b.name.toLowerCase())) throw conflict('Đã có nhóm cùng tên trong nhóm cha này.', 'group_name_taken');
    const id = rt.id();
    const sort = groups.filter((g) => g.parent_id === parent).length;
    await rt.db.tx(async (db) => {
      await db.run('INSERT INTO device_groups (id, parent_id, name, sort, created_at) VALUES (?,?,?,?,?)', [id, parent, b.name, sort, rt.clock.now().toISOString()]);
      await auditCtx(c, db, { action: 'device_group.create', objectType: 'device_group', objectId: id, diff: { name: b.name, parent_id: parent } });
    });
    return c.json({ id, parent_id: parent, name: b.name, sort }, 201);
  });

  // khai bao truoc '/:id'
  r.put('/assign', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ device_ids: z.array(idStr).min(1, 'Chọn ít nhất một thiết bị').max(MAX_ASSIGN, `Tối đa ${MAX_ASSIGN} thiết bị mỗi lần`), group_id: idStr.nullable() }).strict());
    const ids = [...new Set(b.device_ids)];
    if (b.group_id) await requireGroup(rt, b.group_id);
    await requireDevices(rt, ids);
    const n = await assignColumn(c, 'group_id', ids, b.group_id, 'device_group.assign');
    return c.json({ updated: n, group_id: b.group_id });
  });

  r.patch('/devices/:deviceId', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('deviceId');
    const b = await parseBody(
      c,
      z.object({
        group_id: idStr.nullable().optional(),
        location_id: idStr.nullable().optional(),
        mac: z.string().trim().max(17).nullable().optional(),
        serial: z.string().trim().max(64).regex(/^[A-Za-z0-9._\-/ ]*$/, 'Số serial chỉ gồm chữ, số, . _ - /').nullable().optional(),
        name: z.string().trim().min(1).max(100).optional(),
      }).strict(),
    );
    if (!(await rt.db.query('SELECT 1 AS x FROM devices WHERE id = ?', [id]))[0]) throw notFound('Không tìm thấy thiết bị.');
    const sets: string[] = [];
    const params: unknown[] = [];
    const diff: Record<string, unknown> = {};
    if (b.group_id !== undefined) { if (b.group_id) await requireGroup(rt, b.group_id); sets.push('group_id = ?'); params.push(b.group_id); diff.group_id = b.group_id; }
    if (b.location_id !== undefined) { if (b.location_id) await requireLocation(rt, b.location_id); sets.push('location_id = ?'); params.push(b.location_id); diff.location_id = b.location_id; }
    if (b.mac !== undefined) {
      const mac = b.mac ? b.mac : null;
      if (mac && !MAC_RE.test(mac)) throw unprocessable('Địa chỉ MAC không đúng định dạng (AA:BB:CC:DD:EE:FF).', 'mac_invalid');
      const norm = mac ? mac.toUpperCase().replace(/-/g, ':') : null;
      if (norm && (await rt.db.query('SELECT 1 AS x FROM device_profiles WHERE mac = ? AND device_id <> ?', [norm, id]))[0]) throw conflict('Địa chỉ MAC này đã gắn cho thiết bị khác.', 'mac_taken');
      sets.push('mac = ?'); params.push(norm); diff.mac = norm;
    }
    if (b.serial !== undefined) { sets.push('serial = ?'); params.push(b.serial || null); diff.serial = b.serial || null; }
    await rt.db.tx(async (db) => {
      if (sets.length) {
        // upsert: tao dong device_profiles rong neu chua co (TV chua tung bao cao), roi UPDATE cac cot
        await db.run('INSERT INTO device_profiles (device_id) VALUES (?) ON CONFLICT (device_id) DO NOTHING', [id]);
        await db.run(`UPDATE device_profiles SET ${sets.join(', ')} WHERE device_id = ?`, [...params, id]);
      }
      if (b.name !== undefined) { await db.run('UPDATE devices SET name = ? WHERE id = ?', [b.name, id]); diff.name = b.name; }
      await auditCtx(c, db, { action: 'device.placement', objectType: 'device', objectId: id, diff });
    });
    if (b.name !== undefined) await dropDeviceCache(rt, [id]);
    const row = (await rt.db.query<DevRow>(`SELECT ${DEV_SELECT} ${DEV_FROM} WHERE d.id = ?`, [id]))[0]!;
    return c.json((await presentDevices(c, [row]))[0]);
  });

  r.patch('/:id', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('id');
    const b = await parseBody(c, z.object({ name: name80.optional(), parent_id: idStr.nullable().optional(), sort: z.number().int().min(0).max(100000).optional() }).strict());
    const g = await requireGroup(rt, id);
    const groups = await liveGroups(rt.db);
    const parent = b.parent_id === undefined ? g.parent_id : b.parent_id;
    const name = b.name ?? g.name;
    if (parent !== g.parent_id) {
      if (parent) await requireGroup(rt, parent);
      const sub = subtreeIds(groups, id);
      if (parent && sub.includes(parent)) throw unprocessable('Không thể chuyển nhóm vào chính nó hoặc nhóm con của nó.', 'group_cycle');
      // do sau: cap cua nhanh con sau khi chuyen
      const subDepth = Math.max(...sub.map((s) => depthOf(groups, s))) - depthOf(groups, id) + 1;
      if (depthOf(groups, parent) + subDepth > MAX_GROUP_DEPTH) throw unprocessable(`Cây nhóm tối đa ${MAX_GROUP_DEPTH} cấp.`, 'group_too_deep');
    }
    if ((parent !== g.parent_id || name !== g.name) && groups.some((x) => x.id !== id && x.parent_id === parent && x.name.toLowerCase() === name.toLowerCase())) throw conflict('Đã có nhóm cùng tên trong nhóm cha này.', 'group_name_taken');
    await rt.db.tx(async (db) => {
      await db.run('UPDATE device_groups SET name = ?, parent_id = ?, sort = ? WHERE id = ?', [name, parent, b.sort ?? num(g.sort), id]);
      await auditCtx(c, db, { action: 'device_group.update', objectType: 'device_group', objectId: id, diff: { from: { name: g.name, parent_id: g.parent_id }, to: { name, parent_id: parent } } });
    });
    return c.json({ id, name, parent_id: parent });
  });

  // Xoa nhom: nhom con va thiet bi duoc DON LEN nhom cha (hoac ve "chua xep nhom" neu la nhom goc). Khong mat thiet bi.
  r.delete('/:id', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('id');
    const g = await requireGroup(rt, id);
    const groups = await liveGroups(rt.db);
    const kids = groups.filter((x) => x.parent_id === id);
    const devCount = num((await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM device_profiles WHERE group_id = ?', [id]))[0]?.n);
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run('UPDATE device_groups SET parent_id = ? WHERE parent_id = ? AND deleted_at IS NULL', [g.parent_id, id]);
      await db.run('UPDATE device_profiles SET group_id = ? WHERE group_id = ?', [g.parent_id, id]);
      await db.run('UPDATE device_groups SET deleted_at = ? WHERE id = ?', [now, id]);
      await auditCtx(c, db, { action: 'device_group.delete', objectType: 'device_group', objectId: id, diff: { name: g.name, moved_to: g.parent_id, children_moved: kids.length, devices_moved: devCount } });
    });
    return c.json({ id, deleted: true, moved_to: g.parent_id, children_moved: kids.length, devices_moved: devCount });
  });

  // Dat am luong hang loat cho mot nhom (kem nhom con). Moi thiet bi mot lenh set_volume; thiet bi chua ghep/bi chan bi bo qua (liet ke ro).
  r.post('/:id/volume', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    await requireGroup(rt, c.req.param('id'));
    const b = await parseBody(c, volumeBody);
    const groups = await liveGroups(rt.db);
    const gids = b.include_children ? subtreeIds(groups, c.req.param('id')) : [c.req.param('id')];
    const devs = await rt.db.query<{ id: string; blocked: number; trust_level: number }>(
      `SELECT d.id, d.blocked, d.trust_level FROM devices d JOIN device_profiles p ON p.device_id = d.id WHERE p.group_id IN (${placeholders(gids.length)}) ORDER BY d.id LIMIT ${MAX_ASSIGN + 1}`,
      gids,
    );
    if (devs.length > MAX_ASSIGN) throw unprocessable(`Nhóm có hơn ${MAX_ASSIGN} thiết bị, hãy chọn nhóm nhỏ hơn.`, 'group_too_large');
    if (!devs.length) throw unprocessable('Nhóm chưa có thiết bị nào.', 'group_empty');
    const bucket = Math.floor(rt.clock.now().getTime() / 600_000);
    if ((await rt.kv.incr(`rl:devvol:u:${u.id}:${bucket}`, 600)) > 20) throw tooMany('Bạn đặt âm lượng hàng loạt quá nhiều, thử lại sau ít phút.', 300);
    const queued: { device_id: string; command_id: string }[] = [];
    const skipped: { device_id: string; reason: string }[] = [];
    for (const d of devs) {
      if (Number(d.blocked) === 1) { skipped.push({ device_id: d.id, reason: 'device_blocked' }); continue; }
      if (num(d.trust_level) < 1) { skipped.push({ device_id: d.id, reason: 'device_not_approved' }); continue; }
      try {
        const cid = await enqueueCommand(rt, d.id, { type: 'set_volume', args: { percent: b.percent } }, { ttlS: 3600, createdBy: u.id, ip: c.get('ip') ?? null });
        queued.push({ device_id: d.id, command_id: cid });
      } catch (e) {
        if (e instanceof CommandError) { skipped.push({ device_id: d.id, reason: e.code }); continue; }
        throw e;
      }
    }
    await auditCtx(c, rt.db, { action: 'device_group.set_volume', objectType: 'device_group', objectId: c.req.param('id'), diff: { percent: b.percent, include_children: b.include_children, queued: queued.length, skipped: skipped.length } });
    return c.json({ queued: queued.length, skipped, commands: queued, delivery: deliveryInfo(rt.config.env) }, 202);
  });

  return r;
}

/* ================================================================== Dia diem */
const locationBody = z
  .object({
    name: name80,
    address: optText(200),
    province: optText(60),
    district: optText(60),
    lat: z.number().min(-90, 'Vĩ độ từ -90 đến 90').max(90, 'Vĩ độ từ -90 đến 90').nullish().transform((v) => v ?? null),
    lng: z.number().min(-180, 'Kinh độ từ -180 đến 180').max(180, 'Kinh độ từ -180 đến 180').nullish().transform((v) => v ?? null),
    venue_type: z.enum(VENUE_TYPES).default('other'),
    contact_name: optText(80),
    contact_phone: z.string().trim().max(20).regex(/^[0-9+() .-]*$/, 'Số điện thoại chỉ gồm số và + ( ) . -').nullish().transform((v) => (v ? v : null)),
    notes: optText(500),
    status: z.enum(['active', 'inactive']).default('active'),
  })
  .strict()
  .refine((v) => (v.lat === null) === (v.lng === null), { message: 'Nhập đủ cả vĩ độ và kinh độ', path: ['lat'] });

const locSpec: ListSpec = {
  from: 'FROM locations l',
  select: `l.id, l.name, l.address, l.province, l.district, l.lat, l.lng, l.venue_type, l.contact_name, l.contact_phone, l.notes, l.status, l.created_at,
    (SELECT COUNT(*) FROM device_profiles p WHERE p.location_id = l.id) AS device_count,
    (SELECT COUNT(*) FROM device_profiles p JOIN devices d ON d.id = p.device_id WHERE p.location_id = l.id AND d.status = 'active' AND d.blocked = 0) AS online_count`,
  where: [{ sql: 'l.deleted_at IS NULL', params: [] }],
  search: ['l.name', 'l.address', 'l.province', 'l.district', 'l.contact_name'],
  sorts: { name: 'l.name', province: 'l.province', created_at: 'l.created_at', venue_type: 'l.venue_type' },
  defaultSort: 'name:asc',
  tiebreak: 'l.id',
  filters: { venue_type: eq('l.venue_type'), province: eq('l.province'), status: eq('l.status') },
};
const presentLoc = (x: Record<string, unknown>) => ({ ...x, device_count: num(x.device_count), online_count: num(x.online_count) });

export function locationRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('devices', 'view'), async (c) => {
    const res = await runList<Record<string, unknown>>(c, locSpec);
    return c.json({ ...res, items: res.items.map(presentLoc), venue_types: VENUE_TYPES });
  });

  r.post('/', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, locationBody);
    const id = rt.id();
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run(
        'INSERT INTO locations (id, name, address, province, district, lat, lng, venue_type, contact_name, contact_phone, notes, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, b.name, b.address, b.province, b.district, b.lat, b.lng, b.venue_type, b.contact_name, b.contact_phone, b.notes, b.status, now, now],
      );
      await auditCtx(c, db, { action: 'location.create', objectType: 'location', objectId: id, diff: { name: b.name, venue_type: b.venue_type, province: b.province } });
    });
    return c.json({ id, ...b, device_count: 0, online_count: 0 }, 201);
  });

  r.put('/assign', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ device_ids: z.array(idStr).min(1, 'Chọn ít nhất một thiết bị').max(MAX_ASSIGN, `Tối đa ${MAX_ASSIGN} thiết bị mỗi lần`), location_id: idStr.nullable() }).strict());
    const ids = [...new Set(b.device_ids)];
    if (b.location_id) await requireLocation(rt, b.location_id);
    await requireDevices(rt, ids);
    const n = await assignColumn(c, 'location_id', ids, b.location_id, 'location.assign');
    return c.json({ updated: n, location_id: b.location_id });
  });

  r.get('/:id', requirePerm('devices', 'view'), async (c) => {
    const rt = getRt(c);
    const rows = await rt.db.query<Record<string, unknown>>(`SELECT ${locSpec.select} ${locSpec.from} WHERE l.id = ? AND l.deleted_at IS NULL`, [c.req.param('id')]);
    if (!rows[0]) throw notFound('Không tìm thấy địa điểm.', 'location_not_found');
    return c.json(presentLoc(rows[0]));
  });

  r.patch('/:id', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('id');
    const before = (await rt.db.query<Record<string, unknown>>('SELECT * FROM locations WHERE id = ? AND deleted_at IS NULL', [id]))[0];
    if (!before) throw notFound('Không tìm thấy địa điểm.', 'location_not_found');
    // PATCH = gop voi gia tri cu roi kiem tra lai nhu tao moi
    const raw = (await parseBody(c, z.record(z.unknown()))) as Record<string, unknown>;
    const allowed = ['name', 'address', 'province', 'district', 'lat', 'lng', 'venue_type', 'contact_name', 'contact_phone', 'notes', 'status'];
    for (const k of Object.keys(raw)) if (!allowed.includes(k)) throw unprocessable(`Trường "${k}" không được phép sửa.`, 'validation_error');
    const merged: Record<string, unknown> = {};
    for (const k of allowed) merged[k] = k in raw ? raw[k] : before[k];
    const lat = merged.lat === undefined ? null : merged.lat;
    const lng = merged.lng === undefined ? null : merged.lng;
    const rawClean = { ...merged, lat, lng };
    const b = locationBody.safeParse(rawClean);
    if (!b.success) throw unprocessable(`Dữ liệu không hợp lệ: ${b.error.issues[0]?.message ?? 'sai định dạng'}.`, 'validation_error', b.error.flatten());
    const v = b.data;
    await rt.db.tx(async (db) => {
      await db.run(
        'UPDATE locations SET name = ?, address = ?, province = ?, district = ?, lat = ?, lng = ?, venue_type = ?, contact_name = ?, contact_phone = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?',
        [v.name, v.address, v.province, v.district, v.lat, v.lng, v.venue_type, v.contact_name, v.contact_phone, v.notes, v.status, rt.clock.now().toISOString(), id],
      );
      const changed = Object.keys(raw).filter((k) => String(before[k] ?? '') !== String((v as Record<string, unknown>)[k] ?? ''));
      await auditCtx(c, db, { action: 'location.update', objectType: 'location', objectId: id, diff: { changed } });
    });
    const row = (await rt.db.query<Record<string, unknown>>(`SELECT ${locSpec.select} ${locSpec.from} WHERE l.id = ?`, [id]))[0]!;
    return c.json(presentLoc(row));
  });

  // Xoa: neu con thiet bi thi phai chon noi chuyen (move_to=<id dia diem khac> | none = bo gan dia diem) — khong thi 409.
  r.delete('/:id', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('id');
    const loc = await requireLocation(rt, id);
    const n = num((await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM device_profiles WHERE location_id = ?', [id]))[0]?.n);
    const moveTo = c.req.query('move_to');
    if (n > 0 && !moveTo) throw conflict(`Địa điểm đang có ${n} thiết bị. Hãy chuyển thiết bị sang địa điểm khác (hoặc bỏ gắn) trước khi xóa.`, 'location_has_devices', { device_count: n });
    let target: string | null = null;
    if (n > 0 && moveTo && moveTo !== 'none') {
      if (moveTo === id) throw unprocessable('Địa điểm đích phải khác địa điểm đang xóa.', 'validation_error');
      target = (await requireLocation(rt, moveTo)).id;
    }
    await rt.db.tx(async (db) => {
      if (n > 0) await db.run('UPDATE device_profiles SET location_id = ? WHERE location_id = ?', [target, id]);
      await db.run('UPDATE locations SET deleted_at = ? WHERE id = ?', [rt.clock.now().toISOString(), id]);
      await auditCtx(c, db, { action: 'location.delete', objectType: 'location', objectId: id, diff: { name: loc.name, devices_moved: n, moved_to: target } });
    });
    return c.json({ id, deleted: true, devices_moved: n, moved_to: target });
  });

  return r;
}
