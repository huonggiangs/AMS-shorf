// e2e smoke: Postgres 16 THAT (embedded-postgres) + Redis THAT (redis-server) + S3/SMTP gia (tests/e2e/fakes.ts).
// Khoi dong: migrate+seed (CLI that cua @ams/api) -> API (node.ts, createDockerRuntime) -> gateway -> ingest-consumer, roi di het luong.
// Chay: `pnpm e2e:smoke` o goc repo. Thoat 0 neu moi buoc PASS.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { generateTotpSecret, hmacSha256Hex, sha256Hex, totp, uuidv7 } from '@ams/shared';
import { VirtualDevice, Recorder, httpTransport } from '@ams/sim';
import type { Manifest } from '@ams/edge-gateway/protocol';
import { startNode as startApi } from '@ams/api/node';
import { enqueueCommand } from '@ams/edge-gateway';
import type { Runtime } from '@ams/runtime';
import { startNode as startGateway } from '@ams/edge-gateway/node';
import { startConsumer } from '@ams/ingest-consumer/node';
import { startFakeS3, startFakeSmtp, type FakeS3, type FakeSmtp } from './fakes.js';

// ------------------------------------------------------------------ khung bao cao
type Status = 'PASS' | 'FAIL' | 'SKIP';
const results: { n: string; name: string; status: Status; detail: string; ms: number }[] = [];
let failed = false;
let counter = 0;

