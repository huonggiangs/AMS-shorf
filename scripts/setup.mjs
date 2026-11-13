#!/usr/bin/env node
// AMS - bộ khởi tạo dùng chung cho Makefile và scripts/ams.ps1 (không phụ thuộc gói ngoài, Node >= 20).
//
//   node scripts/setup.mjs setup [--force]   kiểm tra máy + tạo .env từ .env.example (khóa ngẫu nhiên)
//   node scripts/setup.mjs env [--force]     chỉ tạo/bổ sung .env
//   node scripts/setup.mjs doctor            chẩn đoán: công cụ, .env, container, cổng dịch vụ
//   node scripts/setup.mjs creds             in địa chỉ + tài khoản Super admin mẫu từ .env
//   node scripts/setup.mjs totp              in mã TOTP hiện tại + URI otpauth của Super admin mẫu
//   node scripts/setup.mjs tunnel-url        tìm URL quick tunnel trong log và in URL webhook SePay
//   node scripts/setup.mjs check-env         kiểm .env (còn CHANGE_ME / mặc định yếu thì thoát mã 1)
//   node scripts/setup.mjs seed-mode [bootstrap|demo]
//                                            in chế độ seed sẽ chạy: mặc định local -> demo, staging/production -> bootstrap.
//                                            Yêu cầu `demo` ở staging/production mà thiếu AMS_ALLOW_DEMO_SEED=1 thì thoát mã 3.
//                                            `bootstrap` = chỉ Super admin + cấu hình tối thiểu (xem docs/SEED-AND-BOOTSTRAP.md)
import { randomBytes, createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');
const ENV_EXAMPLE = join(ROOT, '.env.example');
const COMPOSE_FILE = 'infra/docker/docker-compose.yml';
const PLACEHOLDER = 'CHANGE_ME_AUTO';

const MIN = { dockerMajor: 24, composeMinor: [2, 20], ramGbCore: 8, ramGbRecommended: 16, cpuCore: 4, cpuRecommended: 8, diskGb: 20 };

const c = process.stdout.isTTY
  ? { g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
  : { g: (s) => s, y: (s) => s, r: (s) => s, b: (s) => s };
const ok = (m) => console.log(`${c.g('[OK]  ')} ${m}`);
const warn = (m) => console.log(`${c.y('[CẢNH BÁO]')} ${m}`);
const bad = (m) => console.log(`${c.r('[LỖI] ')} ${m}`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, shell: false, ...opts });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), missing: r.error?.code === 'ENOENT' };
}

// ---------------------------------------------------------------- .env
export function parseEnv(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) map[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return map;
}
const readEnv = () => (existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {});

const b64 = (n) => randomBytes(n).toString('base64');
const b64url = (n) => randomBytes(n).toString('base64url');
const hex = (n) => randomBytes(n).toString('hex');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) { val = (val << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

// Cách sinh cho từng khóa. Khóa nào không có ở đây mà còn CHANGE_ME_AUTO sẽ nhận hex 24 byte.
const GENERATORS = {
  SESSION_SECRET: () => b64url(48),
  FIELD_ENC_KEY: () => b64(32), // đúng 32 byte, base64 (AES-256-GCM)
  SEPAY_WEBHOOK_SECRET: () => hex(32),
  POSTGRES_PASSWORD: () => hex(24),
  REDIS_PASSWORD: () => hex(24),
  GRAFANA_ADMIN_PASSWORD: () => b64url(18),
  SEED_ADMIN_PASSWORD: () => `${b64url(14)}Aa1!`, // đạt chính sách mật khẩu thông thường
  SEED_ADMIN_TOTP_SECRET: () => base32(randomBytes(20)),
};

export function buildEnv(exampleText, existing = {}) {
  const gen = {};
  const lines = exampleText.split(/\r?\n/).map((line) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) return line;
    const [, key, val] = m;
    if (existing[key] !== undefined && existing[key] !== '' && existing[key] !== PLACEHOLDER) { gen[key] = existing[key]; return `${key}=${existing[key]}`; }
    if (val.trim() === PLACEHOLDER) { gen[key] = (GENERATORS[key] ?? (() => hex(24)))(); return `${key}=${gen[key]}`; }
    gen[key] = val; return line;
  });
  // đồng bộ mật khẩu vào chuỗi kết nối dùng khi chạy ngoài container
  const fix = (text) => text
    .replace(/^(DATABASE_URL=postgres:\/\/)([^:]+):[^@]*@/m, (_, a, u) => `${a}${u}:${gen.POSTGRES_PASSWORD}@`)
    .replace(/^(REDIS_URL=redis:\/\/):[^@]*@/m, (_, a) => `${a}:${gen.REDIS_PASSWORD}@`);
  return { text: fix(lines.join('\n')), generated: gen };
}

