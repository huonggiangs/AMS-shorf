import { Hono } from 'hono';
import { z } from 'zod';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { diffObjects } from '../lib/audit.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { getRt, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { requireAnyPerm, requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

interface PRow {
  id: string;
  name: string;
  protocol: string | null;
  endpoint: string | null;
  auth_ref: string | null;
  enabled: number;
  floor_cpm_vnd: number;
  imps: number | null;
  rev: number | null;
  valid: number | null;
}

const P_SELECT = `p.id, p.name, p.protocol, p.endpoint, p.auth_ref, p.enabled, p.floor_cpm_vnd,
  (SELECT SUM(impressions) FROM impression_hourly h WHERE h.partner_id = p.id) AS imps,
  (SELECT SUM(revenue_micro_vnd) FROM impression_hourly h WHERE h.partner_id = p.id) AS rev,
  (SELECT SUM(valid) FROM impression_hourly h WHERE h.partner_id = p.id) AS valid`;

// Khong tra khoa bi mat: auth_ref chi la tham chieu ten bien moi truong/kho bi mat; che di khi hien thi.
const present = (p: PRow) => {
  const imps = num(p.imps);
  return {
    id: p.id,
    name: p.name,
    protocol: p.protocol,
    endpoint: p.endpoint,
    auth: p.auth_ref ? '••••••••' : null,
    enabled: !!p.enabled,
    status: p.enabled ? 'online' : 'offline',
    floor_cpm_vnd: num(p.floor_cpm_vnd),
    impressions: imps,
    // eCPM = doanh thu / luot * 1000 (micro-dong -> dong)
    ecpm_vnd: imps > 0 ? Math.round((num(p.rev) / 1e6 / imps) * 1000) : 0,
    fill_rate: imps > 0 ? Math.round((num(p.valid) / imps) * 1000) / 10 : null,
  };
};

const spec: ListSpec = {
  from: 'FROM partners p',
  select: P_SELECT,
  search: ['p.name', 'p.protocol'],
  sorts: { name: 'p.name', protocol: 'p.protocol', floor_cpm_vnd: 'p.floor_cpm_vnd' },
  defaultSort: 'name:asc',
  tiebreak: 'p.id',
  filters: { enabled: (v) => ({ sql: 'p.enabled = ?', params: [v === 'true' || v === '1' ? 1 : 0] }), status: (v) => ({ sql: 'p.enabled = ?', params: [v === 'online' ? 1 : 0] }) },
};

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'https:' && !x.username && !x.password;
    } catch {
      return false;
    }
  }, 'Endpoint phải là URL https không chứa thông tin đăng nhập');

async function load(c: Ctx, id: string): Promise<PRow> {
  const r = (await getRt(c).db.query<PRow>(`SELECT ${P_SELECT} FROM partners p WHERE p.id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy đối tác.');
  return r;
}

export function partnerRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Lich phat can danh sach doi tac: cho phep partners:view hoac schedule:view
  r.get('/', requireAnyPerm(['partners', 'view'], ['schedule', 'view']), async (c) => {
    const res = await runList<PRow>(c, spec);
    return c.json({ ...res, items: res.items.map(present) });
  });
  r.get('/:id', requirePerm('partners', 'view'), async (c) => c.json(present(await load(c, c.req.param('id')))));

  const body = z.object({ name: z.string().trim().min(1, 'Nhập tên đối tác').max(120), protocol: z.string().trim().max(40).optional().nullable(), endpoint: httpsUrl.optional().nullable(), auth: z.string().max(200).optional().nullable(), floor_cpm_vnd: z.coerce.number().int().min(0).max(100_000_000).optional(), enabled: z.boolean().optional() });

  r.post('/', requirePerm('partners', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, body);
    if ((await rt.db.query('SELECT 1 AS x FROM partners WHERE LOWER(name) = ?', [b.name.toLowerCase()])).length) throw conflict('Tên đối tác đã tồn tại.', 'duplicate');
    const id = rt.id();
    await rt.db.tx(async (db) => {
      await db.run('INSERT INTO partners (id, name, protocol, endpoint, auth_ref, enabled, floor_cpm_vnd) VALUES (?,?,?,?,?,?,?)', [id, b.name, b.protocol ?? null, b.endpoint ?? null, b.auth ?? null, b.enabled === false ? 0 : 1, b.floor_cpm_vnd ?? 0]);
      await auditCtx(c, db, { action: 'partner.create', objectType: 'partner', objectId: id, diff: { name: b.name, protocol: b.protocol ?? null } });
    });
    return c.json(present(await load(c, id)), 201);
  });

  r.put('/:id', requirePerm('partners', 'write'), async (c) => {
    const rt = getRt(c);
    const p = await load(c, c.req.param('id'));
    const b = await parseBody(c, body.partial());
    if (b.name && b.name.toLowerCase() !== p.name.toLowerCase() && (await rt.db.query('SELECT 1 AS x FROM partners WHERE LOWER(name) = ? AND id <> ?', [b.name.toLowerCase(), p.id])).length) throw conflict('Tên đối tác đã tồn tại.', 'duplicate');
    if (b.floor_cpm_vnd !== undefined && b.floor_cpm_vnd < 0) throw unprocessable('Giá sàn không hợp lệ.', 'bad_floor');
    await rt.db.tx(async (db) => {
      await db.run('UPDATE partners SET name = ?, protocol = ?, endpoint = ?, auth_ref = ?, enabled = ?, floor_cpm_vnd = ? WHERE id = ?', [
        b.name ?? p.name,
        b.protocol !== undefined ? b.protocol : p.protocol,
        b.endpoint !== undefined ? b.endpoint : p.endpoint,
        b.auth !== undefined && b.auth !== '••••••••' ? b.auth : p.auth_ref,
        b.enabled === undefined ? p.enabled : b.enabled ? 1 : 0,
        b.floor_cpm_vnd ?? p.floor_cpm_vnd,
        p.id,
      ]);
      await auditCtx(c, db, { action: 'partner.update', objectType: 'partner', objectId: p.id, diff: diffObjects({ name: p.name, protocol: p.protocol, endpoint: p.endpoint, enabled: !!p.enabled, floor_cpm_vnd: p.floor_cpm_vnd, auth: '' }, { name: b.name, protocol: b.protocol, endpoint: b.endpoint, enabled: b.enabled, floor_cpm_vnd: b.floor_cpm_vnd, auth: b.auth !== undefined && b.auth !== '••••••••' ? 'x' : undefined }, ['auth']) });
    });
    return c.json(present(await load(c, p.id)));
  });
  return r;
}
