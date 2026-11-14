// Dinh gia phia API: nap bang gia/hop dong, chot gia luc duyet, bao gia. Ham thuan o @ams/shared/pricing.
import type { Db, Runtime } from '@ams/runtime';
import {
  ANY, PRICING_DAYPARTS, PRICING_SCREEN_TYPES, buildSnapshot, estimateImpressions, microToVndString, priceFallbackFromEnv,
  type ContractLinePrice, type RateCardRow, type SnapshotMissing, type SnapshotRow,
} from '@ams/shared';
import { unprocessable } from './errors.js';
import { jsonParse, num } from './http.js';
import { todayVn } from './dates.js';

type Q = Pick<Db, 'query'>;
const SCREEN_LABEL: Record<string, string> = { tv: 'TV', elevator: 'thang máy', led_p5: 'LED' };
const DAYPART_LABEL: Record<string, string> = { peak: 'giờ cao điểm', off_peak: 'giờ thường' };

export const RATE_CARD_COLS = 'id, customer_id, screen_type, region_id, daypart, model, price_micro_vnd, floor_micro_vnd, effective_from, effective_to, active, note, created_by, created_at';

export function toRateCardRow(r: Record<string, unknown>): RateCardRow {
  return {
    id: String(r['id']),
    customer_id: String(r['customer_id']),
    screen_type: String(r['screen_type']),
    region_id: String(r['region_id']),
    daypart: String(r['daypart']),
    model: String(r['model']),
    price_micro_vnd: num(r['price_micro_vnd']),
    floor_micro_vnd: num(r['floor_micro_vnd']),
    effective_from: String(r['effective_from']),
    effective_to: r['effective_to'] === null || r['effective_to'] === undefined ? null : String(r['effective_to']),
    active: num(r['active']),
  };
}

/** Dong bang gia dang co hieu luc tai `atIso` cho khach (dong chung '*' + dong rieng cua khach). */
export async function loadRateCards(db: Q, customerId: string | null, atIso: string): Promise<RateCardRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT ${RATE_CARD_COLS} FROM rate_cards WHERE active = 1 AND (customer_id = '*' OR customer_id = ?) AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)`,
    [customerId ?? '', atIso, atIso],
  );
  return rows.map(toRateCardRow);
}

/** Gia thoa thuan cua hop dong: chi khi hop dong cua dung khach, dang hieu luc va trong thoi han. null = khong ap dung. */
export async function loadContractLinePrices(rt: Runtime, db: Q, contractId: string | null, customerId: string | null): Promise<ContractLinePrice[] | null> {
  if (!contractId) return null;
  const ct = (await db.query<{ state: string; customer_id: string; start_date: string | null; end_date: string | null }>('SELECT state, customer_id, start_date, end_date FROM contracts WHERE id = ?', [contractId]))[0];
  if (!ct || ct.state !== 'active' || (customerId && ct.customer_id !== customerId)) return null;
  const today = todayVn(rt);
  if ((ct.start_date && ct.start_date > today) || (ct.end_date && ct.end_date < today)) return null;
  const lines = await db.query<{ id: string; screen_type: string | null; region_id: string | null; daypart: string | null; p: unknown }>(
    'SELECT cl.id, cl.screen_type, cl.region_id, cl.daypart, p.impression_price_micro_vnd AS p FROM contract_lines cl JOIN contract_line_prices p ON p.contract_line_id = cl.id WHERE cl.contract_id = ? ORDER BY cl.id',
    [contractId],
  );
  return lines.map((l) => ({ id: l.id, screen_type: l.screen_type, region_id: l.region_id, daypart: l.daypart, impression_price_micro_vnd: num(l.p) }));
}

export function campaignScreenTypes(targetTypes: string | null | undefined): string[] {
  const t = jsonParse<string[]>(targetTypes, ['tv']).filter((x) => (PRICING_SCREEN_TYPES as readonly string[]).includes(x));
  return t.length ? t : ['tv'];
}

export interface CampaignForPrice {
  id: string;
  customer_id: string;
  contract_id: string | null;
  target_types: string | null;
}

export interface PricePlan {
  rows: SnapshotRow[];
  missing: SnapshotMissing[];
  placeholder: boolean;
}

/** Tinh gia chot cho chien dich o thoi diem `atIso` (chua ghi). `missing` khong rong => chua chot duoc (production chua co bang gia). */
export async function planCampaignPrices(rt: Runtime, db: Q, camp: CampaignForPrice, atIso: string): Promise<PricePlan> {
  const [cards, lines] = await Promise.all([loadRateCards(db, camp.customer_id, atIso), loadContractLinePrices(rt, db, camp.contract_id, camp.customer_id)]);
  const { rows, missing } = buildSnapshot({
    customerId: camp.customer_id,
    screenTypes: campaignScreenTypes(camp.target_types),
    at: atIso,
    rateCards: cards,
    contractLines: lines,
    fallback: priceFallbackFromEnv(rt.config.env),
  });
  return { rows, missing, placeholder: rows.some((r) => r.source === 'placeholder') };
}

/** Ném 422 `no_rate_card` voi thong bao ro rang neu thieu gia (production chua cau hinh bang gia). */
export function assertPriced(plan: PricePlan): void {
  if (plan.missing.length === 0) return;
  const parts = plan.missing.map((m) => `${SCREEN_LABEL[m.screen_type] ?? m.screen_type} / ${DAYPART_LABEL[m.daypart] ?? m.daypart}`);
  throw unprocessable(
    `Chưa có bảng giá cho loại màn hình/khung giờ: ${[...new Set(parts)].join(', ')}. Quản trị viên tài chính cần tạo bảng giá (Cài đặt > Bảng giá) trước khi gửi duyệt hoặc duyệt chiến dịch.`,
    'no_rate_card',
    { missing: plan.missing },
  );
}

/** Ghi gia chot (xoa dong cu cua chien dich, ghi dong moi) trong giao dich `db` cua nguoi goi. */
export async function writeCampaignPrices(db: Db, campaignId: string, rows: readonly SnapshotRow[], by: string | null, nowIso: string): Promise<void> {
  await db.run('DELETE FROM campaign_prices WHERE campaign_id = ?', [campaignId]);
  for (const r of rows) {
    await db.run(
      `INSERT INTO campaign_prices (campaign_id, screen_type, region_id, daypart, unit_price_micro_vnd, floor_micro_vnd, list_price_micro_vnd, model, cpm_micro_vnd, source, source_ref, floored, resolved_by, resolved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [campaignId, r.screen_type, r.region_id, r.daypart, r.unit_price_micro_vnd, r.floor_micro_vnd, r.list_price_micro_vnd, r.model, r.cpm_micro_vnd, r.source, r.source_ref, r.floored ? 1 : 0, by, nowIso],
    );
  }
}

