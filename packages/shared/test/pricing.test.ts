import { describe, expect, it } from 'vitest';
import {
  ANY, MICRO_PER_VND, PEAK_END_MIN, PEAK_START_MIN, buildSnapshot, chargeMicro, daypartAt, estimateImpressions, matchRateCard, microToVndString, pickSnapshotPrice,
  priceFallbackFromEnv, resolveUnitPrice, unitFromCard, vnMinuteOfDay, type ContractLinePrice, type RateCardRow,
} from '../src/index.js';

const vnd = (n: number) => n * MICRO_PER_VND;
let seq = 0;
const card = (o: Partial<RateCardRow> & { price_micro_vnd: number }): RateCardRow => ({
  id: `rc${String(++seq).padStart(3, '0')}`, customer_id: ANY, screen_type: ANY, region_id: ANY, daypart: ANY, model: 'per_impression', floor_micro_vnd: 0,
  effective_from: '2026-01-01T00:00:00.000Z', effective_to: null, active: 1, ...o,
});
const NOW = '2026-11-14T03:00:00.000Z';
const q = (o: Partial<{ customerId: string | null; screenType: string; region: string; daypart: string; at: string }> = {}) => ({ customerId: 'K1', screenType: 'tv', region: ANY, daypart: 'off_peak', at: NOW, ...o });
const NO_FB = { placeholderMicro: null };

// gio VN -> thoi diem UTC (VN = UTC+7)
const vnAt = (hh: number, mm: number, ss = 0, ms = 0) => Date.UTC(2026, 10, 14, hh - 7, mm, ss, ms);

describe('daypart theo gio Viet Nam: peak = [17:00, 22:00)', () => {
  it('bien: 16:59:59.999 off_peak, 17:00:00.000 peak, 21:59:59.999 peak, 22:00:00.000 off_peak', () => {
    expect(daypartAt(vnAt(16, 59, 59, 999))).toBe('off_peak');
    expect(daypartAt(vnAt(17, 0))).toBe('peak');
    expect(daypartAt(vnAt(21, 59, 59, 999))).toBe('peak');
    expect(daypartAt(vnAt(22, 0))).toBe('off_peak');
    expect(PEAK_START_MIN).toBe(1020);
    expect(PEAK_END_MIN).toBe(1320);
  });
  it('qua nua dem UTC/VN: 00:00 VN = 17:00 UTC hom truoc; 23:59 VN off_peak; khong phu thuoc gio may', () => {
    expect(vnMinuteOfDay(Date.UTC(2026, 10, 13, 17, 0))).toBe(0);
    expect(daypartAt(Date.UTC(2026, 10, 13, 17, 0))).toBe('off_peak');
    expect(vnMinuteOfDay(Date.UTC(2026, 10, 14, 16, 59))).toBe(23 * 60 + 59);
    // 10:00 UTC = 17:00 VN
    expect(daypartAt(Date.UTC(2026, 10, 14, 10, 0))).toBe('peak');
    expect(daypartAt(Date.UTC(2026, 10, 14, 9, 59, 59, 999))).toBe('off_peak');
  });
});

describe('don gia: per_impression va cpm (so nguyen, khong troi so)', () => {
  it('cpm quy ra luot bang ceil: 25 d/luot = 25.000 d CPM; cpm khong chia het 1.000 thi lam tron LEN (<= 1 micro)', () => {
    expect(unitFromCard('per_impression', vnd(30))).toBe(vnd(30));
    expect(unitFromCard('cpm', vnd(25_000))).toBe(vnd(25));
    expect(unitFromCard('cpm', 1_000_001)).toBe(1001);
    expect(unitFromCard('cpm', 1)).toBe(1);
    expect(unitFromCard('cpm', 0)).toBe(0);
  });
  it('tong tien N luot = N x don gia (BigInt chinh xac) khong lech nhu so thuc', () => {
    // 0.1 + 0.2 kieu troi so khong xay ra vi micro nguyen: 3 luot x 33.333 micro
    const unit = unitFromCard('cpm', 33_333_000);
    expect(unit).toBe(33_333);
    expect(unit * 3).toBe(99_999);
    expect(estimateImpressions(1_000_000, vnd(25))).toBe(40_000);
    expect(estimateImpressions(5_000_000, 1)).toBe(5_000_000 * MICRO_PER_VND);
    expect(estimateImpressions(0, vnd(25))).toBe(0);
  });
  it('microToVndString', () => {
    expect(microToVndString(vnd(20))).toBe('20');
    expect(microToVndString(20_500_000)).toBe('20.5');
    expect(microToVndString(1)).toBe('0.000001');
    expect(microToVndString(0)).toBe('0');
  });
});

