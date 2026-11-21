// Mau bo cuc da vung (kieu QuangBao Cloud): CRUD, quyen module `schedule`. Xem migrations/0021.
import { Hono } from 'hono';
import { z } from 'zod';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { notFound, unprocessable } from '../lib/errors.js';
import { getRt, jsonParse, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { orientationSchema, zonesSchema, type Zone } from '../lib/layout.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

interface Row {
  id: string;
  name: string;
  orientation: string;
  zones: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const present = (r: Row) => ({
  id: r.id,
  name: r.name,
  orientation: r.orientation,
  zones: jsonParse<Zone[]>(r.zones, []),
  system: r.id.startsWith('sys_'),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const spec: ListSpec = {
  from: 'FROM layout_templates t',
  select: 't.id, t.name, t.orientation, t.zones, t.created_by, t.created_at, t.updated_at',
  search: ['t.name'],
  sorts: { updated_at: 't.updated_at', name: 't.name' },
  defaultSort: 'updated_at:desc',
  tiebreak: 't.id',
  filters: {},
};

const body = z.object({ name: z.string().trim().min(1, 'Nhập tên mẫu').max(120), orientation: orientationSchema.default('landscape'), zones: zonesSchema });

/** Mau he thong (migration 0021, id 'sys_*') chi xem va dung, khong sua/xoa. */
const guardSystem = (id: string): void => {
  if (id.startsWith('sys_')) throw unprocessable('Đây là mẫu hệ thống, không sửa hoặc xóa được. Hãy dùng mẫu này để tạo chương trình hoặc tạo mẫu mới.', 'system_template');
};

async function load(c: Ctx, id: string): Promise<Row> {
  const r = (await getRt(c).db.query<Row>('SELECT id, name, orientation, zones, created_by, created_at, updated_at FROM layout_templates WHERE id = ?', [id]))[0];
  if (!r) throw notFound('Không tìm thấy mẫu bố cục.');
  return r;
}

export function layoutTemplateRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('schedule', 'view'), async (c) => {
    const res = await runList<Row>(c, spec);
    return c.json({ ...res, items: res.items.map(present) });
  });

  r.get('/:id', requirePerm('schedule', 'view'), async (c) => c.json(present(await load(c, c.req.param('id')))));

  r.post('/', requirePerm('schedule', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, body);
    const id = rt.id();
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run('INSERT INTO layout_templates (id, name, orientation, zones, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [id, b.name, b.orientation, JSON.stringify(b.zones), c.get('user').id, now, now]);
      await auditCtx(c, db, { action: 'layout_template.create', objectType: 'layout_template', objectId: id, diff: { name: b.name, zones: b.zones.length } });
    });
    return c.json(present(await load(c, id)), 201);
  });

  r.put('/:id', requirePerm('schedule', 'write'), async (c) => {
    const rt = getRt(c);
    const cur = await load(c, c.req.param('id'));
    guardSystem(cur.id);
    const b = await parseBody(c, body.partial());
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run('UPDATE layout_templates SET name = ?, orientation = ?, zones = ?, updated_at = ? WHERE id = ?', [b.name ?? cur.name, b.orientation ?? cur.orientation, b.zones ? JSON.stringify(b.zones) : (cur.zones ?? '[]'), now, cur.id]);
      await auditCtx(c, db, { action: 'layout_template.update', objectType: 'layout_template', objectId: cur.id, diff: { name: b.name ?? cur.name } });
    });
    return c.json(present(await load(c, cur.id)));
  });

  r.delete('/:id', requirePerm('schedule', 'delete'), async (c) => {
    const rt = getRt(c);
    const cur = await load(c, c.req.param('id'));
    guardSystem(cur.id);
    await rt.db.tx(async (db) => {
      await db.run('DELETE FROM layout_templates WHERE id = ?', [cur.id]);
      await auditCtx(c, db, { action: 'layout_template.delete', objectType: 'layout_template', objectId: cur.id, diff: { name: cur.name } });
    });
    return c.json({ ok: true });
  });

  return r;
}
