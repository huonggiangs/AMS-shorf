// Bang gia (rate cards) + bao gia (p1-pricing). Doi gia = tao phien ban moi (effective-dated), khong sua dong cu. Quyen ghi: finance:approve (nhom "finance manage").
import { Hono } from 'hono';
import { z } from 'zod';
import { ANY, PRICING_DAYPARTS, PRICING_SCREEN_TYPES, microToVndString, type RateCardRow } from '@ams/shared';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { eq, getRt, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { RATE_CARD_COLS, planCampaignPrices, quoteFromRows, unavailableQuote } from '../lib/pricing.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

const MAX_MICRO = 1_000_000_000_000; // 1 trieu VND/luot: tran chong nhap nham
const MICRO_SCALE = 1_000_000;

/** "20", "20.5", "0,000001" -> micro-VND nguyen (khong qua so thuc). */
export function vndToMicro(v: string | number): number {
  const s = String(v).trim().replace(',', '.');
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw unprocessable('Giá phải là số dương, tối đa 6 chữ số thập phân (đồng).', 'bad_price');
  return Number(BigInt(m[1]!) * BigInt(MICRO_SCALE) + BigInt((m[2] ?? '').padEnd(6, '0') || '0'));
}

const micro = z.coerce.number().int('Giá phải là số nguyên micro-VND').min(0).max(MAX_MICRO);
const iso = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s) && !Number.isNaN(Date.parse(s)), 'Thời điểm phải dạng ISO UTC (YYYY-MM-DDTHH:mm:ssZ)');
const keyFields = {
  customer_id: z.string().min(1).max(64).default(ANY),
  screen_type: z.enum(['*', ...PRICING_SCREEN_TYPES]).default(ANY),
  region_id: z.string().min(1).max(16).default(ANY),
  daypart: z.enum(['*', ...PRICING_DAYPARTS]).default(ANY),
};
const priceFields = {
  model: z.enum(['per_impression', 'cpm']).default('per_impression'),
  price_micro_vnd: micro.optional(),
  price_vnd: z.union([z.string(), z.number()]).optional(),
  floor_micro_vnd: micro.optional(),
  floor_vnd: z.union([z.string(), z.number()]).optional(),
  effective_from: iso.optional(),
  note: z.string().trim().max(500).optional().nullable(),
};
const createBody = z.object({ ...keyFields, ...priceFields });
const reviseBody = z.object({ model: priceFields.model.optional(), price_micro_vnd: priceFields.price_micro_vnd, price_vnd: priceFields.price_vnd, floor_micro_vnd: priceFields.floor_micro_vnd, floor_vnd: priceFields.floor_vnd, effective_from: priceFields.effective_from, note: priceFields.note });

interface CardRow extends Record<string, unknown> {
  id: string;
  customer_id: string;
  screen_type: string;
  region_id: string;
  daypart: string;
  model: string;
  price_micro_vnd: unknown;
  floor_micro_vnd: unknown;
  effective_from: string;
  effective_to: string | null;
  active: unknown;
  note: string | null;
  created_by: string | null;
  created_at: string;
  customer_name?: string | null;
}

function statusOf(r: CardRow, nowIso: string): 'inactive' | 'scheduled' | 'current' | 'expired' {
  if (num(r.active) !== 1) return 'inactive';
  if (r.effective_from > nowIso) return 'scheduled';
  if (r.effective_to !== null && r.effective_to <= nowIso) return 'expired';
  return 'current';
}
const present = (r: CardRow, nowIso: string) => {
  const price = num(r.price_micro_vnd);
  return {
    id: r.id,
    customer_id: r.customer_id,
    customer_name: r.customer_name ?? null,
    screen_type: r.screen_type,
    region_id: r.region_id,
    daypart: r.daypart,
    model: r.model,
    price_micro_vnd: price,
    price_vnd: microToVndString(price),
    floor_micro_vnd: num(r.floor_micro_vnd),
    floor_vnd: microToVndString(num(r.floor_micro_vnd)),
    effective_from: r.effective_from,
    effective_to: r.effective_to,
    status: statusOf(r, nowIso),
    note: r.note,
    created_by: r.created_by,
    created_at: r.created_at,
  };
};

