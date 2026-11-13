import type { Runtime } from '@ams/runtime';
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

export async function processEvents(
  rt: Runtime,
  dev: DeviceRec,
  rawEvents: unknown[],
  view: ManifestView,
  policy: EventPolicy,
): Promise<{ result: EventResult; msg: IngestMessage | null }> {
  const now = rt.clock.now().getTime();
  const rejected: EventResult['rejected'] = [];
  const impressions: ImpressionRow[] = [];
  const pops: PopRow[] = [];
  const hourKey = new Date(now).toISOString().slice(0, 13).replace(/\D/g, '');
  const capKey = `cap:${dev.id}:${hourKey}`;
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
      // dem nguyen tu (incr) cho tung su kien: nhieu lo song song khong vuot tran (R1-04)
      const n = await rt.kv.incr(capKey, 3700);
      if (n > policy.maxPerDeviceHour) reason = 'rate_cap';
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
