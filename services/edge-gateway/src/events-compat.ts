// Chuan hoa su kien tu cac app (Signage Player, Mindo TV, ban cu) ve dang chuan cua DEVICE-PROTOCOL 8 TRUOC khi kiem hop le.
// Muc tieu: app gui khac ten truong / kieu (so dang chuoi, ts co mui gio, epoch, thoi luong tinh giay...) van duoc ghi nhan thay vi bi loai im lang.
// Moi alias dung duoc dem lai (`alias:<ten>`) de van hanh thay duoc app nao con gui kieu cu (Chan doan dong bo).
import { z } from 'zod';
import { MAX_EVENTS_PER_BATCH } from './protocol.js';

/** UUID bat ky phien ban (v4 cua ban app cu, v7 chuan) — khong phai chuoi tuy y, de van khu trung duoc. */
export const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const lenientImpression = z.object({
  type: z.literal('impression'),
  event_id: z.string().regex(EVENT_ID_RE),
  ts: z.string().datetime(),
  campaign_id: z.string().min(1).max(40),
  creative_id: z.string().min(1).max(40),
  slot_id: z.string().max(40).optional(),
  vcr_pct: z.number().int().min(0).max(100),
  played_ms: z.number().int().min(0).max(3_600_000),
});
const lenientPop = z.object({
  type: z.literal('proof_of_play'),
  event_id: z.string().regex(EVENT_ID_RE),
  ts: z.string().datetime(),
  creative_id: z.string().min(1).max(40),
  campaign_id: z.string().min(1).max(40).optional(),
  duration_ms: z.number().int().min(0).max(3_600_000),
});
export type NormImpression = z.infer<typeof lenientImpression>;
export type NormPop = z.infer<typeof lenientPop>;
export type NormEvent = NormImpression | NormPop;

const POP_TYPES = new Set(['proof_of_play', 'proof-of-play', 'proofofplay', 'pop', 'play', 'played', 'playback', 'play_log', 'playlog']);
const IMP_TYPES = new Set(['impression', 'imp', 'view', 'viewed']);

const pick = (o: Record<string, unknown>, names: string[], used: string[], canonical: string = names[0]!): unknown => {
  for (const n of names) {
    const v = o[n];
    if (v !== undefined && v !== null && v !== '') {
      if (n !== canonical) used.push(n);
      return v;
    }
  }
  return undefined;
};
const asNum = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : undefined);

