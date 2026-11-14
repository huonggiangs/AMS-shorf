// Dung 2 tai lieu OpenAPI 3.1 tu app that: danh sach route lay tu Hono (createApp + mountFinanceRoutes + createGateway),
// body tu zod that (extract.ts / protocol.ts), phan hoi tu apps/web-admin/src/api/schemas.ts + gateway-schemas.ts.
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z, type ZodTypeAny } from 'zod';
import { createTestRuntime } from '@ams/runtime/test';
import { createApp } from '@ams/api/app';
import { createGateway } from '@ams/edge-gateway';
import { heartbeatBody, registerBody, commandAckBody, eventsBody, HEADER, MAX_CLOCK_SKEW_S, MAX_EVENTS_PER_BATCH, PROTOCOL_VERSION, ERROR_CODES } from '@ams/edge-gateway/protocol';
import { extractFile, type Extracted } from './extract.js';
import * as W from '../../../apps/web-admin/src/api/schemas.js';
import * as G from './gateway-schemas.js';
import { mountFinanceRoutes } from '../../../services/api/src/finance-mount.js';
import { P0_PENDING } from './todo-p0.js';

export const REPO = resolve(import.meta.dirname, '../../..');

type Json = Record<string, unknown>;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export interface RouteKey {
  method: string;
  path: string; // dang Hono: /admin/v1/campaigns/:id
}