function cmdEnv({ force = false } = {}) {
  if (!existsSync(ENV_EXAMPLE)) { bad('Không thấy .env.example'); process.exit(1); }
  const example = readFileSync(ENV_EXAMPLE, 'utf8');
  const exists = existsSync(ENV_FILE);
  if (exists && !force) {
    // Giữ giá trị cũ; chỉ bổ sung khóa mới của .env.example và điền khóa còn CHANGE_ME_AUTO.
    const cur = readEnv();
    const missing = Object.keys(parseEnv(example)).filter((k) => !(k in cur));
    const stale = Object.entries(cur).filter(([, v]) => v === PLACEHOLDER).map(([k]) => k);
    if (!missing.length && !stale.length) { ok('.env đã có và đầy đủ (giữ nguyên, không ghi đè)'); return; }
    const { text } = buildEnv(example, cur);
    writeFileSync(ENV_FILE, text);
    ok(`.env cập nhật: thêm ${missing.length} khóa mới, sinh ${stale.length} khóa còn trống (các giá trị cũ được giữ)`);
    return;
  }
  const { text } = buildEnv(example, {});
  writeFileSync(ENV_FILE, text, { mode: 0o600 });
  try { chmodSync(ENV_FILE, 0o600); } catch { /* Windows */ }
  ok(`Đã tạo .env với khóa ngẫu nhiên (SESSION_SECRET, FIELD_ENC_KEY 32 byte, SEPAY_WEBHOOK_SECRET, Postgres, Redis...)`);
  warn('Hãy sao lưu .env và đặc biệt FIELD_ENC_KEY: mất khóa này sẽ không giải mã được dữ liệu nhạy cảm.');
}

// ---------------------------------------------------------------- kiểm tra máy
function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) ok(`Node.js ${process.versions.node}`);
  else if (major >= 20) warn(`Node.js ${process.versions.node}: chạy được script này nhưng dự án nhắm tới Node 22 (cần khi phát triển ngoài Docker)`);
  else bad(`Node.js ${process.versions.node} quá cũ (cần >= 20, khuyến nghị 22)`);
  return major >= 20;
}

function checkDocker() {
  let healthy = true;
  const v = run('docker', ['version', '--format', '{{.Client.Version}}']);
  if (v.missing) { bad('Không tìm thấy lệnh `docker`. Cài Docker Desktop (Windows: bật WSL2) rồi chạy lại.'); return { ok: false, daemon: false }; }
  const major = Number((v.out.split('.')[0]) || 0);
  if (major >= MIN.dockerMajor) ok(`Docker client ${v.out}`); else { warn(`Docker client ${v.out || '?'} cũ; khuyến nghị >= ${MIN.dockerMajor}`); }
  const comp = run('docker', ['compose', 'version', '--short']);
  if (comp.code !== 0) { bad('Thiếu `docker compose` (Compose v2). Cập nhật Docker Desktop.'); healthy = false; }
  else {
    const [a, b] = comp.out.replace(/^v/, '').split('.').map(Number);
    if (a > MIN.composeMinor[0] || (a === MIN.composeMinor[0] && b >= MIN.composeMinor[1])) ok(`Docker Compose ${comp.out}`);
    else { bad(`Docker Compose ${comp.out} < ${MIN.composeMinor.join('.')} (cần cho depends_on required:false)`); healthy = false; }
  }
  const info = run('docker', ['info', '--format', '{{.NCPU}} {{.MemTotal}}']);
  if (info.code !== 0) {
    bad('Docker daemon không chạy hoặc không kết nối được. Mở Docker Desktop và đợi biểu tượng "Running".');
    return { ok: false, daemon: false };
  }
  const [ncpu, mem] = info.out.split(' ').map(Number);
  const gb = mem / 1024 ** 3;
  if (gb >= MIN.ramGbRecommended - 0.5) ok(`Docker thấy ${gb.toFixed(1)} GB RAM, ${ncpu} CPU`);
  else if (gb >= MIN.ramGbCore - 0.5) warn(`Docker chỉ có ${gb.toFixed(1)} GB RAM (khuyến nghị ${MIN.ramGbRecommended}). Đủ chạy profile core; KHÔNG bật events/obs cùng lúc. Windows: tăng bộ nhớ WSL2 trong %UserProfile%\\.wslconfig`);
  else { bad(`Docker chỉ có ${gb.toFixed(1)} GB RAM (tối thiểu ${MIN.ramGbCore} GB cho core).`); healthy = false; }
  if (ncpu < MIN.cpuCore) { bad(`Docker chỉ có ${ncpu} CPU (tối thiểu ${MIN.cpuCore}).`); healthy = false; }
  else if (ncpu < MIN.cpuRecommended) warn(`Docker có ${ncpu} CPU (khuyến nghị ${MIN.cpuRecommended}); build lần đầu sẽ chậm.`);
  return { ok: healthy, daemon: true };
}

