import { Hono } from 'hono';
import { z } from 'zod';
import { REGIONS } from '@ams/shared';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, notFound, tooMany, unprocessable } from '../lib/errors.js';
import { redeemPairingCode } from '@ams/edge-gateway/pairing';
import { dropDeviceCache } from '../lib/manifest.js';
import { getRt, num, parseBody, placeholders, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

const D_SELECT = `d.id, d.name, d.kind, d.model, d.os, d.app_version, d.region_id, d.status, d.last_seen_at, d.views_30d, d.blocked, d.trust_level, d.paired_at, d.created_at, eu.display_name AS owner_name`;
const D_FROM = 'FROM devices d LEFT JOIN end_users eu ON eu.id = d.user_id';

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
  owner_name: string | null;
}

const REGION_BY_NAME = Object.fromEntries(Object.entries(REGIONS).map(([k, v]) => [v.toLowerCase(), k]));
export const regionCode = (v: string): string => REGION_BY_NAME[v.toLowerCase()] ?? v.toUpperCase();

const apiStatus = (d: Pick<DevRow, 'status' | 'blocked'>) => (d.blocked ? 'blocked' : d.status === 'active' ? 'online' : d.status);

const spec: ListSpec = {
  from: D_FROM,
  select: D_SELECT,
  search: ['d.name', 'd.model', 'eu.display_name', 'd.id'],
  sorts: { name: 'd.name', owner_name: 'eu.display_name', region: 'd.region_id', views: 'd.views_30d', last_seen_at: 'd.last_seen_at', status: 'd.status', created_at: 'd.created_at' },
  defaultSort: 'created_at:desc',
  tiebreak: 'd.id',
  filters: {
    kind: (v) => ({ sql: 'd.kind = ?', params: [v === 'unknown' ? 'virtual' : v] }),
    region: (v) => ({ sql: 'd.region_id = ?', params: [regionCode(v)] }),
    status: (v) => {
      if (v === 'blocked') return { sql: 'd.blocked = 1', params: [] };
      if (v === 'online') return { sql: "d.status = 'active' AND d.blocked = 0", params: [] };
      return { sql: 'd.status = ? AND d.blocked = 0', params: [v] };
    },
  },
};

async function present(c: Ctx, rows: DevRow[]): Promise<Record<string, unknown>[]> {
  const rt = getRt(c);
  const recent = new Map<string, string[]>();
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const imp = await rt.db.query<{ device_id: string; name: string; last: string }>(
      `SELECT e.device_id, c.name, MAX(e.ts) AS last FROM ev_ad_impression e JOIN campaigns c ON c.id = e.campaign_id
        WHERE e.device_id IN (${placeholders(ids.length)}) AND e.valid = 1 GROUP BY e.device_id, c.name ORDER BY last DESC`,
      ids,
    );
    for (const x of imp) {
      const a = recent.get(x.device_id) ?? [];
      if (a.length < 5) a.push(x.name);
      recent.set(x.device_id, a);
    }
  }
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
    last_seen_at: d.last_seen_at,
    paired_at: d.paired_at,
    views: num(d.views_30d),
    recent_ads: recent.get(d.id) ?? [],
  }));
}

export function deviceRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('devices', 'view'), async (c) => {
    const res = await runList<DevRow>(c, spec);
    return c.json({ ...res, items: await present(c, res.items) });
  });

  // khai bao truoc :id de 'bulk' khong bi hieu la id
  r.post('/bulk', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ action: z.enum(['verify', 'block', 'unblock']), ids: z.array(z.string().min(1).max(64)).min(1, 'Chọn ít nhất một thiết bị').max(500, 'Tối đa 500 thiết bị mỗi lần') }));
    const ids = [...new Set(b.ids)];
    const sql =
      b.action === 'verify'
        ? `UPDATE devices SET trust_level = 2, blocked = 0, status = CASE WHEN status = 'checking' THEN 'active' ELSE status END WHERE id IN (${placeholders(ids.length)})`
        : b.action === 'block'
          ? `UPDATE devices SET blocked = 1, trust_level = 0 WHERE id IN (${placeholders(ids.length)})`
          : `UPDATE devices SET blocked = 0, trust_level = CASE WHEN trust_level = 0 THEN 1 ELSE trust_level END WHERE id IN (${placeholders(ids.length)})`;
    let updated = 0;
    await rt.db.tx(async (db) => {
      updated = (await db.run(sql, ids)).changes;
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
    if ((await rt.kv.incr(`rl:pair:${u.id}:${bucket}`, 600)) > 30) throw tooMany('Nhập mã quá nhiều lần, thử lại sau ít phút.', 300);
    const nowIso = rt.clock.now().toISOString();
    const userId = rt.id();
    await rt.db.run('INSERT INTO end_users (id, phone_hash, email_enc, display_name, created_at) VALUES (?, NULL, NULL, ?, ?)', [userId, b.owner_name || `Ghép bởi ${u.name}`, nowIso]);
    const res = await redeemPairingCode(rt, b.code, userId); // cung xoa kv `dev:<id>`
    if (!res.ok) {
      await rt.db.run('DELETE FROM end_users WHERE id = ?', [userId]);
      if (res.reason === 'not_found') throw notFound('Mã ghép đôi không đúng.', 'pair_code_not_found');
      if (res.reason === 'expired') throw unprocessable('Mã đã hết hạn (5 phút). Hãy lấy mã mới trên màn hình TV.', 'pair_code_expired');
      throw conflict('Mã này đã được dùng.', 'pair_code_used');
    }
    await auditCtx(c, rt.db, { action: 'device.pair', objectType: 'device', objectId: res.deviceId, diff: { end_user_id: userId } });
    return c.json({ device_id: res.deviceId, paired: true });
  });

  r.get('/:id', requirePerm('devices', 'view'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('id');
    const row = (await rt.db.query<DevRow>(`SELECT ${D_SELECT} ${D_FROM} WHERE d.id = ?`, [id]))[0];
    if (!row) throw notFound('Không tìm thấy thiết bị.');
    const base = (await present(c, [row]))[0]!;
    const seen = await rt.db.query<{ name: string; brand: string | null; views: number }>(
      `SELECT c.name, adv.name AS brand, COUNT(*) AS views FROM ev_ad_impression e JOIN campaigns c ON c.id = e.campaign_id LEFT JOIN advertisers adv ON adv.id = c.advertiser_id
        WHERE e.device_id = ? AND e.valid = 1 GROUP BY c.id, c.name, adv.name ORDER BY views DESC LIMIT 10`,
      [id],
    );
    const since = new Date(rt.clock.now().getTime() - 6 * 86400_000).toISOString().slice(0, 10);
    const days = await rt.db.query<{ d: string; n: number }>('SELECT substr(ts, 1, 10) AS d, COUNT(*) AS n FROM ev_ad_impression WHERE device_id = ? AND valid = 1 AND ts >= ? GROUP BY substr(ts, 1, 10)', [id, since]);
    const dm = new Map(days.map((x) => [x.d, num(x.n)]));
    const views7 = Array.from({ length: 7 }, (_, i) => dm.get(new Date(rt.clock.now().getTime() - (6 - i) * 86400_000).toISOString().slice(0, 10)) ?? 0);
    return c.json({ ...base, seen_ads: seen.map((s) => ({ name: s.name, brand: s.brand, views: num(s.views) })), views_7d: views7 });
  });

  return r;
}
