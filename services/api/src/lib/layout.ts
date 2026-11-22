// Bo cuc da vung (migration 0021): kiem tra zod dung chung cho mau bo cuc va chuong trinh phat song. Toa do tinh theo % khung (0..100).
import { z } from 'zod';

export const ZONE_TYPES = ['video', 'image', 'marquee', 'text', 'clock', 'weather', 'qr'] as const;
export const MEDIA_ZONE_TYPES = ['video', 'image'] as const;
export const MAX_ZONES = 8;

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Màu dạng #RRGGBB');
const pct = z.number().min(0).max(100);

/** Ma QR: anh tai len (data URL nho), noi dung/URL (thiet bi tu ve) hoac VietQR (anh cong khai img.vietqr.io, khong can khoa). */
export const qrSchema = z
  .object({
    mode: z.enum(['image', 'url', 'vietqr']),
    value: z.string().max(270_000).optional(),
    vietqr: z
      .object({
        bin: z.string().regex(/^\d{6}$/, 'BIN ngân hàng gồm 6 chữ số'),
        account: z.string().regex(/^[0-9A-Za-z]{4,24}$/, 'Số tài khoản 4–24 ký tự'),
        name: z.string().trim().max(60).optional(),
        amount: z.number().int().min(0).max(100_000_000_000).optional(),
        memo: z.string().trim().max(50).optional(),
        template: z.enum(['compact', 'compact2', 'qr_only', 'print']).optional(),
      })
      .optional(),
  })
  .refine((v) => (v.mode === 'vietqr' ? !!v.vietqr : !!v.value), { message: 'Thiếu dữ liệu mã QR' })
  .refine((v) => v.mode !== 'image' || (v.value?.startsWith('data:image/') ?? false), { message: 'Ảnh QR phải là data URL (png/jpg/webp/svg)' });

export const weatherSchema = z.object({
  mode: z.enum(['gps', 'fixed']),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  label: z.string().trim().max(60).optional(),
});

export const zoneSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'Mã vùng chỉ gồm chữ, số, - và _ (tối đa 32 ký tự)'),
    name: z.string().trim().max(60).optional(),
    type: z.enum(ZONE_TYPES),
    x: pct,
    y: pct,
    w: z.number().min(1).max(100),
    h: z.number().min(1).max(100),
    z: z.number().int().min(0).max(20).default(0),
    transition: z.enum(['none', 'fade', 'slide-left', 'slide-right', 'zoom']).default('none'),
    text: z.string().max(200).optional(),
    bg_color: hex.optional(),
    text_color: hex.optional(),
    font_size: z.number().int().min(8).max(200).optional(),
    scroll_speed: z.number().int().min(0).max(100).optional(),
    url: z.string().max(500).optional(),
    qr: qrSchema.optional(),
    weather: weatherSchema.optional(),
  })
  .refine((v) => v.x + v.w <= 100.01 && v.y + v.h <= 100.01, { message: 'Vùng vượt ra ngoài khung (x+w và y+h tối đa 100%)' });

export const zonesSchema = z
  .array(zoneSchema)
  .max(MAX_ZONES, `Tối đa ${MAX_ZONES} vùng`)
  .refine((a) => new Set(a.map((x) => x.id)).size === a.length, { message: 'Mã vùng bị trùng' });

export const orientationSchema = z.enum(['landscape', 'portrait']);
export type Zone = z.infer<typeof zoneSchema>;

export const layoutSchema = z.object({
  template_id: z.string().max(64).nullable().optional(),
  orientation: orientationSchema.default('landscape'),
  zones: zonesSchema,
});
export type Layout = z.infer<typeof layoutSchema>;