describe('resolveUnitPrice: do cu the, hieu luc theo ngay, san, hop dong', () => {
  it('dong cu the hon thang: loai man + khung gio > mac dinh; khach rieng > chung', () => {
    const cards = [card({ price_micro_vnd: vnd(30) }), card({ screen_type: 'tv', price_micro_vnd: vnd(25) }), card({ screen_type: 'tv', daypart: 'peak', price_micro_vnd: vnd(40) }), card({ customer_id: 'K1', screen_type: 'tv', price_micro_vnd: vnd(22) })];
    expect(resolveUnitPrice(q({ daypart: 'peak' }), cards, null, NO_FB)).toMatchObject({ unitPriceMicroVnd: vnd(22), source: 'rate_card' }); // khach rieng (8) > tv+peak (5)
    expect(resolveUnitPrice(q({ daypart: 'peak', customerId: 'K2' }), cards, null, NO_FB)).toMatchObject({ unitPriceMicroVnd: vnd(40) });
    expect(resolveUnitPrice(q({ daypart: 'off_peak', customerId: 'K2' }), cards, null, NO_FB)).toMatchObject({ unitPriceMicroVnd: vnd(25) });
    expect(resolveUnitPrice(q({ screenType: 'elevator', customerId: 'K2' }), cards, null, NO_FB)).toMatchObject({ unitPriceMicroVnd: vnd(30), source: 'default_card' });
  });
  it('khu vuc: dong khu vuc thang dong "*" khi khop; khu vuc khac roi ve "*"', () => {
    const cards = [card({ screen_type: 'tv', price_micro_vnd: vnd(25) }), card({ screen_type: 'tv', region_id: 'HN', price_micro_vnd: vnd(32) })];
    expect(resolveUnitPrice(q({ region: 'HN' }), cards, null, NO_FB)!.unitPriceMicroVnd).toBe(vnd(32));
    expect(resolveUnitPrice(q({ region: 'HCM' }), cards, null, NO_FB)!.unitPriceMicroVnd).toBe(vnd(25));
    expect(resolveUnitPrice(q({ region: ANY }), cards, null, NO_FB)!.unitPriceMicroVnd).toBe(vnd(25));
  });
  it('phien ban theo ngay hieu luc: [effective_from, effective_to) va dong tat khong khop', () => {
    const v1 = card({ screen_type: 'tv', price_micro_vnd: vnd(20), effective_from: '2026-01-01T00:00:00.000Z', effective_to: '2026-11-14T00:00:00.000Z' });
    const v2 = card({ screen_type: 'tv', price_micro_vnd: vnd(26), effective_from: '2026-11-14T00:00:00.000Z' });
    expect(resolveUnitPrice(q({ at: '2026-11-13T23:59:59.999Z' }), [v1, v2], null, NO_FB)!.unitPriceMicroVnd).toBe(vnd(20));
    expect(resolveUnitPrice(q({ at: '2026-11-14T00:00:00.000Z' }), [v1, v2], null, NO_FB)!.unitPriceMicroVnd).toBe(vnd(26)); // bien: to la loai tru, from la bao gom
    expect(resolveUnitPrice(q({ at: '2025-12-31T23:59:59.999Z' }), [v1, v2], null, NO_FB)).toBeNull();
    expect(matchRateCard([{ ...v2, active: 0 }], q())).toBeNull();
  });
  it('gia san: gia niem yet/gia hop dong thap hon san bi nang len san va danh dau floored', () => {
    const cards = [card({ screen_type: 'tv', price_micro_vnd: vnd(30), floor_micro_vnd: vnd(18) })];
    const line: ContractLinePrice = { id: 'cl1', screen_type: 'tv', region_id: null, daypart: null, impression_price_micro_vnd: vnd(10) };
    expect(resolveUnitPrice(q(), cards, [line], NO_FB)).toMatchObject({ unitPriceMicroVnd: vnd(18), floorMicroVnd: vnd(18), floored: true, source: 'contract', sourceRef: 'cl1', listPriceMicroVnd: vnd(30) });
    expect(resolveUnitPrice(q(), cards, [{ ...line, impression_price_micro_vnd: vnd(20) }], NO_FB)).toMatchObject({ unitPriceMicroVnd: vnd(20), floored: false });
    expect(chargeMicro({ unitPriceMicroVnd: vnd(5), floorMicroVnd: vnd(18) })).toBe(vnd(18));
    expect(chargeMicro({ unitPriceMicroVnd: vnd(25), floorMicroVnd: vnd(18) })).toBe(vnd(25));
  });
  it('hop dong ghi de bang gia theo do cu the (loai man + khung gio > chi loai man > tat ca); dong khac loai man khong ap', () => {
    const cards = [card({ price_micro_vnd: vnd(30) })];
    const lines: ContractLinePrice[] = [
      { id: 'a', screen_type: null, region_id: null, daypart: 'all_day', impression_price_micro_vnd: vnd(28) },
      { id: 'b', screen_type: 'tv', region_id: null, daypart: null, impression_price_micro_vnd: vnd(26) },
      { id: 'c', screen_type: 'tv', region_id: null, daypart: 'peak', impression_price_micro_vnd: vnd(35) },
      { id: 'd', screen_type: 'elevator', region_id: null, daypart: null, impression_price_micro_vnd: vnd(1) },
    ];
    expect(resolveUnitPrice(q({ daypart: 'peak' }), cards, lines, NO_FB)).toMatchObject({ unitPriceMicroVnd: vnd(35), sourceRef: 'c' });
    expect(resolveUnitPrice(q({ daypart: 'off_peak' }), cards, lines, NO_FB)).toMatchObject({ unitPriceMicroVnd: vnd(26), sourceRef: 'b' });
    expect(resolveUnitPrice(q({ screenType: 'led_p5' }), cards, lines, NO_FB)).toMatchObject({ unitPriceMicroVnd: vnd(28), sourceRef: 'a' });
  });
  it('chua co bang gia: production => null (tu choi); local/test => gia tam 20 d (hoac bien moi truong ro rang)', () => {
    expect(resolveUnitPrice(q(), [], null, priceFallbackFromEnv({ AMS_ENV: 'production' }))).toBeNull();
    expect(resolveUnitPrice(q(), [], null, priceFallbackFromEnv({ RUNTIME: 'cloudflare' }))).toBeNull();
    expect(resolveUnitPrice(q(), [], null, priceFallbackFromEnv({ AMS_ENV: 'staging' }))).toBeNull();
    expect(resolveUnitPrice(q(), [], null, priceFallbackFromEnv({ AMS_ENV: 'test' }))).toMatchObject({ unitPriceMicroVnd: vnd(20), source: 'placeholder' });
    expect(resolveUnitPrice(q(), [], null, priceFallbackFromEnv({ AMS_ENV: 'local', IMPRESSION_PRICE_MICRO_VND: '12345' }))).toMatchObject({ unitPriceMicroVnd: 12345 });
    // hop dong khong co bang gia: khong co san => van phai co bang gia (production)
    expect(resolveUnitPrice(q(), [], [{ id: 'x', screen_type: null, region_id: null, daypart: null, impression_price_micro_vnd: vnd(5) }], NO_FB)).toBeNull();
  });
});

