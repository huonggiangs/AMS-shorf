// Khoi dong stack THAT cho e2e UI: Postgres 16 (embedded) + Redis that + S3/SMTP gia + migrate/seed + API + gateway + consumer
// + web-admin build bang vite, phuc vu tinh qua mot server Node nho (proxy /api/* -> API, nhu dev proxy cua vite).
// Boot theo tests/e2e/smoke.ts (khong sua tep do).
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createNet, connect } from 'node:net';
import { createServer as createHttp, request as httpRequest } from 'node:http';
import { existsSync, rmSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { generateTotpSecret } from '@ams/shared';
import { startNode as startApi } from '@ams/api/node';
import { startNode as startGateway } from '@ams/edge-gateway/node';
import { startConsumer } from '@ams/ingest-consumer/node';
import { startFakeS3, startFakeSmtp, type FakeS3, type FakeSmtp } from '../e2e/fakes.js';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const HERE = new URL('./', import.meta.url).pathname;
export const BUCKET = 'ams-media';
export const ADMIN_EMAIL = 'ui-admin@ams.local';
export const ADMIN_PASSWORD = 'Ui-Admin-Passw0rd!';
export const ADMIN_TOTP = generateTotpSecret();

export interface Stack {
  webUrl: string;
  apiUrl: string;
  gwUrl: string;
  s3: FakeS3;
  smtp: FakeSmtp;
  q: <T = Record<string, any>>(sql: string, params?: unknown[]) => Promise<T[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close: () => Promise<void>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNet();
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function run(cmd: string, args: string[], env: Record<string, string | undefined>, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env } as NodeJS.ProcessEnv, cwd });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} -> ${code}\n${out.slice(-800)}`))));
  });
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json' };

/** Server tinh cho ban build vite + SPA fallback + proxy /api/* -> API (bo tien to /api). */
async function startWeb(distDir: string, apiPort: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createHttp((req, res) => {
    const url = req.url ?? '/';
    if (url === '/api' || url.startsWith('/api/')) {
      const up = httpRequest({ host: '127.0.0.1', port: apiPort, path: url.replace(/^\/api/, '') || '/', method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}` } }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => res.writeHead(502).end('bad gateway'));
      req.pipe(up);
      return;
    }
    const p = normalize(decodeURIComponent(url.split('?')[0]!)).replace(/^(\.\.[/\\])+/, '');
    let file = join(distDir, p);
    if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, 'index.html'); // SPA
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

export async function startStack(log: (m: string) => void): Promise<Stack> {
  const cleanups: (() => Promise<void> | void)[] = [];
  const close = async () => {
    // pool pg cua API/gateway co the nhan 57P01 (admin shutdown) khi dung Postgres luc don dep: nuot loi do.
    process.on('uncaughtException', (e: NodeJS.ErrnoException & { code?: string }) => {
      if (e?.code === '57P01' || /terminating connection/.test(String(e?.message))) return;
      console.error(e);
      process.exit(1);
    });
    for (const c of cleanups.reverse()) {
      try {
        await c();
      } catch {
        /* */
      }
    }
  };
  try {
    // --- build web-admin (vite, bo qua tsc: typecheck la cong rieng)
    const dist = join(HERE, '.dist');
    if (process.env['E2E_UI_SKIP_BUILD'] && existsSync(join(dist, 'index.html'))) log('web-admin: dung ban build co san (.dist)');
    else {
      log('web-admin: vite build ...');
      await run('pnpm', ['--filter', '@ams/web-admin', 'exec', 'vite', 'build', '--outDir', dist, '--emptyOutDir'], {}, ROOT);
    }

    // --- Postgres that
    const pgPort = await freePort();
    const pgDir = join(tmpdir(), `ams-e2e-ui-pg-${process.pid}-${Date.now()}`);
    const epg = new EmbeddedPostgres({ databaseDir: pgDir, user: 'ams', password: 'ams', port: pgPort, persistent: false, onLog: () => undefined, onError: () => undefined });
    await epg.initialise();
    await epg.start();
    let pgc!: pg.Client;
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
    const dbUrl = `postgres://ams:ams@127.0.0.1:${pgPort}/ams`;
    pgc = new pg.Client({ connectionString: dbUrl });
    await pgc.connect();
    log(`Postgres 16 that :${pgPort}`);

    // --- Redis that
    const redisPort = await freePort();
    const rdir = mkdtempSync(join(tmpdir(), 'ams-e2e-ui-redis-'));
    const rproc: ChildProcess = spawn('redis-server', ['--port', String(redisPort), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--dir', rdir], { stdio: 'ignore' });
    cleanups.push(() => {
      rproc.kill('SIGTERM');
      rmSync(rdir, { recursive: true, force: true });
    });
    for (let i = 0; i < 80 && !(await redisPing(redisPort)); i++) await sleep(100);
    log(`Redis that :${redisPort}`);

    const s3 = await startFakeS3(BUCKET);
    const smtp = await startFakeSmtp();
    cleanups.push(() => s3.close());
    cleanups.push(() => smtp.close());

    const env: Record<string, string> = {
      DATABASE_URL: dbUrl,
      REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      S3_ENDPOINT: s3.url,
      S3_PUBLIC_ENDPOINT: s3.url,
      S3_REGION: 'us-east-1',
      S3_BUCKET: BUCKET,
      S3_ACCESS_KEY: 'e2e-access',
      S3_SECRET_KEY: 'e2e-secret',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      MAIL_FROM: 'AMS <no-reply@ams.test>',
      SESSION_SECRET: randomBytes(32).toString('base64'),
      FIELD_ENC_KEY: randomBytes(32).toString('base64'),
      SEPAY_MODE: 'mock', // bat /dev/sepay/simulate
      RUNTIME: 'docker',
      PUBLIC_ADMIN_URL: 'http://admin.ams.test',
      PORTAL_PUBLIC_URL: 'http://portal.ams.test',
      TRUST_PROXY: '1',
      SCRYPT_N: '1024',
      SEED_ADMIN_EMAIL: ADMIN_EMAIL,
      SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
      SEED_ADMIN_TOTP_SECRET: ADMIN_TOTP,
      MEDIA_PUBLIC_URL: `${s3.url}/${BUCKET}`,
      HB_MIN_GAP_S: '0',
      TELEMETRY_FLUSH_MS: '300',
      MANIFEST_MEM_TTL_S: '1',
      DEVICE_MEM_TTL_S: '1',
      GATEWAY_DEV_ENDPOINTS: '0',
      API_SCHEDULER: '0',
    };
    await run('pnpm', ['--filter', '@ams/api', 'migrate'], env, ROOT);
    await run('pnpm', ['--filter', '@ams/api', 'seed'], env, ROOT);
    log('migrate + seed xong');

    const api = await startApi({ ...env, PORT: '0', OUTBOX_INTERVAL_MS: '500' });
    cleanups.push(() => api.close());
    const gwPort = await freePort();
    const gw = await startGateway({ ...env, PORT: String(gwPort), COMMAND_SWEEP_MS: '500' });
    cleanups.push(() => gw.close());
    const cons = await startConsumer({ ...env, PORT: '0' });
    cleanups.push(() => cons.close());
    const web = await startWeb(dist, api.port);
    cleanups.push(() => web.close());
    log(`api :${api.port}, gateway :${gwPort}, web ${web.url}`);

    return {
      webUrl: web.url,
      apiUrl: `http://127.0.0.1:${api.port}`,
      gwUrl: `http://127.0.0.1:${gwPort}`,
      s3,
      smtp,
      q: async (sql, params = []) => (await pgc.query(sql, params)).rows,
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
