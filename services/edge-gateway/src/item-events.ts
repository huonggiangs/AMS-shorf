// item_impression: luot hien thi tung MUC cua danh sach phat trong vung (docs/PLAYLIST.md). CHI de bao cao, khong tinh tien, khong tru chi tieu,
// khong qua hang doi ingest (ghi thang ev_item_impression, migration 0029). Khu trung theo log_id (UNIQUE): gui lai => dem mot lan, khong phai loi.
import { chunkForIn, type Runtime } from '@ams/runtime';
import { itemImpressionSchema, programIdOf } from '@ams/shared';
import { EVENT_ID_RE, normalizeTs } from './events-compat.js';
import type { DeviceRec } from './devices.js';
import type { EventPolicy } from './events.js';

export const SOURCE_TRUSTED = 'device';
export const SOURCE_PENDING = 'pending_trust';

/** Su kien item_impression? `type` = 'item_impression' (chuan) hoac co du log_id + item_id (app khong gui type). */
export function isItemImpressionRaw(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  const t = typeof o['type'] === 'string' ? o['type'].toLowerCase() : '';
  if (t === 'item_impression' || t === 'item-impression' || t === 'itemimpression') return true;
  return !t && (o['log_id'] !== undefined || o['logId'] !== undefined) && (o['item_id'] !== undefined || o['itemId'] !== undefined);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const ITEM_TYPES = new Set(['video', 'image', 'text']);

/** Chuan hoa ten truong (snake/camel, ten cu) -> dang chuan, roi kiem bang zod. Tra ve su kien hoac null (malformed). */
export function normalizeItemImpression(raw: unknown): { ev: ReturnType<typeof itemImpressionSchema.parse>; played_at_ms: number } | { error: 'malformed'; log_id: string | null } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const logId = str(o['log_id']) ?? str(o['logId']) ?? str(o['event_id']) ?? null;
  const typeRaw = str(o['type'])?.toLowerCase();
  const itemType = str(o['item_type']) ?? str(o['itemType']) ?? str(o['media_type']) ?? (typeRaw && ITEM_TYPES.has(typeRaw) ? typeRaw : undefined);
  const playedAt = normalizeTs(o['played_at'] ?? o['playedAt'] ?? o['ts'] ?? o['timestamp']);
  const cand = {
    type: 'item_impression' as const,
    log_id: logId ?? '',
    program_id: str(o['program_id']) ?? str(o['programId']) ?? str(o['slot_id']) ?? '',
    zone_id: str(o['zone_id']) ?? str(o['zoneId']) ?? '',
    item_id: str(o['item_id']) ?? str(o['itemId']) ?? '',
    ...((str(o['media_id']) ?? str(o['mediaId']) ?? str(o['creative_id'])) ? { media_id: (str(o['media_id']) ?? str(o['mediaId']) ?? str(o['creative_id']))! } : {}),
    item_type: itemType ?? '',
    played_at: playedAt ?? '',
  };
  const r = itemImpressionSchema.safeParse(cand);
  if (!r.success || !EVENT_ID_RE.test(r.data.log_id) || !playedAt) return { error: 'malformed', log_id: logId };
  return { ev: r.data, played_at_ms: Date.parse(playedAt) };
}

export interface ItemResult {
  /** da ghi moi */
  stored: number;
  /** log_id da co tu truoc (gui lai): bo qua, khong phai loi */
  duplicates: number;
  rejected: { event_id: string | null; reason: string }[];
}

export async function processItemImpressions(rt: Runtime, dev: DeviceRec, raws: unknown[], policy: EventPolicy): Promise<ItemResult> {
  const out: ItemResult = { stored: 0, duplicates: 0, rejected: [] };
  if (raws.length === 0) return out;
  const now = rt.clock.now().getTime();
  type Ok = { ev: ReturnType<typeof itemImpressionSchema.parse>; program: string; played_at: string };
  const ok: Ok[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const n = normalizeItemImpression(raw);
    if ('error' in n) {
      out.rejected.push({ event_id: n.log_id, reason: 'malformed' });
      continue;
    }
    if (seen.has(n.ev.log_id)) {
      out.duplicates++; // trung ngay trong lo
      continue;
    }
    seen.add(n.ev.log_id);
    if (n.played_at_ms > now + policy.futureSkewS * 1000 || n.played_at_ms < now - policy.maxAgeH * 3600_000) {
      out.rejected.push({ event_id: n.ev.log_id, reason: 'ts_out_of_range' });
      continue;
    }
    ok.push({ ev: n.ev, program: programIdOf(n.ev.program_id), played_at: new Date(n.played_at_ms).toISOString() });
  }
  if (ok.length === 0) return out;

  // chuong trinh + media co that; khach hang (doi tac) / chien dich suy ra o may chu, khong tin app
  const programs = new Set<string>();
  for (const part of chunkForIn([...new Set(ok.map((x) => x.program))])) {
    for (const r of await rt.db.query<{ id: string }>(`SELECT id FROM broadcast_programs WHERE id IN (${part.map(() => '?').join(',')})`, part)) programs.add(r.id);
  }
  const media = new Map<string, { customer_id: string | null; campaign_id: string | null }>();
  for (const part of chunkForIn([...new Set(ok.flatMap((x) => (x.ev.media_id ? [x.ev.media_id] : [])))])) {
    for (const r of await rt.db.query<{ id: string; customer_id: string | null; campaign_id: string | null }>(`SELECT id, customer_id, campaign_id FROM creatives WHERE id IN (${part.map(() => '?').join(',')})`, part)) media.set(r.id, r);
  }
  const rows: Ok[] = [];
  for (const x of ok) {
    if (!programs.has(x.program)) out.rejected.push({ event_id: x.ev.log_id, reason: 'unknown_program' });
    else if (x.ev.media_id && !media.has(x.ev.media_id)) out.rejected.push({ event_id: x.ev.log_id, reason: 'unknown_media' });
    else if (x.ev.item_type === 'text' && x.ev.media_id) out.rejected.push({ event_id: x.ev.log_id, reason: 'malformed' });
    else rows.push(x);
  }
  if (rows.length === 0) return out;
  const receivedAt = new Date(now).toISOString();
  const source = dev.trust >= 1 ? SOURCE_TRUSTED : SOURCE_PENDING;
  const res = await rt.db.batch(
    rows.map((x) => {
      const m = x.ev.media_id ? media.get(x.ev.media_id) : undefined;
      return {
        sql: `INSERT INTO ev_item_impression (log_id, device_id, program_id, zone_id, item_id, item_type, media_id, customer_id, campaign_id, played_at, received_at, source)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (log_id) DO NOTHING`,
        params: [x.ev.log_id, dev.id, x.program, x.ev.zone_id, x.ev.item_id, x.ev.item_type, x.ev.media_id ?? null, m?.customer_id ?? null, m?.campaign_id ?? null, x.played_at, receivedAt, source],
      };
    }),
  );
  res.forEach((r) => (r.changes > 0 ? out.stored++ : out.duplicates++));
  return out;
}
