import { z } from 'zod';

/* ---------- RBAC (PLAN §4): 12 modules x 4 actions ---------- */
export const MODULES = [
  'overview', 'devices', 'tv_experience', 'campaigns', 'customers', 'approvals',
  'media', 'screens', 'schedule', 'finance', 'partners', 'admin',
] as const;
export type Module = (typeof MODULES)[number];
export const ACTIONS = ['view', 'write', 'approve', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];
export const ROLES = ['super_admin', 'content_manager', 'finance', 'device_ops', 'customer', 'partner'] as const;
export type Role = (typeof ROLES)[number];
export const EXTERNAL_ROLES: readonly string[] = ['customer', 'partner'];
export const EXTERNAL_MODULES: readonly Module[] = ['campaigns', 'media', 'finance'];

export type Permissions = Partial<Record<Module, Action[]>>;

const permsSchema = z
  .record(z.string(), z.array(z.string()))
  .transform((r) => {
    const out: Permissions = {};
    for (const m of MODULES) {
      const a = r[m];
      if (a) out[m] = a.filter((x): x is Action => (ACTIONS as readonly string[]).includes(x));
    }
    return out;
  });

/* ---------- helpers ---------- */
const money = z.coerce.number().int().default(0); // VND, integer, never float
const idStr = z.union([z.string(), z.number()]).transform(String);

/** Lists: accept { items | data | rows, total, page, page_size } and normalise. */
export const listOf = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item).optional(),
      data: z.array(item).optional(),
      rows: z.array(item).optional(),
      total: z.coerce.number().optional(),
      page: z.coerce.number().optional(),
      page_size: z.coerce.number().optional(),
    })
    .passthrough()
    .transform((r) => {
      const items = r.items ?? r.data ?? r.rows ?? [];
      return { items: items as z.infer<T>[], total: r.total ?? items.length, page: r.page ?? 1, page_size: r.page_size ?? items.length };
    });
export type Paged<T> = { items: T[]; total: number; page: number; page_size: number };

/* ---------- auth ---------- */
export const meSchema = z
  .object({
    user: z
      .object({
        id: idStr,
        email: z.string(),
        name: z.string().nullish(),
        role: z.string(),
        customer_id: z.string().nullish(),
        mfa_enabled: z.boolean().optional(),
        last_login_at: z.string().nullish(),
      })
      .passthrough(),
    permissions: permsSchema.default({}),
    customer_scope: z
      .object({ customer_id: z.string(), code: z.string().nullish(), name: z.string().nullish(), campaign_grants: z.array(z.string()).optional() })
      .nullish(),
    dev_mode: z.boolean().optional(),
    csrf_token: z.string().optional(),
    /** forced password change pending (server answers 403 `password_change_required` to everything else) */
    must_change_password: z.boolean().optional(),
  })
  .passthrough();
export type Me = z.infer<typeof meSchema>;

export const loginSchema = z
  .object({
    mfa_required: z.boolean().default(false),
    mfa_token: z.string().optional(),
    mfa_enroll_required: z.boolean().optional(),
    csrf_token: z.string().optional(),
  })
  .passthrough();
export type LoginResult = z.infer<typeof loginSchema>;

export const enrollSchema = z
  .object({ secret: z.string(), otpauth_url: z.string().optional(), qr_url: z.string().optional(), mfa_token: z.string().optional() })
  .passthrough();

/* ---------- campaigns ---------- */
export const CAMPAIGN_STATUS = ['draft', 'pending', 'awaiting_funds', 'scheduled', 'active', 'paused', 'rejected', 'ended'] as const;
export const campaignSchema = z
  .object({
    id: idStr,
    name: z.string(),
    customer_id: z.string().nullish(),
    brand: z.string().nullish(),
    status: z.string(),
    screen_type: z.string().nullish(), // tv | elevator | led
    duration_sec: z.coerce.number().nullish(),
    budget_vnd: money,
    reserved_vnd: money.optional(),
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    impressions: z.coerce.number().default(0),
    target_impressions: z.coerce.number().nullish(),
    source: z.string().nullish(),
    creator: z.string().nullish(),
    media_id: z.string().nullish(),
    media_name: z.string().nullish(),
    pacing_pct: z.coerce.number().nullish(),
    reward_per_view: z.coerce.number().nullish(),
    reject_reason: z.string().nullish(),
    restricted_industry: z.boolean().optional(),
    restricted_reason: z.string().nullish(),
    customer_industry: z.string().nullish(),
    content_rights_confirmed: z.boolean().optional(),
    content_rights_confirmed_at: z.string().nullish(),
    content_rights_confirmed_by: z.string().nullish(),
  })
  .passthrough();
export type Campaign = z.infer<typeof campaignSchema>;

export const approveResultSchema = z
  .object({ status: z.string(), reserved_vnd: money.optional(), shortfall_vnd: money.optional(), message: z.string().optional() })
  .passthrough();

