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
export const PRESENCE_TTL_S = 6 * 60;
export const PAIR_CODE_TTL_S = 5 * 60;

/** Bang ma loi (HTTP -> code). Than loi luon la { error: { code, message, details? } }. */
export const ERROR_CODES = {
  bad_request: 400,
  invalid_signature: 401,
  stale_timestamp: 401,
  unknown_device: 401,
  device_blocked: 403,
  replay: 409,
  payload_too_large: 413,
  validation_failed: 422,
  rate_limited: 429,
  overloaded: 503,
  not_found: 404,
  internal: 500,
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export const AD_FORMATS = ['fullscreen', 'menu_banner', 'l_banner', 'pause_ad', 'qr_corner', 'reward'] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

export const DEVICE_KINDS = ['tv', 'elevator', 'led_p5', 'phone', 'virtual'] as const;

export const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const B64URL_RE = /^[A-Za-z0-9_-]+$/;
export const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const registerBody = z.object({
  pubkey: z.string().regex(B64URL_RE).length(43), // 32 byte base64url khong padding
  kind: z.enum(DEVICE_KINDS).default('tv'),
  model: z.string().max(80).optional(),
  os: z.string().max(40).optional(),
  app_version: z.string().max(20).optional(),
  region: z.string().max(16).optional(),
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
});
export type HeartbeatBody = z.infer<typeof heartbeatBody>;

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
  sha256: string;
  duration_s: number | null;
  px_w: number | null;
  px_h: number | null;
  format: AdFormat;
  media_type: 'video' | 'image';
  size_bytes: number | null;
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
}

export interface Problem {
  error: { code: ErrorCode; message: string; details?: unknown };
}
