import { z } from 'zod';

/** Schemas cho Bàn làm việc / Phân phối thông minh / Hàng đợi & Nhật ký (/admin/v1/broadcast-insights). */
const n = z.coerce.number();
const idStr = z.union([z.string(), z.number()]).transform(String);

export const summarySchema = z
  .object({
    generated_at: z.string().nullish(),
    programs: z.object({ total: n, live: n, published: n, draft: n, expired: n, recent: z.array(z.object({ id: z.string(), name: z.string(), target_type: z.string(), status: z.string(), live: z.boolean(), item_count: n, updated_at: z.string().nullish() }).passthrough()).default([]) }).passthrough(),
    media: z.object({ pending_review: n, approved: n, rejected: n }).passthrough(),
    devices: z.object({ online: n, offline: n, awaiting_approval: n, regions: z.array(z.object({ region: z.string(), online: n, offline: n })).default([]) }).passthrough(),
    notices: z.array(z.object({ id: idStr, at: z.string(), text: z.string().nullish(), target: z.string().nullish(), regions: z.array(z.string()).nullish(), matched: n.nullish(), queued: n.nullish() }).passthrough()).default([]),
    queue: z.object({ pending: n, delivered: n, failed: n }).passthrough(),
  })
  .passthrough();
export type Summary = z.infer<typeof summarySchema>;

export const recoSchema = z
  .object({
    program_id: z.string(),
    name: z.string(),
    status: z.string(),
    target_type: z.string(),
    score: n,
    reasons: z.array(z.string()).default([]),
    warnings: z.array(z.string()).default([]),
    regions: z.array(z.string()).default([]),
    groups: z.array(z.object({ region: z.string(), online: n, total: n })).default([]),
    online_total: n.default(0),
    device_total: n.default(0),
  })
  .passthrough();
export type Reco = z.infer<typeof recoSchema>;

export const recommendResultSchema = z
  .object({
    engine: z.string(),
    summary: z.string(),
    items: z.array(recoSchema).default([]),
    media_suggestions: z.array(z.object({ id: z.string(), name: z.string().nullish(), kind: z.string().nullish(), target_type: z.string().nullish(), kid_safe: z.boolean().default(false) }).passthrough()).default([]),
  })
  .passthrough();
export type RecommendResult = z.infer<typeof recommendResultSchema>;

export const recoHistorySchema = z
  .object({
    id: idStr,
    at: z.string(),
    actor: z.string(),
    context: z.object({ place: z.string().nullish(), hour: n.nullish(), audience: z.string().nullish(), density: z.string().nullish(), weather: z.string().nullish(), note: z.string().nullish() }).passthrough().nullish(),
    top: z.array(z.object({ id: z.string(), name: z.string(), score: n })).nullish(),
  })
  .passthrough();

export const queueSchema = z
  .object({
    id: idStr,
    device_id: z.string(),
    device_name: z.string().nullish(),
    device_kind: z.string().nullish(),
    region: z.string().nullish(),
    type: z.string(),
    args: z.record(z.unknown()).default({}),
    status: z.string(),
    state: z.string(),
    created_at: z.string(),
    expires_at: z.string().nullish(),
    delivered_at: z.string().nullish(),
    acked_at: z.string().nullish(),
    deliveries: n.default(0),
    result: z.string().nullish(),
    cancellable: z.boolean().default(false),
  })
  .passthrough();
export type QueueRow = z.infer<typeof queueSchema>;

export const bpLogSchema = z.object({ id: idStr, at: z.string(), actor: z.string(), action: z.string(), object_type: z.string().nullish(), object_id: z.string().nullish(), diff: z.unknown().nullish() }).passthrough();
export type BpLog = z.infer<typeof bpLogSchema>;

export const devLogSchema = z.object({ id: idStr, device_id: z.string(), device_name: z.string().nullish(), region: z.string().nullish(), at: z.string(), level: z.string(), tag: z.string().nullish(), message: z.string() }).passthrough();
export type DevLog = z.infer<typeof devLogSchema>;

export const heartbeatSchema = z
  .object({ id: z.string(), device_id: z.string(), device_name: z.string().nullish(), at: z.string(), region: z.string().nullish(), app_ver: z.string().nullish(), soc_temp: n.nullish(), rssi: n.nullish(), dl_mbps: n.nullish(), cache_used_mb: n.nullish(), state: n.nullish() })
  .passthrough();
export type Heartbeat = z.infer<typeof heartbeatSchema>;
