import { Hono } from 'hono';
import { z } from 'zod';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, notFound } from '../lib/errors.js';
import { getRt, num, parseBody, runList } from '../lib/http.js';
import type { ListSpec } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

interface FRow {
  id: string;
  category: string;
  floor_cpm_vnd: number;
  updated_at: string;
}
const spec: ListSpec = {
  from: 'FROM rtb_floors f',
  select: 'f.id, f.category, f.floor_cpm_vnd, f.updated_at',
  search: ['f.category'],
  sorts: { category: 'f.category', floor_cpm_vnd: 'f.floor_cpm_vnd' },
  defaultSort: 'category:asc',
  tiebreak: 'f.id',
  filters: {},
};
const price = z.coerce.number().int('Giá sàn phải là số nguyên đồng').min(0).max(100_000_000);

export function rtbFloorRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/', requirePerm('partners', 'view'), async (c) => {
    const res = await runList<FRow>(c, spec);
    return c.json({ ...res, items: res.items.map((f) => ({ id: f.id, category: f.category, floor_cpm_vnd: num(f.floor_cpm_vnd), updated_at: f.updated_at, fill_rate: null })) });
  });
  r.post('/', requirePerm('partners', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ category: z.string().trim().min(1).max(80), floor_cpm_vnd: price }));
    if ((await rt.db.query('SELECT 1 AS x FROM rtb_floors WHERE category = ?', [b.category])).length) throw conflict('Danh mục đã có giá sàn.', 'duplicate');
    const id = rt.id();
    await rt.db.tx(async (db) => {
      await db.run('INSERT INTO rtb_floors (id, category, floor_cpm_vnd, updated_by, updated_at) VALUES (?,?,?,?,?)', [id, b.category, b.floor_cpm_vnd, c.get('user').id, rt.clock.now().toISOString()]);
      await auditCtx(c, db, { action: 'rtb_floor.create', objectType: 'rtb_floor', objectId: id, diff: b });
    });
    return c.json({ id, category: b.category, floor_cpm_vnd: b.floor_cpm_vnd }, 201);
  });
  r.put('/:id', requirePerm('partners', 'write'), async (c) => {
    const rt = getRt(c);
    const f = (await rt.db.query<FRow>('SELECT id, category, floor_cpm_vnd, updated_at FROM rtb_floors WHERE id = ?', [c.req.param('id')]))[0];
    if (!f) throw notFound('Không tìm thấy giá sàn.');
    const b = await parseBody(c, z.object({ floor_cpm_vnd: price }));
    await rt.db.tx(async (db) => {
      await db.run('UPDATE rtb_floors SET floor_cpm_vnd = ?, updated_by = ?, updated_at = ? WHERE id = ?', [b.floor_cpm_vnd, c.get('user').id, rt.clock.now().toISOString(), f.id]);
      await auditCtx(c, db, { action: 'rtb_floor.update', objectType: 'rtb_floor', objectId: f.id, diff: { category: f.category, floor_cpm_vnd: { from: num(f.floor_cpm_vnd), to: b.floor_cpm_vnd } } });
    });
    return c.json({ id: f.id, category: f.category, floor_cpm_vnd: b.floor_cpm_vnd });
  });
  return r;
}
