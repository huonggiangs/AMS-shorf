// Bo cuc da vung (kieu QuangBao Cloud): kieu du lieu + mau co san + ham dung chung cho trinh soan, trinh xem truoc va chuong trinh phat song.
import { z } from 'zod';

export const ZONE_TYPES = ['video', 'image', 'marquee', 'text', 'clock', 'weather', 'qr'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];
export const ZONE_LABEL: Record<ZoneType, string> = { video: 'Video', image: 'Ảnh', marquee: 'Chữ chạy', text: 'Văn bản', clock: 'Đồng hồ', weather: 'Thời tiết', qr: 'Mã QR' };
export const TRANSITIONS = [
  { id: 'none', label: 'Không' },
  { id: 'fade', label: 'Mờ dần' },
  { id: 'slide-left', label: 'Trượt sang trái' },
  { id: 'slide-right', label: 'Trượt sang phải' },
  { id: 'zoom', label: 'Phóng to' },
] as const;
export const MAX_ZONES = 8;

export const zoneSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    type: z.enum(ZONE_TYPES),
    x: z.coerce.number(),
    y: z.coerce.number(),
    w: z.coerce.number(),
    h: z.coerce.number(),
    z: z.coerce.number().default(0),
    transition: z.string().default('none'),
    text: z.string().nullish(),
    bg_color: z.string().nullish(),
    text_color: z.string().nullish(),
    font_size: z.coerce.number().nullish(),
    scroll_speed: z.coerce.number().nullish(),
    url: z.string().nullish(),
    qr: z.object({ mode: z.enum(['image', 'url', 'vietqr']), value: z.string().optional(), vietqr: z.object({ bin: z.string(), account: z.string(), name: z.string().optional(), amount: z.coerce.number().optional(), memo: z.string().optional(), template: z.string().optional() }).optional() }).nullish(),
    weather: z.object({ mode: z.enum(['gps', 'fixed']), lat: z.coerce.number().optional(), lon: z.coerce.number().optional(), label: z.string().optional() }).nullish(),
  })
  .passthrough();
export type Zone = z.infer<typeof zoneSchema>;
export type Orientation = 'landscape' | 'portrait';

export const layoutSchema = z.object({ template_id: z.string().nullish(), orientation: z.enum(['landscape', 'portrait']), zones: z.array(zoneSchema) }).passthrough();
export type Layout = z.infer<typeof layoutSchema>;

export const templateSchema = z
  .object({ id: z.string(), name: z.string(), orientation: z.enum(['landscape', 'portrait']), zones: z.array(zoneSchema).default([]), system: z.boolean().default(false), updated_at: z.string().nullish() })
  .passthrough();
export type LayoutTemplate = z.infer<typeof templateSchema>;

export const isMediaZone = (z: Pick<Zone, 'type'>): boolean => z.type === 'video' || z.type === 'image';
export const zoneName = (z: Zone, i = 0): string => (z.name && z.name.trim() ? z.name : `${ZONE_LABEL[z.type]} ${i + 1}`);

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Giu vung trong khung 0..100% (x+w, y+h <= 100), kich thuoc toi thieu 5%. */
export function clampZone(z: Zone): Zone {
  const w = clamp(round1(z.w), 5, 100);
  const h = clamp(round1(z.h), 5, 100);
  return { ...z, w, h, x: clamp(round1(z.x), 0, 100 - w), y: clamp(round1(z.y), 0, 100 - h) };
}

