import { kvIncrMany, type Runtime } from '@ams/runtime';
import { chargeMicro, daypartAt, signageModelClass } from '@ams/shared';
import { normalizeEvent, type NormImpression } from './events-compat.js';
import type { DeviceRec } from './devices.js';
import type { ManifestView } from './manifest.js';
import type { ImpressionRow, IngestMessage, PopRow } from '@ams/ingest-consumer/contract';
export { INGEST_TOPIC } from '@ams/ingest-consumer/contract';
export type { ImpressionRow, IngestMessage, PopRow };

export interface EventPolicy {
  minVcrPct: number; // impression chi hop le (tinh tien/thuong) khi VCR >= nguong (mac dinh 100)
  minPlayedRatio: number; // played_ms >= ty le x thoi luong creative
  maxPerDeviceHour: number;
  maxAgeH: number;
  futureSkewS: number;
  /**
   * Gia DU PHONG moi impression hop le (micro-VND), CHI dung khi chien dich khong co gia chot trong manifest (DB cu/test). 0 = khong co du phong (production):
   * impression do bi danh dau `no_price`, khong tinh tien. Gia that lay tu gia chot cua chien dich (campaign_prices) qua manifest, khong tu bien nay.
   */
  priceMicroVnd: number;
  rewardPointToVnd: number; // quy doi diem thuong -> VND — TAM
}

export const DEFAULT_POLICY: EventPolicy = {
  minVcrPct: 100,
  minPlayedRatio: 0.9,
  maxPerDeviceHour: 120,
  maxAgeH: 48,
  futureSkewS: 300,
  priceMicroVnd: 0,
  rewardPointToVnd: 1,
};

/** ev_proof_of_play.source: thiet bi da cap quyen / chua cap quyen (giu lai de tinh lai khi duoc cap quyen) */
export const POP_SOURCE_TRUSTED = 'device';
export const POP_SOURCE_PENDING = 'pending_trust';

/** Chi tiet phu tro cho chan doan/thong ke (khong tra ve cho thiet bi). */
export interface EventExtras {
  /** ten alias/dinh dang cu da gap -> so lan */
  aliases: Record<string, number>;
  /** proof_of_play da luu nhung khong tinh la luot xem (ly do -> so lan), vd short_play, pending_trust */
  flags: Record<string, number>;
  /** item_impression (danh sach phat): 'stored' | 'duplicate' | 'rej:<ly do>' -> so lan; ghi vao device_event_stats duoi 'item:<khoa>' */
  items?: Record<string, number>;
}

export interface EventResult {
  accepted: number;
  valid: number;
  flagged: number;
  rejected: { event_id: string | null; reason: string }[];
}

/** Quyet dinh tran gio cho tung event_id (bo dem nguyen tu, tinh truoc cho ca lo). */
type CapFn = (eventId: string) => boolean;

/**
 * Tran gio/thiet bi (R1-12, N1, N4): MOT vong cho ca lo thay vi toi da 50 lan `kv.incr` tuan tu.
 *  1. Chay lo lan 1 chi de thu thap event_id dung duoc den buoc dem tran (cac ly do khac da loai truoc khi dem).
 *  2. Chiem `capev:<thiet bi>:<event_id>` (khoa khu trung, nguyen tu) -> chi su kien MOI moi duoc tinh; lo giao lai (mat phan hoi) KHONG tru tran lan hai.
 *  3. Cong dung so su kien moi vao `cap:<thiet bi>:<gio>` (mot incrBy nguyen tu) -> thu tu thu tu cua tung su kien MOI = n - moi + i + 1; > maxPerDeviceHour => rate_cap.
 *  4. Su kien da chiem truoc do (giao lai): khong dem them; bi rate_cap khi bo dem gio hien da vuot tran (an toan: khong bao gio tinh tien nhieu hon, ingest khu trung theo event_id nen ban ghi dau tien thang).
 * Lo lan 2 chay lai dung logic cu voi quyet dinh da co. Dong ghi gia/doanh thu khong bi sua boi ham nay.
 */
