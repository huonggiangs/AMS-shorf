// Luoc do `creative.overlay` v1 cho quang cao hien thi tren app TV Brain-rot (mau: assets/formats/ADS.png).
// Nguon su that phia may chu (a1 nhap/kiem, a3 tra trong manifest). Phia app: AmsOverlaySpec.java kiem lai cung quy tac.
// Dac ta chi tiet: docs/TV-APP-INTEGRATION.md muc 4.
import { z } from 'zod';

export const OVERLAY_VERSION = 1 as const;

/** Noi hien thi tren TV. `lock` = cot quang cao ben trai man khoa phu huynh (ADS.png). */
export const OVERLAY_CONTEXTS = ['lock', 'fullscreen', 'pause', 'corner'] as const;
export type OverlayContext = (typeof OVERLAY_CONTEXTS)[number];

/** Ti le 16:9 cho phep lech toi da 16 don vi (khop AmsOverlaySpec.java). */
export const BG_MIN_W = 1280;
export const BG_MAX_W = 7680;
/** Cac bac chuan HD -> 8K (dac ta muc 6). Cac kich thuoc khac 16:9 van hop le, bac chi de goi y tai len. */
export const BG_TIERS = [
  { name: 'HD', w: 1280, h: 720 },
  { name: 'FHD', w: 1920, h: 1080 },
  { name: '4K', w: 3840, h: 2160 },
  { name: '8K', w: 7680, h: 4320 },
] as const;

export function isSixteenNine(w: number, h: number): boolean {
  return Number.isInteger(w) && Number.isInteger(h) && Math.abs(w * 9 - h * 16) <= 16;
}

/** Dung cho form tai len nen: tra ve ly do tu choi bang tieng Viet hoac null. */
export function backgroundSizeProblem(w: number, h: number): string | null {
  if (!isSixteenNine(w, h)) return `Anh nen phai ti le 16:9 (nhan ${w}x${h}).`;
  if (w < BG_MIN_W) return `Anh nen toi thieu ${BG_MIN_W}x720 (HD).`;
  if (w > BG_MAX_W) return `Anh nen toi da ${BG_MAX_W}x4320 (8K).`;
  return null;
}

const noControl = (s: string): boolean => !/[\u0000-\u001f\u007f]/.test(s);
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(noControl, 'khong duoc chua ky tu dieu khien');
const httpsUrl = z.string().max(120).regex(/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{2,5})?(\/[^\s]*)?$/, 'phai la URL https, khong khoang trang');
const pct = z.number().int().min(0).max(15);

export const overlayBackground = z
  .object({
    url: httpsUrl,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    px_w: z.number().int(),
    px_h: z.number().int(),
  })
  .superRefine((b, ctx) => {
    const p = backgroundSizeProblem(b.px_w, b.px_h);
    if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p, path: ['px_w'] });
  });

export const overlaySchema = z
  .object({
    v: z.literal(OVERLAY_VERSION),
    /** the "TAI TRO • QUANG CAO 4K" o goc tren trai */
    sponsor_tag: text(1, 40),
    /** nhan thuong hieu o goc tren phai cua hang chip ("VINFAST AUTO") */
    brand_label: text(1, 24),
    /** tieu de lon (toi da 2 dong tren man 16:9) */
    headline: text(1, 90),
    /** ma tham chieu hien thi "SCTE-35 ID #<scte_id>". Chi la nhan, KHONG phai chen SCTE-35 that. */
    scte_id: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,38}$/).optional(),
    badges: z.array(text(1, 30)).max(3).default([]),
    hotline: z.object({ label: text(1, 40), number: z.string().regex(/^[0-9 .+()-]{6,20}$/), sub: text(1, 40).optional() }).optional(),
    /** url nen la link ngan qua may chu chuyen huong cua AMS (<= ~60 ky tu) de ma QR du thua tren the 150 px */
    qr: z.object({ url: httpsUrl, label: text(1, 40).optional(), title: text(1, 30), hint: text(1, 40).optional() }).optional(),
    /** may chu dien tu tep media cua creative (nguon duy nhat); form khong cho nhap tay */
    background: overlayBackground.optional(),
    safe_area: z
      .object({ top: pct, right: pct, bottom: pct, left: pct })
      .default({ top: 5, right: 5, bottom: 5, left: 5 }),
    duration_s: z.number().int().min(5).max(60).default(15),
    /** da duoc nguoi duyet xac nhan phu hop man hinh co the co tre em; mac dinh false => app khong hien tren man khoa */
    kid_safe: z.boolean().default(false),
    contexts: z.array(z.enum(OVERLAY_CONTEXTS)).min(1).max(OVERLAY_CONTEXTS.length).default(['fullscreen']),
  })
  .strict();

export type Overlay = z.infer<typeof overlaySchema>;
export type OverlayInput = z.input<typeof overlaySchema>;

/** Ben phai man khoa phu huynh (ADS.png): ap dung khi context = lock. */
export const LOCK_AD_FRACTION = 0.69;

export function isLockEligible(o: Pick<Overlay, 'contexts' | 'kid_safe'>): boolean {
  return o.contexts.includes('lock') && o.kid_safe;
}

/**
 * 6 dinh dang cua dac ta (muc 6) -> cach app TV v1 thuc hien. `lock` khong phai dinh dang rieng:
 * la mot creative `fullscreen` co overlay.contexts chua 'lock'.
 */
export const FORMAT_SUPPORT = {
  fullscreen: { v1: 'lock_split | full', contexts: ['lock', 'fullscreen'] },
  pause_ad: { v1: 'corner_card (can hook MediaSession, chua noi day)', contexts: ['pause'] },
  qr_corner: { v1: 'corner_card (chua noi day)', contexts: ['corner'] },
  menu_banner: { v1: 'khong ho tro: Brain-rot khong co menu rieng tren TV', contexts: [] },
  l_banner: { v1: 'khong ho tro: Android khong co the co video cua ung dung khac', contexts: [] },
  reward: { v1: 'khong ho tro: TV khong co tai khoan nguoi xem; can ghep doi AMS + ung dung dien thoai', contexts: [] },
} as const satisfies Record<string, { v1: string; contexts: readonly OverlayContext[] }>;

/** Creative nhu xuat hien trong manifest (DEVICE-PROTOCOL muc 7.1) + truong overlay moi. */
export const manifestCreativeWithOverlay = z.object({
  id: z.string(),
  campaign_id: z.string(),
  url: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  duration_s: z.number().int().nullable(),
  px_w: z.number().int().nullable(),
  px_h: z.number().int().nullable(),
  format: z.enum(['fullscreen', 'menu_banner', 'l_banner', 'pause_ad', 'qr_corner', 'reward']),
  media_type: z.enum(['video', 'image']),
  size_bytes: z.number().int().nullable(),
  overlay: overlaySchema.optional(),
});