/* ---------- customers / contracts ---------- */
export const customerSchema = z
  .object({
    id: idStr,
    code: z.string().nullish(),
    legal_name: z.string(),
    short_name: z.string().nullish(),
    tax_code: z.string().nullish(),
    address: z.string().nullish(),
    representative: z.string().nullish(),
    rep_title: z.string().nullish(),
    phone: z.string().nullish(),
    email: z.string().nullish(),
    contact: z.string().nullish(),
    industry: z.string().nullish(),
    owner: z.string().nullish(),
    payment_terms: z.string().nullish(),
    credit_limit_vnd: money,
    debt_vnd: money,
    status: z.string(),
    since: z.string().nullish(),
  })
  .passthrough();
export type Customer = z.infer<typeof customerSchema>;

export const contractSchema = z
  .object({
    id: idStr,
    number: z.string(),
    customer_id: z.string(),
    customer_name: z.string().nullish(),
    title: z.string().nullish(),
    value_vnd: money,
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    paid_pct: z.coerce.number().default(0),
    status: z.string(),
  })
  .passthrough();
export type Contract = z.infer<typeof contractSchema>;

export const contractRenderSchema = z.object({ html: z.string(), amount_in_words: z.string().optional() }).passthrough();

/* ---------- media ---------- */
export const mediaSchema = z
  .object({
    id: idStr,
    name: z.string(),
    kind: z.string().nullish(), // video | image | link
    mime: z.string().nullish(),
    width: z.coerce.number().nullish(),
    height: z.coerce.number().nullish(),
    duration_sec: z.coerce.number().nullish(),
    size_bytes: z.coerce.number().nullish(),
    status: z.string(), // pending | approved | rejected | processing
    owner_name: z.string().nullish(),
    source_url: z.string().nullish(),
    thumb_url: z.string().nullish(),
    reject_reason: z.string().nullish(),
    format: z.string().nullish(), // fullscreen | menu_banner | l_banner | pause_ad | qr_corner | reward
    sha256: z.string().nullish(),
    overlay: z.unknown().optional(),
  })
  .passthrough();
export type Media = z.infer<typeof mediaSchema>;
export const uploadUrlSchema = z
  .object({ id: idStr, url: z.string(), method: z.string().optional(), headers: z.record(z.string(), z.string()).optional() })
  .passthrough();

/* ---------- devices ---------- */
export const deviceSchema = z
  .object({
    id: idStr,
    name: z.string(),
    kind: z.string().nullish(), // tv | phone | unknown
    model: z.string().nullish(),
    os: z.string().nullish(),
    owner_name: z.string().nullish(),
    app_version: z.string().nullish(),
    region: z.string().nullish(),
    status: z.string(),
    last_seen_at: z.string().nullish(),
    views: z.coerce.number().default(0),
    recent_ads: z.array(z.string()).optional(),
  })
  .passthrough();
export type Device = z.infer<typeof deviceSchema>;

/* ---------- screens / schedule ---------- */
export const screenSchema = z
  .object({
    id: idStr,
    name: z.string(),
    type: z.string(), // elevator | led
    venue_kind: z.string().nullish(),
    size: z.string().nullish(),
    resolution: z.string().nullish(),
    screens: z.coerce.number().default(1),
    region: z.string().nullish(),
    status: z.string(),
  })
  .passthrough();
export type Screen = z.infer<typeof screenSchema>;

export const slotSchema = z
  .object({ id: idStr, campaign_id: z.string().nullish(), name: z.string(), start_min: z.coerce.number(), end_min: z.coerce.number(), color: z.coerce.number().optional() })
  .passthrough();
export type Slot = z.infer<typeof slotSchema>;

/* ---------- finance ---------- */
export const walletSchema = z
  .object({ customer_id: z.string(), customer_name: z.string().nullish(), balance_vnd: money, reserved_vnd: money, spent_vnd: money, available_vnd: money.optional() })
  .passthrough();
export type Wallet = z.infer<typeof walletSchema>;

export const topupSchema = z
  .object({
    id: idStr,
    code: z.string().nullish(),
    customer_id: z.string().nullish(),
    customer_name: z.string().nullish(),
    method: z.string().nullish(),
    amount_vnd: money,
    status: z.string(),
    created_at: z.string(),
    payment_code: z.string().nullish(),
  })
  .passthrough();
export type Topup = z.infer<typeof topupSchema>;

export const topupCreateSchema = z
  .object({
    id: idStr,
    payment_code: z.string(),
    content: z.string().optional(),
    qr_url: z.string().optional(),
    bank: z.string().optional(),
    account_number: z.string().optional(),
    account_holder: z.string().optional(),
    amount_vnd: money,
    min_amount_vnd: money.optional(),
  })
  .passthrough();
export type TopupCreated = z.infer<typeof topupCreateSchema>;

