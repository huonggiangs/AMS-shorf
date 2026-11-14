// Dinh gia (p1-pricing): ham thuan, dung chung cho API (chot gia luc duyet, bao gia) va gateway (tinh tien theo gia chot).
// Tien: micro-VND so nguyen (1 VND = 1.000.000). Xem docs/PRICING.md.
import { AD_FORMATS } from './overlay.js';

export const MICRO_PER_VND = 1_000_000;
/** Don gia TAM cu (20 VND/luot). Chi con duoc dung o local/test; production tu choi (xem placeholderAllowed). */
export const PLACEHOLDER_PRICE_MICRO_VND = 20_000_000;
export const PRICE_ENV_VAR = 'IMPRESSION_PRICE_MICRO_VND';

export const ANY = '*';
export const PRICING_SCREEN_TYPES = ['tv', 'elevator', 'led_p5'] as const;
export const PRICING_DAYPARTS = ['all_day', 'peak', 'off_peak', 'custom'] as const;
export const PRICING_FORMATS = AD_FORMATS;
export type PricingUnit = 'impression' | 'play';
export type PriceSource = 'contract' | 'rate_card' | 'tenant_default' | 'env_fallback' | 'placeholder';

export interface RateCardRow {
  id: string;
  tenant_id: string;
  screen_type: string;
  format: string;
  daypart: string;
  unit: string;
  price_micro_vnd: number;
  floor_micro_vnd: number;
  active: number;
}
export interface ContractLinePrice {
  id: string;
  screen_type: string | null;
  daypart: string | null;
  impression_price_micro_vnd: number;
}
export interface PriceQuery {
  tenantId: string | null;
  screenType: string;
  format: string;
  daypart: string;
}
export interface PriceFallback {
  /** gia tri bien moi truong IMPRESSION_PRICE_MICRO_VND neu duoc dat RO RANG (so nguyen > 0), nguoc lai null */
  envMicro: number | null;
  /** co cho dung don gia tam 20 VND khong (chi local/test) */
  allowPlaceholder: boolean;
}
export interface ResolvedPrice {
  unit: PricingUnit;
  /** gia tinh tien moi luot, DA ap gia san (>= floor) */
  unitPriceMicroVnd: number;
  floorMicroVnd: number;
  /** gia niem yet khop (null neu khong co dong bang gia nao khop) */
  listPriceMicroVnd: number | null;
  source: PriceSource;
  /** id dong bang gia / dong hop dong da dung */
  sourceRef: string | null;
  /** true neu gia thoa thuan/niem yet thap hon san va bi nang len san */
  floored: boolean;
  rateCardId: string | null;
}

