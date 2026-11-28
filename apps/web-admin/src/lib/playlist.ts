// Danh sach phat (playlist) cua mot vung: kieu du lieu, parse vung cu -> playlist, tong thoi luong, dong bo truong cu (creative_ids/durations).
// Ban sao tu chua (self-contained) cua packages/shared/src/playlist.ts; se hop nhat khi merge.
import type { Zone } from './layout';

export type PlaylistItemType = 'video' | 'image' | 'text';
export interface PlaylistItemStyle { rich?: string; bg_color?: string; text_color?: string; font_size?: number }
export interface PlaylistItem {
  id: string;
  type: PlaylistItemType;
  media_id?: string;
  url?: string;
  text_content?: string;
  style?: PlaylistItemStyle;
  /** giay. Anh/Van ban: mac dinh 8. Video: de trong = dung thoi luong that cua tep */
  duration?: number;
  name: string;
}

export const ITEM_DEFAULT_S = 8;
/** Mac dinh cua anh trong vung CU (truoc khi co playlist) - giu nguyen hanh vi cu khi parse. */
export const LEGACY_IMAGE_S = 5;
export const MAX_ITEM_S = 3600;
export const TYPE_LABEL: Record<PlaylistItemType, string> = { video: 'Video', image: 'Ảnh', text: 'Text' };

export const newId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${h(8)}-${h(4)}-4${h(3)}-a${h(3)}-${h(12)}`;
};

export function newItem(type: PlaylistItemType, existing: PlaylistItem[] = [], patch: Partial<PlaylistItem> = {}): PlaylistItem {
  const n = existing.filter((i) => i.type === type).length + 1;
  const base: PlaylistItem = { id: newId(), type, name: `${TYPE_LABEL[type]} ${n}` };
  if (type === 'image') base.duration = ITEM_DEFAULT_S;
  if (type === 'text') { base.duration = ITEM_DEFAULT_S; base.text_content = 'Nhập nội dung văn bản'; base.style = { bg_color: '#111827', text_color: '#FFFFFF', font_size: 24 }; }
  return { ...base, ...patch };
}

interface LegacyZone { type?: string; creative_id?: string | null; creative_ids?: string[] | null; durations?: Record<string, number> | null; playlist?: PlaylistItem[] | null }
export interface ParseOpts { kindOf?: (mediaId: string) => 'video' | 'image' | undefined; nameOf?: (mediaId: string) => string | undefined }

/** Vung co playlist -> tra nguyen; vung cu (creative_id / creative_ids + durations) -> tu dong chuyen thanh playlist. */
export function zonePlaylist(zone: Pick<Zone, 'type'> & LegacyZone, opts: ParseOpts = {}): PlaylistItem[] {
  if (Array.isArray(zone.playlist)) return zone.playlist;
  const ids = zone.creative_ids?.length ? zone.creative_ids : zone.creative_id ? [zone.creative_id] : [];
  return ids.map((mid, i) => {
    const type: 'video' | 'image' = opts.kindOf?.(mid) ?? (zone.type === 'image' ? 'image' : 'video');
    const d = zone.durations?.[mid];
    const dur = d != null && d >= 1 ? Math.min(MAX_ITEM_S, Math.round(d)) : type === 'image' ? LEGACY_IMAGE_S : undefined;
    return { id: newId(), type, media_id: mid, name: opts.nameOf?.(mid) ?? `${TYPE_LABEL[type]} ${i + 1}`, ...(dur ? { duration: dur } : {}) };
  });
}

/** Thoi luong hieu luc (giay) cua 1 muc; video chua biet do dai -> 0. */
export function itemDurationS(it: PlaylistItem, metaS?: number | null): number {
  if (it.type === 'video') return it.duration && it.duration > 0 ? it.duration : metaS && metaS > 0 ? metaS : 0;
  return it.duration && it.duration > 0 ? it.duration : ITEM_DEFAULT_S;
}
/** Tong thoi luong 1 vong phat (giay). metaOf: thoi luong that cua video theo media_id. */
export function playlistTotalS(items: PlaylistItem[], metaOf?: (mediaId: string) => number | null | undefined): number {
  return items.reduce((s, it) => s + itemDurationS(it, it.media_id ? metaOf?.(it.media_id) : undefined), 0);
}
export const fmtDur = (s: number): string => { const t = Math.round(s); return t >= 3600 ? `${Math.floor(t / 3600)}g ${Math.floor((t % 3600) / 60)}p ${t % 60}s` : t >= 60 ? `${Math.floor(t / 60)}p ${t % 60}s` : `${t}s`; };

/** Truong cu de ung dung doi cu van chay: creative_ids (khong trung) + durations (chi muc co thoi luong, theo media_id). */
export function legacyMirror(items: PlaylistItem[]): { creative_ids: string[]; durations: Record<string, number> | null } {
  const creative_ids: string[] = [];
  const durations: Record<string, number> = {};
  for (const it of items) {
    if (!it.media_id || creative_ids.includes(it.media_id)) continue;
    creative_ids.push(it.media_id);
    if (it.duration && it.duration > 0) durations[it.media_id] = Math.round(it.duration);
  }
  return { creative_ids, durations: Object.keys(durations).length ? durations : null };
}

/** Vung video/anh/playlist cu ghep tu danh sach tep cap chuong trinh (creative_ids + item_zones) -> gan creative_ids vao vung de zonePlaylist doc duoc. */
export function hydrateZones(zones: Zone[], items: { creative_id: string; zone_id?: string | null; name?: string | null; kind?: string | null }[], opts: ParseOpts = {}): Zone[] {
  const media = zones.filter((z) => z.type === 'video' || z.type === 'image' || z.type === 'playlist');
  const first = media[0]?.id;
  const kinds = new Map(items.map((i) => [i.creative_id, i.kind === 'image' ? 'image' : i.kind === 'video' ? 'video' : undefined] as const));
  const names = new Map(items.map((i) => [i.creative_id, i.name ?? undefined] as const));
  const o: ParseOpts = { kindOf: (id) => opts.kindOf?.(id) ?? kinds.get(id), nameOf: (id) => opts.nameOf?.(id) ?? names.get(id) };
  return zones.map((z) => {
    if (!media.includes(z) || Array.isArray(z.playlist)) return z;
    const own = (z as Zone & LegacyZone).creative_ids?.length ? (z as Zone & LegacyZone).creative_ids! : items.filter((i) => (i.zone_id && media.some((m) => m.id === i.zone_id) ? i.zone_id : first) === z.id).map((i) => i.creative_id);
    return { ...z, creative_ids: own, playlist: zonePlaylist({ ...z, creative_ids: own }, o), loop: z.loop ?? true };
  });
}

/** Ghi playlist (va loop) vao vung + dong bo truong cu. */
export function withPlaylist(z: Zone, items: PlaylistItem[], loop = z.loop ?? true): Zone {
  const m = legacyMirror(items);
  return { ...z, playlist: items, loop, creative_ids: m.creative_ids, durations: m.durations };
}