const spec = (nowIso: string): ListSpec => ({
  from: "FROM rate_cards rc LEFT JOIN customers cu ON cu.id = rc.customer_id",
  select: 'rc.id, rc.customer_id, cu.short_name AS customer_name, rc.screen_type, rc.region_id, rc.daypart, rc.model, rc.price_micro_vnd, rc.floor_micro_vnd, rc.effective_from, rc.effective_to, rc.active, rc.note, rc.created_by, rc.created_at',
  search: ['rc.note', 'rc.region_id'],
  sorts: { effective_from: 'rc.effective_from', screen_type: 'rc.screen_type', region_id: 'rc.region_id', daypart: 'rc.daypart', price: 'rc.price_micro_vnd', created_at: 'rc.created_at' },
  defaultSort: 'effective_from:desc',
  tiebreak: 'rc.id',
  filters: {
    screen_type: eq('rc.screen_type'),
    region_id: eq('rc.region_id'),
    daypart: eq('rc.daypart'),
    customer_id: eq('rc.customer_id'),
    // current=1: chi dong dang co hieu luc luc nay
    current: (v) => (v === '1' ? { sql: 'rc.active = 1 AND rc.effective_from <= ? AND (rc.effective_to IS NULL OR rc.effective_to > ?)', params: [nowIso, nowIso] } : null),
  },
});

