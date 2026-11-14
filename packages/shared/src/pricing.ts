// Dinh gia (p1-pricing): ham thuan, dung chung cho API (chot gia luc duyet, bao gia) va gateway (tinh tien theo gia chot).
// Tien: micro-VND SO NGUYEN (1 VND = 1.000.000), KHONG so thuc. Xem docs/PRICING.md.
export const MICRO_PER_VND = 1_000_000;
/** Don gia TAM cu (20 VND/luot). Chi duoc dung o local/test khi CHUA co bang gia; production tu choi (xem placeholderAllowed). */
export const PLACEHOLDER_PRICE_MICRO_VND = 20_000_000;
export const PRICE_ENV_VAR = 'IMPRESSION_PRICE_MICRO_VND';

export const ANY = '*';
export const PRICING_SCREEN_TYPES = ['tv', 'elevator', 'led_p5'] as const;
/** Khung gio cu the cua mot luot phat (tinh theo gio Viet Nam cua su kien). '*' chi dung o dong bang gia (ap cho moi khung). */
export const PRICING_DAYPARTS = ['peak', 'off_peak'] as const;
export type PricingDaypart = (typeof PRICING_DAYPARTS)[number];
export const RATE_CARD_DAYPARTS = [ANY, ...PRICING_DAYPARTS] as const;
export type PricingModel = 'per_impression' | 'cpm';
export const PRICING_MODELS: readonly PricingModel[] = ['per_impression', 'cpm'];
export type PriceSource = 'contract' | 'rate_card' | 'default_card' | 'placeholder' | 'legacy';

/** Gio cao diem: [17:00, 22:00) gio Viet Nam (bao gom 17:00:00.000, KHONG bao gom 22:00:00.000). Cac gio con lai la off_peak. Co dinh trong ma de gia chot khong doi am tham. */
export const PEAK_START_MIN = 17 * 60;
export const PEAK_END_MIN = 22 * 60;
const VN_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;