describe('buildSnapshot / pickSnapshotPrice', () => {
  const cards = [
    card({ price_micro_vnd: vnd(30), floor_micro_vnd: vnd(10) }),
    card({ screen_type: 'tv', daypart: 'peak', price_micro_vnd: vnd(40) }),
    card({ screen_type: 'tv', region_id: 'HN', daypart: 'peak', price_micro_vnd: vnd(48) }),
  ];
  it('moi loai man x {peak, off_peak}; them dong khu vuc chi khi gia khac "*"', () => {
    const { rows, missing } = buildSnapshot({ customerId: 'K1', screenTypes: ['tv'], at: NOW, rateCards: cards, contractLines: null, fallback: NO_FB });
    expect(missing).toEqual([]);
    const k = rows.map((r) => `${r.screen_type}/${r.region_id}/${r.daypart}=${r.unit_price_micro_vnd / MICRO_PER_VND}`);
    expect(k).toEqual(['tv/*/peak=40', 'tv/HN/peak=48', 'tv/*/off_peak=30']);
    expect(pickSnapshotPrice(rows, { screenType: 'tv', region: 'HN', daypart: 'peak' })!.unit_price_micro_vnd).toBe(vnd(48));
    expect(pickSnapshotPrice(rows, { screenType: 'tv', region: 'HCM', daypart: 'peak' })!.unit_price_micro_vnd).toBe(vnd(40));
    expect(pickSnapshotPrice(rows, { screenType: 'tv', region: 'HN', daypart: 'off_peak' })!.unit_price_micro_vnd).toBe(vnd(30));
    expect(pickSnapshotPrice(rows, { screenType: 'elevator', region: ANY, daypart: 'peak' })).toBeUndefined();
  });
  it('thieu gia o "*" => missing (khong chot duoc)', () => {
    const onlyTv = [card({ screen_type: 'tv', price_micro_vnd: vnd(25) })];
    const r = buildSnapshot({ customerId: 'K1', screenTypes: ['tv', 'elevator'], at: NOW, rateCards: onlyTv, contractLines: null, fallback: NO_FB });
    expect(r.missing).toEqual([{ screen_type: 'elevator', daypart: 'peak' }, { screen_type: 'elevator', daypart: 'off_peak' }]);
    expect(buildSnapshot({ customerId: 'K1', screenTypes: ['tv'], at: NOW, rateCards: [], contractLines: null, fallback: NO_FB }).missing).toHaveLength(2);
  });
});