export async function processEvents(
  rt: Runtime,
  dev: DeviceRec,
  rawEvents: unknown[],
  view: ManifestView,
  policy: EventPolicy,
  /** loai chien dich (WP-18). Co tham so: chi chien dich 'cover' moi sinh thuong luot xem. Bo trong: giu hanh vi cu (khong loc). */
  rewardModels?: ReadonlyMap<string, { reward_model: string }>,
): Promise<{ result: EventResult; msg: IngestMessage | null; extras: EventExtras }> {
  const candidates: string[] = [];
  await processEventsPass(rt, dev, rawEvents, view, policy, rewardModels, (id) => {
    candidates.push(id);
    return false;
  });
  if (candidates.length === 0) return processEventsPass(rt, dev, rawEvents, view, policy, rewardModels, () => false);
  const now = rt.clock.now().getTime();
  const hourKey = new Date(now).toISOString().slice(0, 13).replace(/\D/g, '');
  const capKey = `cap:${dev.id}:${hourKey}`;
  const claims = await kvIncrMany(rt.kv, candidates.map((id) => ({ k: `capev:${dev.id}:${id}`, ttlSec: 3700 })));
  const fresh = candidates.filter((_, i) => claims[i] === 1);
  const [n] = await kvIncrMany(rt.kv, [{ k: capKey, by: fresh.length, ttlSec: 3700 }]);
  const capped = new Map<string, boolean>();
  const firstOrd = (n ?? 0) - fresh.length;
  fresh.forEach((id, i) => capped.set(id, firstOrd + i + 1 > policy.maxPerDeviceHour));
  for (const id of candidates) if (!capped.has(id)) capped.set(id, (n ?? 0) > policy.maxPerDeviceHour);
  return processEventsPass(rt, dev, rawEvents, view, policy, rewardModels, (id) => capped.get(id) === true);
}

