// Kiem Dockerfile khong can Docker: goi (bundle) api / edge-gateway / ingest-consumer bang esbuild DUNG THAM SO nhu Dockerfile,
// chay `node index.mjs` voi bien moi truong giong docker-compose (ten bien lay tu compose), Postgres + Redis THAT, roi goi /health.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { existsSync, rmSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { startFakeS3, startFakeSmtp } from './fakes.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
let fails = 0;
const log = (ok: boolean, name: string, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' - ' + extra : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });
const redisPing = (port: number) => new Promise<boolean>((res) => { const c = connect(port, '127.0.0.1', () => c.write('PING\r\n')); c.on('data', (d) => { c.destroy(); res(d.toString().startsWith('+PONG')); }); c.on('error', () => res(false)); });
function run(cmd: string, args: string[], env: Record<string, string>, cwd: string): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env } as NodeJS.ProcessEnv, cwd });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(`${cmd} ${args.join(' ')} -> ${c}\n${out.slice(-800)}`))));
  });
}
function findEsbuild(): string {
  const dir = join(ROOT, 'node_modules/.pnpm');
  const d = readdirSync(dir).filter((n) => n.startsWith('esbuild@')).sort().pop();
  if (!d) throw new Error('khong tim thay esbuild trong node_modules/.pnpm');
  return join(dir, d, 'node_modules/esbuild/bin/esbuild');
}

const cleanups: (() => Promise<void> | void)[] = [];
async function main() {
  const pgPort = await freePort();
  const pgDir = join(tmpdir(), `ams-bundle-pg-${process.pid}-${Date.now()}`);
  const epg = new EmbeddedPostgres({ databaseDir: pgDir, user: 'ams', password: 'ams', port: pgPort, persistent: false, onLog: () => undefined, onError: () => undefined });
  await epg.initialise();
  await epg.start();
  cleanups.push(async () => { await epg.stop(); if (existsSync(pgDir)) rmSync(pgDir, { recursive: true, force: true }); });
  await epg.createDatabase('ams');
  const redisPort = await freePort();
  const rdir = mkdtempSync(join(tmpdir(), 'ams-bundle-redis-'));
  const rp: ChildProcess = spawn('redis-server', ['--port', String(redisPort), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--dir', rdir], { stdio: 'ignore' });
  cleanups.push(() => { rp.kill('SIGTERM'); rmSync(rdir, { recursive: true, force: true }); });
  for (let i = 0; i < 80 && !(await redisPing(redisPort)); i++) await sleep(100);
  const s3 = await startFakeS3('ams-media');
  const smtp = await startFakeSmtp();
  cleanups.push(() => s3.close(), () => smtp.close());
  log(true, 'ha tang: Postgres + Redis + S3/SMTP gia');

  // cung ten bien voi infra/docker/docker-compose.yml (x-app-env)
  const env: Record<string, string> = {
    RUNTIME: 'docker', NODE_ENV: 'production', LOG_LEVEL: 'info',
    DATABASE_URL: `postgres://ams:ams@127.0.0.1:${pgPort}/ams`, REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    S3_ENDPOINT: s3.url, S3_PUBLIC_ENDPOINT: s3.url, S3_REGION: 'us-east-1', S3_BUCKET: 'ams-media', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's', S3_FORCE_PATH_STYLE: 'true',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: 'AMS <no-reply@ams.localhost>',
    SESSION_SECRET: randomBytes(32).toString('base64'), FIELD_ENC_KEY: randomBytes(32).toString('base64'),
    SEPAY_MODE: 'mock', SEPAY_WEBHOOK_SECRET: 'x'.repeat(24),
    PUBLIC_ADMIN_URL: 'https://admin.ams.localhost', PORTAL_PUBLIC_URL: 'https://portal.ams.localhost', APP_PUBLIC_URL: 'https://admin.ams.localhost',
    TRUST_PROXY: '1', SCRYPT_N: '1024', SEED: '1', SEED_ADMIN_EMAIL: 'admin@ams.localhost', SEED_ADMIN_PASSWORD: 'Change-me-1234!', SEED_ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
  };
  try {
    const o1 = await run('pnpm', ['--filter', '@ams/api', 'migrate'], env, ROOT);
    const o2 = await run('pnpm', ['--filter', '@ams/api', 'seed'], env, ROOT);
    log(/0003_integration/.test(o1), 'migrate + seed (lenh cua tang `migrate` trong Dockerfile)', o2.trim().split('\n').pop() ?? '');
  } catch (e) { log(false, 'migrate/seed', (e as Error).message); return; }

  const esb = findEsbuild();
  const out = mkdtempSync(join(tmpdir(), 'ams-bundle-out-'));
  cleanups.push(() => rmSync(out, { recursive: true, force: true }));
  const svcs: { dir: string; port: number; path: string }[] = [
    { dir: 'api', port: 8787, path: '/health' },
    { dir: 'edge-gateway', port: 8788, path: '/health' },
    { dir: 'ingest-consumer', port: 8789, path: '/health' },
  ];
  for (const s of svcs) {
    const outfile = join(out, s.dir, 'index.mjs');
    try {
      await run(esb, ['src/index.ts', '--bundle', '--platform=node', '--target=node22', '--format=esm', `--outfile=${outfile}`, '--sourcemap', '--legal-comments=none', '--log-level=warning', '--external:pg-native',
        "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"], {}, join(ROOT, 'services', s.dir));
      log(statSync(outfile).size > 0, `esbuild ${s.dir} (tham so nhu Dockerfile)`, `${(statSync(outfile).size / 1e6).toFixed(1)} MB`);
    } catch (e) { log(false, `esbuild ${s.dir}`, (e as Error).message); continue; }
    const port = await freePort();
    let logs = '';
    // chay CHINH XAC nhu image: `node --enable-source-maps index.mjs`, cwd = thu muc chua tep (khong co node_modules)
    const p = spawn('node', ['--enable-source-maps', 'index.mjs'], { cwd: join(out, s.dir), env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ...env, PORT: String(port), API_SCHEDULER: '0' } });
    p.stdout.on('data', (d) => (logs += d));
    p.stderr.on('data', (d) => (logs += d));
    cleanups.push(() => { p.kill('SIGTERM'); });
    let ok = false;
    let body = '';
    for (let i = 0; i < 60 && !ok; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}${s.path}`); body = await r.text(); ok = r.status === 200; } catch { /* chua len */ }
      if (!ok) await sleep(250);
    }
    log(ok, `node index.mjs ${s.dir}: GET ${s.path} = 200`, ok ? body.slice(0, 80) : logs.slice(-300));
    if (ok && s.dir === 'api') {
      const r = await fetch(`http://127.0.0.1:${port}/auth/session`).catch(() => null);
      log(!!r && r.status < 500, 'api /auth/session khong 5xx (DB that)', String(r?.status));
    }
  }
}
main().catch((e) => { fails++; console.error(e); }).finally(async () => {
  for (const c of cleanups.reverse()) { try { await c(); } catch { /* */ } }
  console.log(fails ? `KET QUA: ${fails} FAIL` : 'KET QUA: tat ca PASS');
  process.exit(fails ? 1 : 0);
});
