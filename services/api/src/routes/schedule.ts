import { Hono } from 'hono';
import { z } from 'zod';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { diffObjects } from '../lib/audit.js';
import { dbTarget } from '../lib/creative.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { eq, getRt, jsonParse, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

const S_SELECT = `s.id, s.campaign_id, s.partner_id, s.target_type, s.daypart, s.start_min, s.end_min, s.priority, s.reward_points, s.regions,
  c.name AS campaign_name, c.state AS campaign_state, c.target_types, p.name AS partner_name`;
const S_FROM = 'FROM schedule_slots s LEFT JOIN campaigns c ON c.id = s.campaign_id LEFT JOIN partners p ON p.id = s.partner_id';

interface SlotRow {
  id: string;
  campaign_id: string | null;
  partner_id: string | null;
  target_type: string | null;
  daypart: string | null;
  start_min: number | null;
  end_min: number | null;
  priority: number;
  reward_points: number;
  regions: string | null;
  campaign_name: string | null;
  campaign_state: string | null;
  target_types: string | null;
  partner_name: string | null;
}

const present = (s: SlotRow) => ({
  id: s.id,
  campaign_id: s.campaign_id,
  partner_id: s.partner_id,
  name: s.campaign_name ?? s.partner_name ?? s.id,
  target_type: s.target_type,
  daypart: s.daypart,
  start_min: num(s.start_min),
  end_min: num(s.end_min),
  priority: num(s.priority),
  reward_points: num(s.reward_points),
  regions: jsonParse<string[]>(s.regions, []),
  campaign_status: s.campaign_state === 'pending_review' ? 'pending' : s.campaign_state,
});

const spec: ListSpec = {
  from: S_FROM,
  select: S_SELECT,
  search: ['c.name', 'p.name'],
  sorts: { start_min: 's.start_min', end_min: 's.end_min', name: 'c.name', priority: 's.priority' },
  defaultSort: 'start_min:asc',
  tiebreak: 's.id',
  filters: { campaign_id: eq('s.campaign_id'), partner_id: eq('s.partner_id'), target_type: eq('s.target_type') },
};

// luoi 30 phut, trong ngay (PLAN: timeline keo tha buoc 30 phut)
const minute = z.coerce.number().int().min(0).max(1440).refine((n) => n % 30 === 0, 'Phải là bội số của 30 phút');
const times = z.object({ start_min: minute, end_min: minute });

async function loadSlot(c: Ctx, id: string): Promise<SlotRow> {
  const r = (await getRt(c).db.query<SlotRow>(`SELECT ${S_SELECT} ${S_FROM} WHERE s.id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy lịch phát.');
  return r;
}

export function scheduleRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('schedule', 'view'), async (c) => {
    const res = await runList<SlotRow>(c, spec);
    return c.json({ ...res, items: res.items.map(present) });
  });

  r.get('/:id', requirePerm('schedule', 'view'), async (c) => c.json(present(await loadSlot(c, c.req.param('id')))));

  r.post('/', requirePerm('schedule', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, times.extend({ campaign_id: z.string().min(1).max(64), priority: z.coerce.number().int().min(1).max(5).default(3), reward_points: z.coerce.number().int().min(0).max(100000).default(0), regions: z.array(z.string().max(10)).max(20).default([]) }));
    if (b.end_min <= b.start_min) throw unprocessable('Giờ kết thúc phải sau giờ bắt đầu.', 'bad_times');
    const camp = (await rt.db.query<{ state: string; target_types: string | null }>('SELECT state, target_types FROM campaigns WHERE id = ?', [b.campaign_id]))[0];
    if (!camp) throw unprocessable('Chiến dịch không tồn tại.', 'campaign_not_found');
    if (['rejected', 'ended'].includes(camp.state)) throw conflict('Không tạo lịch cho chiến dịch bị trả lại hoặc đã kết thúc.', 'invalid_state');
    const target = jsonParse<string[]>(camp.target_types, ['tv'])[0] ?? 'tv';
    const id = rt.id();
    await rt.db.tx(async (db) => {
      await db.run(
        'INSERT INTO schedule_slots (id, campaign_id, partner_id, screen_group_id, target_type, daypart, start_min, end_min, priority, reward_points, regions) VALUES (?,?,NULL,NULL,?,?,?,?,?,?,?)',
        [id, b.campaign_id, dbTarget(target), 'custom', b.start_min, b.end_min, b.priority, b.reward_points, JSON.stringify(b.regions)],
      );
      await auditCtx(c, db, { action: 'schedule.create', objectType: 'schedule_slot', objectId: id, diff: { campaign_id: b.campaign_id, start_min: b.start_min, end_min: b.end_min } });
    });
    return c.json(present(await loadSlot(c, id)), 201);
  });

  r.put('/:id', requirePerm('schedule', 'write'), async (c) => {
    const rt = getRt(c);
    const s = await loadSlot(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ start_min: minute.optional(), end_min: minute.optional(), priority: z.coerce.number().int().min(1).max(5).optional(), reward_points: z.coerce.number().int().min(0).max(100000).optional() }));
    const start = b.start_min ?? num(s.start_min);
    const end = b.end_min ?? num(s.end_min);
    if (end <= start) throw unprocessable('Giờ kết thúc phải sau giờ bắt đầu.', 'bad_times');
    await rt.db.tx(async (db) => {
      await db.run('UPDATE schedule_slots SET start_min = ?, end_min = ?, priority = ?, reward_points = ?, daypart = ? WHERE id = ?', [start, end, b.priority ?? s.priority, b.reward_points ?? s.reward_points, 'custom', s.id]);
      await auditCtx(c, db, { action: 'schedule.update', objectType: 'schedule_slot', objectId: s.id, diff: diffObjects({ start_min: num(s.start_min), end_min: num(s.end_min), priority: s.priority, reward_points: s.reward_points }, { start_min: start, end_min: end, priority: b.priority, reward_points: b.reward_points }) });
    });
    return c.json(present(await loadSlot(c, s.id)));
  });

  r.delete('/:id', requirePerm('schedule', 'delete'), async (c) => {
    const rt = getRt(c);
    const s = await loadSlot(c, c.req.param('id'));
    await rt.db.tx(async (db) => {
      await db.run('DELETE FROM schedule_slots WHERE id = ?', [s.id]);
      await auditCtx(c, db, { action: 'schedule.delete', objectType: 'schedule_slot', objectId: s.id, diff: { campaign_id: s.campaign_id } });
    });
    return c.json({ ok: true });
  });

  return r;
}