async function processEventsPass(
  rt: Runtime,
  dev: DeviceRec,
  rawEvents: unknown[],
  view: ManifestView,
  policy: EventPolicy,
  rewardModels: ReadonlyMap<string, { reward_model: string }> | undefined,
  capped: CapFn,
): Promise<{ result: EventResult; msg: IngestMessage | null; extras: EventExtras }> {
  const now = rt.clock.now().getTime();
  const rejected: EventResult['rejected'] = [];
  const impressions: ImpressionRow[] = [];
  const pops: PopRow[] = [];
  const seen = new Set<string>();

  const extras: EventExtras = { aliases: {}, flags: {} };
  const bump = (m: Record<string, number>, k: string): void => void (m[k] = (m[k] ?? 0) + 1);
  const normCtx = { durationMs: (id: string): number | null => { const d = view.creative(id)?.duration_s; return d ? d * 1000 : null; } };

  for (const raw of rawEvents) {
    const rawId = (raw as { event_id?: unknown; eventId?: unknown; id?: unknown } | null) ?? {};
    const idGuess = [rawId.event_id, rawId.eventId, rawId.id].find((x): x is string => typeof x === 'string') ?? null;
    const norm = normalizeEvent(raw, normCtx);
    if ('error' in norm) {
      rejected.push({ event_id: idGuess, reason: 'malformed' });
      continue;
    }
    const ev = norm.ev;
    for (const a of norm.aliases) bump(extras.aliases, a);
    if (seen.has(ev.event_id)) continue; // trung ngay trong lo: bo qua im lang
    seen.add(ev.event_id);
    const tsMs = Date.parse(ev.ts);
    if (tsMs > now + policy.futureSkewS * 1000 || tsMs < now - policy.maxAgeH * 3600_000) {
      rejected.push({ event_id: ev.event_id, reason: 'ts_out_of_range' });
      continue;
    }
    const ts = new Date(tsMs).toISOString();
    if (ev.type === 'proof_of_play') {
      let info = view.creative(ev.creative_id);
      if (!info) {
        // creative khong con trong manifest hien tai (chien dich vua doi, manifest xoay) nhung co that trong CSDL: van ghi nhan luot da phat that
        // (proof_of_play khong tinh tien). Chi cho thiet bi da cap quyen; creative la/khong ton tai van bi tu choi.
        // Chi nhan khi creative dung loai/bac phan giai voi nhom manifest cua thiet bi (khong cho thiet bi bao cao creative cua loai man khac).
        const late = dev.trust >= 1 ? await rt.db.query<{ campaign_id: string | null; duration_s: number | null; target_type: string | null; px_w: number | null; px_h: number | null }>('SELECT campaign_id, duration_s, target_type, px_w, px_h FROM creatives WHERE id = ?', [ev.creative_id]).catch(() => []) : [];
        const c0 = late[0];
        const fits = !!c0 && (c0.target_type ?? dev.screenType) === dev.screenType && (dev.screenType === 'tv' || signageModelClass(dev.screenType, c0.px_w, c0.px_h) === dev.modelClass);
        if (!c0?.campaign_id || !fits) {
          rejected.push({ event_id: ev.event_id, reason: 'not_in_manifest' });
          continue;
        }
        info = { campaign_id: c0.campaign_id, duration_s: c0.duration_s === null ? null : Number(c0.duration_s), current: false };
        bump(extras.aliases, 'late_not_in_manifest');
      }
      if (ev.campaign_id && info.campaign_id !== ev.campaign_id) {
        rejected.push({ event_id: ev.event_id, reason: 'campaign_mismatch' });
        continue;
      }
      // Hieu luc cua proof_of_play (DEVICE-PROTOCOL 8.2): thiet bi da duoc cap quyen (trust >= 1) => 'device'; chua duoc cap quyen (trust 0) =>
      // 'pending_trust': VAN LUU (khong loai bo, khong mat), khong dung lam bang chung phat cho toi khi thiet bi duoc cap quyen — bao cao tinh lai
      // theo trust_level HIEN TAI (api/routes/history.ts). Gateway khong bao gio ghi doanh thu hay thuong tu proof_of_play.
      // Luot xem chi tinh khi phat >= minPlayedRatio x thoi luong (0,9 x); ngan hon van luu nhung khong tinh (ly do `short_play`).
      const short = !!info.duration_s && ev.duration_ms < info.duration_s * 1000 * policy.minPlayedRatio;
      if (dev.trust < 1) bump(extras.flags, 'pending_trust');
      else if (short) bump(extras.flags, 'short_play');
      pops.push({ event_id: ev.event_id, ts, screen_id: dev.screenId ?? dev.id, creative_id: ev.creative_id, duration_ms: ev.duration_ms, source: dev.trust >= 1 ? POP_SOURCE_TRUSTED : POP_SOURCE_PENDING, device_id: dev.id, campaign_id: info.campaign_id });
      continue;
    }
    const e = ev as NormImpression;
    const info = view.creative(e.creative_id);
    // creative khong thuoc manifest cua nhom thiet bi / sai chien dich: tu choi han (khong luu, tranh rac campaign_id gia)
    if (!info) {
      rejected.push({ event_id: e.event_id, reason: 'not_in_manifest' });
      continue;
    }
    if (info.campaign_id !== e.campaign_id) {
      rejected.push({ event_id: e.event_id, reason: 'campaign_mismatch' });
      continue;
    }
    let reason: string | null = null;
    if (dev.trust < 1) reason = 'untrusted_device';
    else if (e.vcr_pct < policy.minVcrPct) reason = 'vcr_low';
    else if (info.duration_s && e.played_ms < info.duration_s * 1000 * policy.minPlayedRatio) reason = 'short_play';
    // GIA: don gia cua luot nay = gia CHOT cua chien dich luc duyet theo (khu vuc thiet bi, khung gio cua su kien theo gio VN), khong bao gio duoi san.
    // Cung event_id luon cho cung gia (ts bat bien) nen lo giao lai khong doi so tien. Khong co gia chot: gia du phong (local/test) hoac `no_price`.
    const snap = view.price(info.campaign_id, dev.region ?? '*', daypartAt(tsMs));
    const unitPrice = snap ? chargeMicro({ unitPriceMicroVnd: snap.unit_price_micro_vnd, floorMicroVnd: snap.floor_micro_vnd }) : policy.priceMicroVnd;
    if (!reason && !(Number.isSafeInteger(unitPrice) && unitPrice > 0)) reason = 'no_price';
    if (!reason) {
      if (capped(e.event_id)) reason = 'rate_cap'; // tran gio: quyet dinh theo lo, xem processEvents
    }
    const valid = reason === null;
    const coverCampaign = rewardModels ? rewardModels.get(info.campaign_id)?.reward_model === 'cover' : true; // 'performance': luot xem thuan KHONG co thuong
    const reward = valid && coverCampaign && dev.screenType === 'tv' && dev.trust >= 1 ? view.reward(e.campaign_id, e.slot_id) * policy.rewardPointToVnd : 0;
    impressions.push({
      ts,
      event_id: e.event_id,
      device_id: dev.id,
      screen_id: dev.screenId,
      campaign_id: info.campaign_id,
      creative_id: e.creative_id,
      slot_id: e.slot_id ?? null,
      partner_id: null,
      region_id: dev.region,
      vcr_pct: e.vcr_pct,
      valid: valid ? 1 : 0,
      reject_reason: reason,
      revenue_micro_vnd: valid ? unitPrice : 0,
      reward_vnd: reward,
    });
  }
  const popsTrusted = pops.filter((p) => p.source === POP_SOURCE_TRUSTED).length - (extras.flags['short_play'] ?? 0);
  const valid = impressions.filter((r) => r.valid === 1).length + popsTrusted;
  const msg = impressions.length + pops.length > 0 ? ({ v: 1, device_id: dev.id, impressions, pops } as IngestMessage) : null;
  // proof_of_play: 'valid' = thiet bi da cap quyen; 'flagged' = dang cho cap quyen (van luu, tinh lai khi duoc cap quyen)
  return { result: { accepted: impressions.length + pops.length, valid, flagged: impressions.length - impressions.filter((r) => r.valid === 1).length + (pops.length - popsTrusted), rejected }, msg, extras };
}