/* ------------------------------------------------------------------ route that */
type Live = { api: RouteKey[]; gateway: RouteKey[] };
let liveMemo: Promise<Live> | null = null;
/** Memo: moi tien trinh chi dung runtime thu + app mot lan (truoc day moi lan goi buildAll/liveRoutes lai nap lai toan bo => OOM tren may tai nang). */
export function liveRoutes(): Promise<Live> {
  return (liveMemo ??= liveRoutesUncached());
}
async function liveRoutesUncached(): Promise<Live> {
  // chi liet ke route (khong cham DB): sqlite nhe hon pglite (WASM ~vai tram MB)
  const rt = await createTestRuntime({ dialect: 'sqlite' });
  try {
    const app = createApp(rt, { mountFinance: (a, r) => mountFinanceRoutes(a, r) });
    const gw = createGateway(rt);
    const pick = (routes: readonly { method: string; path: string }[]): RouteKey[] => {
      const seen = new Set<string>();
      const out: RouteKey[] = [];
      for (const r of routes) {
        if (r.method === 'ALL' || r.path.endsWith('/*')) continue;
        const k = `${r.method} ${r.path}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ method: r.method, path: r.path });
      }
      return out.sort((a, b) => cmp(a.path, b.path) || cmp(a.method, b.method));
    };
    return { api: pick(app.routes), gateway: pick(gw.app.routes) };
  } finally {
    await (rt as unknown as { close?: () => Promise<void> }).close?.();
  }
}

/* ------------------------------------------------------------------ nguon trich xuat */
const SRC: { file: string; prefixes: string[] }[] = [
  { file: 'services/api/src/auth/routes.ts', prefixes: ['/auth'] },
  { file: 'services/api/src/routes/devices.ts', prefixes: ['/admin/v1/devices'] },
  { file: 'services/api/src/routes/campaigns.ts', prefixes: ['/admin/v1/campaigns', '/portal/v1/campaigns'] },
  { file: 'services/api/src/routes/customers.ts', prefixes: ['/admin/v1/customers'] },
  { file: 'services/api/src/routes/contracts.ts', prefixes: ['/admin/v1/contracts'] },
  { file: 'services/api/src/routes/approvals.ts', prefixes: ['/admin/v1/approvals'] },
  { file: 'services/api/src/routes/media.ts', prefixes: ['/admin/v1/media', '/portal/v1/media'] },
  { file: 'services/api/src/routes/screens.ts', prefixes: ['/admin/v1/screens'] },
  { file: 'services/api/src/routes/schedule.ts', prefixes: ['/admin/v1/schedule'] },
  { file: 'services/api/src/routes/users.ts', prefixes: ['/admin/v1/users', '/admin/v1/permissions'] },
  { file: 'services/api/src/routes/audit-log.ts', prefixes: ['/admin/v1/audit-log'] },
  { file: 'services/api/src/routes/dashboard.ts', prefixes: ['/admin/v1/dashboard'] },
  { file: 'services/api/src/routes/revenue.ts', prefixes: ['/admin/v1/revenue'] },
  { file: 'services/api/src/routes/partners.ts', prefixes: ['/admin/v1/partners'] },
  { file: 'services/api/src/routes/rtb-floors.ts', prefixes: ['/admin/v1/rtb-floors'] },
  { file: 'services/api/src/routes/pricing.ts', prefixes: ['/admin/v1/rate-cards'] },
  { file: 'services/api/src/routes/pricing-quote.ts', prefixes: ['/admin/v1/pricing', '/portal/v1/pricing'] },
  { file: 'services/api/src/routes/portal.ts', prefixes: ['/portal/v1'] },
  { file: 'services/api/src/routes/history.ts', prefixes: ['/admin/v1/history', '/portal/v1/history'] },
  { file: 'services/api/src/routes/invoices.ts', prefixes: ['/admin/v1/invoices', '/admin/v1/payouts', '/portal/v1/invoices'] },
  { file: 'services/api/src/routes/tv-experience.ts', prefixes: ['/admin/v1/tv-experience'] },
  { file: 'services/payments/src/routes.ts', prefixes: [''] },
];

export interface Coverage {
  routes: number;
  withBodyExtracted: number;
  withoutExtraction: string[];
  unresolved: string[];
}

async function extractAll(): Promise<Map<string, Extracted & { src: string }>> {
  const map = new Map<string, Extracted & { src: string }>();
  for (const s of SRC) {
    const fe = await extractFile(resolve(REPO, s.file));
    if (fe.unresolved.length) throw new Error(`Khong eval duoc schema body trong ${s.file}: ${fe.unresolved.map((u) => `${u.method} ${u.subpath} (${u.reason})`).join('; ')}`);
    for (const r of fe.routes) for (const p of s.prefixes) map.set(`${r.method} ${p}${r.subpath === '/' ? '' : r.subpath}`, { ...r, src: `${s.file}:${r.line}` });
  }
  return map;
}

/* ------------------------------------------------------------------ JSON schema */
const J = (s: ZodTypeAny): Json => {
  const out = zodToJsonSchema(s, { target: 'jsonSchema2019-09', $refStrategy: 'none', effectStrategy: 'input', removeAdditionalStrategy: 'strict', pipeStrategy: 'input' }) as Json;
  delete out['$schema'];
  return out;
};

class Components {
  schemas: Record<string, Json> = {};
  add(name: string, s: ZodTypeAny | Json): Json {
    this.schemas[name] = typeof (s as ZodTypeAny).safeParse === 'function' ? J(s as ZodTypeAny) : (s as Json);
    return { $ref: `#/components/schemas/${name}` };
  }
}
/**
 * web-admin dung zod 3.24.1, goi nay dung 3.25.76: gan truc tiep schema cua web vao ZodTypeAny buoc tsc so sanh cau truc hai ban zod (hang chuc schema lon)
 * => bo nho tang vot (OOM/Killed 137 tren may tai nang). Ep kieu qua `unknown` bo qua phep so sanh do; luc chay hai ban tuong thich.
 */
const asZ = (s: unknown): ZodTypeAny => s as ZodTypeAny;
const ref = (n: string): Json => ({ $ref: `#/components/schemas/${n}` });

/* ------------------------------------------------------------------ phan hoi admin */
const ITEM: Record<string, [string, ZodTypeAny]> = {
  devices: ['Device', asZ(W.deviceSchema)],
  campaigns: ['Campaign', asZ(W.campaignSchema)],
  customers: ['Customer', asZ(W.customerSchema)],
  contracts: ['Contract', asZ(W.contractSchema)],
  media: ['Media', asZ(W.mediaSchema)],
  screens: ['Screen', asZ(W.screenSchema)],
  schedule: ['ScheduleSlot', asZ(W.slotSchema)],
  users: ['AdminUser', asZ(W.userSchema)],
  'audit-log': ['AuditEntry', asZ(W.auditSchema)],
  partners: ['Partner', asZ(W.partnerSchema)],
  'rtb-floors': ['RtbFloor', asZ(W.floorSchema)],
  'rate-cards': ['RateCard', asZ(W.rateCardSchema)],
  topups: ['Topup', asZ(W.topupSchema)],
  wallets: ['Wallet', asZ(W.walletSchema)],
};
const SPECIAL: [RegExp, string, ZodTypeAny][] = [
  [/^POST \/auth\/login$/, 'LoginResult', asZ(W.loginSchema)],
  [/^GET \/auth\/me$/, 'Me', asZ(W.meSchema)],
  [/^POST \/auth\/mfa\/enroll$/, 'MfaEnroll', asZ(W.enrollSchema)],
  [/^POST \/admin\/v1\/campaigns\/:id\/approve$/, 'ApproveResult', asZ(W.approveResultSchema)],
  [/^POST \/admin\/v1\/contracts\/:id\/render$/, 'ContractRender', asZ(W.contractRenderSchema)],
  [/^POST \/(admin|portal)\/v1\/media\/upload-url$/, 'UploadUrl', asZ(W.uploadUrlSchema)],
  [/^(GET|PUT) \/admin\/v1\/settings\/sepay$/, 'SepaySettings', asZ(W.sepaySettingsSchema)],
  [/^GET \/admin\/v1\/dashboard\/overview$/, 'Overview', asZ(W.overviewSchema)],
  [/^GET \/admin\/v1\/revenue$/, 'Revenue', asZ(W.revenueSchema)],
  [/^GET \/portal\/v1\/wallet$/, 'PortalWallet', asZ(W.portalWalletSchema)],
  [/^POST \/portal\/v1\/topups$/, 'TopupCreated', asZ(W.topupCreateSchema)],
  [/^GET \/admin\/v1\/payments\/manual-queue$/, 'ManualQueue', asZ(W.manualQueueSchema)],
  [/^GET \/(admin|portal)\/v1\/(wallet\/)?refund-requests$/, 'RefundRequests', asZ(W.refundRequestsSchema)],
  [/^GET \/admin\/v1\/activation-log$/, 'ActivationLog', asZ(W.activationLogSchema)],
  [/^GET \/(admin|portal)\/v1\/(pricing|campaigns\/:id)\/quote$/, 'Quote', asZ(W.quoteSchema)],
];

function adminResponse(c: Components, method: string, path: string, list: boolean): { schema: Json; note?: string } {
  const key = `${method} ${path}`;
  for (const [re, name, zs] of SPECIAL) if (re.test(key)) return { schema: c.add(name, zs) };
  const m = /^\/(?:admin|portal)\/v1\/([a-z-]+)(\/:[A-Za-z]+)?$/.exec(path);
  const hit = m ? ITEM[m[1]!] : undefined;
  if (hit) {
    const [name, zs] = hit;
    const item = c.add(name, zs);
    if (method === 'GET' && !m![2] && list) {
      return { schema: c.add(`${name}Page`, { type: 'object', properties: { items: { type: 'array', items: item }, total: { type: 'integer' }, page: { type: 'integer' }, page_size: { type: 'integer' } }, required: ['items', 'total', 'page', 'page_size'] }) };
    }
    if (method !== 'DELETE') return { schema: item };
  }
  return { schema: ref('GenericObject'), note: 'Hình dạng phản hồi chưa có schema zod dùng chung; xem mã nguồn route.' };
}

/* ------------------------------------------------------------------ chung */
const pascal = (s: string) => s.replace(/(^|[-_ ])(\w)/g, (_, __, ch: string) => ch.toUpperCase());
function operationId(method: string, path: string): string {
  const scope = path.startsWith('/admin/v1') ? 'admin' : path.startsWith('/portal/v1') ? 'portal' : path.startsWith('/auth') ? 'auth' : path.startsWith('/webhooks') ? 'webhook' : path.startsWith('/v1') ? 'device' : '';
  const rest = path.replace(/^\/(admin\/v1|portal\/v1|auth|webhooks|v1)/, '');
  const segs = rest.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? 'By' + pascal(s.slice(1)) : pascal(s)));
  return scope + pascal(method.toLowerCase()) + (segs.join('') || (scope ? '' : 'Health'));
}
const oaPath = (p: string) => p.replace(/:([A-Za-z]+)/g, '{$1}');
const pathParams = (p: string): Json[] => [...p.matchAll(/:([A-Za-z]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));

const ERR = (c: Components): void => {
  c.add('ErrorBody', { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string', description: 'snake_case, vd validation_error, forbidden, not_found, invalid_state' }, message: { type: 'string', description: 'Tiếng Việt cho người dùng' }, details: {} }, required: ['code', 'message'] } }, required: ['error'] });
  c.add('GenericObject', { type: 'object', additionalProperties: true });
};
const errResponses = (): Json => ({
  '4XX': { $ref: '#/components/responses/Error' },
  '5XX': { $ref: '#/components/responses/Error' },
});
const ERROR_RESPONSE: Json = { description: 'Lỗi: luôn có dạng { error: { code, message, details? } }', content: { 'application/json': { schema: ref('ErrorBody') } } };

const LIST_PARAMS: Json[] = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'page_size', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 } },
  { name: 'q', in: 'query', description: 'Tìm kiếm văn bản (các cột tìm kiếm của danh sách)', schema: { type: 'string' } },
  { name: 'sort', in: 'query', description: '`<trường>:<asc|desc>`', schema: { type: 'string' } },
  { name: 'filter', in: 'query', description: '`khoá:giá trị,khoá:giá trị` hoặc truyền từng khoá bộ lọc làm query riêng', schema: { type: 'string' } },
];