/** ts: ISO co/khong mui gio, hoac epoch (giay/mili giay, so hay chuoi). Tra ve ISO UTC hoac undefined. */
export function normalizeTs(v: unknown): string | undefined {
  const n = asNum(v);
  if (n !== undefined && typeof v !== 'string') return epochIso(n);
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{9,16}(\.\d+)?$/.test(s)) return epochIso(Number(s));
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(' ', 'T') : s);
    if (Number.isFinite(ms) && /\d{4}-\d{2}-\d{2}/.test(s)) {
      // chuoi khong co mui gio: Date.parse coi la gio dia phuong cua may chu (UTC tren Worker) — giu nguyen, la quy uoc UTC cua giao thuc
      return new Date(ms).toISOString();
    }
  }
  return undefined;
}
function epochIso(n: number): string | undefined {
  const ms = n < 1e11 ? n * 1000 : n; // giay vs mili giay
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

export interface NormalizeCtx {
  /** thoi luong khai bao cua creative (ms), de suy vcr_pct khi app khong gui */
  durationMs(creativeId: string): number | null;
}

/**
 * Tra ve su kien chuan + danh sach alias da dung, hoac loi (`malformed`). Khong tu bia du lieu: thieu truong bat buoc => malformed.
 * Quy tac thoi luong proof_of_play: duration_ms | played_ms | playedMs | duration_s*1000 | duration (neu <= 3600 coi la giay, nguoc lai mili giay).
 */
export function normalizeEvent(raw: unknown, ctx: NormalizeCtx): { ev: NormEvent; aliases: string[] } | { error: 'malformed' } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'malformed' };
  const o = raw as Record<string, unknown>;
  const used: string[] = [];
  const typeRaw = asStr(o['type'])?.toLowerCase();
  const creativeId = asStr(pick(o, ['creative_id', 'creativeId', 'creative', 'media_id', 'mediaId'], used));
  const campaignId = asStr(pick(o, ['campaign_id', 'campaignId', 'campaign'], used));
  const eventId = asStr(pick(o, ['event_id', 'eventId', 'id', 'uuid'], used));
  const ts = normalizeTs(pick(o, ['ts', 'timestamp', 'played_at', 'playedAt', 'started_at', 'time'], used));
  if (o['ts'] !== undefined && ts !== o['ts']) used.push('ts_format');

  const msUsed: string[] = []; // chi de tim gia tri; alias ghi ben duoi theo loai su kien
  const playedRaw = asNum(pick(o, ['played_ms', 'playedMs', 'duration_ms', 'durationMs'], msUsed, ''));
  const secRaw = asNum(pick(o, ['duration_s', 'durationS', 'played_s', 'seconds'], used, ''));
  const bareDur = asNum(o['duration']);
  let ms: number | undefined = playedRaw;
  if (ms === undefined && secRaw !== undefined) ms = secRaw * 1000;
  if (ms === undefined && bareDur !== undefined) {
    used.push('duration');
    ms = bareDur <= 3600 ? bareDur * 1000 : bareDur;
  }
  const vcrRaw = asNum(pick(o, ['vcr_pct', 'vcr', 'vcrPct', 'completion_pct', 'percent'], used));

  let type: 'impression' | 'proof_of_play';
  if (typeRaw && POP_TYPES.has(typeRaw)) type = 'proof_of_play';
  else if (typeRaw && IMP_TYPES.has(typeRaw)) type = 'impression';
  else if (typeRaw) return { error: 'malformed' };
  else type = campaignId && vcrRaw !== undefined ? 'impression' : ms !== undefined && vcrRaw === undefined && !campaignId ? 'proof_of_play' : 'impression';
  // played_ms (impression) / duration_ms (proof_of_play) la ten chuan; ten con lai tinh la alias
  const canonMs = type === 'proof_of_play' ? 'duration_ms' : 'played_ms';
  for (const k of ['played_ms', 'playedMs', 'duration_ms', 'durationMs']) if (o[k] !== undefined && o[k] !== null && o[k] !== '') { if (k !== canonMs) used.push(k); break; }
  if (typeRaw && typeRaw !== type) used.push(`type:${typeRaw}`);
  if (!typeRaw) used.push('type_missing');

  const clamp = (n: number, hi: number): number => Math.max(0, Math.min(hi, Math.round(n)));
  if (!eventId || !creativeId || !ts) return { error: 'malformed' };
  const candidate =
    type === 'proof_of_play'
      ? { type, event_id: eventId, ts, creative_id: creativeId, ...(campaignId ? { campaign_id: campaignId } : {}), duration_ms: ms === undefined ? NaN : clamp(ms, 3_600_000) }
      : (() => {
          const dur = ctx.durationMs(creativeId);
          const played = ms === undefined ? (vcrRaw !== undefined && dur ? (vcrRaw / 100) * dur : undefined) : ms;
          const vcr = vcrRaw !== undefined ? vcrRaw : played !== undefined && dur ? Math.min(100, (played / dur) * 100) : undefined;
          if (vcrRaw === undefined && vcr !== undefined) used.push('vcr_derived');
          if (ms === undefined && played !== undefined) used.push('played_derived');
          const slot = asStr(pick(o, ['slot_id', 'slotId'], used));
          return {
            type,
            event_id: eventId,
            ts,
            campaign_id: campaignId ?? '',
            creative_id: creativeId,
            ...(slot ? { slot_id: slot } : {}),
            vcr_pct: vcr === undefined ? NaN : clamp(vcr, 100),
            played_ms: played === undefined ? NaN : clamp(played, 3_600_000),
          };
        })();
  const parsed = type === 'proof_of_play' ? lenientPop.safeParse(candidate) : lenientImpression.safeParse(candidate);
  if (!parsed.success) return { error: 'malformed' };
  return { ev: parsed.data, aliases: [...new Set(used)] };
}

/** Than /v1/events: `events` (chuan) hoac cac ten cu `items|batch|data|records`, hoac mang tran. */
export function extractEvents(parsed: unknown): { events: unknown[] | null; alias: string | null } {
  if (Array.isArray(parsed)) return { events: parsed, alias: 'body_array' };
  if (!parsed || typeof parsed !== 'object') return { events: null, alias: null };
  const o = parsed as Record<string, unknown>;
  if (Array.isArray(o['events'])) return { events: o['events'], alias: null };
  for (const k of ['items', 'batch', 'data', 'records']) if (Array.isArray(o[k])) return { events: o[k] as unknown[], alias: `body_${k}` };
  return { events: null, alias: null };
}

export { MAX_EVENTS_PER_BATCH };
