// Danh sach phat trong MOT vung (v1): vung chua nhieu muc video / anh / van ban phat TUAN TU. Dung chung api (kiem tra), gateway (manifest) va web-admin.
// Tuong thich nguoc: vung cu (creative_ids + durations, hoac 1 creative) duoc doc thanh danh sach muc bang `zonePlaylist` (id on dinh = uuid v5).
// Xem docs/PLAYLIST.md.
import { sha1 } from '@noble/hashes/legacy';
import { z } from 'zod';
import { RICH_LIMITS, normColor, richHtmlToPlain, sanitizeRich } from './richtext.js';
import { IMAGE_DEFAULT_S, ITEM_DURATION_MAX_S, ITEM_DURATION_MIN_S, TEXT_DEFAULT_S } from './zone-duration.js';

export const PLAYLIST_MAX_ITEMS = 50;
export const PLAYLIST_ITEM_TYPES = ['video', 'image', 'text'] as const;
export type PlaylistItemType = (typeof PLAYLIST_ITEM_TYPES)[number];
/** Ten vung -> hang so mac dinh khi anh/van ban khong dat `duration` */
export const PLAYLIST_DEFAULT_S = { image: IMAGE_DEFAULT_S, text: TEXT_DEFAULT_S } as const;
/** Doi tuong cua uuid v5 cho muc suy ra tu du lieu cu (co dinh vinh vien: doi se doi id da ghi nhan o bao cao). */
export const PLAYLIST_LEGACY_NS = '6f1b8c1e-3b0a-5a7e-9d2c-0a11c0de0001';
export const PLAYLIST_URL_MAX = 500;
export const PLAYLIST_TEXT_MAX = 2000;

const hexColor = z
  .string()
  .max(40)
  .transform((v, ctx) => {
    const c = normColor(v);
    if (!c) { ctx.addIssue({ code: 'custom', message: 'Mau dang #RRGGBB' }); return z.NEVER; }
    return c;
  });

