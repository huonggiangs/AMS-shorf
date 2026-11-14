import { kvIncrMany, type Runtime } from '@ams/runtime';
import { impressionEvent, proofOfPlayEvent, type ImpressionEvent } from './protocol.js';
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
  priceMicroVnd: number; // don gia/impression hop le, micro-VND (1 VND = 1.000.000) — TAM, can bang gia that
  rewardPointToVnd: number; // quy doi diem thuong -> VND — TAM
}

export const DEFAULT_POLICY: EventPolicy = {
  minVcrPct: 100,
  minPlayedRatio: 0.9,
  maxPerDeviceHour: 120,
  maxAgeH: 48,
  futureSkewS: 300,
  priceMicroVnd: 20_000_000,
  rewardPointToVnd: 1,
};

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
): Promise<{ result: EventResult; msg: IngestMessage | null }> {
  const candidates: string[] = [];
  await processEventsPass(rt, dev, rawEvents, view, policy, (id) => {
    candidates.push(id);
    return false;
  });
  if (candidates.length === 0) return processEventsPass(rt, dev, rawEvents, view, policy, () => false);
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
  return processEventsPass(rt, dev, rawEvents, view, policy, (id) => capped.get(id) === true);
}

async function processEventsPass(
  rt: Runtime,
  dev: DeviceRec,
  rawEvents: unknown[],
  view: ManifestView,
  policy: EventPolicy,
  capped: CapFn,
): Promise<{ result: EventResult; msg: IngestMessage | null }> {
  const now = rt.clock.now().getTime();
  const rejected: EventResult['rejected'] = [];
  const impressions: ImpressionRow[] = [];
  const pops: PopRow[] = [];
  const seen = new Set<string>();

  for (const raw of rawEvents) {
    const idGuess = typeof (raw as { event_id?: unknown })?.event_id === 'string' ? ((raw as { event_id: string }).event_id) : null;
    const type = (raw as { type?: unknown })?.type;
    const parsed = type === 'proof_of_play' ? proofOfPlayEvent.safeParse(raw) : impressionEvent.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ event_id: idGuess, reason: 'malformed' });
      continue;
    }
    const ev = parsed.data;
    if (seen.has(ev.event_id)) continue; // trung ngay trong lo: bo qua im lang
    seen.add(ev.event_id);
    const tsMs = Date.parse(ev.ts);
    if (tsMs > now + policy.futureSkewS * 1000 || tsMs < now - policy.maxAgeH * 3600_000) {
      rejected.push({ event_id: ev.event_id, reason: 'ts_out_of_range' });
      continue;
    }
    const ts = new Date(tsMs).toISOString();
    if (ev.type === 'proof_of_play') {
      if (!view.creative(ev.creative_id)) {
        rejected.push({ event_id: ev.event_id, reason: 'not_in_manifest' });
        continue;
      }
      pops.push({ event_id: ev.event_id, ts, screen_id: dev.screenId ?? dev.id, creative_id: ev.creative_id, duration_ms: ev.duration_ms, source: 'device' });
      continue;
    }
    const e = ev as ImpressionEvent;
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
    if (!reason) {
      if (capped(e.event_id)) reason = 'rate_cap'; // tran gio: quyet dinh theo lo, xem processEvents
    }
    const valid = reason === null;
    const reward = valid && dev.screenType === 'tv' && dev.trust >= 1 ? view.reward(e.campaign_id, e.slot_id) * policy.rewardPointToVnd : 0;
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
      revenue_micro_vnd: valid ? policy.priceMicroVnd : 0,
      reward_vnd: reward,
    });
  }
  const valid = impressions.filter((r) => r.valid === 1).length;
  const msg = impressions.length + pops.length > 0 ? ({ v: 1, device_id: dev.id, impressions, pops } as IngestMessage) : null;
  return { result: { accepted: impressions.length + pops.length, valid, flagged: impressions.length - valid, rejected }, msg };
}
