// Schema phan hoi cua gateway. Gateway chi dinh nghia zod cho REQUEST (protocol.ts, duoc import truc tiep);
// phan hoi la object literal trong gateway.ts va interface TS trong protocol.ts => ban sao zod duoi day.
// Moi ban sao ghi nguon `gateway.ts:<dong>`; test/contract (tests trong packages/openapi/test) goi gateway that de doi chieu khoa.
import { z } from 'zod';
import { AD_FORMATS, ERROR_CODES } from '@ams/edge-gateway/protocol';

export const errorBody = z.object({
  error: z.object({ code: z.enum(Object.keys(ERROR_CODES) as [string, ...string[]]), message: z.string(), details: z.unknown().optional() }),
});

export const registerResponse = z.object({
  device_id: z.string(),
  trust_level: z.number().int(),
  attestation_nonce: z.string(),
  server_time: z.string().datetime(),
  protocol: z.number().int(),
  heartbeat_interval: z.number().int().describe('giay'),
  created: z.boolean().describe('true => 201 (thiet bi moi), false => 200 (da dang ky truoc)'),
});

export const pairResponse = z.union([
  z.object({ paired: z.literal(true), trust_level: z.number().int() }),
  z.object({ paired: z.literal(false), code: z.string().regex(/^\d{6}$/), expires_at: z.string().datetime(), expires_in: z.number().int(), ttl_s: z.number().int() }),
]);

export const deviceCommand = z
  .object({
    id: z.string().describe('id dong trong bang device_commands'),
    type: z.string().regex(/^[a-z][a-z0-9_.-]{0,39}$/).describe('refresh_manifest, reboot, set_monitor; Signage Player: reset_pin (args rong), set_volume {percent 0-100}, set_orientation {orientation landscape|portrait}, message {text <= 200, duration_s? 3-120}; TV: lock, unlock, message {text, seconds}... Type la: bo qua nhung VAN ack.'),
    args: z.record(z.unknown()).optional(),
  })
  .describe('Vong doi: pending -> delivered -> acked|failed, hoac expired (TTL mac dinh 1 gio theo admin, toi da 7 ngay; reset_pin mac dinh 15 phut, toi da 1 gio). Giao lai sau 120s neu chua ack, toi da 10 lan giao; `id` KHONG DOI khi giao lai. At-least-once: thiet bi phai idempotent theo id.');

export const heartbeatResponse = z.object({
  ok: z.literal(true),
  server_time: z.string().datetime(),
  next_interval: z.number().describe('giay, da cong jitter'),
  interval_base: z.number(),
  manifest_etag: z.string(),
  manifest_group: z.string(),
  manifest_url: z.string().describe('duong tuong doi /v1/manifest/g/{group}'),
  commands: z.array(deviceCommand).describe('lenh cho thiet bi, giao at-least-once; ack bang cmd_ack trong heartbeat ke tiep hoac POST /v1/commands/ack'),
  min_app_version: z.string().optional(),
  hotline: z.string().max(60).optional().describe('CHI thang may/LED, khi co cau hinh: hotline/Zalo hien o man hinh logo (luu de hien ca khi mat mang)'),
  app_update_url: z.string().optional().describe('CHI thang may/LED, khi co cau hinh: URL HTTPS tai ban cap nhat app (di kem app_update_sha256)'),
  app_update_sha256: z.string().regex(/^[0-9a-f]{64}$/).optional().describe('SHA-256 hex cua tep cap nhat; app PHAI kiem truoc khi cai'),
});

export const commandAckResponse = z.object({ ok: z.literal(true), acked: z.number().int(), known: z.number().int(), unknown: z.array(z.string()).describe('id khong thuoc thiet bi nay (bo qua, khong loi)') });

export const logsResponse = z.object({ ok: z.literal(true), stored: z.number().int().describe('so dong da luu') });

export const eventsResponse = z.object({
  accepted: z.number().int(),
  valid: z.number().int(),
  flagged: z.number().int(),
  rejected: z.array(z.object({ event_id: z.string().nullable(), reason: z.string() })),
});

