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
    type: z.string().regex(/^[a-z][a-z0-9_.-]{0,39}$/).describe('Ban dau: refresh_manifest, reboot, set_monitor. Type la: bo qua nhung VAN ack.'),
    args: z.record(z.unknown()).optional(),
  })
  .describe('Vong doi: pending -> delivered -> acked|failed, hoac expired (TTL 7 ngay). Giao lai sau 120s neu chua ack, toi da 10 lan giao. At-least-once: thiet bi phai idempotent theo id.');

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
});

export const commandAckResponse = z.object({ ok: z.literal(true), acked: z.number().int(), known: z.number().int(), unknown: z.number().int() });

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
  sha256: z.string().describe('hex; thiet bi PHAI kiem tra truoc khi phat'),
  duration_s: z.number().nullable(),
  px_w: z.number().nullable(),
  px_h: z.number().nullable(),
  format: z.enum(AD_FORMATS),
  overlay: overlay.optional(),
  media_type: z.enum(['video', 'image']),
  size_bytes: z.number().nullable(),
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
});
export const manifest = z.object({
  version: z.number().int(),
  group: z.string(),
  tz: z.string().describe('start_min/end_min tinh theo mui gio nay (Asia/Ho_Chi_Minh)'),
  etag: z.string(),
  generated_at: z.string().datetime(),
  ttl_s: z.number().int(),
  creatives: z.array(manifestCreative),
  schedule: z.array(manifestSlot),
});
export const manifestDelta = z.object({
  version: z.number().int(),
  group: z.string(),
  etag: z.string(),
  base_etag: z.string(),
  generated_at: z.string().datetime(),
  ttl_s: z.number().int(),
  creatives_added: z.array(manifestCreative),
  creatives_removed: z.array(z.string()),
  schedule: z.array(manifestSlot),
});
export const health = z.object({ ok: z.literal(true), service: z.string(), runtime: z.string(), time: z.string().optional() });