export function newZone(type: ZoneType, existing: Zone[]): Zone {
  let n = existing.length + 1;
  while (existing.some((z) => z.id === `z${n}`)) n++;
  const base: Zone = { id: `z${n}`, type, x: 10, y: 10, w: 50, h: 40, z: Math.min(20, existing.length), transition: type === 'video' || type === 'image' ? 'fade' : 'none' };
  if (type === 'marquee') return { ...base, x: 0, y: 88, w: 100, h: 12, text: 'Nhập nội dung chữ chạy', bg_color: '#DC2626', text_color: '#FFFFFF', font_size: 18, scroll_speed: 60 };
  if (type === 'text') return { ...base, w: 40, h: 20, text: 'Nhập nội dung văn bản', bg_color: '#111827', text_color: '#FFFFFF', font_size: 24 };
  if (type === 'clock') return { ...base, w: 30, h: 15, bg_color: '#111827', text_color: '#FFFFFF', font_size: 28 };
  if (type === 'weather') return { ...base, w: 30, h: 15, bg_color: '#1D4ED8', text_color: '#FFFFFF', weather: { mode: 'fixed', lat: 21.0285, lon: 105.8542, label: 'Hà Nội' } };
  if (type === 'qr') return { ...base, w: 20, h: 20, url: 'https://anio.vn', qr: { mode: 'url', value: 'https://anio.vn' } };
  return base;
}

interface Preset { id: string; name: string; orientation: Orientation; zones: Zone[] }
const mk = (id: string, type: ZoneType, x: number, y: number, w: number, h: number, extra: Partial<Zone> = {}): Zone => ({ id, type, x, y, w, h, z: 0, transition: type === 'video' || type === 'image' ? 'fade' : 'none', ...extra });
const BAR: Partial<Zone> = { text: 'Chào mừng quý khách', bg_color: '#DC2626', text_color: '#FFFFFF', font_size: 18, scroll_speed: 60 };
/** Mau co san (tao nhanh mot bo cuc roi chinh tiep). */
export const PRESETS: Preset[] = [
  { id: 'full-l', name: 'Toàn màn hình (ngang)', orientation: 'landscape', zones: [mk('main', 'video', 0, 0, 100, 100)] },
  { id: 'full-p', name: 'Toàn màn hình (dọc)', orientation: 'portrait', zones: [mk('main', 'video', 0, 0, 100, 100)] },
  { id: 'bar-l', name: 'Chính + chữ chạy (ngang)', orientation: 'landscape', zones: [mk('main', 'video', 0, 0, 100, 88), mk('bar', 'marquee', 0, 88, 100, 12, { z: 1, ...BAR })] },
  { id: 'bar-p', name: 'Chính + chữ chạy (dọc)', orientation: 'portrait', zones: [mk('main', 'video', 0, 0, 100, 90), mk('bar', 'marquee', 0, 90, 100, 10, { z: 1, ...BAR })] },
  { id: 'side-l', name: 'Chính + cột phụ + đồng hồ (ngang)', orientation: 'landscape', zones: [mk('main', 'video', 0, 0, 70, 88), mk('side', 'image', 70, 0, 30, 60), mk('clock', 'clock', 70, 60, 30, 28, { z: 1, bg_color: '#111827', text_color: '#FFFFFF', font_size: 28 }), mk('bar', 'marquee', 0, 88, 100, 12, { z: 2, ...BAR })] },
  { id: 'stack-p', name: 'Hai tầng + chữ chạy (dọc)', orientation: 'portrait', zones: [mk('top', 'video', 0, 0, 100, 60), mk('bottom', 'image', 0, 60, 100, 30), mk('bar', 'marquee', 0, 90, 100, 10, { z: 1, ...BAR })] },
];

/** Loi bo cuc thuong gap (cung quy tac may chu), de bao ngay tren form. Tra ve '' neu hop le. */
export function layoutError(zones: Zone[]): string {
  if (zones.length === 0) return 'Cần ít nhất một vùng.';
  if (zones.length > MAX_ZONES) return `Tối đa ${MAX_ZONES} vùng.`;
  if (new Set(zones.map((z) => z.id)).size !== zones.length) return 'Mã vùng bị trùng.';
  if (zones.some((z) => z.x + z.w > 100.01 || z.y + z.h > 100.01 || z.x < 0 || z.y < 0)) return 'Có vùng vượt ra ngoài khung.';
  if (!zones.some(isMediaZone)) return 'Cần ít nhất một vùng video hoặc ảnh để phát tệp.';
  return '';
}

/** Phan giai (px) mac dinh de hien thi ti le khung. */
export const ASPECT: Record<Orientation, string> = { landscape: '16 / 9', portrait: '9 / 16' };
