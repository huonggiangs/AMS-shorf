// Hop dong giao thuc thiet bi <-> gateway. Dung chung cho gateway, sim va (qua docs/DEVICE-PROTOCOL.md) app TV.
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

export const HEADER = {
  deviceId: 'x-device-id',
  timestamp: 'x-timestamp', // epoch giay (so nguyen)
  nonce: 'x-nonce', // 16..64 ky tu [A-Za-z0-9_-]
  signature: 'x-signature', // Ed25519, base64url
} as const;

/** Lech dong ho toi da giua thiet bi va may chu (giay). */
export const MAX_CLOCK_SKEW_S = 300;
/** Thoi gian nho nonce (giay) = 2 x skew de moi chu ky con hieu luc deu bi chan phat lai. */
export const NONCE_TTL_S = 2 * MAX_CLOCK_SKEW_S;
export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_BODY_BYTES = 16 * 1024; // events toi da 50 x ~250B
export const MAX_HEARTBEAT_BODY_BYTES = 2048; // muc tieu <512B (PLAN), tran cung 2 KB
export const JITTER = 0.2;
export { PRESENCE_TTL_S } from './heartbeat-ttl.js'; // dan xuat tu chu ky heartbeat toi da (khong con 6 phut)
export const PAIR_CODE_TTL_S = 5 * 60;

/** Bang ma loi (HTTP -> code). Than loi luon la { error: { code, message, details? } }. */
export const ERROR_CODES = {
  bad_request: 400,
  invalid_signature: 401,
  stale_timestamp: 401,
  unknown_device: 401,
  device_blocked: 403,
  // thiet bi da bi xoa khoi AMS (xoa mem): app dung gui, xoa khoa/khoa ghep va yeu cau ghep lai (dang ky moi)
  device_deleted: 410,
  replay: 409,
  payload_too_large: 413,
  validation_failed: 422,
  rate_limited: 429,
  overloaded: 503,
  not_found: 404,
  internal: 500,
  // ---- phia nguoi xem (WP-18)
  forbidden: 403,
  feature_disabled: 403,
  otp_required: 403,
  otp_invalid: 403,
  phone_not_verified: 403,
  tax_consent_required: 403,
  invalid_code: 404,
  already_paired: 409,
  conflict: 409,
  insufficient_balance: 409,
  idempotency_conflict: 409,
  below_threshold: 422,
  not_configured: 503,
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export { AD_FORMATS, type AdFormat, type CreativeOverlay } from '@ams/shared';
import type { AdFormat, CreativeOverlay } from '@ams/shared';

export const DEVICE_KINDS = ['tv', 'elevator', 'led_p5', 'phone', 'virtual'] as const;

export const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const B64URL_RE = /^[A-Za-z0-9_-]+$/;
export const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Ma vung: chu/so/_/- (<= 16). Dau '.' bi cam vi nhom manifest la `<region>.<daypart>.<model_class>`. Chuoi rong = chua cau hinh. */
export const REGION_RE = /^[A-Za-z0-9_-]{0,16}$/;
/** Do phan giai khung hinh dang hien thi (da tinh xoay), pixel. Gioi han chong gia tri vo ly lam bung nhom manifest. */
export const PX_MIN = 64;
export const PX_MAX = 16384;
const pxField = z.number().int().min(PX_MIN).max(PX_MAX);
export const SCREEN_ORIENTATIONS = ['landscape', 'portrait'] as const;
/** Nguon dang phat (Signage Player): ams (manifest tu may chu), usb, lan. */
export const PLAY_SOURCES = ['ams', 'usb', 'lan'] as const;

/** Danh sach tinh nang app tren thiet bi bao cao (vd 'set_volume', 'reboot', 'lock'); web dung de hien huy hieu "ho tro am luong". Tuy chon. */
export const capsField = z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,29}$/)).max(24);

export const registerBody = z.object({
  pubkey: z.string().regex(B64URL_RE).length(43), // 32 byte base64url khong padding
  kind: z.enum(DEVICE_KINDS).default('tv'),
  model: z.string().max(80).optional(),
  os: z.string().max(40).optional(),
  app_version: z.string().max(20).optional(),
  region: z.string().regex(REGION_RE).optional(),
  /** thang may/LED: do phan giai de chon nhom manifest `elevator_<w>x<h>` khi chua gan screen */
  px_w: pxField.optional(),
  px_h: pxField.optional(),
  orientation: z.enum(SCREEN_ORIENTATIONS).optional(),
  caps: capsField.optional(),
});
export type RegisterBody = z.infer<typeof registerBody>;