const int = (v: unknown): number => {
  const n = typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Do cu the cua mot dong bang gia so voi truy van; -1 = khong khop. Thu tu uu tien: tenant rieng > loai man > dinh dang > khung gio. */
export function rateCardScore(r: RateCardRow, q: PriceQuery): number {
  if (int(r.active) !== 1 || r.unit !== 'impression') return -1;
  let s = 0;
  if (r.tenant_id !== ANY) {
    if (!q.tenantId || r.tenant_id !== q.tenantId) return -1;
    s += 8;
  }
  if (r.screen_type !== ANY) {
    if (r.screen_type !== q.screenType) return -1;
    s += 4;
  }
  if (r.format !== ANY) {
    if (r.format !== q.format) return -1;
    s += 2;
  }
  if (r.daypart !== ANY) {
    if (r.daypart !== q.daypart) return -1;
    s += 1;
  }
  return s;
}

/** Dong bang gia cu the nhat khop truy van (hoa: id nho hon thang, de ket qua on dinh). */
export function matchRateCard(rows: readonly RateCardRow[], q: PriceQuery): RateCardRow | null {
  let best: RateCardRow | null = null;
  let bestScore = -1;
  for (const r of rows) {
    const s = rateCardScore(r, q);
    if (s < 0) continue;
    if (s > bestScore || (s === bestScore && best !== null && r.id < best.id)) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}

/** Dong hop dong (co gia thoa thuan moi luot) cu the nhat khop loai man + khung gio; null = moi gia tri. */
export function matchContractLine(lines: readonly ContractLinePrice[], q: Pick<PriceQuery, 'screenType' | 'daypart'>): ContractLinePrice | null {
  let best: ContractLinePrice | null = null;
  let bestScore = -1;
  for (const l of lines) {
    if (int(l.impression_price_micro_vnd) <= 0) continue;
    let s = 0;
    if (l.screen_type) {
      if (l.screen_type !== q.screenType) continue;
      s += 2;
    }
    if (l.daypart) {
      if (l.daypart !== q.daypart) continue;
      s += 1;
    }
    if (s > bestScore || (s === bestScore && best !== null && l.id < best.id)) {
      best = l;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Chot don gia. Thu tu: (1) gia thoa thuan cua hop dong (neu chien dich gan hop dong va co dong khop);
 * (2) bang gia (dong cu the nhat; dong '*','*','*' = gia mac dinh cua tenant); (3) bien moi truong dat ro rang; (4) don gia tam (chi local/test).
 * Gia san = san cua dong bang gia khop (ap ca cho gia hop dong). Ket qua KHONG BAO GIO thap hon san. null = khong co gia nao dung duoc.
 */
export function resolveUnitPrice(q: PriceQuery, rateCards: readonly RateCardRow[], contractLines: readonly ContractLinePrice[] | null, fb: PriceFallback): ResolvedPrice | null {
  const card = matchRateCard(rateCards, q);
  const floor = card ? Math.max(0, int(card.floor_micro_vnd)) : 0;
  const list = card ? int(card.price_micro_vnd) : null;
  const done = (price: number, source: PriceSource, ref: string | null): ResolvedPrice => ({
    unit: 'impression',
    unitPriceMicroVnd: Math.max(price, floor),
    floorMicroVnd: floor,
    listPriceMicroVnd: list,
    source,
    sourceRef: ref,
    floored: price < floor,
    rateCardId: card?.id ?? null,
  });
  const line = contractLines ? matchContractLine(contractLines, q) : null;
  if (line) return done(int(line.impression_price_micro_vnd), 'contract', line.id);
  if (card) {
    const isDefault = card.screen_type === ANY && card.format === ANY && card.daypart === ANY;
    return done(int(card.price_micro_vnd), isDefault ? 'tenant_default' : 'rate_card', card.id);
  }
  if (fb.envMicro !== null && fb.envMicro > 0) return done(fb.envMicro, 'env_fallback', PRICE_ENV_VAR);
  if (fb.allowPlaceholder) return done(PLACEHOLDER_PRICE_MICRO_VND, 'placeholder', null);
  return null;
}

/** So tien tinh cho mot luot hop le theo gia chot: khong bao gio duoi san. */
export function chargeMicro(snapshot: { unitPriceMicroVnd: number; floorMicroVnd: number }): number {
  return Math.max(int(snapshot.unitPriceMicroVnd), int(snapshot.floorMicroVnd), 0);
}

/** So luot uoc tinh mua duoc voi ngan sach (VND) o don gia (micro-VND). */
export function estimateImpressions(budgetVnd: number, unitPriceMicroVnd: number): number {
  if (!(unitPriceMicroVnd > 0) || !(budgetVnd > 0)) return 0;
  return Number((BigInt(Math.floor(budgetVnd)) * BigInt(MICRO_PER_VND)) / BigInt(Math.round(unitPriceMicroVnd)));
}

/** Gia tri bien moi truong neu dat ro rang va hop le; null neu khong dat / khong hop le. */
export function explicitEnvPrice(env: Record<string, string | undefined>): number | null {
  const raw = (env[PRICE_ENV_VAR] ?? '').trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Don gia tam chi duoc dung o local/test (cung quy tac voi resolveAmsEnv cua @ams/db: khong dat AMS_ENV thi cloudflare/k8s = production). */
export function placeholderAllowed(env: Record<string, string | undefined>): boolean {
  const raw = (env['AMS_ENV'] ?? '').trim().toLowerCase();
  if (raw) return raw === 'local' || raw === 'test' || raw === 'dev' || raw === 'development';
  const rt = (env['RUNTIME'] ?? '').trim().toLowerCase();
  return !(rt === 'cloudflare' || rt === 'k8s');
}

export const priceFallbackFromEnv = (env: Record<string, string | undefined>): PriceFallback => ({ envMicro: explicitEnvPrice(env), allowPlaceholder: placeholderAllowed(env) });

/** Khung gio dinh gia cua chien dich tu cac slot: tat ca slot cung mot khung => khung do; nguoc lai 'all_day'. */
export function campaignDaypart(slotDayparts: readonly (string | null | undefined)[]): string {
  const set = new Set(slotDayparts.map((d) => d || 'all_day'));
  return set.size === 1 ? [...set][0]! : 'all_day';
}