const PUBLIC = [/^GET \/health$/, /^POST \/auth\/login$/, /^POST \/auth\/mfa\/verify$/, /^POST \/auth\/invite\/accept$/, /^POST \/webhooks\//];

/* ------------------------------------------------------------------ tai lieu admin */
export async function buildAdminDoc(routes: RouteKey[], ex: Map<string, Extracted & { src: string }>, cov: Coverage): Promise<Json> {
  const c = new Components();
  ERR(c);
  const paths: Record<string, Record<string, Json>> = {};
  const ids = new Set<string>();
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    const e = ex.get(key);
    cov.routes++;
    if (!e) cov.withoutExtraction.push(key);
    const id = operationId(r.method, r.path);
    if (ids.has(id)) throw new Error(`operationId trung: ${id}`);
    ids.add(id);
    const isPortal = r.path.startsWith('/portal/v1');
    const res = adminResponse(c, r.method, r.path, !!e?.list || (r.method === 'GET' && /\/v1\/(topups|wallets|refund-requests|wallet-adjustments)$/.test(r.path)));
    const status = e?.statuses.length ? Math.min(...e.statuses) : 200;
    const isPub = PUBLIC.some((re) => re.test(key));
    const isWebhook = r.path.startsWith('/webhooks');
    const op: Json = {
      operationId: id,
      tags: [r.path.split('/').filter((s) => s && !['admin', 'portal', 'v1'].includes(s))[0] ?? 'system'],
      summary: `${r.method} ${oaPath(r.path)}`,
      parameters: [...pathParams(r.path), ...(e?.list ? LIST_PARAMS : [])],
    };
    const desc: string[] = [];
    if (e?.perm) {
      op['x-ams-permission'] = { module: e.perm.module, action: e.perm.action, ...(e.perm.kind ? { account: e.perm.kind } : {}) };
      desc.push(`Quyền cần có: mô-đun \`${e.perm.module}\`, hành động \`${e.perm.action}\` (kiểm ở máy chủ; ma trận mặc định ở packages/config/src/rbac.ts).`);
    }
    if (isPortal) desc.push('Chỉ tài khoản ngoài (customer/partner); dữ liệu luôn bị lọc theo customer_id trong câu SQL.');
    if (r.path.startsWith('/admin/v1')) desc.push('Chỉ tài khoản nội bộ.');
    if (res.note) desc.push(res.note);
    if (e) op['x-ams-source'] = e.src;
    if (desc.length) op['description'] = desc.join('\n\n');
    if (e?.body) {
      cov.withBodyExtracted++;
      op['requestBody'] = { required: true, content: { 'application/json': { schema: c.add(`${pascal(id)}Request`, e.body) } } };
    } else if (e?.bodyExpr) throw new Error('body chua eval: ' + key);
    op['responses'] = {
      [String(status)]: { description: status === 201 ? 'Đã tạo' : 'Thành công', content: { 'application/json': { schema: res.schema } } },
      ...errResponses(),
    };
    if (r.method === 'DELETE' && !e?.statuses.length) (op['responses'] as Json)['200'] = { description: 'Đã xóa', content: { 'application/json': { schema: ref('GenericObject') } } };
    if (isWebhook) {
      op['security'] = [{ sepayHmac: [], sepayTimestamp: [] }, { sepayApiKey: [] }];
      op['description'] = 'SePay gọi vào đây khi có giao dịch. Xác thực HMAC-SHA256 (`X-SePay-Signature: sha256=<hex>` + `X-SePay-Timestamp`, lệch >5 phút bị từ chối) hoặc `Authorization: Apikey <khóa>`. Trả `{"success":true}`; webhook trùng (cùng `id`) chỉ cộng tiền một lần.';
    } else if (isPub) op['security'] = [];
    else if (r.path === '/auth/mfa/enroll') op['security'] = [{}, { cookieAuth: [] }];
    else op['security'] = [r.method === 'GET' ? { cookieAuth: [] } : { cookieAuth: [], csrfToken: [] }];
    (paths[oaPath(r.path)] ??= {})[r.method.toLowerCase()] = op;
  }

  const doc: Json = {
    openapi: '3.1.0',
    info: {
      title: 'AMS - Admin / Customer API',
      version: '0.1.0',
      summary: 'API quản trị + cổng khách hàng + webhook thanh toán của hệ thống quản lý quảng cáo AMS',
      description: [
        'File này được SINH TỰ ĐỘNG (`pnpm --filter @ams/openapi generate`); không sửa tay. `pnpm --filter @ams/openapi check` báo lỗi khi file lệch khỏi route/zod thật.',
        '',
        'Nguồn: danh sách route lấy từ ứng dụng Hono thật (`createApp` + `mountFinanceRoutes`); body request trích từ zod thật trong `services/api` và `services/payments`; ' +
          'schema phản hồi lấy từ `apps/web-admin/src/api/schemas.ts` (hợp đồng phía client, dạng *input*; `additionalProperties: true` nghĩa là có thể có thêm trường).',
        '',
        'Xác thực: cookie `ams_session` (HttpOnly, SameSite=Lax) + header `X-CSRF-Token` cho phương thức ghi. Lỗi: `{ "error": { "code", "message", "details"? } }`.',
        'Số tiền luôn là số nguyên đồng (VND), không dùng số thực.',
        '',
        '## TODO (p0-domain): chưa có trong tài liệu này',
        'Endpoint lệnh thiết bị phía admin (tạo/liệt kê/huỷ `device_commands`), trạng thái chiến dịch mới, outbox, chi tiêu. p0-domain đang bổ sung; khi route xuất hiện, `check` sẽ báo lệch, chạy lại `generate` (yêu cầu ở ops/agents/g1-openapi.requests.md).',
      ].join('\n'),
    },
    servers: [{ url: 'http://api.ams.localhost', description: 'Docker local (Caddy)' }, { url: 'http://localhost:8787', description: 'API trực tiếp (dev)' }],
    tags: [...new Set(Object.values(paths).flatMap((m) => Object.values(m).flatMap((o) => o['tags'] as string[])))].sort(cmp).map((name) => ({ name })),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => cmp(a, b))),
    components: {
      schemas: Object.fromEntries(Object.entries(c.schemas).sort(([a], [b]) => cmp(a, b))),
      responses: { Error: ERROR_RESPONSE },
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ams_session' },
        csrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: 'Bắt buộc cho POST/PUT/PATCH/DELETE; lấy từ /auth/me hoặc phản hồi đăng nhập (`csrf_token`).' },
        sepayHmac: { type: 'apiKey', in: 'header', name: 'X-SePay-Signature', description: '`sha256=<hex HMAC-SHA256 của body (có timestamp)>`' },
        sepayTimestamp: { type: 'apiKey', in: 'header', name: 'X-SePay-Timestamp' },
        sepayApiKey: { type: 'apiKey', in: 'header', name: 'Authorization', description: '`Apikey <khóa>`' },
      },
    },
    'x-todo': P0_PENDING.admin,
  };
  return doc;
}