export const heartbeatBody = z.object({
  state: z.number().int().min(0).max(3).default(0), // 0 cho, 1 dang phat, 2 loi, 3 giam sat
  app_ver: z.string().max(20).optional(),
  soc_temp: z.number().int().min(-40).max(150).optional(),
  rssi: z.number().int().min(-120).max(0).optional(),
  dl_mbps: z.number().min(0).max(100000).optional(),
  cache_used_mb: z.number().int().min(0).optional(),
  cache_slots: z.number().int().min(0).optional(),
  manifest_etag: z.string().max(64).optional(),
  cmd_ack: z.array(z.string().max(40)).max(20).optional(),
  // ---- Signage Player (tuy chon; TV khong can gui). Than heartbeat van <= 2 KB.
  /** ten khac cua app_ver */
  app_version: z.string().max(20).optional(),
  /** ten khac cua cache_used_mb */
  cache_mb: z.number().int().min(0).max(100_000_000).optional(),
  /** nguon dang phat: ams | usb | lan */
  source: z.enum(PLAY_SOURCES).optional(),
  px_w: pxField.optional(),
  px_h: pxField.optional(),
  orientation: z.enum(SCREEN_ORIENTATIONS).optional(),
  region: z.string().regex(REGION_RE).optional(),
  /** am luong hien tai 0-100 (AudioManager STREAM_MUSIC quy ve %). Tuy chon, tuong thich nguoc: app cu khong gui. */
  volume: z.number().int().min(0).max(100).optional(),
  /** tinh nang app ho tro (xem capsField); gui o heartbeat dau tien sau khi khoi dong la du, gui lai moi lan cung duoc */
  caps: capsField.optional(),
});
export type HeartbeatBody = z.infer<typeof heartbeatBody>;

/** POST /v1/commands/ack: thiet bi bao ket qua lenh (ok -> acked, failed -> failed). */
export const MAX_ACK_BODY_BYTES = 4096;
export const commandAckBody = z.object({
  acks: z
    .array(z.object({ id: z.string().min(1).max(40), status: z.enum(['ok', 'failed']).default('ok'), result: z.string().max(500).optional() }))
    .min(1)
    .max(20),
});
export type CommandAckBody = z.infer<typeof commandAckBody>;