/** Phut trong ngay (0..1439) theo gio Viet Nam (UTC+7, khong doi gio mua he). */
export function vnMinuteOfDay(ms: number): number {
  return Math.floor((((ms + VN_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60_000);
}
/** Khung gio cua mot thoi diem: peak neu 17:00 <= gio VN < 22:00. */
export function daypartAt(ms: number): PricingDaypart {
  const m = vnMinuteOfDay(ms);
  return m >= PEAK_START_MIN && m < PEAK_END_MIN ? 'peak' : 'off_peak';
}

export interface RateCardRow {
  id: string;
  customer_id: string; // '*' = moi khach
  screen_type: string; // '*' | tv | elevator | led_p5
  region_id: string; // '*' | ma khu vuc
  daypart: string; // '*' | peak | off_peak
  model: string; // per_impression: price = micro-VND moi luot; cpm: price = micro-VND moi 1.000 luot
  price_micro_vnd: number;
  floor_micro_vnd: number; // san MOI LUOT
  effective_from: string;
  effective_to: string | null;
  active: number;
}
export interface ContractLinePrice {
  id: string;
  screen_type: string | null;
  region_id: string | null;
  daypart: string | null; // null / 'all_day' / '*' = moi khung
  impression_price_micro_vnd: number;
}
export interface PriceQuery {
  customerId: string | null;
  screenType: string;
  region: string; // '*' = khong gan khu vuc
  daypart: string;
  /** thoi diem tinh hieu luc (ISO) */
  at: string;
}
export interface PriceFallback {
  /** chi local/test: gia khi CHUA co bang gia. null = khong cho (production). */
  placeholderMicro: number | null;
}
export interface ResolvedPrice {
  /** gia tinh tien moi luot, DA ap gia san (>= floor), micro-VND nguyen */
  unitPriceMicroVnd: number;
  floorMicroVnd: number;
  /** gia niem yet moi luot cua dong bang gia khop (null neu khong co) */
  listPriceMicroVnd: number | null;
  model: PricingModel;
  /** gia CPM goc (micro-VND/1.000 luot) neu dong bang gia la CPM */
  cpmMicroVnd: number | null;
  source: PriceSource;
  /** id dong bang gia / dong hop dong da dung */
  sourceRef: string | null;
  /** true neu gia thoa thuan/niem yet thap hon san va bi nang len san */
  floored: boolean;
}

const int = (v: unknown): number => {
  const n = typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Don gia moi luot tu mot dong bang gia: per_impression = nguyen gia; cpm = LAM TRON LEN (ceil) cua gia/1.000 de luon la so nguyen micro-VND (lech toi da 1 micro-VND = 0,000001 d moi luot). */
export function unitFromCard(model: string, priceMicro: number): number {
  const p = int(priceMicro);
  if (p <= 0) return 0;
  if (model === 'cpm') return Math.floor((p + 999) / 1000);
  return p;
}

/** Dong bang gia con hieu luc tai thoi diem `at` (effective_from <= at < effective_to) va dang bat. */
export function isEffective(r: Pick<RateCardRow, 'active' | 'effective_from' | 'effective_to'>, at: string): boolean {
  if (int(r.active) !== 1) return false;
  if (r.effective_from > at) return false;
  if (r.effective_to !== null && r.effective_to !== undefined && r.effective_to <= at) return false;
  return true;
}

/** Do cu the cua mot dong bang gia so voi truy van; -1 = khong khop. Thu tu uu tien: khach rieng (8) > loai man (4) > khu vuc (2) > khung gio (1). */
export function rateCardScore(r: RateCardRow, q: PriceQuery): number {
  if (!isEffective(r, q.at)) return -1;
  let s = 0;
  if (r.customer_id !== ANY) {
    if (!q.customerId || r.customer_id !== q.customerId) return -1;
    s += 8;
  }
  if (r.screen_type !== ANY) {
    if (r.screen_type !== q.screenType) return -1;
    s += 4;
  }
  if (r.region_id !== ANY) {
    if (r.region_id !== q.region) return -1;
    s += 2;
  }
  if (r.daypart !== ANY) {
    if (r.daypart !== q.daypart) return -1;
    s += 1;
  }
  return s;
}

/** Dong bang gia cu the nhat khop truy van. Hoa: effective_from muon hon thang, roi id nho hon (on dinh, xac dinh). */
export function matchRateCard(rows: readonly RateCardRow[], q: PriceQuery): RateCardRow | null {
  let best: RateCardRow | null = null;
  let bestScore = -1;
  for (const r of rows) {
    const s = rateCardScore(r, q);
    if (s < 0) continue;
    if (
      s > bestScore ||
      (s === bestScore && best !== null && (r.effective_from > best.effective_from || (r.effective_from === best.effective_from && r.id < best.id)))
    ) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}

const isAnyLine = (v: string | null | undefined): boolean => !v || v === ANY || v === 'all_day';

/** Dong hop dong (co gia thoa thuan moi luot) cu the nhat khop loai man + khu vuc + khung gio; null/'*'/'all_day' = moi gia tri. */
export function matchContractLine(lines: readonly ContractLinePrice[], q: Pick<PriceQuery, 'screenType' | 'region' | 'daypart'>): ContractLinePrice | null {
  let best: ContractLinePrice | null = null;
  let bestScore = -1;
  for (const l of lines) {
    if (int(l.impression_price_micro_vnd) <= 0) continue;
    let s = 0;
    if (!isAnyLine(l.screen_type)) {
      if (l.screen_type !== q.screenType) continue;
      s += 4;
    }
    if (!isAnyLine(l.region_id)) {
      if (l.region_id !== q.region) continue;
      s += 2;
    }
    if (!isAnyLine(l.daypart)) {
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
 * Chot don gia cho mot (loai man, khu vuc, khung gio). Thu tu:
 *  (1) gia thoa thuan cua dong hop dong khop (neu chien dich gan hop dong) — thang bang gia;
 *  (2) bang gia: dong cu the nhat con hieu luc (dong ('*','*','*','*') = gia mac dinh);
 *  (3) don gia tam (CHI khi `fb.placeholderMicro` != null, tuc local/test).
 * Gia san = san cua dong bang gia khop (ap ca cho gia hop dong). Ket qua KHONG BAO GIO thap hon san.
 * Hop dong KHONG co dong bang gia khop thi khong co san => van phai co bang gia (production: null => tu choi).
 */
export function resolveUnitPrice(q: PriceQuery, rateCards: readonly RateCardRow[], contractLines: readonly ContractLinePrice[] | null, fb: PriceFallback): ResolvedPrice | null {
  const card = matchRateCard(rateCards, q);
  if (!card) {
    if (fb.placeholderMicro !== null && fb.placeholderMicro > 0) {
      return { unitPriceMicroVnd: fb.placeholderMicro, floorMicroVnd: 0, listPriceMicroVnd: null, model: 'per_impression', cpmMicroVnd: null, source: 'placeholder', sourceRef: null, floored: false };
    }
    return null;
  }
  const floor = Math.max(0, int(card.floor_micro_vnd));
  const list = unitFromCard(card.model, card.price_micro_vnd);
  const model: PricingModel = card.model === 'cpm' ? 'cpm' : 'per_impression';
  const cpm = model === 'cpm' ? int(card.price_micro_vnd) : null;
  const done = (price: number, source: PriceSource, ref: string): ResolvedPrice => ({
    unitPriceMicroVnd: Math.max(price, floor),
    floorMicroVnd: floor,
    listPriceMicroVnd: list,
    model,
    cpmMicroVnd: cpm,
    source,
    sourceRef: ref,
    floored: price < floor,
  });
  const line = contractLines ? matchContractLine(contractLines, q) : null;
  if (line) return done(int(line.impression_price_micro_vnd), 'contract', line.id);
  const isDefault = card.customer_id === ANY && card.screen_type === ANY && card.region_id === ANY && card.daypart === ANY;
  return done(list, isDefault ? 'default_card' : 'rate_card', card.id);
}

export interface SnapshotRow {
  screen_type: string;
  region_id: string;
  daypart: PricingDaypart;
  unit_price_micro_vnd: number;
  floor_micro_vnd: number;
  list_price_micro_vnd: number | null;
  model: PricingModel;
  cpm_micro_vnd: number | null;
  source: PriceSource;
  source_ref: string | null;
  floored: boolean;
}
export interface SnapshotMissing {
  screen_type: string;
  daypart: PricingDaypart;
}

/**
 * Gia chot cua chien dich: voi moi loai man muc tieu x khung gio (peak/off_peak) tinh gia o khu vuc '*' (bat buoc co), va them dong rieng cho moi khu vuc
 * co dong bang gia/hop dong rieng NEU gia khac gia '*'. `missing` khong rong => khong chot duoc (chua co bang gia phu).
 */
export function buildSnapshot(input: {
  customerId: string | null;
  screenTypes: readonly string[];
  at: string;
  rateCards: readonly RateCardRow[];
  contractLines: readonly ContractLinePrice[] | null;
  fallback: PriceFallback;
}): { rows: SnapshotRow[]; missing: SnapshotMissing[] } {
  const regions = new Set<string>();
  for (const r of input.rateCards) if (r.region_id !== ANY) regions.add(r.region_id);
  for (const l of input.contractLines ?? []) if (!isAnyLine(l.region_id)) regions.add(l.region_id as string);
  const rows: SnapshotRow[] = [];
  const missing: SnapshotMissing[] = [];
  const toRow = (st: string, region: string, dp: PricingDaypart, p: ResolvedPrice): SnapshotRow => ({
    screen_type: st,
    region_id: region,
    daypart: dp,
    unit_price_micro_vnd: p.unitPriceMicroVnd,
    floor_micro_vnd: p.floorMicroVnd,
    list_price_micro_vnd: p.listPriceMicroVnd,
    model: p.model,
    cpm_micro_vnd: p.cpmMicroVnd,
    source: p.source,
    source_ref: p.sourceRef,
    floored: p.floored,
  });
  const seen = new Set<string>();
  for (const st of input.screenTypes) {
    if (seen.has(st)) continue;
    seen.add(st);
    for (const dp of PRICING_DAYPARTS) {
      const base = resolveUnitPrice({ customerId: input.customerId, screenType: st, region: ANY, daypart: dp, at: input.at }, input.rateCards, input.contractLines, input.fallback);
      if (!base) {
        missing.push({ screen_type: st, daypart: dp });
        continue;
      }
      rows.push(toRow(st, ANY, dp, base));
      for (const region of [...regions].sort()) {
        const p = resolveUnitPrice({ customerId: input.customerId, screenType: st, region, daypart: dp, at: input.at }, input.rateCards, input.contractLines, input.fallback);
        if (p && (p.unitPriceMicroVnd !== base.unitPriceMicroVnd || p.floorMicroVnd !== base.floorMicroVnd || p.sourceRef !== base.sourceRef)) rows.push(toRow(st, region, dp, p));
      }
    }
  }
  return { rows, missing };
}

/** Gia chot cho mot luot (loai man, khu vuc, khung gio): dong dung khu vuc neu co, nguoc lai dong '*'. undefined = khong co gia chot. */
export function pickSnapshotPrice<T extends Pick<SnapshotRow, 'screen_type' | 'region_id' | 'daypart'>>(rows: readonly T[], q: { screenType: string; region: string; daypart: string }): T | undefined {
  let any: T | undefined;
  for (const r of rows) {
    if (r.screen_type !== q.screenType || r.daypart !== q.daypart) continue;
    if (r.region_id === q.region && q.region !== ANY) return r;
    if (r.region_id === ANY) any = r;
  }
  return any;
}

/** So tien tinh cho mot luot hop le theo gia chot: khong bao gio duoi san. */
export function chargeMicro(snapshot: { unitPriceMicroVnd: number; floorMicroVnd: number }): number {
  return Math.max(int(snapshot.unitPriceMicroVnd), int(snapshot.floorMicroVnd), 0);
}

/** So luot uoc tinh mua duoc voi ngan sach (VND) o don gia (micro-VND), tinh bang BigInt (khong troi so, khong lech so thuc). */
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

/** Gia tam cho local/test (bien moi truong neu dat ro rang, nguoc lai 20 d); null o production. */
export const priceFallbackFromEnv = (env: Record<string, string | undefined>): PriceFallback => ({
  placeholderMicro: placeholderAllowed(env) ? (explicitEnvPrice(env) ?? PLACEHOLDER_PRICE_MICRO_VND) : null,
});

/** micro-VND -> chuoi VND, bo so 0 thua (20000000 -> "20"; 20500000 -> "20.5"; 1 -> "0.000001"). Chi de hien thi: tinh toan luon dung so nguyen micro. */
export function microToVndString(micro: number): string {
  const v = BigInt(Math.max(0, Math.round(Number(micro) || 0)));
  const whole = v / BigInt(MICRO_PER_VND);
  const frac = (v % BigInt(MICRO_PER_VND)).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}