function checkHost() {
  const gb = os.totalmem() / 1024 ** 3;
  ok(`Máy chủ: ${os.platform()} ${os.arch()}, ${gb.toFixed(1)} GB RAM, ${os.cpus().length} CPU`);
  if (gb < MIN.ramGbCore) warn(`RAM máy ${gb.toFixed(1)} GB thấp hơn ${MIN.ramGbCore} GB tối thiểu`);
  const df = process.platform === 'win32' ? { code: 1 } : run('df', ['-Pk', ROOT]);
  if (df.code === 0) {
    const free = Number(df.out.split('\n').pop().trim().split(/\s+/)[3]) / 1024 ** 2;
    if (free < MIN.diskGb) warn(`Ổ đĩa còn ${free.toFixed(0)} GB trống (khuyến nghị >= 60 GB, tối thiểu ${MIN.diskGb} GB)`); else ok(`Ổ đĩa còn ${free.toFixed(0)} GB trống`);
  }
}

function checkPorts(env) {
  const ports = [['PROXY_HTTP_PORT', 80], ['PROXY_HTTPS_PORT', 443], ['WEB_ADMIN_PORT', 8080], ['API_PORT', 8787], ['GATEWAY_PORT', 8788], ['POSTGRES_PORT', 5432], ['REDIS_PORT', 6379], ['MEDIA_PUBLIC_PORT', 9000], ['MAILPIT_UI_PORT', 8025]];
  return Promise.all(ports.map(([k, d]) => new Promise(async (res) => {
    const port = Number(env[k] || d);
    const { createServer } = await import('node:net');
    const s = createServer();
    s.once('error', (e) => { warn(`Cổng ${port} (${k}) có vẻ đang bị chiếm (${e.code}). Nếu đó là AMS đang chạy thì bỏ qua; nếu không hãy đổi ${k} trong .env`); res(); });
    s.once('listening', () => s.close(() => res()));
    s.listen(port, '127.0.0.1');
  })));
}

// Phân loại môi trường: khớp packages/db/src/seed-guard.ts (resolveAmsEnv).
export function amsEnvOf(env) {
  const raw = String(env.AMS_ENV || '').trim().toLowerCase();
  const map = { local: 'local', dev: 'local', development: 'local', test: 'test', staging: 'staging', stg: 'staging', production: 'production', prod: 'production' };
  if (raw) return map[raw] || null; // null = không hợp lệ
  const rt = String(env.RUNTIME || '').toLowerCase();
  return rt === 'cloudflare' || rt === 'k8s' ? 'production' : 'local';
}
const isLocalAms = (e) => e === 'local' || e === 'test';
const WEAK = /^(test|mock|change[-_ ]?me|secret|example|dummy|placeholder|password|sepay)|CHANGE_ME/i;

