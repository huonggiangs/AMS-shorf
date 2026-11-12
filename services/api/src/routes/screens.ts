import { Hono } from 'hono';
import { z } from 'zod';
import { REGIONS } from '@ams/shared';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { diffObjects } from '../lib/audit.js';
import { ELEVATOR_PX, LED_MODULE_PX, parsePx } from '../lib/creative.js';
import { notFound, unprocessable } from '../lib/errors.js';
import { getRt, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import { regionCode } from './devices.js';
import type { AppEnv } from '../types.js';

// Moi dong "vi tri lap dat" = mot dia diem (venue) + cac man hinh cua dia diem do.
const AGG = `(SELECT venue_id, MIN(type) AS type, COUNT(*) AS n, MIN(diag_inch) AS diag_inch, MIN(width_mm) AS w_mm, MIN(height_mm) AS h_mm, MIN(px_w) AS px_w, MIN(px_h) AS px_h,
  MAX(CASE state WHEN 'offline' THEN 4 WHEN 'needs_update' THEN 3 WHEN 'checking' THEN 2 ELSE 1 END) AS worst FROM screens GROUP BY venue_id)`;
const V_SELECT = 'v.id, v.code, v.name, v.kind, v.region_id, v.address, v.created_at, s.type, s.n, s.diag_inch, s.w_mm, s.h_mm, s.px_w, s.px_h, s.worst';
const V_FROM = `FROM venues v JOIN ${AGG} s ON s.venue_id = v.id`;

interface VenueRow {
  id: string;
  code: string | null;
  name: string;
  kind: string;
  region_id: string | null;
  address: string | null;
  created_at: string;
  type: string;
  n: number;
  diag_inch: number | null;
  w_mm: number | null;
  h_mm: number | null;
  px_w: number | null;
  px_h: number | null;
  worst: number;
}

const STATUS = ['', 'online', 'checking', 'needs_update', 'offline'];
const STATE_DB: Record<string, string> = { online: 'active', checking: 'checking', needs_update: 'needs_update', offline: 'offline' };
const mFmt = (mm: number) => (mm / 1000).toFixed(2).replace('.', ',');

const present = (v: VenueRow) => {
  const led = v.type === 'led_p5';
  return {
    id: v.id,
    code: v.code,
    name: v.name,
    type: led ? 'led' : 'elevator',
    venue_kind: v.kind === 'parking' ? 'Bãi đỗ xe' : 'Chung cư',
    size: led ? (v.w_mm && v.h_mm ? `${mFmt(num(v.w_mm))} × ${mFmt(num(v.h_mm))} m` : null) : v.diag_inch ? `${num(v.diag_inch)}"` : null,
    resolution: v.px_w && v.px_h ? `${v.px_w}×${v.px_h}` : null,
    screens: num(v.n),
    region: v.region_id ? (REGIONS[v.region_id] ?? v.region_id) : null,
    region_id: v.region_id,
    address: v.address,
    status: STATUS[num(v.worst)] ?? 'online',
    created_at: v.created_at,
  };
};

const spec: ListSpec = {
  from: V_FROM,
  select: V_SELECT,
  search: ['v.name', 'v.code', 'v.address'],
  sorts: { name: 'v.name', type: 's.type', region: 'v.region_id', screens: 's.n', created_at: 'v.created_at' },
  defaultSort: 'name:asc',
  tiebreak: 'v.id',
  filters: {
    type: (v) => ({ sql: 's.type = ?', params: [v === 'led' || v === 'led_p5' ? 'led_p5' : 'elevator'] }),
    region: (v) => ({ sql: 'v.region_id = ?', params: [regionCode(v)] }),
    status: (v) => ({ sql: 's.worst = ?', params: [Math.max(1, STATUS.indexOf(v))] }),
  },
};

const createBody = z.object({
  name: z.string().trim().min(1, 'Nhập tên vị trí').max(300),
  type: z.enum(['elevator', 'led']),
  venue_kind: z.string().trim().max(40).default('Chung cư'),
  size: z.string().trim().max(60).optional().nullable(),
  resolution: z.string().trim().max(30),
  screens: z.coerce.number().int().min(1).max(200).default(1),
  region: z.string().trim().min(1).max(60),
  address: z.string().trim().max(500).optional().nullable(),
});

async function loadVenue(c: Ctx, id: string): Promise<VenueRow> {
  const r = (await getRt(c).db.query<VenueRow>(`SELECT ${V_SELECT} ${V_FROM} WHERE v.id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy vị trí lắp đặt.');
  return r;
}

export function screenRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('screens', 'view'), async (c) => {
    const res = await runList<VenueRow>(c, spec);
    return c.json({ ...res, items: res.items.map(present) });
  });

  r.get('/:id', requirePerm('screens', 'view'), async (c) => {
    const rt = getRt(c);
    const v = await loadVenue(c, c.req.param('id'));
    const screens = await rt.db.query('SELECT id, type, diag_inch, width_mm, height_mm, px_w, px_h, orientation, pixel_pitch_mm, brightness_nit, controller_kind, state, installed_at FROM screens WHERE venue_id = ? ORDER BY id', [v.id]);
    return c.json({ ...present(v), items: screens });
  });

  r.post('/', requirePerm('screens', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, createBody);
    const code = regionCode(b.region);
    if (!REGIONS[code]) throw unprocessable(`Khu vực không hợp lệ: ${b.region}.`, 'bad_region');
    const px = parsePx(b.resolution);
    if (!px) throw unprocessable('Độ phân giải phải theo dạng rộng×cao, ví dụ 1080×1920.', 'bad_resolution');
    const led = b.type === 'led';
    let diag: number | null = null;
    let wmm: number | null = null;
    let hmm: number | null = null;
    if (!led) {
      if (!ELEVATOR_PX.some((p) => p.w === px.w && p.h === px.h)) throw unprocessable('Màn hình thang máy chỉ nhận 768×1366 (18,5") hoặc 1080×1920 (21,5"/23,8").', 'bad_resolution');
      const d = b.size ? Number(b.size.replace(',', '.').replace(/[^\d.]/g, '')) : NaN;
      diag = [18.5, 21.5, 23.8].includes(d) ? d : px.w === 768 ? 18.5 : 21.5;
    } else {
      const m = b.size?.replace(/,/g, '.').match(/([\d.]+)\s*[×x]\s*([\d.]+)/i);
      wmm = m ? Math.round(Number(m[1]) * 1000) : px.w * 5;
      hmm = m ? Math.round(Number(m[2]) * 1000) : px.h * 5;
      if (Math.round(wmm / 5) !== px.w || Math.round(hmm / 5) !== px.h) throw unprocessable(`Độ phân giải LED P5 phải bằng kích thước mm / 5 (${Math.round(wmm / 5)}×${Math.round(hmm / 5)} px).`, 'bad_resolution');
      if (!LED_MODULE_PX.some((p) => p.w === px.w && p.h === px.h)) {
        // cho phep bang LED ghep, nhung phai la boi cua mo-dun 0,64 m (128 px)
        if (px.w % 64 !== 0 || px.h % 64 !== 0) throw unprocessable('Kích thước bảng LED phải là bội số của mô-đun 0,32 m (64 px).', 'bad_resolution');
      }
    }
    const kind = /bãi|bai|parking/i.test(b.venue_kind) ? 'parking' : 'apartment';
    const id = rt.id();
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run('INSERT INTO venues (id, code, name, kind, region_id, address, created_at) VALUES (?,?,?,?,?,?,?)', [id, `V-${id.slice(-8)}`, b.name, kind, code, b.address ?? b.name, nowIso]);
      await db.run('INSERT INTO screen_groups (id, venue_id, name) VALUES (?,?,?)', [rt.id(), id, b.name]);
      for (let i = 0; i < b.screens; i++) {
        await db.run(
          `INSERT INTO screens (id, venue_id, type, diag_inch, width_mm, height_mm, px_w, px_h, orientation, pixel_pitch_mm, brightness_nit, controller_kind, state, installed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'checking', ?)`,
          [rt.id(), id, led ? 'led_p5' : 'elevator', diag, wmm, hmm, px.w, px.h, px.w >= px.h ? 'landscape' : 'portrait', led ? 5.0 : null, led ? 6000 : 350, led ? 'novastar' : 'android_player', nowIso],
        );
      }
      await auditCtx(c, db, { action: 'screen.create', objectType: 'venue', objectId: id, diff: { name: b.name, type: b.type, screens: b.screens, resolution: `${px.w}x${px.h}`, region: code } });
    });
    return c.json(present(await loadVenue(c, id)), 201);
  });

  r.put('/:id', requirePerm('screens', 'write'), async (c) => {
    const rt = getRt(c);
    const v = await loadVenue(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ name: z.string().trim().min(1).max(300).optional(), region: z.string().trim().max(60).optional(), address: z.string().trim().max(500).optional(), status: z.enum(['online', 'checking', 'needs_update', 'offline']).optional() }));
    const code = b.region ? regionCode(b.region) : undefined;
    if (code && !REGIONS[code]) throw unprocessable(`Khu vực không hợp lệ: ${b.region}.`, 'bad_region');
    await rt.db.tx(async (db) => {
      if (b.name !== undefined || code !== undefined || b.address !== undefined) {
        await db.run('UPDATE venues SET name = ?, region_id = ?, address = ? WHERE id = ?', [b.name ?? v.name, code ?? v.region_id, b.address ?? v.address, v.id]);
      }
      if (b.status) await db.run('UPDATE screens SET state = ? WHERE venue_id = ?', [STATE_DB[b.status], v.id]);
      await auditCtx(c, db, { action: 'screen.update', objectType: 'venue', objectId: v.id, diff: diffObjects({ name: v.name, region: v.region_id, address: v.address }, { name: b.name, region: code, address: b.address, ...(b.status ? { status: b.status } : {}) }) });
    });
    return c.json(present(await loadVenue(c, v.id)));
  });

  return r;
}