export const sepaySettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    bank: z.string().nullish(),
    account_number: z.string().nullish(),
    account_holder: z.string().nullish(),
    prefix: z.string().default('AMS'),
    webhook_url: z.string(),
    auth_mode: z.string().nullish(),
    auto_activate: z.boolean().optional(),
    min_activate_vnd: money.optional(),
    env: z.string().nullish(),
    dev_mode: z.boolean().optional(),
    has_secret: z.boolean().optional(),
    recent: z
      .array(z.object({ id: idStr, at: z.string(), content: z.string().nullish(), amount_vnd: money, result: z.string().nullish(), customer: z.string().nullish() }).passthrough())
      .optional(),
  })
  .passthrough();
export type SepaySettings = z.infer<typeof sepaySettingsSchema>;

/* ---------- admin ---------- */
export const userSchema = z
  .object({ id: idStr, name: z.string().nullish(), email: z.string(), phone: z.string().nullish(), role: z.string(), customer_id: z.string().nullish(), customer_name: z.string().nullish(), status: z.string(), expires_at: z.string().nullish(), perm_count: z.coerce.number().optional() })
  .passthrough();
export type AdminUser = z.infer<typeof userSchema>;

export const auditSchema = z.object({ id: idStr, at: z.string(), actor: z.string().nullish(), action: z.string(), object: z.string().nullish(), ip: z.string().nullish() }).passthrough();
export type AuditRow = z.infer<typeof auditSchema>;

export const partnerSchema = z.object({ id: idStr, name: z.string(), protocol: z.string().nullish(), status: z.string(), enabled: z.boolean().optional(), ecpm_vnd: money.optional(), fill_rate: z.coerce.number().nullish(), endpoint: z.string().nullish(), auth: z.string().nullish() }).passthrough();
export type Partner = z.infer<typeof partnerSchema>;
export const floorSchema = z.object({ id: idStr, category: z.string(), floor_cpm_vnd: money, fill_rate: z.coerce.number().nullish() }).passthrough();
export type Floor = z.infer<typeof floorSchema>;

export const overviewSchema = z
  .object({
    kpi: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
    trend: z.array(z.object({ label: z.string(), views: z.coerce.number(), revenue_vnd: z.coerce.number() })).default([]),
    revenue_split: z.array(z.object({ name: z.string(), value: z.coerce.number() })).default([]),
    slot_fill: z.array(z.object({ day: z.string(), values: z.array(z.coerce.number()) })).default([]),
    alerts: z.array(z.object({ level: z.string(), title: z.string(), text: z.string().optional() })).default([]),
    top_campaigns: z.array(campaignSchema).default([]),
  })
  .passthrough();
export type Overview = z.infer<typeof overviewSchema>;

export const revenueSchema = z
  .object({ months: z.array(z.object({ label: z.string(), revenue_vnd: z.coerce.number(), reward_vnd: z.coerce.number() })).default([]) })
  .passthrough();
export type Revenue = z.infer<typeof revenueSchema>;

export const okSchema = z.object({}).passthrough();

/** GET /portal/v1/wallet: own wallet + receiving account for QR top-up */
export const portalWalletSchema = z
  .object({
    balance_vnd: money,
    reserved_vnd: money,
    spent_vnd: money,
    available_vnd: money.optional(),
    payment: z.object({ bank: z.string(), account_number: z.string(), account_holder: z.string(), prefix: z.string().default('AMS') }).nullish(),
  })
  .passthrough();
export type PortalWallet = z.infer<typeof portalWalletSchema>;

/* ---------- finance admin (a2): hàng đợi thủ công, hoàn tiền, nhật ký kích hoạt ---------- */
export const manualQueueSchema = z.object({
  items: z.array(
    z
      .object({ id: idStr, event_id: z.string().nullish(), reason: z.string(), customer_id: z.string().nullish(), topup_id: z.string().nullish(), received_at: z.string().nullish(), amount_vnd: money, content: z.string().nullish() })
      .passthrough(),
  ),
});
export type ManualItem = z.infer<typeof manualQueueSchema>['items'][number];
export const refundRequestsSchema = z.object({
  items: z.array(
    z
      .object({ id: idStr, customer_id: z.string(), customer_name: z.string().nullish(), amount_vnd: money, reason: z.string().nullish(), status: z.string(), decision_note: z.string().nullish(), created_at: z.string().nullish(), decided_at: z.string().nullish() })
      .passthrough(),
  ),
});
export type RefundRequest = z.infer<typeof refundRequestsSchema>['items'][number];
export const activationLogSchema = z.object({
  items: z.array(z.object({ id: idStr, customer_id: z.string().nullish(), trigger_topup_id: z.string().nullish(), actions: z.array(z.unknown()).default([]), created_at: z.string().nullish() }).passthrough()),
});
export type ActivationEntry = z.infer<typeof activationLogSchema>['items'][number];