async function step(name: string, fn: () => Promise<string | void>, opts: { needs?: boolean } = {}): Promise<boolean> {
  const n = `S${String(++counter).padStart(2, '0')}`;
  if (opts.needs === false) {
    results.push({ n, name, status: 'SKIP', detail: 'bo qua vi buoc truoc that bai', ms: 0 });
    return false;
  }
  const t0 = Date.now();
  try {
    const d = (await fn()) ?? '';
    results.push({ n, name, status: 'PASS', detail: d, ms: Date.now() - t0 });
    return true;
  } catch (e) {
    failed = true;
    results.push({ n, name, status: 'FAIL', detail: (e as Error).message.split('\n')[0]!.slice(0, 300), ms: Date.now() - t0 });
    if (process.env['E2E_VERBOSE']) console.error(e);
    return false;
  }
}
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
function eq(actual: unknown, expected: unknown, what: string): void {
  if (canon(actual) !== canon(expected)) throw new Error(`${what}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function ok(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(what);
}
async function waitFor<T>(what: string, fn: () => Promise<T | null | false | undefined>, timeoutMs = 15_000, every = 150): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`het gio cho: ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ ha tang
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}
async function redisPing(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const c = connect(port, '127.0.0.1', () => c.write('PING\r\n'));
    c.on('data', (d) => {
      c.destroy();
      resolve(d.toString().startsWith('+PONG'));
    });
    c.on('error', () => resolve(false));
  });
}
function run(cmd: string, args: string[], env: Record<string, string | undefined>, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env } as NodeJS.ProcessEnv, cwd });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} -> ${code}\n${out.slice(-800)}`))));
  });
}

// ------------------------------------------------------------------ client HTTP co cookie + CSRF
class Http {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(private baseFn: () => string) {}
  get base(): string {
    return this.baseFn();
  }
  async call<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Headers }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const h: Record<string, string> = { ...headers };
    if (this.cookies.size) h['cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
    if (method !== 'GET' && this.csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = this.csrf;
    const res = await fetch(this.base + path, { method, headers: h, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(';');
      const i = kv!.indexOf('=');
      const k = kv!.slice(0, i);
      const v = kv!.slice(i + 1);
      if (v === '' || /max-age=0/i.test(sc)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json as T, headers: res.headers };
  }
  /** goi va ky vong ma HTTP */
  async expect<T = any>(status: number, method: string, path: string, body?: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await this.call<T>(method, path, body);
    if (r.status !== status) throw new Error(`${method} ${path} -> ${r.status} (muon ${status}): ${JSON.stringify(r.body).slice(0, 240)}`);
    return r.body;
  }
  async loginMfa(email: string, password: string, secret: string | null, atMs = Date.now()): Promise<void> {
    const r1 = await this.expect<{ mfa_required: boolean; mfa_token?: string; csrf_token?: string }>(200, 'POST', '/auth/login', { email, password });
    if (!r1.mfa_required) {
      this.csrf = r1.csrf_token ?? '';
      return;
    }
    ok(secret, 'can bi mat TOTP');
    const r2 = await this.expect<{ csrf_token: string }>(200, 'POST', '/auth/mfa/verify', { mfa_token: r1.mfa_token, code: await totp(secret, atMs) });
    this.csrf = r2.csrf_token;
  }
}

// ------------------------------------------------------------------ main
const ROOT = new URL('../../', import.meta.url).pathname;
const BUCKET = 'ams-media';
const PRICE_MICRO = 20_500_000; // 20,5 VND / impression: kiem phan du micro-VND
const SECRET_SEPAY = 'e2e-sepay-secret-' + randomBytes(6).toString('hex');
const ADMIN_EMAIL = 'e2e-admin@ams.local';
const ADMIN_PASSWORD = 'E2e-Admin-Passw0rd!';
const ADMIN_TOTP = generateTotpSecret();

const cleanups: (() => Promise<void> | void)[] = [];
async function cleanup(): Promise<void> {
  for (const c of cleanups.reverse()) {
    try {
      await c();
    } catch {
      /* bo qua */
    }
  }
}

async function main(): Promise<void> {
  // ---------- Postgres that
  const pgPort = await freePort();
  const pgDir = join(tmpdir(), `ams-e2e-pg-${process.pid}-${Date.now()}`);
  const epg = new EmbeddedPostgres({ databaseDir: pgDir, user: 'ams', password: 'ams', port: pgPort, persistent: false, onLog: () => undefined, onError: () => undefined });
  const dbUrl = `postgres://ams:ams@127.0.0.1:${pgPort}/ams`;
  let pgc!: pg.Client;
  const q = async <T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pgc.query(sql, params)).rows as T[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0] ?? {};
  const num = (v: unknown) => Number(v ?? 0);

  const upPg = await step('Postgres 16 that (embedded-postgres) khoi dong', async () => {
    await epg.initialise();
    await epg.start();
    cleanups.push(async () => {
      try {
        await pgc?.end();
      } catch {
        /* */
      }
      await epg.stop();
      if (existsSync(pgDir)) rmSync(pgDir, { recursive: true, force: true });
    });
    await epg.createDatabase('ams');
    pgc = new pg.Client({ connectionString: dbUrl });
    await pgc.connect();
    const v = String((await one('SHOW server_version')).server_version);
    ok(v.startsWith('16'), `phien ban ${v}`);
    return `server_version ${v}`;
  });

  // ---------- Redis that
  const redisPort = await freePort();
  const upRedis = await step('Redis that (redis-server) khoi dong', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ams-e2e-redis-'));
    const proc: ChildProcess = spawn('redis-server', ['--port', String(redisPort), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: 'ignore' });
    cleanups.push(() => {
      proc.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
    });
    await waitFor('redis PONG', () => redisPing(redisPort), 8000, 100);
    const ver = execFileSync('redis-server', ['--version']).toString().match(/v=(\S+)/)?.[1];
    return `redis ${ver} cong ${redisPort}`;
  });

  // ---------- S3 + SMTP gia
  let s3!: FakeS3;
  let smtp!: FakeSmtp;
  await step('S3 gia + SMTP gia (chay qua TCP that)', async () => {
    s3 = await startFakeS3(BUCKET);
    smtp = await startFakeSmtp();
    cleanups.push(() => s3.close());
    cleanups.push(() => smtp.close());
    return `s3 :${s3.port}, smtp :${smtp.port}`;
  });

  const env: Record<string, string> = {
    DATABASE_URL: dbUrl,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    S3_ENDPOINT: s3?.url ?? '',
    S3_PUBLIC_ENDPOINT: s3?.url ?? '',
    S3_REGION: 'us-east-1',
    S3_BUCKET: BUCKET,
    S3_ACCESS_KEY: 'e2e-access',
    S3_SECRET_KEY: 'e2e-secret',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp?.port ?? 1025),
    MAIL_FROM: 'AMS <no-reply@ams.test>',
    SESSION_SECRET: randomBytes(32).toString('base64'),
    FIELD_ENC_KEY: randomBytes(32).toString('base64'),
    SEPAY_MODE: 'production',
    SEPAY_WEBHOOK_SECRET: SECRET_SEPAY,
    PUBLIC_ADMIN_URL: 'http://admin.ams.test',
    PORTAL_PUBLIC_URL: 'http://portal.ams.test',
    TRUST_PROXY: '1',
    SCRYPT_N: '1024',
    SEED_ADMIN_EMAIL: ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
    SEED_ADMIN_TOTP_SECRET: ADMIN_TOTP,
    // gateway: so lieu khong lam cham test
    MEDIA_PUBLIC_URL: `${s3?.url}/${BUCKET}`,
    HB_MIN_GAP_S: '0',
    TELEMETRY_FLUSH_MS: '300',
    IMPRESSION_PRICE_MICRO_VND: String(PRICE_MICRO),
    MANIFEST_MEM_TTL_S: '1',
    DEVICE_MEM_TTL_S: '1',
    GATEWAY_DEV_ENDPOINTS: '0', // ghep doi di qua API that, khong qua duong dev cua gateway
    API_SCHEDULER: '0',
  };

  let migrated = false;
  await step('migrate (pnpm --filter @ams/api migrate) tren Postgres that', async () => {
    const out = await run('pnpm', ['--filter', '@ams/api', 'migrate'], env, ROOT);
    ok(/0003_integration/.test(out), 'migration 0003 chua duoc ap dung: ' + out.slice(-200));
    const cols = await q("SELECT column_name FROM information_schema.columns WHERE table_name = 'creatives' AND column_name IN ('sha256','format','overlay')");
    eq(cols.length, 3, 'cot creatives.sha256/format/overlay');
    const a = await q("SELECT column_name FROM information_schema.columns WHERE table_name = 'admins' AND column_name IN ('phone','expires_at')");
    eq(a.length, 2, 'cot admins.phone/expires_at');
    ok(/0004_domain_p0/.test(out), 'migration 0004 chua duoc ap dung: ' + out.slice(-200));
    const t4 = await q("SELECT table_name FROM information_schema.tables WHERE table_name IN ('outbox','device_commands','spend_events')");
    eq(t4.length, 3, 'bang outbox/device_commands/spend_events');
    migrated = true;
    return out.trim().split('\n').pop()!.slice(0, 120);
  }, { needs: upPg });

  // chay lan 2: phai idempotent
  await step('migrate lan 2 idempotent', async () => {
    const out = await run('pnpm', ['--filter', '@ams/api', 'migrate'], env, ROOT);
    ok(/\(khong co\)/.test(out), out.slice(-200));
  }, { needs: migrated });

  let seeded = false;
  await step('seed (pnpm --filter @ams/api seed) + tai khoan Super admin TOTP', async () => {
    await run('pnpm', ['--filter', '@ams/api', 'seed'], env, ROOT);
    const a = await one('SELECT role, status FROM admins WHERE email = $1', [ADMIN_EMAIL]);
    eq([a.role, a.status], ['super_admin', 'active'], 'admin mau');
    const n = num((await one('SELECT COUNT(*) AS n FROM devices')).n);
    ok(n >= 100, `thieu thiet bi mau: ${n}`);
    seeded = true;
    return `${n} thiet bi mau`;
  }, { needs: migrated });

  const audit = await step('audit_log bat bien tren Postgres that (UPDATE/DELETE bi chan)', async () => {
    const e1 = await pgc.query("UPDATE audit_log SET action = 'x'").then(() => null, (e: Error) => e.message);
    const e2 = await pgc.query('DELETE FROM audit_log').then(() => null, (e: Error) => e.message);
    ok(e1 && /bat bien|immutable|INSERT/i.test(e1), 'UPDATE khong bi chan: ' + e1);
    ok(e2 && /bat bien|immutable|INSERT/i.test(e2), 'DELETE khong bi chan: ' + e2);
  }, { needs: seeded });
  void audit;

  // ---------- dich vu
  let apiUrl = '';
  let gwUrl = '';
  let consumerUrl = '';
  let apiPort = 0;
  let apiRt: Runtime | undefined;
  const up = await step('khoi dong API (node.ts) + gateway + ingest-consumer; /health 200', async () => {
    const api = await startApi({ ...env, PORT: '0', OUTBOX_INTERVAL_MS: '500' });
    apiRt = api.rt;
    cleanups.push(() => api.close());
    apiPort = api.port;
    apiUrl = `http://127.0.0.1:${apiPort}`;
    const gwPort = await freePort();
    const gw = await startGateway({ ...env, PORT: String(gwPort), COMMAND_SWEEP_MS: '500' });
    cleanups.push(() => gw.close());
    gwUrl = `http://127.0.0.1:${gwPort}`;
    const cons = await startConsumer({ ...env, PORT: '0' });
    cleanups.push(() => cons.close());
    consumerUrl = `http://127.0.0.1:${cons.port}`;
    for (const [n, u] of [['api', apiUrl], ['gateway', gwUrl], ['consumer', consumerUrl]] as const) {
      const r = await fetch(u + '/health');
      eq(r.status, 200, `${n} /health`);
    }
    return `api :${apiPort}, gateway :${gwPort}, consumer :${cons.port}`;
  }, { needs: seeded });

  const admin = new Http(() => apiUrl);
  const cust = new Http(() => apiUrl);

  await step('dang nhap admin (mat khau + TOTP seed) -> /auth/me la super_admin', async () => {
    await admin.loginMfa(ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP);
    const me = await admin.expect<{ user?: { role: string }; role?: string }>(200, 'GET', '/auth/me');
    const role = me.user?.role ?? me.role;
    eq(role, 'super_admin', 'vai tro');
    // sai CSRF bi chan
    const bad = await admin.call('POST', '/admin/v1/customers', { legal_name: 'x' }, { 'x-csrf-token': 'sai' });
    ok(bad.status === 403, `CSRF sai phai 403, nhan ${bad.status}`);
    // khong dang nhap bi chan
    const anon = await fetch(apiUrl + '/admin/v1/customers');
    eq(anon.status, 401, 'khong cookie');
  }, { needs: up });
  const loggedIn = results[results.length - 1]!.status === 'PASS';

  // ---------- khach hang + hop dong
  const emailA = `khach-a-${randomBytes(3).toString('hex')}@example.com`;
  const emailB = `khach-b-${randomBytes(3).toString('hex')}@example.com`;
  let custA = { id: '', code: '' };
  let custB = { id: '', code: '' };
  const taxA = String(Math.floor(1e9 + Math.random() * 9e9));
  const taxB = String(Math.floor(1e9 + Math.random() * 9e9));
  let contractId = '';
  const okCust = await step('tao khach A, khach B (pending_payment, vi 0) + hop dong A (pending_sign)', async () => {
    const a = await admin.expect<{ id: string; code: string; status: string }>(201, 'POST', '/admin/v1/customers', { legal_name: 'Cong ty E2E A', short_name: 'E2E A', tax_code: taxA, email: emailA, representative: 'Nguyen Van A', phone: '0900000001' });
    const b = await admin.expect<{ id: string; code: string }>(201, 'POST', '/admin/v1/customers', { legal_name: 'Cong ty E2E B', short_name: 'E2E B', tax_code: taxB, email: emailB, representative: 'Tran Van B', phone: '0900000002' });
    custA = { id: a.id, code: a.code };
    custB = { id: b.id, code: b.code };
    eq(a.status, 'pending_payment', 'trang thai khach A');
    const k = await admin.expect<{ id: string; status: string }>(201, 'POST', '/admin/v1/contracts', { customer_id: a.id, value_vnd: 50_000_000, advance_pct: 10, months: 6 });
    contractId = k.id;
    eq(k.status, 'pending_sign', 'trang thai hop dong');
    const w = await one('SELECT balance_vnd, reserved_vnd FROM ad_wallets WHERE customer_id = $1', [a.id]);
    eq([num(w.balance_vnd), num(w.reserved_vnd)], [0, 0], 'vi ban dau');
    return `A=${a.code} B=${b.code}`;
  }, { needs: loggedIn });

  // ---------- media + overlay
  const fileBytes = randomBytes(4096);
  const fileSha = await sha256Hex(new Uint8Array(fileBytes));
  const overlayA = {
    sponsor_tag: 'Tài trợ bởi E2E A',
    brand_label: 'E2E A',
    headline: 'Giảm 30% mùa lễ hội',
    hotline: { label: 'Đặt hàng', number: '1900 1234', sub: '8h-22h' },
    qr: { url: 'https://example.com/voucher?c=E2E', label: 'Quét nhận voucher', title: 'Voucher 30%' },
    scte_id: 'AMS-E2E-001',
    badges: ['HOT', 'Mới'],
  };
  let mediaA = '';
  let mediaB = '';
  let mediaA2 = '';
  async function uploadMedia(h: Http, customerId: string | null, name: string, extra: Record<string, unknown> = {}): Promise<{ id: string; res: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const up = await h.expect<{ id: string; url: string; method: string; headers: Record<string, string> }>(201, 'POST', h === admin ? '/admin/v1/media/upload-url' : '/portal/v1/media/upload-url', {
      name, content_type: 'video/mp4', size_bytes: fileBytes.length, width: 1920, height: 1080, duration_sec: 15, ...(customerId ? { customer_id: customerId } : {}), ...extra,
    });
    const put = await fetch(up.url, { method: 'PUT', headers: up.headers, body: fileBytes });
    if (put.status !== 200) throw new Error(`PUT presigned -> ${put.status}`);
    const res = await h.expect<any>(200, 'POST', `${h === admin ? '/admin/v1/media' : '/portal/v1/media'}/${up.id}/confirm`, { width: 1920, height: 1080, duration_sec: 15 }); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { id: up.id, res };
  }
  const okMedia = await step('tai media noi bo (chon customer_id, format+overlay) qua URL ky S3 that -> confirm tinh SHA-256', async () => {
    // thieu customer_id: noi bo bat buoc chon
    const r0 = await admin.call('POST', '/admin/v1/media/upload-url', { name: 'x.mp4', content_type: 'video/mp4', size_bytes: 10 });
    eq(r0.status, 422, 'thieu customer_id');
    const a = await uploadMedia(admin, custA.id, 'quang-cao-a.mp4', { format: 'fullscreen', overlay: overlayA });
    mediaA = a.id;
    eq(a.res.status, 'pending', 'trang thai media sau confirm');
    eq(a.res.sha256, fileSha, 'sha256 luu DB');
    eq(a.res.overlay, overlayA, 'overlay luu/tra ve');
    const row = await one('SELECT sha256, format, overlay FROM creatives WHERE id = $1', [a.id]);
    eq(row.sha256, fileSha, 'sha256 trong DB');
    eq(JSON.parse(row.overlay).headline, overlayA.headline, 'overlay trong DB');
    const b = await uploadMedia(admin, custB.id, 'quang-cao-b.mp4');
    mediaB = b.id;
    const c = await uploadMedia(admin, custA.id, 'quang-cao-a2.mp4');
    mediaA2 = c.id;
    return `sha ${fileSha.slice(0, 12)}…, s3 PUT=${s3.puts}`;
  }, { needs: okCust });

  await step('overlay: QR http bi 422; sua format + overlay (PUT /media/:id/overlay) ghi audit', async () => {
    const bad = await admin.call('PUT', `/admin/v1/media/${mediaA}/overlay`, { overlay: { qr: { url: 'http://evil.example' } } });
    eq(bad.status, 422, 'QR http');
    eq((bad.body as any).error.code, 'bad_overlay', 'ma loi'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const bad2 = await admin.call('PUT', `/admin/v1/media/${mediaA}/overlay`, { format: 'banner_xyz' });
    eq(bad2.status, 422, 'format la');
    const r = await admin.expect<any>(200, 'PUT', `/admin/v1/media/${mediaA}/overlay`, { format: 'l_banner' }); // eslint-disable-line @typescript-eslint/no-explicit-any
    eq(r.format, 'l_banner', 'format moi');
    eq(r.overlay.hotline.number, '1900 1234', 'overlay giu nguyen');
    const au = await one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'media.overlay' AND object_id = $1", [mediaA]);
    eq(num(au.n), 1, 'audit media.overlay');
  }, { needs: okMedia });

  // ---------- chien dich
  let campA = '';
  let campB = '';
  const okCamp = await step('tao chien dich A (5.000.000 d) + B, gan media, gui duyet -> pending', async () => {
    const a = await admin.expect<{ id: string; status: string }>(201, 'POST', '/admin/v1/campaigns', { name: 'E2E chien dich A', customer_id: custA.id, screen_type: 'tv', media_id: mediaA, budget_vnd: 5_000_000, duration_sec: 15 });
    campA = a.id;
    const b = await admin.expect<{ id: string }>(201, 'POST', '/admin/v1/campaigns', { name: 'E2E chien dich B', customer_id: custB.id, screen_type: 'tv', media_id: mediaB, budget_vnd: 1_000_000 });
    campB = b.id;
    eq(a.status, 'draft', 'trang thai draft');
    const s = await admin.expect<{ status: string }>(200, 'POST', `/admin/v1/campaigns/${a.id}/submit`);
    eq(s.status, 'pending', 'sau submit');
    const row = await one('SELECT format, overlay, sha256 FROM creatives WHERE campaign_id = $1', [campA]);
    eq(row.format, 'l_banner', 'creative gan vao chien dich mang format');
    eq(row.sha256, fileSha, 'creative gan vao chien dich mang sha256');
  }, { needs: okMedia });

  // ---------- webhook SePay
  const sepayBody = (id: number, amount: number, content: string) => JSON.stringify({ id, gateway: 'MBBank', transactionDate: new Date().toISOString().slice(0, 19).replace('T', ' '), accountNumber: '0123456789', content, transferType: 'in', transferAmount: amount, referenceCode: 'FT' + id });
  async function sendWebhook(raw: string, opts: { ts?: number; secret?: string; noSig?: boolean } = {}): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const sig = await hmacSha256Hex(opts.secret ?? SECRET_SEPAY, `${ts}.${raw}`);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-sepay-timestamp': ts };
    if (!opts.noSig) headers['x-sepay-signature'] = `sha256=${sig}`;
    const res = await fetch(apiUrl + '/webhooks/payments/sepay', { method: 'POST', headers, body: raw });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const TOPUP = 6_000_000;
  const okTopup = await step('webhook SePay: sai chu ky 401, qua han 401, hop le gui 3 lan -> chi cong 1 lan', async () => {
    const raw = sepayBody(910001, TOPUP, `AMS ${custA.code} chuyen tien quang cao`);
    eq((await sendWebhook(raw, { secret: 'sai-bi-mat' })).status, 401, 'sai chu ky');
    eq((await sendWebhook(raw, { noSig: true })).status, 401, 'thieu chu ky');
    eq((await sendWebhook(raw, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401, 'timestamp cu');
    const r = await Promise.all([sendWebhook(raw), sendWebhook(raw), sendWebhook(raw)]); // dong thoi: kiem tra dua
    for (const x of r) {
      eq(x.status, 200, 'webhook 200');
      eq(x.body, { success: true }, 'than tra ve');
    }
    const again = await sendWebhook(raw); // them mot lan nua tuan tu
    eq(again.status, 200, 'gui lai');
    const w = await one('SELECT balance_vnd, reserved_vnd, spent_vnd FROM ad_wallets WHERE customer_id = $1', [custA.id]);
    eq(num(w.balance_vnd), TOPUP, 'so du sau 4 lan gui cung giao dich');
    const t = await one("SELECT COUNT(*) AS n FROM topups WHERE customer_id = $1 AND status = 'credited'", [custA.id]);
    eq(num(t.n), 1, 'so topup credited');
    const e = await one("SELECT COUNT(*) AS n, COALESCE(SUM(amount_vnd),0) AS s FROM wallet_entries WHERE customer_id = $1 AND kind = 'topup'", [custA.id]);
    eq([num(e.n), num(e.s)], [1, TOPUP], 'so cai topup');
    const rej = await one("SELECT COUNT(*) AS n FROM payment_webhooks WHERE result LIKE 'rejected:%'");
    ok(num(rej.n) >= 3, 'webhook bi tu choi duoc luu lai');
    const cs = await one('SELECT state FROM customers WHERE id = $1', [custA.id]);
    eq(cs.state, 'active', 'khach duoc tu kich hoat khi nap >= muc toi thieu');
    const ct = await one('SELECT state FROM contracts WHERE id = $1', [contractId]);
    eq(ct.state, 'active', 'hop dong tu kich hoat');
    const act = await one('SELECT COUNT(*) AS n FROM activation_log WHERE customer_id = $1', [custA.id]);
    eq(num(act.n), 1, 'activation_log');
    return `balance ${TOPUP.toLocaleString('vi-VN')} (4 lan gui, cong 1)`;
  }, { needs: okCamp });

  let inviteToken = '';
  await step('email kich hoat tai khoan cong khach (SMTP that) co lien ket /invite?token=', async () => {
    const m = await waitFor('thu moi khach A', async () => smtp.mails.find((x) => x.to.includes(emailA)));
    const qp = m.raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))); // quoted-printable
    const mm = /invite\?token=([A-Za-z0-9_-]+)/.exec(qp);
    ok(mm, 'khong thay lien ket kich hoat trong thu');
    inviteToken = mm[1]!;
    return `den ${emailA}`;
  }, { needs: okTopup });

  // ---------- thiet bi ao truoc khi duyet
  const gwTransport = httpTransport(gwUrl);
  const device = new VirtualDevice({
    transport: gwTransport,
    rec: new Recorder(),
    kind: 'tv',
    region: 'HN',
    confirmPairing: async (code) => {
      const r = await admin.call('POST', '/admin/v1/devices/pair', { code, owner_name: 'Nguoi dung E2E' });
      return r.status === 200;
    },
  });
  const okDev = await step('thiet bi ao: register + pair (API goi redeemPairingCode) + heartbeat; manifest CHUA co creative cua A', async () => {
    ok(await device.register(), 'register: ' + device.report.errors.join('; '));
    // ma sai
    const bad = await admin.call('POST', '/admin/v1/devices/pair', { code: '000000' });
    eq(bad.status, 404, 'ma ghep sai');
    ok(await device.pair(), 'pair: ' + device.report.errors.join('; '));
    const d = await one('SELECT trust_level, user_id, paired_at FROM devices WHERE id = $1', [device.id]);
    eq(num(d.trust_level), 1, 'trust_level sau ghep');
    ok(d.user_id && d.paired_at, 'user_id/paired_at');
    const hb = await device.heartbeat(1);
    ok(hb, 'heartbeat: ' + device.report.errors.join('; '));
    device.etag = null;
    await device.syncManifest();
    ok(device.manifest, 'manifest');
    ok(!device.manifest.creatives.some((c) => c.campaign_id === campA), 'chien dich A chua duoc duyet ma da co trong manifest');
    // dung lai mot ma ghep: 409
    return `device ${device.id.slice(-8)}, etag ${hb.etag}`;
  }, { needs: okTopup });

  // ---------- duyet
  let etagBefore = '';
  const okApprove = await step('duyet chien dich A -> giu 5.000.000 d, state active, co lich mac dinh', async () => {
    etagBefore = device.etag ?? '';
    const r = await admin.expect<{ status: string; reserved_vnd: number; shortfall_vnd: number }>(200, 'POST', `/admin/v1/campaigns/${campA}/approve`);
    eq([r.status, r.reserved_vnd, r.shortfall_vnd], ['active', 5_000_000, 0], 'ket qua duyet');
    const c = await one('SELECT state, funding_state, reserved_vnd, approved_budget_vnd FROM campaigns WHERE id = $1', [campA]);
    eq([c.state, c.funding_state, num(c.reserved_vnd), num(c.approved_budget_vnd)], ['active', 'reserved', 5_000_000, 5_000_000], 'DB');
    const w = await one('SELECT balance_vnd, reserved_vnd FROM ad_wallets WHERE customer_id = $1', [custA.id]);
    eq([num(w.balance_vnd), num(w.reserved_vnd)], [TOPUP, 5_000_000], 'vi sau khi giu');
    const slots = await one('SELECT COUNT(*) AS n FROM schedule_slots WHERE campaign_id = $1', [campA]);
    eq(num(slots.n), 1, 'lich mac dinh');
    const cr = await one("SELECT review_state, state FROM creatives WHERE campaign_id = $1", [campA]);
    eq([cr.review_state, cr.state], ['approved', 'ready'], 'creative sau duyet');
    // duyet lai: 409
    const again = await admin.call('POST', `/admin/v1/campaigns/${campA}/approve`);
    eq(again.status, 409, 'duyet lan 2');
  }, { needs: okDev });

  let creativeId = '';
  const okManifest = await step('manifest co hieu luc nhanh (epoch kv): creative dung sha256/format/overlay/URL; tai tep tu URL khop sha256', async () => {
    let man: Manifest | undefined;
    if (process.env['E2E_VERBOSE']) setTimeout(async () => {
      console.error('DIAG campaign', await q('SELECT id,state,funding_state,target_types FROM campaigns WHERE id=$1', [campA]));
      console.error('DIAG slots', await q('SELECT * FROM schedule_slots WHERE campaign_id=$1', [campA]));
      console.error('DIAG creatives', await q('SELECT id,target_type,px_w,px_h,kind,storage_key,review_state,state,scan_state,sha256,format FROM creatives WHERE campaign_id=$1', [campA]));
      console.error('DIAG device', await q('SELECT id,kind,region_id FROM devices WHERE id=$1', [device.id]));
      console.error('DIAG manifest', JSON.stringify(device.manifest)?.slice(0, 400));
      console.error('DIAG redis epoch', execFileSync('redis-cli', ['-p', String(redisPort), 'get', 'manifest:epoch']).toString(), execFileSync('redis-cli', ['-p', String(redisPort), 'get', 'manifest:HN.all.tv']).toString().slice(0, 600));
    }, 3000);
    await waitFor('manifest co creative cua A', async () => {
      await device.heartbeat(1);
      device.etag = null;
      await device.syncManifest();
      man = device.manifest ?? undefined;
      return man?.creatives.some((c) => c.campaign_id === campA);
    }, 8000, 400);
    const c = man!.creatives.find((x) => x.campaign_id === campA)!;
    creativeId = c.id;
    eq(c.sha256, fileSha, 'sha256 trong manifest');
    eq(c.format, 'l_banner', 'format trong manifest');
    eq(c.overlay, overlayA, 'overlay trong manifest');
    ok(c.url.startsWith(`${s3.url}/${BUCKET}/media/${custA.id}/`), 'URL media: ' + c.url);
    eq([c.px_w, c.px_h, c.duration_s], [1920, 1080, 15], 'kich thuoc/thoi luong');
    ok(man!.schedule.some((s) => s.campaign_id === campA && s.creative_ids.includes(c.id)), 'lich tro toi creative');
    ok(man!.etag !== etagBefore, 'etag phai doi');
    const dl = await fetch(c.url);
    eq(dl.status, 200, 'tai tep media');
    eq(await sha256Hex(new Uint8Array(await dl.arrayBuffer())), c.sha256, 'sha256 tep tai ve');
    // duong cong khai theo nhom (CDN) cung phat ban moi
    const pubm = await fetch(`${gwUrl}/v1/manifest/g/${encodeURIComponent(man!.group)}`);
    eq(pubm.status, 200, 'manifest cong khai');
    ok(((await pubm.json()) as Manifest).creatives.some((x) => x.id === c.id), 'manifest cong khai co creative');
    return `etag ${man!.etag}, group ${man!.group}`;
  }, { needs: okApprove });

  // ---------- impression + chi tieu
  const ev = (over: Partial<Record<string, unknown>> = {}, tOff = 0) => {
    const t = Date.now() - 3000 - tOff;
    const slot = device.manifest!.schedule.find((s) => s.campaign_id === campA)!;
    return { type: 'impression', event_id: uuidv7(t), ts: new Date(t).toISOString(), campaign_id: campA, creative_id: creativeId, slot_id: slot.slot_id, vcr_pct: 100, played_ms: 15000, ...over };
  };
  // su kien tao lazily (can manifest cua thiet bi); event_id co dinh de gui lai dung nhu giao lai that
  let batch1: ReturnType<typeof ev>[] = [];
  let batch2: ReturnType<typeof ev>[] = [];
  let badEvt: ReturnType<typeof ev> | undefined;
  const waitSpent = async (campaignId: string, vnd: number) =>
    waitFor(`chi tieu chien dich ${campaignId.slice(-6)} = ${vnd}`, async () => num((await one('SELECT spent_vnd FROM campaigns WHERE id = $1', [campaignId])).spent_vnd) === vnd);
  const okImp = await step('gui impression (lo 3 hop le + 1 khong hop le): gateway -> Redis -> consumer -> payments; chi tieu = floor(3x20,5)=61 d, du 0,5 d', async () => {
    batch1 = [ev({}, 0), ev({}, 1000), ev({}, 2000)];
    batch2 = [ev({}, 3000)];
    badEvt = ev({ vcr_pct: 40, played_ms: 6000 }, 4000);
    const r = await device.request('events', 'POST', '/v1/events', { events: [...batch1, badEvt] });
    eq(r.status, 202, 'events 202');
    const j = JSON.parse(r.text) as { accepted: number; valid: number; flagged: number };
    eq([j.accepted, j.valid, j.flagged], [4, 3, 1], 'ket qua lo');
    await waitSpent(campA, 61);
    const c = await one('SELECT spent_vnd, reserved_vnd, spend_remainder_micro FROM campaigns WHERE id = $1', [campA]);
    eq([num(c.spent_vnd), num(c.reserved_vnd), num(c.spend_remainder_micro)], [61, 4_999_939, 500_000], 'chien dich: da chi / con giu / phan du micro');
    const w = await one('SELECT balance_vnd, reserved_vnd, spent_vnd FROM ad_wallets WHERE customer_id = $1', [custA.id]);
    eq([num(w.balance_vnd), num(w.reserved_vnd), num(w.spent_vnd)], [TOPUP - 61, 4_999_939, 61], 'vi');
    const n = await waitFor('ev_ad_impression = 4', async () => num((await one('SELECT COUNT(*) AS n FROM ev_ad_impression WHERE campaign_id = $1', [campA])).n) === 4);
    void n;
    return 'chi 61 d, du 500000 micro';
  }, { needs: okManifest });

  await step('giao lai CUNG lo (event_id trung) + gui trung lan nua: khong tru tien lan hai', async () => {
    const r = await device.request('events', 'POST', '/v1/events', { events: batch1 });
    eq(r.status, 202, 'events 202');
    await sleep(1500); // du thoi gian de consumer xu ly (neu co loi, so se doi)
    const c = await one('SELECT spent_vnd FROM campaigns WHERE id = $1', [campA]);
    eq(num(c.spent_vnd), 61, 'chi tieu sau giao lai');
    const n = await one('SELECT COUNT(*) AS n FROM ev_ad_impression WHERE campaign_id = $1', [campA]);
    eq(num(n.n), 4, 'so su kien sau giao lai');
    const d = await one('SELECT COUNT(*) AS n FROM spend_dedupe WHERE campaign_id = $1', [campA]);
    eq(num(d.n), 1, 'so khoa khu trung chi tieu');
  }, { needs: okImp });

  await step('lo thu hai (1 impression): du 0,5 + 20,5 = 21 d -> tong 82 d; so cai spend khop', async () => {
    const r = await device.request('events', 'POST', '/v1/events', { events: batch2 });
    eq(r.status, 202, 'events');
    await waitSpent(campA, 82);
    const c = await one('SELECT spent_vnd, reserved_vnd, spend_remainder_micro FROM campaigns WHERE id = $1', [campA]);
    eq([num(c.spent_vnd), num(c.reserved_vnd), num(c.spend_remainder_micro)], [82, 4_999_918, 0], 'chien dich');
    const e = await one("SELECT COUNT(*) AS n, COALESCE(SUM(amount_vnd),0) AS s FROM wallet_entries WHERE customer_id = $1 AND kind = 'spend'", [custA.id]);
    eq([num(e.n), num(e.s)], [2, 82], 'so cai spend (2 lan, tong 82)');
    const w = await one('SELECT balance_vnd, reserved_vnd, spent_vnd FROM ad_wallets WHERE customer_id = $1', [custA.id]);
    eq([num(w.balance_vnd), num(w.reserved_vnd), num(w.spent_vnd)], [TOPUP - 82, 4_999_918, 82], 'vi');
    // doi soat vi: balance = topup - spend; cache = so cai
    const led = await one("SELECT COALESCE(SUM(CASE WHEN kind IN ('topup','refund') THEN amount_vnd ELSE 0 END),0) AS cin, COALESCE(SUM(CASE WHEN kind = 'spend' THEN amount_vnd ELSE 0 END),0) AS sp FROM wallet_entries WHERE customer_id = $1", [custA.id]);
    eq(num(led.cin) - num(led.sp), TOPUP - 82, 'so cai: nap - chi');
  }, { needs: okImp });

  await step('so lieu: campaign.impressions=4 (hop le), dashboard KPI tang dung, thiet bi online, recent_ads', async () => {
    const list = await admin.expect<{ items: any[] }>(200, 'GET', `/admin/v1/campaigns?customer_id=${custA.id}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    const ca = list.items.find((x) => x.id === campA)!;
    eq([ca.impressions, ca.spent_vnd, ca.status], [4, 82, 'active'], 'chien dich qua API');
    const dash = await admin.expect<any>(200, 'GET', '/admin/v1/dashboard/overview?range=7'); // eslint-disable-line @typescript-eslint/no-explicit-any
    eq(dash.kpi.impressions, 4, 'KPI impressions (chi hop le)');
    eq(dash.kpi.revenue_vnd, 82, 'KPI doanh thu (4 x 20,5)');
    const top = dash.top_campaigns.find((x: any) => x.id === campA); // eslint-disable-line @typescript-eslint/no-explicit-any
    ok(top, 'top_campaigns co chien dich A');
    await device.heartbeat(1);
    await waitFor('thiet bi online sau flush', async () => {
      const d = await one('SELECT status, last_seen_at FROM devices WHERE id = $1', [device.id]);
      return d.status === 'active' && d.last_seen_at;
    });
    const dd = await admin.expect<any>(200, 'GET', `/admin/v1/devices/${device.id}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    ok(dd.recent_ads.includes('E2E chien dich A'), 'recent_ads: ' + JSON.stringify(dd.recent_ads));
    eq(dd.status, 'online', 'trang thai thiet bi');
    const hb = await one('SELECT COUNT(*) AS n FROM ev_heartbeat WHERE device_id = $1', [device.id]);
    ok(num(hb.n) >= 1, 'ev_heartbeat');
    return `KPI impressions=${dash.kpi.impressions}, revenue=${dash.kpi.revenue_vnd} d`;
  }, { needs: okImp });

  // ---------- cong khach hang + IDOR
  let custLogin = false;
  const CUST_PASSWORD = 'Khach-A-Passw0rd!2026';
  await step('khach A: nhan loi moi -> dat mat khau -> bat TOTP -> dang nhap cong', async () => {
    const acc = await cust.expect<{ mfa_token: string; mfa_enroll_required: boolean }>(200, 'POST', '/auth/invite/accept', { token: inviteToken, password: CUST_PASSWORD });
    ok(acc.mfa_enroll_required, 'phai bat 2FA');
    const en = await cust.expect<{ secret: string; mfa_token: string }>(200, 'POST', '/auth/mfa/enroll', { mfa_token: acc.mfa_token });
    const v = await cust.expect<{ csrf_token: string }>(200, 'POST', '/auth/mfa/verify', { mfa_token: en.mfa_token, code: await totp(en.secret) });
    cust.csrf = v.csrf_token;
    const me = await cust.expect<any>(200, 'GET', '/portal/v1/me'); // eslint-disable-line @typescript-eslint/no-explicit-any
    ok(JSON.stringify(me).includes(custA.code), 'portal/me khong cho thay ma khach A');
    custLogin = true;
  }, { needs: okTopup });

  await step('khach A chi thay du lieu cua minh: danh sach chien dich/media/vi dung; khach A KHONG vao duoc /admin', async () => {
    const camps = await cust.expect<{ items: any[]; total: number }>(200, 'GET', '/portal/v1/campaigns'); // eslint-disable-line @typescript-eslint/no-explicit-any
    eq(camps.items.map((c) => c.id), [campA], 'danh sach chien dich cua A');
    eq(camps.items[0].customer_id, custA.id, 'chu so huu');
    const media = await cust.expect<{ items: any[] }>(200, 'GET', '/portal/v1/media'); // eslint-disable-line @typescript-eslint/no-explicit-any
    ok(media.items.length >= 1 && media.items.every((m) => m.customer_id === custA.id), 'media chi cua A');
    ok(!media.items.some((m) => m.id === mediaB), 'media cua B lot vao danh sach A');
    const wal = await cust.expect<any>(200, 'GET', '/portal/v1/wallet'); // eslint-disable-line @typescript-eslint/no-explicit-any
    eq([wal.balance_vnd, wal.reserved_vnd, wal.spent_vnd, wal.customer_id], [TOPUP - 82, 4_999_918, 82, custA.id], 'vi tren cong');
    const adm = await cust.call('GET', '/admin/v1/customers');
    ok(adm.status === 403 || adm.status === 401, `khach vao /admin phai bi chan, nhan ${adm.status}`);
    const dash = await cust.call('GET', '/admin/v1/dashboard/overview');
    ok(dash.status === 403 || dash.status === 401, 'khach vao dashboard admin');
  }, { needs: custLogin });

  await step('IDOR: khach A doc/sua/duyet/tai du lieu khach B -> 404 (khong lo ton tai)', async () => {
    const paths: [string, string, unknown?][] = [
      ['GET', `/portal/v1/campaigns/${campB}`],
      ['PUT', `/portal/v1/campaigns/${campB}`, { name: 'hack' }],
      ['POST', `/portal/v1/campaigns/${campB}/submit`],
      ['POST', `/portal/v1/campaigns/${campB}/pause`],
      ['GET', `/portal/v1/media/${mediaB}`],
      ['PUT', `/portal/v1/media/${mediaB}/overlay`, { overlay: { headline: 'hack' } }],
      ['POST', `/portal/v1/media/${mediaB}/confirm`, {}],
      ['DELETE', `/portal/v1/media/${mediaB}`],
    ];
    for (const [m, p, b] of paths) {
      const r = await cust.call(m, p, b);
      if (r.status !== 404) throw new Error(`${m} ${p} -> ${r.status} (phai 404)`);
    }
    // id khong ton tai cho cung phan hoi 404 (khong phan biet)
    const ghost = await cust.call('GET', '/portal/v1/campaigns/khong-ton-tai');
    eq(ghost.status, 404, 'id la');
    // tao chien dich voi customer_id cua B trong body: bi bo qua, chien dich thuoc ve A
    const mine = await cust.expect<{ id: string; customer_id: string }>(201, 'POST', '/portal/v1/campaigns', { name: 'A tu tao', customer_id: custB.id, screen_type: 'tv', media_id: mediaA2, budget_vnd: 1_000_000 });
    eq(mine.customer_id, custA.id, 'customer_id bi ghi de bang phien');
    // gan media cua B vao chien dich cua A: 404
    const steal = await cust.call('POST', '/portal/v1/campaigns', { name: 'trom media', screen_type: 'tv', media_id: mediaB, budget_vnd: 1_000_000 });
    eq(steal.status, 404, 'dung media cua khach khac');
    // du lieu B nguyen ven
    const bRow = await one('SELECT name, state FROM campaigns WHERE id = $1', [campB]);
    eq([bRow.name, bRow.state], ['E2E chien dich B', 'draft'], 'chien dich B khong bi doi');
    const wB = await one('SELECT balance_vnd FROM ad_wallets WHERE customer_id = $1', [custB.id]);
    eq(num(wB.balance_vnd), 0, 'vi B');
    // khach A sua overlay tep da duyet cua chinh minh => quay lai cho duyet
    const rv = await cust.expect<any>(200, 'PUT', `/portal/v1/media/${mediaA2}/overlay`, { overlay: { headline: 'Tieu de moi' } }); // eslint-disable-line @typescript-eslint/no-explicit-any
    eq(rv.overlay.headline, 'Tieu de moi', 'overlay tuy sua');
  }, { needs: custLogin });

  // ---------- doi chien dich co hieu luc ngay; khoa thiet bi
  await step('tam dung chien dich -> manifest mat creative (epoch); tiep tuc -> co lai', async () => {
    await admin.expect(200, 'POST', `/admin/v1/campaigns/${campA}/pause`);
    await waitFor('manifest khong con creative A', async () => {
      await device.heartbeat(1);
      device.etag = null;
      await device.syncManifest();
      return !device.manifest!.creatives.some((c) => c.campaign_id === campA);
    }, 8000, 400);
    // impression vao chien dich dang tam dung: creative khong con trong manifest nen bi tu choi, khong tru tien
    await admin.expect(200, 'POST', `/admin/v1/campaigns/${campA}/resume`);
    await waitFor('manifest co lai creative A', async () => {
      await device.heartbeat(1);
      device.etag = null;
      await device.syncManifest();
      return device.manifest!.creatives.some((c) => c.campaign_id === campA);
    }, 8000, 400);
  }, { needs: okManifest });

  await step('het ngan sach: chien dich C (30 d) nhan 2 impression -> chi dung 30 d, ended, manifest bo creative, khong am vi', async () => {
    const c = await admin.expect<{ id: string }>(201, 'POST', '/admin/v1/campaigns', { name: 'E2E chien dich C nho', customer_id: custA.id, screen_type: 'tv', media_id: mediaA2, budget_vnd: 30 });
    await admin.expect(200, 'POST', `/admin/v1/campaigns/${c.id}/submit`);
    const ap = await admin.expect<{ status: string; reserved_vnd: number }>(200, 'POST', `/admin/v1/campaigns/${c.id}/approve`);
    eq([ap.status, ap.reserved_vnd], ['active', 30], 'duyet C');
    let creative = '';
    let slot = '';
    await waitFor('manifest co C', async () => {
      await device.heartbeat(1);
      device.etag = null;
      await device.syncManifest();
      const cc = device.manifest!.creatives.find((x) => x.campaign_id === c.id);
      if (cc) {
        creative = cc.id;
        slot = device.manifest!.schedule.find((s) => s.campaign_id === c.id)!.slot_id;
      }
      return !!cc;
    }, 8000, 400);
    const mk = (off: number) => {
      const t = Date.now() - 3000 - off;
      return { type: 'impression', event_id: uuidv7(t), ts: new Date(t).toISOString(), campaign_id: c.id, creative_id: creative, slot_id: slot, vcr_pct: 100, played_ms: 15000 };
    };
    const r = await device.request('events', 'POST', '/v1/events', { events: [mk(0), mk(1000)] });
    eq(r.status, 202, 'events');
    await waitFor('chien dich C het ngan sach', async () => (await one('SELECT state FROM campaigns WHERE id = $1', [c.id])).state === 'ended');
    const row = await one('SELECT spent_vnd, reserved_vnd, funding_state FROM campaigns WHERE id = $1', [c.id]);
    eq([num(row.spent_vnd), num(row.reserved_vnd), row.funding_state], [30, 0, 'released'], 'C: chi toi da 30 d');
    const w = await one('SELECT balance_vnd, reserved_vnd, spent_vnd FROM ad_wallets WHERE customer_id = $1', [custA.id]);
    ok(num(w.balance_vnd) >= num(w.reserved_vnd) && num(w.reserved_vnd) >= 0, 'vi khong am');
    eq(num(w.spent_vnd), 82 + 30, 'tong da chi cua khach');
    await waitFor('manifest bo creative C', async () => {
      await device.heartbeat(1);
      device.etag = null;
      await device.syncManifest();
      return !device.manifest!.creatives.some((x) => x.campaign_id === c.id);
    }, 8000, 400);
  }, { needs: okManifest });

  await step('khoa thiet bi (bulk block) -> gateway tu choi ngay (kv dev:<id> bi xoa); mo khoa -> hoat dong lai', async () => {
    await admin.expect(200, 'POST', '/admin/v1/devices/bulk', { action: 'block', ids: [device.id] });
    const r = await waitFor('heartbeat bi 403', async () => {
      const x = await device.request('heartbeat', 'POST', '/v1/heartbeat', { state: 1 });
      return x.status === 403 ? x : null;
    }, 6000, 300);
    eq(JSON.parse(r.text).error.code, 'device_blocked', 'ma loi');
    await admin.expect(200, 'POST', '/admin/v1/devices/bulk', { action: 'unblock', ids: [device.id] });
    await waitFor('heartbeat lai 200', async () => (await device.request('heartbeat', 'POST', '/v1/heartbeat', { state: 1 })).status === 200, 6000, 300);
  }, { needs: okDev });

  await step('endpoint tai chinh a2 tren admin: manual-queue, refund-requests, activation-log, wallets tra ve du lieu', async () => {
    // giao dich sai ma khach -> hang doi thu cong
    const raw = sepayBody(910002, 1_234_000, 'AMS KHONGCO chuyen nham');
    eq((await sendWebhook(raw)).status, 200, 'webhook sai ma van 200');
    const mq = await admin.expect<{ items: any[] }>(200, 'GET', '/admin/v1/payments/manual-queue'); // eslint-disable-line @typescript-eslint/no-explicit-any
    ok(mq.items.length >= 1, 'manual-queue rong');
    const rf = await admin.expect<{ items: any[] }>(200, 'GET', '/admin/v1/refund-requests'); // eslint-disable-line @typescript-eslint/no-explicit-any
    ok(Array.isArray(rf.items), 'refund-requests');
    const al = await admin.expect<{ items: any[] }>(200, 'GET', '/admin/v1/activation-log'); // eslint-disable-line @typescript-eslint/no-explicit-any
    ok(al.items.length >= 1, 'activation-log');
    const ws = await admin.expect<{ items: any[] }>(200, 'GET', '/admin/v1/wallets'); // eslint-disable-line @typescript-eslint/no-explicit-any
    ok(ws.items.some((x) => x.customer_id === custA.id), 'wallets co khach A');
  }, { needs: okTopup });


  // ---------- P0 mien nghiep vu (docs/DOMAIN-REVISION-PROPOSAL.md muc 1-4)
  const redisCli = (...a: string[]) => execFileSync('redis-cli', ['-p', String(redisPort), ...a]).toString().trim();
  const epochNow = () => Number(redisCli('get', 'manifest:epoch') || '0');
  let campD = '';

  await step('P0-1+2 outbox: duyet chien dich A de lai dung mot viec campaign.approved + mot manifest.bump, deu done', async () => {
    const rows = await q("SELECT topic, status, dedupe_key FROM outbox WHERE dedupe_key LIKE $1 OR dedupe_key LIKE $2 ORDER BY topic", [`campaign.approved:${campA}:%`, `manifest.bump:campaign.approved:${campA}:%`]);
    eq(rows.map((r) => `${r.topic}:${r.status}`), ['campaign.approved:done', 'manifest.bump:done'], 'outbox cua A');
    const approved = rows.find((r) => r.topic === 'campaign.approved')!;
    ok(String(approved.dedupe_key).startsWith(`campaign.approved:${campA}:`), 'khoa khu trung');
    const pend = await one("SELECT COUNT(*) AS n FROM outbox WHERE status <> 'done'");
    eq(num(pend.n), 0, 'khong con viec dang cho/chet');
  }, { needs: okApprove });

  await step('P0-1 co che trang thai qua API that: hanh dong sai trang thai -> 409 invalid_state (khong doi gi); hai nguoi duyet cung luc -> 200 + 409', async () => {
    for (const [m, p, b] of [['POST', `/admin/v1/campaigns/${campA}/resume`], ['POST', `/admin/v1/campaigns/${campA}/submit`], ['POST', `/admin/v1/campaigns/${campA}/approve`], ['PUT', `/admin/v1/campaigns/${campA}`, { name: 'doi' }]] as [string, string, unknown?][]) {
      const r = await admin.call(m, p, b);
      eq(r.status, 409, `${m} ${p}`);
      eq((r.body as any).error.code, 'invalid_state', `${m} ${p} code`); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    eq((await one('SELECT state FROM campaigns WHERE id = $1', [campA])).state, 'active', 'A khong doi');
    const d = await admin.expect<{ id: string }>(201, 'POST', '/admin/v1/campaigns', { name: 'E2E chien dich D (dua duyet)', customer_id: custA.id, screen_type: 'tv', media_id: mediaA2, budget_vnd: 100_000 });
    campD = d.id;
    await admin.expect(200, 'POST', `/admin/v1/campaigns/${campD}/submit`);
    const rs = await Promise.all([admin.call('POST', `/admin/v1/campaigns/${campD}/approve`), admin.call('POST', `/admin/v1/campaigns/${campD}/approve`)]);
    eq(rs.map((x) => x.status).sort(), [200, 409], 'hai lan duyet dong thoi');
    const row = await one('SELECT state, funding_state, reserved_vnd FROM campaigns WHERE id = $1', [campD]);
    eq([row.state, row.funding_state, num(row.reserved_vnd)], ['active', 'reserved', 100_000], 'D sau duyet');
    const ob = await one("SELECT COUNT(*) AS n FROM outbox WHERE topic = 'campaign.approved' AND dedupe_key LIKE $1", [`%${campD}%`]);
    eq(num(ob.n), 1, 'dung mot viec outbox');
    const rsv = await one("SELECT COUNT(*) AS n FROM wallet_entries WHERE kind = 'reserve' AND ref_id = $1", [campD]);
    eq(num(rsv.n), 1, 'giu tien dung mot lan');
  }, { needs: okApprove });

  await step('P0-2 sau su co (mat dien giua cap nhat trang thai duyet va ghi outbox): worker tu dong ghi bu, giu tien, tang epoch manifest', async () => {
    const c = await admin.expect<{ id: string }>(201, 'POST', '/admin/v1/campaigns', { name: 'E2E chien dich E (mat dien)', customer_id: custA.id, screen_type: 'tv', media_id: mediaA2, budget_vnd: 50_000 });
    await admin.expect(200, 'POST', `/admin/v1/campaigns/${c.id}/submit`);
    const before = epochNow();
    // mo phong tien trinh API chet NGAY SAU khi danh dau duyet (buoc 1) va TRUOC khi ghi outbox: chi co UPDATE trang thai, khong co dong outbox
    await pgc.query(
      "UPDATE campaigns SET state = 'awaiting_funds', funding_state = 'awaiting_funds', approved_budget_vnd = budget_cap_vnd, approved_at = $2, approved_by = 'e2e-crash' WHERE id = $1 AND state = 'pending_review'",
      [c.id, new Date().toISOString()],
    );
    eq(num((await one('SELECT COUNT(*) AS n FROM outbox WHERE dedupe_key LIKE $1', [`%${c.id}%`])).n), 0, 'chua co outbox');
    await waitFor('worker giu tien cho chien dich E', async () => (await one('SELECT state FROM campaigns WHERE id = $1', [c.id])).state === 'active', 20_000, 300);
    const row = await one('SELECT funding_state, reserved_vnd FROM campaigns WHERE id = $1', [c.id]);
    eq([row.funding_state, num(row.reserved_vnd)], ['reserved', 50_000], 'E da giu tien');
    const rs = await q('SELECT topic, status FROM outbox WHERE dedupe_key LIKE $1 ORDER BY topic', [`%${c.id}%`]);
    eq(rs.map((r) => `${r.topic}:${r.status}`), ['campaign.approved:done', 'manifest.bump:done'], 'outbox E');
    ok(epochNow() > before, 'epoch manifest phai tang');
    eq(num((await one("SELECT COUNT(*) AS n FROM wallet_entries WHERE kind = 'reserve' AND ref_id = $1", [c.id])).n), 1, 'giu tien dung mot lan');
  }, { needs: okApprove });

  await step('P0-3 lenh thiet bi: enqueue (idempotency) -> heartbeat giao -> thiet bi ack qua /v1/commands/ack; audit; het han -> expired, khong giao', async () => {
    ok(apiRt, 'khong co runtime API');
    const adminId = String((await one('SELECT id FROM admins WHERE email = $1', [ADMIN_EMAIL])).id);
    const a = await enqueueCommand(apiRt, device.id, { type: 'refresh_manifest' }, { idempotencyKey: 'e2e-refresh', createdBy: adminId });
    const a2 = await enqueueCommand(apiRt, device.id, { type: 'refresh_manifest' }, { idempotencyKey: 'e2e-refresh', createdBy: adminId });
    eq(a2, a, 'idempotency_key -> cung id');
    const b = await enqueueCommand(apiRt, device.id, { type: 'set_monitor', args: { on: true } }, { createdBy: adminId });
    eq(num((await one('SELECT COUNT(*) AS n FROM device_commands WHERE device_id = $1', [device.id])).n), 2, 'hai lenh (khong nhan doi)');
    eq((await one('SELECT status FROM device_commands WHERE id = $1', [a])).status, 'pending', 'pending truoc heartbeat');
    const hb = await device.heartbeat(1);
    ok(hb, 'heartbeat');
    eq(hb.commands.map((x) => x.id), [a, b], 'lenh giao o heartbeat, theo thu tu tao');
    const st = await q('SELECT id, status, deliveries FROM device_commands WHERE device_id = $1 ORDER BY created_at, id', [device.id]);
    eq(st.map((r) => [r.status, num(r.deliveries)]), [['acked', 1], ['acked', 1]], 'thiet bi ao ack qua endpoint');
    eq(device.report.commandsExecuted.map((x) => x.type), ['refresh_manifest', 'set_monitor'], 'thiet bi thuc thi dung loai');
    const aud = await one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'device.command.enqueue' AND object_id = $1 AND actor_id = $2", [device.id, adminId]);
    eq(num(aud.n), 2, 'audit_log: moi lenh moi mot dong (lan day trung khoa khong ghi them)');
    device.monitor = false; // tra lai trang thai thuong cho cac buoc sau
    const hb2 = await device.heartbeat(1);
    eq(hb2!.commands, [], 'khong giao lai lenh da ack');
    // het han: khong giao, gateway quet -> expired
    const old = await enqueueCommand(apiRt, device.id, { type: 'reboot' }, { ttlS: 1, idempotencyKey: 'e2e-expire' });
    await sleep(2200);
    const hb3 = await device.heartbeat(1);
    eq(hb3!.commands, [], 'lenh het han khong duoc giao');
    await waitFor('quet lenh het han', async () => (await one('SELECT status FROM device_commands WHERE id = $1', [old])).status === 'expired', 8000, 300);
    // co hieu kv nam o Redis that
    ok(redisCli('exists', `cmdflag:${device.id}`) === '0', 'co hieu cmdflag da xoa khi het lenh mo');
  }, { needs: okDev });

  await step('P0-4 chi tieu: gui lai cac su kien cu trong lo moi + xoa dau "xong" o Redis roi gui lai tat ca -> chi su kien moi duoc tinh (khong tru kep)', async () => {
    const before = await one('SELECT spent_vnd FROM campaigns WHERE id = $1', [campA]);
    eq(num(before.spent_vnd), 82, 'A truoc');
    const fresh = ev({}, 6000);
    const mix = [batch1[0]!, batch1[1]!, batch2[0]!, fresh]; // 3 su kien cu + 1 moi
    const r = await device.request('events', 'POST', '/v1/events', { events: mix });
    eq(r.status, 202, 'events');
    await waitSpent(campA, 102); // 82 + floor(0 + 20,5) = 102, du 0,5
    const c = await one('SELECT spent_vnd, spend_remainder_micro FROM campaigns WHERE id = $1', [campA]);
    eq([num(c.spent_vnd), num(c.spend_remainder_micro)], [102, 500_000], 'chi them dung 1 su kien moi');
    eq(num((await one('SELECT COUNT(*) AS n FROM spend_events WHERE campaign_id = $1', [campA])).n), 5, 'spend_events: 4 cu + 1 moi');
    // mat bo nho dem "xong" (Redis flush / het han): khu trung ben vung o DB van chan tru kep
    redisCli('eval', "for _,k in ipairs(redis.call('keys','ingest:done:*')) do redis.call('del',k) end", '0');
    eq(redisCli('keys', 'ingest:done:*'), '', 'da xoa dau xong');
    const r2 = await device.request('events', 'POST', '/v1/events', { events: [...batch1, ...batch2, fresh] });
    eq(r2.status, 202, 'events gui lai tat ca');
    await sleep(2000);
    const c2 = await one('SELECT spent_vnd, spend_remainder_micro FROM campaigns WHERE id = $1', [campA]);
    eq([num(c2.spent_vnd), num(c2.spend_remainder_micro)], [102, 500_000], 'khong tru kep sau khi mat dau xong');
    const led = await one("SELECT COALESCE(SUM(amount_vnd),0) AS s FROM wallet_entries WHERE customer_id = $1 AND kind = 'spend' AND ref_type = 'impression_batch'", [custA.id]);
    eq(num(led.s), 102 + 30, 'so cai spend (impression) cua khach A = 102 (A) + 30 (C)');
    const w = await one('SELECT spent_vnd FROM ad_wallets WHERE customer_id = $1', [custA.id]);
    eq(num(w.spent_vnd), 132, 'vi: tong da chi');
  }, { needs: okImp });

  await step('nhat ky kiem toan ghi du cac hanh dong nghiep vu (customer/campaign/media/finance/device)', async () => {
    const a = await q("SELECT action, COUNT(*) AS n FROM audit_log WHERE action IN ('customer.create','contract.create','media.upload_url','media.confirm','campaign.create','campaign.submit','campaign.approve','finance.activation','device.pair','device.bulk_block','campaign.pause','campaign.resume','device.command.enqueue') GROUP BY action");
    const got = new Set(a.map((x) => x.action));
    for (const need of ['customer.create', 'contract.create', 'media.confirm', 'campaign.approve', 'finance.activation', 'device.pair', 'device.bulk_block', 'device.command.enqueue']) ok(got.has(need), `thieu audit ${need}`);
  }, { needs: okTopup });
}

// ------------------------------------------------------------------ chay + in bang
const t0 = Date.now();
try {
  await main();
} catch (e) {
  failed = true;
  results.push({ n: 'S??', name: 'loi ngoai du kien', status: 'FAIL', detail: (e as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(e), ms: 0 });
} finally {
  await cleanup();
}
const w = Math.max(...results.map((r) => r.name.length), 10);
console.log('\n=== AMS e2e smoke (Postgres 16 that + Redis that; S3/SMTP gia) ===');
for (const r of results) console.log(`${r.n} ${r.status.padEnd(4)} ${r.name.padEnd(Math.min(w, 110))}${r.detail ? '  | ' + r.detail : ''}  (${r.ms} ms)`);
const c = (s: Status) => results.filter((r) => r.status === s).length;
console.log(`\nKET QUA: ${c('PASS')} PASS, ${c('FAIL')} FAIL, ${c('SKIP')} SKIP  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