async function loadCard(c: Ctx, id: string): Promise<CardRow> {
  const r = (await getRt(c).db.query<CardRow>(`SELECT ${RATE_CARD_COLS} FROM rate_cards WHERE id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy dòng bảng giá.');
  return r;
}

function priceOf(b: { price_micro_vnd?: number; price_vnd?: string | number }, fallback?: number): number {
  const p = b.price_micro_vnd !== undefined ? b.price_micro_vnd : b.price_vnd !== undefined ? vndToMicro(b.price_vnd) : fallback;
  if (p === undefined || !Number.isSafeInteger(p) || p <= 0) throw unprocessable('Nhập giá lớn hơn 0.', 'price_required');
  if (p > MAX_MICRO) throw unprocessable('Giá quá lớn.', 'price_too_large');
  return p;
}
function floorOf(b: { floor_micro_vnd?: number; floor_vnd?: string | number }, fallback = 0): number {
  const f = b.floor_micro_vnd !== undefined ? b.floor_micro_vnd : b.floor_vnd !== undefined ? vndToMicro(b.floor_vnd) : fallback;
  if (!Number.isSafeInteger(f) || f < 0) throw unprocessable('Giá sàn không hợp lệ.', 'bad_floor');
  return f;
}
/** Gia san la gia MOI LUOT; gia niem yet (quy ra luot) phai >= san. */
function assertFloor(model: string, price: number, floor: number): void {
  const perImp = model === 'cpm' ? Math.floor((price + 999) / 1000) : price;
  if (perImp < floor) throw unprocessable('Giá niêm yết (quy ra mỗi lượt) không được thấp hơn giá sàn.', 'price_below_floor', { unit_micro_vnd: perImp, floor_micro_vnd: floor });
}

/** Tao phien ban moi cho khoa (customer, screen, region, daypart): dong lai phien ban dang chay tai `from`. Trong giao dich cua nguoi goi. */
async function insertVersion(c: Ctx, key: { customer_id: string; screen_type: string; region_id: string; daypart: string }, v: { model: string; price: number; floor: number; from: string; note: string | null }, action: string): Promise<string> {
  const rt = getRt(c);
  const nowIso = rt.clock.now().toISOString();
  const id = rt.id();
  await rt.db.tx(async (db) => {
    const clash = await db.query<{ id: string; effective_from: string }>(
      'SELECT id, effective_from FROM rate_cards WHERE customer_id = ? AND screen_type = ? AND region_id = ? AND daypart = ? AND effective_from >= ? AND active = 1',
      [key.customer_id, key.screen_type, key.region_id, key.daypart, v.from],
    );
    if (clash.length) throw conflict('Đã có phiên bản giá hiệu lực từ thời điểm này hoặc muộn hơn cho cùng loại màn/khu vực/khung giờ. Chọn thời điểm hiệu lực muộn hơn.', 'version_clash', { existing: clash[0]!.id });
    const prev = await db.query<CardRow>(
      `SELECT ${RATE_CARD_COLS} FROM rate_cards WHERE customer_id = ? AND screen_type = ? AND region_id = ? AND daypart = ? AND active = 1 AND effective_from < ? AND (effective_to IS NULL OR effective_to > ?)`,
      [key.customer_id, key.screen_type, key.region_id, key.daypart, v.from, v.from],
    );
    for (const p of prev) await db.run('UPDATE rate_cards SET effective_to = ? WHERE id = ?', [v.from, p.id]);
    await db.run(
      `INSERT INTO rate_cards (id, customer_id, screen_type, region_id, daypart, model, price_micro_vnd, floor_micro_vnd, effective_from, effective_to, active, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,NULL,1,?,?,?)`,
      [id, key.customer_id, key.screen_type, key.region_id, key.daypart, v.model, v.price, v.floor, v.from, v.note, c.get('user').id, nowIso],
    );
    await auditCtx(c, db, {
      action, objectType: 'rate_card', objectId: id,
      diff: { ...key, model: v.model, price_micro_vnd: v.price, floor_micro_vnd: v.floor, effective_from: v.from, closed: prev.map((p) => ({ id: p.id, price_micro_vnd: num(p.price_micro_vnd), effective_to: v.from })) },
    });
  });
  return id;
}

async function assertCustomerExists(c: Ctx, customerId: string): Promise<void> {
  if (customerId === ANY) return;
  if (!(await getRt(c).db.query('SELECT 1 AS x FROM customers WHERE id = ?', [customerId])).length) throw unprocessable('Khách hàng không tồn tại.', 'customer_not_found');
}

export function rateCardRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/', requirePerm('finance', 'view'), async (c) => {
    const nowIso = getRt(c).clock.now().toISOString();
    const res = await runList<CardRow>(c, spec(nowIso));
    return c.json({ ...res, items: res.items.map((x) => present(x, nowIso)) });
  });
  r.get('/:id', requirePerm('finance', 'view'), async (c) => c.json(present(await loadCard(c, c.req.param('id')), getRt(c).clock.now().toISOString())));

  r.post('/', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, createBody);
    await assertCustomerExists(c, b.customer_id);
    const price = priceOf(b);
    const floor = floorOf(b);
    assertFloor(b.model, price, floor);
    const nowIso = rt.clock.now().toISOString();
    const from = b.effective_from ?? nowIso;
    if (from < new Date(Date.parse(nowIso) - 60_000).toISOString()) throw unprocessable('Không đặt thời điểm hiệu lực trong quá khứ (giá cũ đã áp cho chiến dịch hiện có).', 'effective_in_past');
    const id = await insertVersion(c, { customer_id: b.customer_id, screen_type: b.screen_type, region_id: b.region_id, daypart: b.daypart }, { model: b.model, price, floor, from, note: b.note ?? null }, 'rate_card.create');
    return c.json(present(await loadCard(c, id), nowIso), 201);
  });

  // "Sua" = tao phien ban moi tu dong hien co (dong cu giu nguyen, ket thuc tai effective_from moi)
  r.put('/:id', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const cur = await loadCard(c, c.req.param('id'));
    if (num(cur.active) !== 1) throw conflict('Dòng bảng giá đã bị vô hiệu.', 'inactive');
    const b = await parseBody(c, reviseBody);
    const model = b.model ?? cur.model;
    const price = priceOf(b, num(cur.price_micro_vnd));
    const floor = floorOf(b, num(cur.floor_micro_vnd));
    assertFloor(model, price, floor);
    const nowIso = rt.clock.now().toISOString();
    const from = b.effective_from ?? nowIso;
    if (from < new Date(Date.parse(nowIso) - 60_000).toISOString()) throw unprocessable('Không đặt thời điểm hiệu lực trong quá khứ.', 'effective_in_past');
    const id = await insertVersion(c, { customer_id: cur.customer_id, screen_type: cur.screen_type, region_id: cur.region_id, daypart: cur.daypart }, { model, price, floor, from, note: b.note === undefined ? cur.note : b.note }, 'rate_card.revise');
    return c.json(present(await loadCard(c, id), nowIso), 201);
  });

  // Ket thuc dong gia (khong xoa vat ly: lich su gia phuc vu doi soat/tranh chap)
  r.delete('/:id', requirePerm('finance', 'approve'), async (c) => {
    const rt = getRt(c);
    const cur = await loadCard(c, c.req.param('id'));
    const nowIso = rt.clock.now().toISOString();
    if (num(cur.active) !== 1 || (cur.effective_to !== null && cur.effective_to <= nowIso)) throw conflict('Dòng bảng giá đã kết thúc.', 'already_ended');
    const future = cur.effective_from > nowIso;
    await rt.db.tx(async (db) => {
      if (future) await db.run('UPDATE rate_cards SET active = 0, effective_to = effective_from WHERE id = ?', [cur.id]);
      else await db.run('UPDATE rate_cards SET effective_to = ? WHERE id = ?', [nowIso, cur.id]);
      await auditCtx(c, db, { action: 'rate_card.end', objectType: 'rate_card', objectId: cur.id, diff: { price_micro_vnd: num(cur.price_micro_vnd), effective_to: future ? cur.effective_from : nowIso, cancelled_future_version: future } });
    });
    return c.json({ ok: true });
  });
  return r;
}