/** Quyết định chế độ seed. Trả { mode } hoặc { error }. */
export function resolveSeedMode(env, requested) {
  const e = amsEnvOf(env);
  if (!e) return { error: `AMS_ENV="${env.AMS_ENV}" không hợp lệ (local|test|staging|production)` };
  const want = requested || env.SEED_MODE || (isLocalAms(e) ? 'demo' : 'bootstrap');
  if (want !== 'demo' && want !== 'bootstrap') return { error: `chế độ seed "${want}" không hợp lệ (bootstrap|demo)` };
  if (want === 'demo' && !isLocalAms(e) && env.AMS_ALLOW_DEMO_SEED !== '1')
    return { error: `Từ chối seed demo ở AMS_ENV=${e}. Dùng "bootstrap", hoặc đặt AMS_ALLOW_DEMO_SEED=1 nếu thật sự cần.`, refused: true };
  return { mode: want, env: e };
}

export function envProblems(env) {
  const p = [];
  const ams = amsEnvOf(env);
  if (!ams) p.push(`AMS_ENV="${env.AMS_ENV}" không hợp lệ (local|test|staging|production)`);
  if (ams === 'production' && (env.SEPAY_MODE || 'mock') === 'mock') p.push('AMS_ENV=production không được dùng SEPAY_MODE=mock');
  if (env.SEPAY_MODE === 'production' && (!env.SEPAY_WEBHOOK_SECRET || env.SEPAY_WEBHOOK_SECRET.length < 32 || WEAK.test(env.SEPAY_WEBHOOK_SECRET))) p.push('SEPAY_MODE=production cần SEPAY_WEBHOOK_SECRET thật (>= 32 ký tự, không phải giá trị mẫu/mock/CHANGE_ME)');
  if (env.SEPAY_MODE === 'production' && env.SEPAY_API_KEY && WEAK.test(env.SEPAY_API_KEY)) p.push('SEPAY_MODE=production nhưng SEPAY_API_KEY là giá trị mẫu');
  if (ams && !isLocalAms(ams) && env.AMS_ALLOW_DEMO_SEED === '1') p.push(`AMS_ALLOW_DEMO_SEED=1 ở AMS_ENV=${ams}: seed demo được phép; chắc chắn đây không phải CSDL thật`);
  const need = ['SESSION_SECRET', 'FIELD_ENC_KEY', 'SEPAY_WEBHOOK_SECRET', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'SEED_ADMIN_PASSWORD'];
  for (const k of need) if (!env[k] || env[k] === PLACEHOLDER || /^change-me/i.test(env[k])) p.push(`${k} chưa được sinh (chạy: make setup)`);
  if (env.FIELD_ENC_KEY && env.FIELD_ENC_KEY !== PLACEHOLDER) {
    let len = -1; try { len = Buffer.from(env.FIELD_ENC_KEY, 'base64').length; } catch { /* noop */ }
    if (len !== 32) p.push(`FIELD_ENC_KEY phải là 32 byte mã hóa base64 (hiện ${len} byte)`);
  }
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) p.push('SESSION_SECRET phải >= 32 ký tự');
  if (!['docker', 'cloudflare', 'k8s'].includes(env.RUNTIME)) p.push(`RUNTIME="${env.RUNTIME}" không hợp lệ (docker|cloudflare|k8s)`);
  if (!['mock', 'sandbox', 'production'].includes(env.SEPAY_MODE)) p.push(`SEPAY_MODE="${env.SEPAY_MODE}" không hợp lệ (mock|sandbox|production)`);
  if (env.SEPAY_MODE === 'production' && env.RUNTIME === 'docker') p.push('SEPAY_MODE=production trên Docker local: hãy chắc chắn bạn muốn nhận tiền thật về máy này');
  return p;
}

function cmdCheckEnv() {
  if (!existsSync(ENV_FILE)) { bad('Chưa có .env. Chạy: make setup'); process.exit(1); }
  const probs = envProblems(readEnv());
  if (probs.length) { probs.forEach(bad); process.exit(1); }
  ok('.env hợp lệ');
}