export async function loadSnapshot(db: Q, campaignId: string): Promise<(SnapshotRow & { resolved_at: string })[]> {
  const rows = await db.query<Record<string, unknown>>(
    'SELECT screen_type, region_id, daypart, unit_price_micro_vnd, floor_micro_vnd, list_price_micro_vnd, model, cpm_micro_vnd, source, source_ref, floored, resolved_at FROM campaign_prices WHERE campaign_id = ? ORDER BY screen_type, region_id, daypart',
    [campaignId],
  );
  return rows.map((r) => ({
    screen_type: String(r['screen_type']),
    region_id: String(r['region_id']),
    daypart: String(r['daypart']) as SnapshotRow['daypart'],
    unit_price_micro_vnd: num(r['unit_price_micro_vnd']),
    floor_micro_vnd: num(r['floor_micro_vnd']),
    list_price_micro_vnd: r['list_price_micro_vnd'] === null ? null : num(r['list_price_micro_vnd']),
    model: String(r['model']) as SnapshotRow['model'],
    cpm_micro_vnd: r['cpm_micro_vnd'] === null ? null : num(r['cpm_micro_vnd']),
    source: String(r['source']) as SnapshotRow['source'],
    source_ref: r['source_ref'] === null ? null : String(r['source_ref']),
    floored: num(r['floored']) === 1,
    resolved_at: String(r['resolved_at']),
  }));
}

export interface QuoteLine {
  screen_type: string;
  region_id: string;
  daypart: string;
  unit_price_micro_vnd: number;
  unit_price_vnd: string;
  model: string;
  cpm_micro_vnd: number | null;
  estimated_impressions: number | null;
  /** chi noi bo */
  floor_micro_vnd?: number;
  list_price_micro_vnd?: number | null;
  source?: string;
  source_ref?: string | null;
  floored?: boolean;
}
export interface Quote {
  /** locked = gia da chot luc duyet (khong doi nua); quoted = bao gia theo bang gia hien hanh, chot khi duyet */
  status: 'locked' | 'quoted' | 'unavailable';
  locked: boolean;
  resolved_at: string | null;
  budget_vnd: number | null;
  placeholder: boolean;
  lines: QuoteLine[];
  message: string | null;
}

export function quoteFromRows(rows: readonly (SnapshotRow & { resolved_at?: string })[], opts: { budgetVnd: number | null; locked: boolean; internal: boolean; placeholder?: boolean }): Quote {
  const lines: QuoteLine[] = rows.map((r) => ({
    screen_type: r.screen_type,
    region_id: r.region_id,
    daypart: r.daypart,
    unit_price_micro_vnd: r.unit_price_micro_vnd,
    unit_price_vnd: microToVndString(r.unit_price_micro_vnd),
    model: r.model,
    cpm_micro_vnd: r.cpm_micro_vnd,
    estimated_impressions: opts.budgetVnd ? estimateImpressions(opts.budgetVnd, r.unit_price_micro_vnd) : null,
    ...(opts.internal ? { floor_micro_vnd: r.floor_micro_vnd, list_price_micro_vnd: r.list_price_micro_vnd, source: r.source, source_ref: r.source_ref, floored: r.floored } : {}),
  }));
  return {
    status: opts.locked ? 'locked' : 'quoted',
    locked: opts.locked,
    resolved_at: rows[0]?.resolved_at ?? null,
    budget_vnd: opts.budgetVnd,
    placeholder: opts.placeholder ?? rows.some((r) => r.source === 'placeholder' || r.source === 'legacy'),
    lines,
    message: null,
  };
}

export const unavailableQuote = (plan: PricePlan, budgetVnd: number | null): Quote => ({
  status: 'unavailable', locked: false, resolved_at: null, budget_vnd: budgetVnd, placeholder: false, lines: [],
  message: `Chưa có bảng giá cho: ${[...new Set(plan.missing.map((m) => `${SCREEN_LABEL[m.screen_type] ?? m.screen_type} / ${DAYPART_LABEL[m.daypart] ?? m.daypart}`))].join(', ')}. Vui lòng liên hệ nhân viên kinh doanh.`,
});

export { ANY, PRICING_DAYPARTS };