const overlay = z.object({
  sponsor_tag: z.string().max(60).optional(),
  brand_label: z.string().max(60).optional(),
  headline: z.string().max(140).optional(),
  hotline: z.object({ label: z.string().max(60).optional(), number: z.string().max(24), sub: z.string().max(100).optional() }).optional(),
  qr: z.object({ url: z.string().max(512), label: z.string().max(60).optional(), title: z.string().max(80).optional() }).optional(),
  scte_id: z.string().max(64).optional(),
  badges: z.array(z.string().max(30)).optional(),
});
export const manifestCreative = z.object({
  id: z.string(),
  campaign_id: z.string(),
  url: z.string(),
  sha256: z.string().optional().describe('hex; thiet bi PHAI kiem tra truoc khi phat. Chi co o creative tai len; creative delivery=stream KHONG co sha256'),
  delivery: z.literal('stream').optional().describe("vang mat = tai len (tai ve + kiem sha256); 'stream' = phat truc tiep tu url ben ngoai (ExoPlayer/Media3), khong tai ve"),
  kind: z.enum(['mp4', 'webm', 'hls', 'dash']).optional().describe('chi voi delivery=stream: dinh dang luong'),
  duration_ms: z.number().int().optional().describe('chi voi delivery=stream: thoi luong khai bao (ms), dung cho quy tac 0.9 x thoi luong'),
  etag: z.string().nullable().optional().describe('chi voi delivery=stream: ETag luc duyet (neu co)'),
  duration_s: z.number().nullable(),
  px_w: z.number().nullable(),
  px_h: z.number().nullable(),
  format: z.enum(AD_FORMATS),
  overlay: overlay.optional(),
  media_type: z.enum(['video', 'image']),
  size_bytes: z.number().nullable(),
  fit: z.enum(['fit', 'cover']).optional().describe('CHI thang may/LED: cach hien trong khung (mac dinh fit = vua khung, giu ti le, co vien den neu lech; cover = phu kin, co the cat mep)'),
});
const manifestZone = z.object({
  id: z.string(),
  type: z.enum(['video', 'image', 'marquee', 'text', 'clock', 'weather', 'qr']),
  x: z.number().describe('% khung, 0..100'),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  z: z.number().int().optional(),
  transition: z.enum(['none', 'fade', 'slide-left', 'slide-right', 'zoom']).optional(),
  text: z.string().optional().describe('Van ban thuan (thiet bi cu chi doc truong nay)'),
  rich: z.string().optional().describe('Van ban dinh dang cho vung marquee/text: tap con HTML da lam sach (p, b, i, u, s, span, br); thieu = dung text'),
  bg_color: z.string().optional(),
  text_color: z.string().optional(),
  font_size: z.number().int().optional(),
  scroll_speed: z.number().int().optional(),
  scroll_dir: z.enum(['left', 'right']).optional().describe('CHI vung marquee: huong chay, mac dinh left'),
  clock: z.object({ hour12: z.boolean().optional(), tz: z.string().optional(), date: z.boolean().optional() }).optional().describe('CHI vung clock: dinh dang gio, mui gio IANA, hien ngay'),
  url: z.string().optional(),
  qr_kind: z.enum(['text', 'image_url', 'data_url']).optional().describe('CHI vung qr: text = ve QR tu url; image_url = tai anh tu url (VietQR); data_url = anh nhung'),
  qr: z.record(z.unknown()).optional().describe('CHI vung qr: cau hinh goc (mode image|url|vietqr)'),
  weather: z.object({ mode: z.enum(['gps', 'fixed']), lat: z.number().optional(), lon: z.number().optional(), label: z.string().optional() }).optional().describe('CHI vung weather: thiet bi tu lay Open-Meteo (api.open-meteo.com) theo lat/lon'),
  creative_ids: z.array(z.string()).optional().describe('CHI vung video/image: tep phat o vung nay, theo thu tu'),
});
export const manifestSlot = z.object({
  slot_id: z.string(),
  campaign_id: z.string(),
  creative_ids: z.array(z.string()),
  daypart: z.string(),
  start_min: z.number().int(),
  end_min: z.number().int(),
  priority: z.number().int(),
  reward_points: z.number().int(),
  header: z.string().optional().describe('CHI thang may/LED: ghi de header cap manifest cho lich nay (chuoi rong = an)'),
  footer: z.string().optional().describe('CHI thang may/LED: ghi de footer cap manifest cho lich nay (chuoi rong = an)'),
  layout: z.object({ orientation: z.enum(['landscape', 'portrait']), zones: z.array(manifestZone) }).optional().describe('CHI lich noi bo (slot bp_*) co bo cuc da vung; thiet bi cu bo qua truong la'),
});
const signageExtra = {
  header: z.string().optional().describe('CHI thang may/LED: chu header (rong = an)'),
  footer: z.string().optional().describe('CHI thang may/LED: chu footer (rong = an)'),
  hotline: z.string().optional().describe('CHI thang may/LED: hotline/Zalo (dung khi mat mang)'),
  rotation: z.object({ mode: z.literal('sequential') }).optional().describe('CHI thang may/LED: phat tuan tu theo priority tang dan, lap vo han; cung priority theo slot_id'),
};
export const manifest = z.object({
  version: z.number().int(),
  group: z.string(),
  tz: z.string().describe('start_min/end_min tinh theo mui gio nay (Asia/Ho_Chi_Minh)'),
  etag: z.string(),
  generated_at: z.string().datetime(),
  ttl_s: z.number().int(),
  creatives: z.array(manifestCreative),
  schedule: z.array(manifestSlot),
  ...signageExtra,
});
export const manifestDelta = z.object({
  version: z.number().int(),
  group: z.string(),
  etag: z.string(),
  base_etag: z.string(),
  generated_at: z.string().datetime(),
  ttl_s: z.number().int(),
  creatives_added: z.array(manifestCreative),
  creatives_removed: z.array(z.string()).describe('creative bi go; thang may/LED: ca id creative DOI noi dung (cung id xuat hien trong creatives_added) de client thay the'),
  schedule: z.array(manifestSlot),
  ...signageExtra,
});
export const health = z.object({ ok: z.literal(true), service: z.string(), runtime: z.string(), time: z.string().optional() });