// ---------------------------------------------------------------- TOTP (RFC 6238), chỉ để đăng nhập thử cục bộ
export function totp(secretB32, t = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac('sha1', base32decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}
function cmdTotp() {
  const env = readEnv();
  if (!isLocalAms(amsEnvOf(env) || 'production')) { bad('Lệnh totp chỉ dùng ở môi trường local.'); process.exit(1); }
  const s = env.SEED_ADMIN_TOTP_SECRET;
  if (!s || s === PLACEHOLDER) { bad('Chưa có SEED_ADMIN_TOTP_SECRET trong .env (chạy make setup)'); process.exit(1); }
  const uri = `otpauth://totp/AMS:${encodeURIComponent(env.SEED_ADMIN_EMAIL || 'admin@ams.localhost')}?secret=${s}&issuer=AMS&digits=6&period=30`;
  console.log(`Mã TOTP hiện tại: ${c.b(totp(s))}  (đổi sau mỗi 30 giây)`);
  console.log(`URI để thêm vào app xác thực: ${uri}`);
  console.log('Lưu ý: seed của a1 phải nạp SEED_ADMIN_TOTP_SECRET thì mã này mới dùng được (xem ops/agents/f2-infra.requests.md).');
}

function cmdSeedMode(requested) {
  const over = {};
  for (const k of ['AMS_ENV', 'AMS_ALLOW_DEMO_SEED', 'SEED_MODE', 'RUNTIME']) if (process.env[k] !== undefined) over[k] = process.env[k]; // biến tiến trình thắng .env
  const r = resolveSeedMode({ ...readEnv(), ...over }, requested);
  if (r.error) { bad(r.error); process.exit(r.refused ? 3 : 1); }
  console.log(r.mode);
}

function cmdCreds() {
  const e = readEnv();
  if (!isLocalAms(amsEnvOf(e) || 'production')) { warn('AMS_ENV không phải local: không in mật khẩu. Dùng mật khẩu đã cấp cho Super admin (bootstrap) và đổi ngay khi đăng nhập lần đầu.'); return; }
  console.log('');
  console.log(c.b('=== AMS đã sẵn sàng ==='));
  console.log(`Web quản trị : ${e.APP_PUBLIC_URL || 'https://admin.ams.localhost'}   (trình duyệt cảnh báo chứng chỉ tự ký lần đầu: chọn "Tiếp tục")`);
  console.log(`Cổng khách   : ${e.PORTAL_PUBLIC_URL || 'https://portal.ams.localhost'}`);
  console.log(`API          : ${e.API_PUBLIC_URL || 'https://api.ams.localhost'}/health`);
  console.log(`Email (Mailpit): http://localhost:${e.MAILPIT_UI_PORT || 8025}`);
  console.log(`Media TV     : ${e.PUBLIC_MEDIA_BASE_URL || 'http://localhost:9000/media-public'}/renditions/...  (kho tệp = volume mediadata)`);
  console.log(`Super admin  : ${e.SEED_ADMIN_EMAIL}  /  ${e.SEED_ADMIN_PASSWORD}`);
  console.log('Mã TOTP      : chạy `node scripts/setup.mjs totp` nếu đăng nhập yêu cầu 2FA');
  console.log('');
}

// ---------------------------------------------------------------- doctor
async function probe(url, ms = 3000) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.status; } catch (e) { return e.cause?.code || e.name || 'lỗi'; }
}
async function cmdDoctor() {
  console.log(c.b('--- Công cụ ---'));
  checkNode(); checkHost();
  const d = checkDocker();
  for (const [bin, args] of [['pnpm', ['-v']], ['make', ['--version']]]) {
    const r = run(bin, args);
    if (r.missing) warn(`Không có \`${bin}\` ${bin === 'make' ? '(bình thường trên Windows: dùng scripts/ams.ps1)' : '(chỉ cần khi chạy test/phát triển ngoài Docker)'}`);
    else ok(`${bin} ${r.out.split('\n')[0]}`);
  }
  console.log(c.b('--- Cấu hình ---'));
  if (!existsSync(ENV_FILE)) bad('Chưa có .env. Chạy: make setup');
  else { const p = envProblems(readEnv()); if (p.length) p.forEach(bad); else ok('.env hợp lệ'); }
  const env = readEnv();
  if (d.daemon && existsSync(ENV_FILE)) {
    console.log(c.b('--- Cú pháp compose ---'));
    const cfg = run('docker', ['compose', '--env-file', '.env', '-f', COMPOSE_FILE, '--profile', '*', 'config', '-q']);
    cfg.code === 0 ? ok('docker compose config hợp lệ') : bad(`compose config lỗi: ${cfg.err}`);
    console.log(c.b('--- Container ---'));
    const ps = run('docker', ['compose', '--env-file', '.env', '-f', COMPOSE_FILE, '--profile', '*', 'ps', '--all', '--format', '{{.Service}}\t{{.State}}\t{{.Health}}\t{{.ExitCode}}']);
    if (!ps.out) warn('Chưa có container nào. Chạy: make up');
    for (const line of ps.out.split('\n').filter(Boolean)) {
      const [svc, state, health, exit] = line.split('\t');
      const oneShot = ['migrate-seed'].includes(svc);
      if (oneShot) (state === 'exited' && exit === '0') ? ok(`${svc}: đã chạy xong`) : bad(`${svc}: ${state} (exit ${exit}). Xem: make logs S=${svc}`);
      else if (state === 'running' && (health === 'healthy' || health === '')) ok(`${svc}: chạy tốt ${health ? '(healthy)' : ''}`);
      else bad(`${svc}: ${state} ${health}. Xem: make logs S=${svc}`);
    }
  }
  console.log(c.b('--- Cổng dịch vụ ---'));
  await checkPorts(env);
  const urls = [['api', `http://localhost:${env.API_PORT || 8787}/health`], ['edge-gateway', `http://localhost:${env.GATEWAY_PORT || 8788}/health`], ['web-admin', `http://localhost:${env.WEB_ADMIN_PORT || 8080}/healthz`], ['Media (Caddy)', `http://localhost:${env.MEDIA_PUBLIC_PORT || 9000}/media-public/healthz`], ['Mailpit', `http://localhost:${env.MAILPIT_UI_PORT || 8025}/livez`]];
  for (const [name, url] of urls) { const s = await probe(url); (s === 200) ? ok(`${name} ${url} -> 200`) : warn(`${name} ${url} -> ${s} (bình thường nếu chưa chạy make up)`); }
}