/** Kieu hien thi cua muc van ban. Truong la bi bo (khong bao loi) de app moi them truong khong lam hong ban cu. */
export const playlistStyleSchema = z.object({
  color: hexColor.optional(),
  background: hexColor.optional(),
  /** ten khoa cua web-admin (tuong duong background/color); giu nguyen khi luu */
  bg_color: hexColor.optional(),
  text_color: hexColor.optional(),
  /** HTML dinh dang (tuong duong `rich` cap muc); may chu nang len `rich` cua muc va bo khoi style */
  rich: z.string().max(RICH_LIMITS.html).optional(),
  font_size: z.number().int().min(8).max(200).optional(),
  align: z.enum(['left', 'center', 'right', 'justify']).optional(),
  valign: z.enum(['top', 'middle', 'bottom']).optional(),
  font_family: z.enum(['Roboto', 'Arial', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Courier New', 'sans-serif', 'serif', 'monospace']).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
});
export type PlaylistStyle = z.infer<typeof playlistStyleSchema>;

const uuidAny = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'id phai la UUID');
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** https tuyet doi, khong thong tin dang nhap, khong dau cach/ky tu dieu khien */
export function isHttpsUrl(v: string): boolean {
  if (v.length > PLAYLIST_URL_MAX || /[\s\u0000-\u001F]/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.');
  } catch {
    return false;
  }
}

export const playlistItemSchema = z
  .object({
    id: uuidAny,
    type: z.enum(PLAYLIST_ITEM_TYPES),
    name: z.string().trim().min(1).max(120),
    /** creative_id trong kho media (da duyet + san sang luc xuat ban). Video/anh phai co `media_id` HOAC `url`. */
    media_id: z.string().min(1).max(64).optional(),
    /** video/anh ngoai (https). Khong duoc quet/duyet: uu tien dan link vao kho media roi dung `media_id`. */
    url: z.string().max(PLAYLIST_URL_MAX).optional(),
    /** van ban thuan (luon co o muc `text`); neu co `rich` thi may chu dat lai = van ban thuan cua `rich` */
    text_content: z.string().max(PLAYLIST_TEXT_MAX).optional(),
    /** van ban dinh dang (tap con HTML nhu zone.rich), da lam sach o may chu */
    rich: z.string().max(RICH_LIMITS.html).optional(),
    style: playlistStyleSchema.optional(),
    /** giay (1..3600). Thieu: anh/van ban 8 s, video phat het theo thoi luong that cua tep. */
    duration: z.number().min(ITEM_DURATION_MIN_S).max(ITEM_DURATION_MAX_S).optional(),
  })
  .transform((v, ctx) => {
    const bad = (message: string, path: string): typeof z.NEVER => { ctx.addIssue({ code: 'custom', message, path: [path] }); return z.NEVER; };
    const { duration, rich, text_content, ...rest } = v;
    const out: z.infer<typeof playlistItemOut> = { ...rest };
    if (duration !== undefined) out.duration = Math.min(ITEM_DURATION_MAX_S, Math.max(ITEM_DURATION_MIN_S, Math.round(duration)));
    if (v.type === 'text') {
      if (v.media_id || v.url) return bad('Muc van ban khong co media_id/url', 'media_id');
      let plain = (text_content ?? '').replace(CTRL, '');
      const richSrc = rich ?? v.style?.rich;
      if (out.style?.rich !== undefined) { const { rich: _r, ...st } = out.style; out.style = st; if (!Object.keys(st).length) delete out.style; }
      if (richSrc !== undefined) {
        const clean = sanitizeRich(richSrc);
        plain = richHtmlToPlain(clean);
        if (clean) out.rich = clean;
      }
      if (!plain.trim()) return bad('Muc van ban chua co noi dung', 'text_content');
      out.text_content = plain.slice(0, PLAYLIST_TEXT_MAX);
      return out;
    }
    delete out.style;
    if (!!v.media_id === !!v.url) return bad('Video/anh can dung mot trong media_id hoac url', 'media_id');
    if (v.url && !isHttpsUrl(v.url)) return bad('url phai la https hop le', 'url');
    return out;
  });
const playlistItemOut = z.object({
  id: z.string(),
  type: z.enum(PLAYLIST_ITEM_TYPES),
  name: z.string(),
  media_id: z.string().optional(),
  url: z.string().optional(),
  text_content: z.string().optional(),
  rich: z.string().optional(),
  style: playlistStyleSchema.optional(),
  duration: z.number().optional(),
});
export type PlaylistItem = z.infer<typeof playlistItemOut>;

export const playlistSchema = z
  .array(playlistItemSchema)
  .max(PLAYLIST_MAX_ITEMS, `Toi da ${PLAYLIST_MAX_ITEMS} muc moi vung`)
  .refine((a) => new Set(a.map((x) => x.id)).size === a.length, { message: 'id muc bi trung' });

// ---------------------------------------------------------------------------------------------- uuid v5 (id on dinh cho muc suy ra tu du lieu cu)
const hexBytes = (h: string): Uint8Array => Uint8Array.from(h.replace(/-/g, '').match(/../g)!.map((x) => parseInt(x, 16)));
export function uuidV5(name: string, ns: string = PLAYLIST_LEGACY_NS): string {
  const nb = hexBytes(ns);
  const data = new TextEncoder().encode(name);
  const buf = new Uint8Array(nb.length + data.length);
  buf.set(nb);
  buf.set(data, nb.length);
  const h = sha1(buf).slice(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
/** id on dinh cua muc suy ra tu creative cu (cung vung + cung tep => cung id; lap lai tep trong vung cu khong co nen khong can chi so). */
export const legacyItemId = (zoneId: string, creativeId: string): string => uuidV5(`${zoneId}:${creativeId}`);

// ---------------------------------------------------------------------------------------------- doc vung (moi hoac cu) thanh danh sach muc
export interface ZoneLike {
  id: string;
  type?: string;
  playlist?: unknown;
  loop?: boolean;
  /** vung cu: tep phat o vung, theo thu tu */
  creative_ids?: string[] | null;
  /** vung cu: mot tep duy nhat */
  creative_id?: string | null;
  /** vung cu: giay theo creative_id */
  durations?: Record<string, unknown> | null;
}
export interface MediaInfo {
  kind: 'video' | 'image';
  name?: string | null;
  /** thoi luong that cua video (giay) neu biet */
  duration_s?: number | null;
}
export type MediaLookup = (creativeId: string) => MediaInfo | null | undefined;

const clampS = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(ITEM_DURATION_MAX_S, Math.max(ITEM_DURATION_MIN_S, Math.round(n))) : undefined;
};

/**
 * Danh sach muc cua vung. `zone.playlist` hop le (mang) thi dung nguyen; neu khong thi suy ra tu `creative_ids` (hoac `creative_id`) + `durations`:
 * moi tep -> mot muc {id: uuid v5(zone.id:creative_id), type theo `lookup` (mac dinh theo loai vung, anh neu khong ro), media_id, name, duration neu co trong durations}.
 */
export function zonePlaylist(zone: ZoneLike, lookup?: MediaLookup): PlaylistItem[] {
  if (Array.isArray(zone.playlist)) return zone.playlist as PlaylistItem[];
  const ids = Array.isArray(zone.creative_ids) ? zone.creative_ids : zone.creative_id ? [zone.creative_id] : [];
  const out: PlaylistItem[] = [];
  const seen = new Set<string>();
  for (const cid of ids) {
    if (typeof cid !== 'string' || !cid || seen.has(cid)) continue;
    seen.add(cid);
    const info = lookup?.(cid);
    const type: 'video' | 'image' = info?.kind ?? (zone.type === 'video' ? 'video' : 'image');
    const d = clampS(zone.durations?.[cid]);
    out.push({ id: legacyItemId(zone.id, cid), type, name: info?.name || cid, media_id: cid, ...(d ? { duration: d } : {}) });
  }
  return out;
}

export const zoneLoop = (zone: { loop?: unknown }): boolean => zone.loop !== false;

/** Giay phat cua muc: dat tay (clamp) > mac dinh anh/van ban 8 s > video: thoi luong that (giay) neu biet, khong thi null. */
export function itemPlayS(item: Pick<PlaylistItem, 'type' | 'duration' | 'media_id'>, knownVideoDurations?: Record<string, number | null | undefined> | null): number | null {
  const d = clampS(item.duration);
  if (d) return d;
  if (item.type !== 'video') return PLAYLIST_DEFAULT_S[item.type];
  const k = item.media_id ? Number(knownVideoDurations?.[item.media_id]) : NaN;
  return Number.isFinite(k) && k > 0 ? k : null;
}

/** Tong giay mot luot phat het danh sach (video chua biet thoi luong tinh 0; xem `playlistUnknownVideos`). */
export function playlistTotalS(items: readonly PlaylistItem[], knownVideoDurations?: Record<string, number | null | undefined> | null): number {
  let s = 0;
  for (const it of items) s += itemPlayS(it, knownVideoDurations) ?? 0;
  return Math.round(s * 1000) / 1000;
}
export const playlistUnknownVideos = (items: readonly PlaylistItem[], known?: Record<string, number | null | undefined> | null): number => items.filter((it) => itemPlayS(it, known) === null).length;

/** Cac truong cu de app cu van chay: creative_ids (khong trung, giu thu tu, chi muc video/anh co media_id) + durations (chi muc co `duration`). */
export function legacyMirror(items: readonly PlaylistItem[]): { creative_ids: string[]; durations: Record<string, number> } {
  const creative_ids: string[] = [];
  const durations: Record<string, number> = {};
  for (const it of items) {
    if (it.type === 'text' || !it.media_id) continue;
    if (!creative_ids.includes(it.media_id)) {
      creative_ids.push(it.media_id);
      const d = clampS(it.duration);
      if (d) durations[it.media_id] = d;
    }
  }
  return { creative_ids, durations };
}

/** media_id cua cac muc (khong trung, giu thu tu) */
export const playlistMediaIds = (items: readonly PlaylistItem[]): string[] => [...new Set(items.flatMap((i) => (i.media_id ? [i.media_id] : [])))];

// ---------------------------------------------------------------------------------------------- su kien item_impression (app -> POST /v1/events)
export const ITEM_IMPRESSION_MIN_VISIBLE_MS = 1000;
export const itemImpressionSchema = z.object({
  type: z.literal('item_impression'),
  log_id: uuidAny,
  program_id: z.string().min(1).max(64),
  zone_id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  item_id: uuidAny,
  media_id: z.string().min(1).max(64).optional(),
  item_type: z.enum(PLAYLIST_ITEM_TYPES),
  played_at: z.string().datetime({ offset: true }),
});
export type ItemImpressionEvent = z.infer<typeof itemImpressionSchema>;
/** 'bp_<id>' (slot_id/campaign_id trong manifest) hoac '<id>' -> id chuong trinh */
export const programIdOf = (v: string): string => (v.startsWith('bp_') ? v.slice(3) : v);