// ---------------------------------------------------------------- phia nguoi xem (WP-18), nguon: services/edge-gateway/src/viewer.ts
export const viewerPairResponse = z.object({ paired: z.literal(true), device_id: z.string().describe('device_id cua TV vua ghep'), trust_level: z.number().int(), already: z.boolean().optional() });
export const viewerPayoutStatus = z.enum(['pending', 'paid', 'rejected']);
export const walletResponse = z.object({
  paired: z.boolean(),
  balance_vnd: z.number().int().describe('so du KHA DUNG = so cai - lenh rut dang cho'),
  ledger_balance_vnd: z.number().int(),
  pending_payout_vnd: z.number().int(),
  total_paid_vnd: z.number().int(),
  views: z.number().int().describe('so luot xem DA CO THUONG (chien dich phu)'),
  interactions: z.number().int().describe('so tuong tac DA CO THUONG'),
  payouts: z.array(z.object({ id: z.string(), amount_vnd: z.number().int(), status: viewerPayoutStatus, requested_at: z.string(), paid_at: z.string().nullable() })),
  devices: z.array(z.object({ device_id: z.string(), name: z.string().nullable(), paired_at: z.string().nullable() })),
  tax_mode: z.enum(['none', 'auto_pay', 'delegate']),
  tax_authorization: z.enum(['none', 'auto_pay', 'delegate']).describe('trung tax_mode, ten truong cua app Mindo'),
  phone_verified: z.boolean(),
  today_reward_vnd: z.number().int().optional(),
  unit_price_vnd: z.number().int().describe('don gia chi de hien thi (20 d)'),
  payout_threshold_vnd: z.number().int().describe('moc nhan thuong cong don (mac dinh 100000)'),
  interaction_reward_range_vnd: z.array(z.number().int()).length(2),
  daily_reward_cap_vnd: z.number().int(),
  withdraw_enabled: z.boolean().describe('false => POST /v1/withdraw tra feature_disabled'),
});
export const ledgerResponse = z.object({
  items: z.array(z.object({ id: z.string(), kind: z.string(), amount_vnd: z.number().int(), status: z.string(), created_at: z.string(), ref_type: z.string().nullable() })),
  next_cursor: z.string().optional(),
});
export const phoneOtpResponse = z.object({ otp_sent: z.literal(true), expires_in: z.number().int(), phone_masked: z.string(), dev_otp: z.string().optional().describe('CHI local/test khi VIEWER_OTP_DEV_ECHO=1') });
export const phoneVerifiedResponse = z.object({ verified: z.literal(true), phone_masked: z.string() });
export const taxAuthResponse = z.object({
  mode: z.enum(['none', 'auto_pay', 'delegate']),
  tax_authorization: z.enum(['none', 'auto_pay', 'delegate']).describe('trung mode, ten truong cua app Mindo'),
  consent_version: z.string().nullable(),
  updated_at: z.string().nullable(),
  current_consent_version: z.string(),
  modes: z.array(z.string()),
  remittance_active: z.literal(false).describe('CHUA khau tru/nop thue that'),
});
export const withdrawResponse = z.object({
  payout_id: z.string(),
  id: z.string(),
  status: viewerPayoutStatus,
  amount_vnd: z.number().int(),
  requested_at: z.string(),
  review: z.literal('awaiting_finance_approval'),
  idempotent_replay: z.boolean().optional().describe('true => 200, tra lai lenh cu theo idempotency_key'),
});
export const interactionsResponse = z.object({
  accepted: z.number().int(),
  valid: z.number().int(),
  credited_vnd: z.number().int(),
  rejected: z.array(z.object({ event_id: z.string(), reason: z.string() })),
  results: z.array(z.object({ event_id: z.string(), status: z.enum(['credited', 'recorded', 'duplicate', 'rejected']), credited_vnd: z.number().int(), reason: z.string().optional() })),
});