function cmdTunnelUrl() {
  const r = run('docker', ['compose', '--env-file', '.env', '-f', COMPOSE_FILE, '--profile', 'tunnel', 'logs', '--no-log-prefix', 'tunnel']);
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(r.out + r.err);
  if (!m) { bad('Chưa thấy URL tunnel. Đợi vài giây rồi chạy lại: make tunnel'); process.exit(1); }
  console.log(`URL công khai của API : ${m[0]}`);
  console.log(`Webhook SePay (dán vào my.sepay.vn > Webhooks): ${m[0]}/webhooks/payments/sepay`);
  console.log('Lưu ý: URL này đổi mỗi lần chạy lại tunnel. Đặt SEPAY_MODE=sandbox và dùng cùng SEPAY_WEBHOOK_SECRET.');
}

// ---------------------------------------------------------------- main
const [cmd = 'setup', ...rest] = process.argv.slice(2);
const flags = new Set(rest);
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('setup.mjs')) {
  switch (cmd) {
    case 'setup': {
      console.log(c.b('AMS setup: kiểm tra máy'));
      const n = checkNode(); checkHost(); const d = checkDocker();
      await checkPorts(readEnv());
      cmdEnv({ force: flags.has('--force') });
      if (!n || !d.ok) { warn('Có vấn đề ở trên; sửa rồi chạy lại `make setup`. (.env vẫn đã được tạo.)'); process.exit(d.daemon ? 1 : 2); }
      ok('Sẵn sàng. Bước tiếp: make up && make seed');
      break;
    }
    case 'env': cmdEnv({ force: flags.has('--force') }); break;
    case 'check-env': cmdCheckEnv(); break;
    case 'doctor': await cmdDoctor(); break;
    case 'seed-mode': cmdSeedMode(rest[0]); break;
    case 'creds': cmdCreds(); break;
    case 'totp': cmdTotp(); break;
    case 'tunnel-url': cmdTunnelUrl(); break;
    default: console.error(`Lệnh không rõ: ${cmd}`); process.exit(64);
  }
}