/* ------------------------------------------------------------------ tai lieu gateway */
export function buildGatewayDoc(routes: RouteKey[]): Json {
  const c = new Components();
  ERR(c);
  const sigHeaders = (withDeviceId: boolean): Json[] => [
    ...(withDeviceId ? [{ name: HEADER.deviceId, in: 'header', required: true, schema: { type: 'string' }, description: 'device_id từ /v1/register' }] : []),
    { name: HEADER.timestamp, in: 'header', required: true, schema: { type: 'integer' }, description: `epoch giây; lệch máy chủ tối đa ${MAX_CLOCK_SKEW_S}s` },
    { name: HEADER.nonce, in: 'header', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,64}$' }, description: 'dùng một lần (chống phát lại)' },
    { name: HEADER.signature, in: 'header', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{86}$' }, description: 'Ed25519, base64url không padding (64 byte)' },
  ];
  const json = (name: string, s: ZodTypeAny, description: string): Json => ({ description, content: { 'application/json': { schema: c.add(name, s) } } });
  const sig: Json[] = [{ deviceSignature: [] }];
  const common429 = { '401': { $ref: '#/components/responses/Error' }, '403': { $ref: '#/components/responses/Error' }, '409': { $ref: '#/components/responses/Error' }, '413': { $ref: '#/components/responses/Error' }, '422': { $ref: '#/components/responses/Error' }, '429': { $ref: '#/components/responses/RetryLater' }, '503': { $ref: '#/components/responses/RetryLater' } };
  const defs: Record<string, Json> = {
    'POST /v1/register': {
      summary: 'Đăng ký thiết bị (idempotent theo pubkey)',
      description: 'Ký bằng chính khóa riêng tương ứng `pubkey` trong body (không có X-Device-Id). Trả `attestation_nonce` để kiểm chứng. Giới hạn theo IP.',
      parameters: sigHeaders(false),
      requestBody: { required: true, content: { 'application/json': { schema: c.add('RegisterRequest', registerBody) } } },
      responses: { '200': json('RegisterResponse', G.registerResponse, 'Đã đăng ký trước đó'), '201': { description: 'Thiết bị mới', content: { 'application/json': { schema: ref('RegisterResponse') } } }, ...common429 },
    },
    'POST /v1/pair': {
      summary: 'Xin mã ghép đôi 6 số / hỏi trạng thái ghép đôi',
      description: 'Body rỗng. Hiển thị `code` trên TV; người dùng nhập vào app điện thoại (API khách gọi `redeemPairingCode`).',
      parameters: sigHeaders(true),
      responses: { '200': json('PairResponse', G.pairResponse, 'paired=true hoặc mã mới'), ...common429 },
    },
    'POST /v1/heartbeat': {
      summary: 'Nhịp sống + nhận lệnh',
      description: `Thân tối đa 2 KB. Trả khoảng nghỉ kế tiếp có jitter, etag manifest và lệnh đang chờ (giao at-least-once; xác nhận qua \`cmd_ack\` hoặc /v1/commands/ack). 429/503 kèm \`Retry-After\`.`,
      parameters: sigHeaders(true),
      requestBody: { required: false, content: { 'application/json': { schema: c.add('HeartbeatRequest', heartbeatBody) } } },
      responses: { '200': json('HeartbeatResponse', G.heartbeatResponse, 'OK'), ...common429 },
    },
    'POST /v1/commands/ack': {
      summary: 'Báo kết quả lệnh',
      parameters: sigHeaders(true),
      requestBody: { required: true, content: { 'application/json': { schema: c.add('CommandAckRequest', commandAckBody) } } },
      responses: { '200': json('CommandAckResponse', G.commandAckResponse, 'OK'), ...common429 },
    },
    'GET /v1/manifest': {
      summary: 'Manifest của thiết bị (đầy đủ hoặc delta)',
      description: 'Điều kiện: `If-None-Match`/`?etag=` trùng => 304. `?delta=1&etag=<base>` => bản delta nếu còn. Header `X-Manifest-Kind: full|delta`. Thiết bị PHẢI kiểm `sha256` từng creative trước khi phát.',
      parameters: [
        ...sigHeaders(true),
        { name: 'daypart', in: 'query', schema: { type: 'string', pattern: '^[a-z_]{1,16}$' } },
        { name: 'etag', in: 'query', schema: { type: 'string' } },
        { name: 'delta', in: 'query', schema: { type: 'string', enum: ['1'] } },
        { name: 'If-None-Match', in: 'header', schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Manifest', headers: { ETag: { schema: { type: 'string' } }, 'X-Manifest-Kind': { schema: { type: 'string', enum: ['full', 'delta'] } } }, content: { 'application/json': { schema: { oneOf: [c.add('Manifest', G.manifest), c.add('ManifestDelta', G.manifestDelta)] } } } },
        '304': { description: 'Không đổi' },
        ...common429,
      },
    },
    'GET /v1/manifest/g/:group': {
      summary: 'Manifest công khai theo nhóm (cache CDN)',
      description: 'Không cần chữ ký; tắt bằng `MANIFEST_PUBLIC=0`. `group` lấy từ `manifest_group` của heartbeat.',
      security: [],
      parameters: [
        { name: 'etag', in: 'query', schema: { type: 'string' } },
        { name: 'delta', in: 'query', schema: { type: 'string', enum: ['1'] } },
      ],
      responses: {
        '200': { description: 'Manifest', content: { 'application/json': { schema: { oneOf: [ref('Manifest'), ref('ManifestDelta')] } } } },
        '304': { description: 'Không đổi' },
        '404': { $ref: '#/components/responses/Error' },
        '503': { $ref: '#/components/responses/RetryLater' },
      },
    },
    'POST /v1/events': {
      summary: `Gửi lô sự kiện (tối đa ${MAX_EVENTS_PER_BATCH}, idempotent theo event_id)`,
      description: 'Thân tối đa 16 KB. Impression hợp lệ khi vcr_pct >= ngưỡng; sự kiện không có trong manifest bị từ chối từng cái (`rejected`).',
      parameters: sigHeaders(true),
      requestBody: { required: true, content: { 'application/json': { schema: c.add('EventsRequest', eventsBody) } } },
      responses: { '202': json('EventsResponse', G.eventsResponse, 'Đã nhận'), ...common429 },
    },
    'GET /health': {
      summary: 'Sức khỏe dịch vụ',
      security: [],
      parameters: [],
      responses: { '200': json('Health', G.health, 'OK') },
    },
  };

  const paths: Record<string, Record<string, Json>> = {};
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    const d = defs[key];
    if (!d) throw new Error(`Gateway co route chua duoc dac ta trong build.ts: ${key} (ghi vao defs hoac them o P0_PENDING)`);
    const id = operationId(r.method, r.path === '/health' ? '/health' : r.path);
    (paths[oaPath(r.path)] ??= {})[r.method.toLowerCase()] = { operationId: id.replace(/^device/, 'gateway'), tags: [r.path === '/health' ? 'system' : 'device'], security: sig, 'x-ams-source': 'services/edge-gateway/src/gateway.ts', ...d };
  }
  for (const k of Object.keys(defs)) if (!routes.some((r) => `${r.method} ${r.path}` === k)) throw new Error(`Dac ta gateway co route khong con ton tai: ${k}`);

  return {
    openapi: '3.1.0',
    info: {
      title: 'AMS - Device Gateway API',
      version: `0.1.0-protocol.${PROTOCOL_VERSION}`,
      summary: 'Giao thức thiết bị (TV/thang máy/LED) <-> edge gateway',
      description: [
        'File SINH TỰ ĐỘNG từ gateway thật (route Hono + zod trong `services/edge-gateway/src/protocol.ts`). Mô tả văn xuôi: docs/DEVICE-PROTOCOL.md.',
        '',
        '## Chữ ký thiết bị (Ed25519)',
        `Mỗi request (trừ /health và /v1/manifest/g/{group}) mang 4 header: \`${HEADER.deviceId}\`, \`${HEADER.timestamp}\`, \`${HEADER.nonce}\`, \`${HEADER.signature}\`.`,
        'Chuỗi ký (UTF-8, nối bằng `\\n`): `METHOD\\nPATH?QUERY\\nTIMESTAMP\\nNONCE\\nSHA256_HEX(body)`; body rỗng => sha256 của chuỗi rỗng. `PATH?QUERY` đúng như gửi trên đường truyền.',
        `Lệch đồng hồ > ${MAX_CLOCK_SKEW_S}s => 401 \`stale_timestamp\`; nonce dùng lại => 409 \`replay\`.`,
        '',
        '## Lỗi',
        `Mã: ${Object.entries(ERROR_CODES).map(([k, v]) => `\`${k}\` (${v})`).join(', ')}. 429/503 kèm \`Retry-After\` (đã jitter): thiết bị PHẢI chờ đúng giá trị đó.`,
        '',
        '## TODO (p0-domain): chưa có trong tài liệu này',
        'Endpoint admin để tạo/xem lệnh (hiện chỉ có hàm `enqueueCommand`, chưa có route HTTP) và loại lệnh mới do p0-domain bổ sung. `/v1/commands/ack` và `commands[]` của heartbeat (bảng `device_commands`) đã có và được sinh từ mã; xem docs/DEVICE-PROTOCOL.md mục 6. Khi p0 thêm route, `check` báo lệch; chạy lại `generate`.',
      ].join('\n'),
    },
    servers: [{ url: 'http://gw.ams.localhost', description: 'Docker local (Caddy)' }, { url: 'http://localhost:8788', description: 'Gateway trực tiếp (dev)' }],
    tags: [{ name: 'device', description: 'Thiết bị đã ký' }, { name: 'system' }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => cmp(a, b))),
    components: {
      schemas: Object.fromEntries(Object.entries(c.schemas).sort(([a], [b]) => cmp(a, b))),
      responses: {
        Error: ERROR_RESPONSE,
        RetryLater: { description: 'Quá tải hoặc quá giới hạn: chờ `Retry-After` giây rồi thử lại', headers: { 'Retry-After': { schema: { type: 'integer' } } }, content: { 'application/json': { schema: ref('ErrorBody') } } },
      },
      securitySchemes: {
        deviceSignature: { type: 'apiKey', in: 'header', name: HEADER.signature, description: 'Ed25519 trên METHOD\\nPATH?QUERY\\nTIMESTAMP\\nNONCE\\nSHA256(body); kèm X-Device-Id, X-Timestamp, X-Nonce.' },
      },
    },
    'x-todo': P0_PENDING.gateway,
  };
}

type Built = { admin: Json; gateway: Json; coverage: Coverage };
let builtMemo: Promise<Built> | null = null;
/** Memo trong tien trinh: ket qua chi doc (render/so sanh), khong sua. */
export function buildAll(): Promise<Built> {
  return (builtMemo ??= buildAllUncached());
}
async function buildAllUncached(): Promise<Built> {
  const live = await liveRoutes();
  const ex = await extractAll();
  const coverage: Coverage = { routes: 0, withBodyExtracted: 0, withoutExtraction: [], unresolved: [] };
  const admin = await buildAdminDoc(live.api, ex, coverage);
  const gateway = buildGatewayDoc(live.gateway);
  return { admin, gateway, coverage };
}