/** POST /v1/logs: nhat ky thiet bi (toi da 8 KB). */
export const MAX_LOGS_BODY_BYTES = 8 * 1024;
export const MAX_LOG_ENTRIES = 100;
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export const logsBody = z.object({
  entries: z
    .array(
      z.object({
        ts: z.string().datetime(), // ISO-8601 UTC luc xay ra
        level: z.enum(LOG_LEVELS).default('info'),
        tag: z.string().max(32).optional(), // vd play_error, source_switch, net_lost, usb_removed
        msg: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(MAX_LOG_ENTRIES),
});
export type LogsBody = z.infer<typeof logsBody>;

export const impressionEvent = z.object({
  type: z.literal('impression').default('impression'),
  event_id: z.string().regex(UUID_V7_RE),
  ts: z.string().datetime(), // ISO-8601 UTC
  campaign_id: z.string().min(1).max(40),
  creative_id: z.string().min(1).max(40),
  slot_id: z.string().max(40).optional(),
  vcr_pct: z.number().int().min(0).max(100),
  played_ms: z.number().int().min(0).max(3_600_000),
});
export const proofOfPlayEvent = z.object({
  type: z.literal('proof_of_play'),
  event_id: z.string().regex(UUID_V7_RE),
  ts: z.string().datetime(),
  creative_id: z.string().min(1).max(40),
  duration_ms: z.number().int().min(0).max(3_600_000),
});
export const eventsBody = z.object({
  events: z.array(z.discriminatedUnion('type', [impressionEvent.extend({ type: z.literal('impression') }), proofOfPlayEvent])).min(1).max(MAX_EVENTS_PER_BATCH),
});
export type ImpressionEvent = z.infer<typeof impressionEvent>;
export type EventsBody = z.infer<typeof eventsBody>;

export interface ManifestCreative {
  id: string;
  campaign_id: string;
  url: string;
  /** CHI co o creative tai len (delivery khac 'stream'): thiet bi PHAI kiem tra truoc khi phat. Creative stream KHONG co sha256 (may chu khong giu tep). */
  sha256?: string;
  /** Vang mat = tai len (tep cua AMS, tai ve + kiem sha256). 'stream' = phat truc tiep tu `url` ben ngoai (ExoPlayer/Media3), khong tai ve, khong kiem sha256. */
  delivery?: 'stream';
  /** Chi voi delivery 'stream': dinh dang luong de chon nguon (progressive mp4/webm, hls, dash). */
  kind?: 'mp4' | 'webm' | 'hls' | 'dash';
  /** Chi voi delivery 'stream': thoi luong khai bao (ms); quy tac hop le 0.9 x thoi luong dung gia tri nay. */
  duration_ms?: number;
  /** Chi voi delivery 'stream': ETag cua tep luc duyet (neu may chu nguon tra); de thiet bi/ho tro doi chieu, khong bat buoc. */
  etag?: string | null;
  duration_s: number | null;
  px_w: number | null;
  px_h: number | null;
  format: AdFormat;
  /** lop phu (tieu de, hotline, QR, nhan tai tro...) neu creative co; thiet bi cu bo qua truong la */
  overlay?: CreativeOverlay;
  media_type: 'video' | 'image';
  size_bytes: number | null;
  /** CHI thang may/LED: 'cover' (mac dinh) hoac 'fit' */
  fit?: 'fit' | 'cover';
}
export interface ManifestSlot {
  slot_id: string;
  campaign_id: string;
  creative_ids: string[];
  daypart: string;
  start_min: number;
  end_min: number;
  priority: number;
  reward_points: number;
  /** CHI thang may/LED va CHI khi lich co ghi de: chuoi rong = an; vang mat = dung gia tri cap manifest */
  header?: string;
  footer?: string;
  /** CHI lich noi bo (slot `bp_*`) co chon bo cuc da vung; thiet bi cu bo qua truong la. Vung media co `creative_ids` (tep phat o vung do, theo thu tu). */
  layout?: ManifestLayout;
}
export interface ManifestZone {
  id: string;
  type: 'video' | 'image' | 'marquee' | 'text' | 'clock' | 'weather' | 'qr';
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  transition?: string;
  /** van ban thuan (luon co o vung marquee/text; thiet bi cu chi doc truong nay) */
  text?: string;
  /** van ban dinh dang (tap con HTML: p[text-align,line-height], b, i, u, s, span[color,background-color,font-size,font-weight,font-family,letter-spacing], br); da lam sach o may chu */
  rich?: string;
  bg_color?: string;
  text_color?: string;
  font_size?: number;
  scroll_speed?: number;
  url?: string;
  /** vung qr: 'text' (thiet bi tu ve QR tu `url`) | 'image_url' (tai anh tu `url`, vd VietQR) | 'data_url' (anh nhung trong `url`) */
  qr_kind?: 'text' | 'image_url' | 'data_url';
  /** vung qr: cau hinh goc (mode image|url|vietqr) */
  qr?: Record<string, unknown>;
  /** vung weather: thiet bi tu lay Open-Meteo theo toa do (gps = dung vi tri thiet bi neu co, khong thi lat/lon) */
  weather?: { mode: 'gps' | 'fixed'; lat?: number; lon?: number; label?: string };
  creative_ids?: string[];
}
export interface ManifestLayout {
  orientation: 'landscape' | 'portrait';
  zones: ManifestZone[];
}
/** Quy tac xoay vong (thang may/LED). Hien chi 'sequential': theo priority tang dan, lap vo han, cung priority theo slot_id. */
export interface ManifestRotation {
  mode: 'sequential';
}
export const MANIFEST_TZ = 'Asia/Ho_Chi_Minh';

export interface Manifest {
  version: number;
  group: string;
  tz: string; // start_min/end_min tinh theo mui gio nay
  etag: string;
  generated_at: string;
  ttl_s: number;
  creatives: ManifestCreative[];
  schedule: ManifestSlot[];
  /** ---- CHI thang may/LED (TV khong co cac truong nay) ---- */
  header?: string;
  footer?: string;
  hotline?: string;
  rotation?: ManifestRotation;
}
export interface ManifestDelta {
  version: number;
  group: string;
  etag: string;
  base_etag: string;
  generated_at: string;
  ttl_s: number;
  creatives_added: ManifestCreative[];
  creatives_removed: string[];
  schedule: ManifestSlot[]; // lich luon gui day du (nho)
  /** thang may/LED: cac truong cap manifest luon gui day du (nho), giong ban day du */
  header?: string;
  footer?: string;
  hotline?: string;
  rotation?: ManifestRotation;
}

export interface Problem {
  error: { code: ErrorCode; message: string; details?: unknown };
}

// ---------------------------------------------------------------- phia nguoi xem (WP-18)
/** Mat khau mot lan 6 so. */
export const OTP_RE = /^\d{6}$/;
export const MAX_VIEWER_BODY_BYTES = 2048;
export const MAX_INTERACTION_BODY_BYTES = 4096;
export const MAX_INTERACTIONS_PER_BATCH = 10;

export const viewerPairBody = z.object({ code: z.string().regex(/^\d{6}$/, 'Ma ghep doi gom 6 chu so.') });
export type ViewerPairBody = z.infer<typeof viewerPairBody>;

export const bankAccountBody = z.object({
  bank_code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/).optional(),
  bank_name: z.string().trim().min(2).max(80),
  account_number: z.string().regex(/^[0-9A-Za-z]{4,30}$/, 'So tai khoan khong hop le.'),
  account_name: z.string().trim().min(2).max(80),
});
export const withdrawBody = z.object({
  amount_vnd: z.number().int().positive().max(1_000_000_000),
  bank: bankAccountBody,
  otp: z.string().regex(OTP_RE).optional(),
  /** y chi thue di kem lenh rut (app Mindo): auto_pay | delegate | none. Bo trong => dung che do da luu. */
  tax_authorization: z.enum(['none', 'auto_pay', 'delegate']).optional(),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'idempotency_key 8-64 ky tu [A-Za-z0-9_-].'),
});
export type WithdrawBody = z.infer<typeof withdrawBody>;

/** Xac minh so dien thoai: khong co otp => gui OTP; co otp => kiem tra. */
export const phoneBody = z.object({
  phone: z.string().regex(/^(\+84|0)\d{9}$/, 'So dien thoai Viet Nam: 0xxxxxxxxx hoac +84xxxxxxxxx.'),
  otp: z.string().regex(OTP_RE).optional(),
});
export type PhoneBody = z.infer<typeof phoneBody>;

export const TAX_MODES = ['none', 'auto_pay', 'delegate'] as const;
export const taxAuthBody = z.object({
  mode: z.enum(TAX_MODES),
  consent_version: z.string().trim().min(1).max(20),
  /** ma so thue ca nhan (10 hoac 13 so), tuy chon (luat su/ke toan quyet dinh co bat buoc khong) */
  tax_code: z.string().regex(/^\d{10}(-?\d{3})?$/, 'Ma so thue 10 hoac 13 so.').optional(),
});
export type TaxAuthBody = z.infer<typeof taxAuthBody>;

export const interactionEvent = z
  .object({
    type: z.literal('interaction').optional(),
    event_id: z.string().regex(UUID_V7_RE),
    ts: z.string().datetime(),
    kind: z.enum(['tap', 'qr_scan']).optional(),
    /** ten cu cua app Mindo (types.ts: InteractionReport.kind gui qua truong `interaction`); nhan de khop hop dong dang chay */
    interaction: z.enum(['tap', 'qr_scan']).optional(),
    campaign_id: z.string().min(1).max(40),
    creative_id: z.string().min(1).max(40),
    slot_id: z.string().max(40).optional(),
  })
  .refine((e) => e.kind !== undefined || e.interaction !== undefined, { message: 'Can kind (tap|qr_scan).' });
export const interactionsBody = z.object({ events: z.array(interactionEvent).min(1).max(MAX_INTERACTIONS_PER_BATCH) });
export type InteractionsBody = z.infer<typeof interactionsBody>;
