#!/usr/bin/env node
// AMS - triển khai lên Cloudflare (staging | production). Xem docs/DEPLOY-CLOUDFLARE.md.
//
//   node scripts/deploy-cloudflare.mjs --env staging                 deploy đủ: migration D1 + gateway + api + web
//   node scripts/deploy-cloudflare.mjs --env staging --dry-run       kiểm cấu hình + build thử, KHÔNG đụng Cloudflare thật
//   node scripts/deploy-cloudflare.mjs --env staging --bootstrap     tạo D1/KV/Queues/R2 bằng wrangler (thay cho Terraform)
//   node scripts/deploy-cloudflare.mjs --env production --rollback   quay lui bản Worker trước đó (không đụng dữ liệu D1)
// Tùy chọn: --only api,gateway,web   --skip-migrate   --skip-build   --skip-backup   --yes (bỏ hỏi xác nhận, dùng trong CI)
//
// Tên miền cố định: production ams.anio.vn (+ /api/*) và gw-ams.anio.vn; staging ams-stg.anio.vn và gw-ams-stg.anio.vn
// (khai báo trong infra/cloudflare/*/wrangler.toml). Zone anio.vn phải nằm trong tài khoản Cloudflare.
// Biến bắt buộc: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (lấy từ môi trường hoặc tệp .env).
// Không in token ra màn hình. Không có bí mật nào được ghi vào tệp wrangler.generated.toml (chỉ ID tài nguyên).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CF = join(ROOT, 'infra/cloudflare');
const WRANGLER = process.env.WRANGLER_BIN ? [process.env.WRANGLER_BIN] : ['npx', '--yes', `wrangler@${process.env.WRANGLER_VERSION || '4'}`];
const WORKERS = { gateway: 'edge-gateway', api: 'api', web: 'web-admin' }; // thứ tự deploy: gateway (chủ Durable Object) -> api -> web
const REQUIRED_SECRETS = { api: ['SESSION_SECRET', 'FIELD_ENC_KEY', 'SEPAY_WEBHOOK_SECRET'], gateway: [] };

// ---------------------------------------------------------------- tham số
export function parseArgs(argv) {
  const a = { env: '', only: ['gateway', 'api', 'web'], dryRun: false, migrate: true, build: true, backup: true, bootstrap: false, rollback: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--env') a.env = argv[++i] ?? '';
    else if (k === '--only') a.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--skip-migrate') a.migrate = false;
    else if (k === '--skip-build') a.build = false;
    else if (k === '--skip-backup') a.backup = false;
    else if (k === '--bootstrap') a.bootstrap = true;
    else if (k === '--rollback') a.rollback = true;
    else if (k === '--yes' || k === '-y') a.yes = true;
    else if (k === '-h' || k === '--help') a.help = true;
    else throw new Error(`Tham số không rõ: ${k}`);
  }
  return a;
}

function loadDotEnv() {
  const f = join(ROOT, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(CLOUDFLARE_[A-Z_]+)\s*=(.*)$/.exec(line);
    if (m && !process.env[m[1]] && m[2].trim()) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

const log = (m) => console.log(m);
const step = (m) => console.log(`\n=== ${m} ===`);
function die(m) { console.error(`\nLỖI: ${m}`); process.exit(1); }

function sh(cmd, args, { cwd = ROOT, allowFail = false, capture = false, env = {} } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.error) die(`Không chạy được "${cmd}": ${r.error.message}`);
  if (r.status !== 0 && !allowFail) die(`Lệnh thất bại (mã ${r.status}): ${[cmd, ...args].join(' ')}`);
  return r;
}
const wr = (args, o) => sh(WRANGLER[0], [...WRANGLER.slice(1), ...args], o);

// ---------------------------------------------------------------- ID tài nguyên + dựng cấu hình
const ID_KEYS = { __D1_CORE_ID__: 'd1_core_id', __D1_FINANCE_ID__: 'd1_finance_id', __D1_AUDIT_ID__: 'd1_audit_id', __KV_ID__: 'kv_id' };
const idsPath = (env) => join(CF, `ids.${env}.json`);

export function readIds(env) {
  const f = idsPath(env);
  if (!existsSync(f)) return null;
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  const ids = {};
  for (const [k, v] of Object.entries(raw)) ids[k] = v && typeof v === 'object' && 'value' in v ? v.value : v; // chấp nhận cả định dạng `terraform output -json`
  return ids;
}

// Thư mục migration D1 đã lọc theo phương ngữ (xem stageD1Migrations), đường dẫn tương đối từ infra/cloudflare/<worker>/
const D1_DIRS = { core: '../.generated/d1-migrations', finance: '../.generated/d1-migrations-finance', audit: '../.generated/d1-migrations-audit' };

export function renderConfig(template, { ids, financeMigrations = false, auditMigrations = false }) {
  let t = template.replaceAll('"../../../packages/db/migrations"', `"${D1_DIRS.core}"`);
  for (const [ph, key] of Object.entries(ID_KEYS)) t = t.replaceAll(ph, ids?.[key] ?? ph);
  // migrations_dir riêng cho finance/audit nếu repo có thư mục con tương ứng
  const addDir = (db, sub) => { t = t.replace(new RegExp(`(binding = "${db}"[^\\[]*?database_id = "[^"]+"\\n)`, 'g'), `$1migrations_dir = "${D1_DIRS[sub]}"\n`); };
  if (financeMigrations) addDir('DB_FINANCE', 'finance');
  if (auditMigrations) addDir('DB_AUDIT', 'audit');
  return t;
}

// packages/db/migrations chứa tệp theo phương ngữ: NNNN_x.sql (chung), NNNN_x.postgres.sql, NNNN_x.sqlite.sql.
// D1 là SQLite: giữ tệp chung + .sqlite (bỏ hậu tố .sqlite), loại .postgres.
export function d1Name(file) {
  if (/\.postgres\.sql$/.test(file)) return null;
  return file.replace(/\.sqlite\.sql$/, '.sql');
}
function stageD1Migrations(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  for (const f of readdirSync(dstDir)) if (f.endsWith('.sql')) unlinkSync(join(dstDir, f)); // chỉ xóa bản sao đã sinh
  let n = 0;
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith('.sql')).sort()) {
    const name = d1Name(f);
    if (name) { copyFileSync(join(srcDir, f), join(dstDir, name)); n++; }
  }
  return n;
}

function prepareConfigs(a) {
  const ids = readIds(a.env);
  const missing = Object.values(ID_KEYS).filter((k) => !ids || !ids[k]);
  if (missing.length && !a.bootstrap) {
    die(`Thiếu ID tài nguyên (${missing.join(', ')}) trong infra/cloudflare/ids.${a.env}.json.\n` +
        `  Cách 1: chạy lại với --bootstrap để script tạo tài nguyên bằng wrangler.\n` +
        `  Cách 2: cd infra/cloudflare/terraform && terraform apply, rồi: terraform output -json > ../ids.${a.env}.json`);
  }
  const mdir = join(ROOT, 'packages/db/migrations');
  const fin = existsSync(join(mdir, 'finance')), aud = existsSync(join(mdir, 'audit'));
  const gen = join(CF, '.generated');
  if (!existsSync(mdir)) die('Không thấy packages/db/migrations.');
  const nCore = stageD1Migrations(mdir, join(gen, 'd1-migrations'));
  if (!nCore) die('packages/db/migrations không có tệp .sql dùng được cho D1.');
  if (fin) stageD1Migrations(join(mdir, 'finance'), join(gen, 'd1-migrations-finance'));
  if (aud) stageD1Migrations(join(mdir, 'audit'), join(gen, 'd1-migrations-audit'));
  log(`Migration D1: ${nCore} tệp (đã loại tệp .postgres, đổi .sqlite -> .sql) tại infra/cloudflare/.generated/`);
  const out = {};
  for (const w of a.only.map((n) => WORKERS[n] ?? die(`--only không hợp lệ: ${n} (gateway|api|web)`))) {
    const tpl = join(CF, w, 'wrangler.toml');
    if (!existsSync(tpl)) die(`Thiếu ${tpl}`);
    const text = renderConfig(readFileSync(tpl, 'utf8'), { ids, financeMigrations: fin, auditMigrations: aud });
    const left = [...new Set(text.match(/__[A-Z0-9_]+__/g) ?? [])];
    if (left.length && !a.bootstrap) die(`${w}: còn dấu chưa thay: ${left.join(', ')}`);
    const dst = join(CF, w, 'wrangler.generated.toml');
    writeFileSync(dst, text);
    out[w] = dst;
  }
  return { cfgs: out, hasFinance: fin, hasAudit: aud };
}

// ---------------------------------------------------------------- bootstrap tài nguyên bằng wrangler
function bootstrap(a) {
  step(`Bootstrap tài nguyên Cloudflare (${a.env}) bằng wrangler`);
  const ids = readIds(a.env) ?? {};
  const grab = (r, re) => { const m = re.exec((r.stdout || '') + (r.stderr || '')); return m?.[1]; };
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
  const hex32 = /\b([0-9a-f]{32})\b/;
  for (const [dom, key] of [['core', 'd1_core_id'], ['finance', 'd1_finance_id'], ['audit', 'd1_audit_id']]) {
    if (ids[key]) { log(`D1 ${dom}: đã có (${ids[key]})`); continue; }
    const r = wr(['d1', 'create', `ams-${dom}-${a.env}`, '--location', 'apac'], { capture: true, allowFail: true });
    const id = grab(r, uuid);
    if (!id) die(`Không đọc được database_id của D1 ams-${dom}-${a.env} (có thể đã tồn tại). Xem: wrangler d1 list. Đầu ra:\n${r.stdout}${r.stderr}`);
    ids[key] = id; log(`D1 ${dom}: ${id}`);
  }
  if (!ids.kv_id) {
    const r = wr(['kv', 'namespace', 'create', `ams-kv-${a.env}`], { capture: true, allowFail: true });
    const id = grab(r, hex32);
    if (!id) die(`Không đọc được id KV. Đầu ra:\n${r.stdout}${r.stderr}`);
    ids.kv_id = id; log(`KV: ${id}`);
  }
  for (const q of ['ingest', 'ingest-dlq', 'jobs', 'jobs-dlq']) wr(['queues', 'create', `ams-${q}-${a.env}`], { allowFail: true }); // đã tồn tại thì bỏ qua
  for (const b of ['media', 'reports', 'audit']) wr(['r2', 'bucket', 'create', `ams-${b}-${a.env}`], { allowFail: true });
  writeFileSync(idsPath(a.env), JSON.stringify(ids, null, 2) + '\n');
  log(`Đã ghi ${idsPath(a.env)} (không commit tệp này).`);
}

// ---------------------------------------------------------------- các bước
async function confirmProd(a) {
  if (a.env !== 'production' || a.yes || a.dryRun) return;
  if (!process.stdin.isTTY) die('Deploy production không tương tác cần --yes.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question('Bạn sắp deploy PRODUCTION. Gõ "production" để tiếp tục: ');
  rl.close();
  if (ans.trim() !== 'production') die('Đã hủy.');
}

function buildWeb() {
  step('Build web-admin');
  sh('pnpm', ['--filter', '@ams/web-admin', 'build'], { env: { VITE_API_BASE: '/api' } });
  if (!existsSync(join(ROOT, 'apps/web-admin/dist/index.html'))) die('Không thấy apps/web-admin/dist/index.html sau khi build.');
}

function backupD1(a, cfg) {
  step('Sao lưu D1 core trước khi migration');
  const dir = join(ROOT, 'backups', `${a.env}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'core.sql');
  const r = wr(['d1', 'export', `ams-core-${a.env}`, '--remote', '--output', f, '-c', cfg, '--env', a.env], { allowFail: true });
  if (r.status === 0) log(`Đã lưu ${f}`); else log('Cảnh báo: không export được (DB mới/rỗng?). D1 còn có Time Travel 30 ngày để khôi phục.');
}

function migrate(a, cfg, hasFinance, hasAudit) {
  step('Migration D1 (nguồn: packages/db/migrations)');
  const dbs = [['core', 'ams-core']];
  if (hasFinance) dbs.push(['finance', 'ams-finance']);
  if (hasAudit) dbs.push(['audit', 'ams-audit']);
  if (!hasFinance || !hasAudit) log('Ghi chú: chưa có packages/db/migrations/{finance,audit}; D1 finance/audit để trống cho đến khi f1 tách migration theo miền.');
  for (const [, name] of dbs) wr(['d1', 'migrations', 'apply', `${name}-${a.env}`, '--remote', '-c', cfg, '--env', a.env]);
}

function checkSecrets(a, cfgs) {
  step('Kiểm tra bí mật đã đặt trên Worker');
  for (const [name, w] of [['api', 'api'], ['gateway', 'edge-gateway']]) {
    if (!cfgs[w] || !REQUIRED_SECRETS[name].length) continue;
    const r = wr(['secret', 'list', '-c', cfgs[w], '--env', a.env], { capture: true, allowFail: true });
    if (r.status !== 0) { log(`Cảnh báo: chưa đọc được danh sách secret của ${w} (Worker chưa tồn tại?). Đặt bằng: npx wrangler secret put <TÊN> -c ${cfgs[w]} --env ${a.env}`); continue; }
    const have = new Set([...(r.stdout.matchAll(/"name":\s*"([^"]+)"/g))].map((m) => m[1]));
    const miss = REQUIRED_SECRETS[name].filter((s) => !have.has(s));
    if (miss.length) die(`Worker ${w} thiếu secret: ${miss.join(', ')}.\n  Đặt: npx wrangler secret put ${miss[0]} -c ${cfgs[w]} --env ${a.env}`);
    log(`${w}: đủ secret bắt buộc`);
  }
}

async function smoke(a) {
  step('Smoke test /health');
  const app = a.env === 'production' ? 'ams.anio.vn' : 'ams-stg.anio.vn';
  const gw = a.env === 'production' ? 'gw-ams.anio.vn' : 'gw-ams-stg.anio.vn';
  const targets = [`https://${app}/`, `https://${app}/api/health`, `https://${gw}/health`];
  let bad = 0;
  for (const u of targets) {
    let res = 'không kết nối';
    for (let i = 0; i < 6; i++) { try { const r = await fetch(u, { signal: AbortSignal.timeout(8000) }); res = r.status; if (r.status === 200) break; } catch (e) { res = e.cause?.code || e.name; } await new Promise((r) => setTimeout(r, 5000)); }
    log(`${res === 200 ? 'OK ' : 'LỖI'} ${u} -> ${res}`);
    if (res !== 200) bad++;
  }
  if (bad) log('\nCó điểm lỗi: chứng chỉ/DNS của tên miền mới có thể cần vài phút, hoặc Worker chưa có /health. Nếu kéo dài: chạy --rollback.');
}

function rollback(a, cfgs) {
  step(`Quay lui Worker (${a.env}) về phiên bản triển khai liền trước`);
  for (const w of [...a.only].reverse()) { // web -> api -> gateway
    const name = WORKERS[w];
    if (cfgs[name]) wr(['rollback', '-c', cfgs[name], '--env', a.env, '--message', 'AMS rollback']);
  }
  log('\nDữ liệu D1 KHÔNG tự quay lui. Nếu migration gây lỗi, khôi phục bằng Time Travel:');
  log(`  npx wrangler d1 time-travel restore ams-core-${a.env} --timestamp=<ISO-8601 trước khi deploy> --env ${a.env}`);
  log('  hoặc nạp tệp sao lưu trong thư mục backups/ (xem docs/DEPLOY-CLOUDFLARE.md, mục Quay lui).');
}

// ---------------------------------------------------------------- main
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  if (!['staging', 'production'].includes(a.env)) die('Cần --env staging hoặc --env production.');
  loadDotEnv();
  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !process.env[k]);
  if (missing.length) {
    if (a.dryRun) log(`(dry-run) thiếu biến ${missing.join(', ')}: bỏ qua phần cần kết nối Cloudflare.`);
    else die(`Thiếu biến môi trường: ${missing.join(', ')}.\n  Điền vào .env (xem .env.example mục 12) hoặc đặt trong CI secrets. Hướng dẫn tạo token: docs/DEPLOY-CLOUDFLARE.md.`);
  }
  await confirmProd(a);

  if (a.bootstrap) { if (a.dryRun) log('(dry-run) bỏ qua bootstrap'); else bootstrap(a); }
  const { cfgs, hasFinance, hasAudit } = prepareConfigs(a);
  log(`Cấu hình dựng xong cho: ${Object.keys(cfgs).join(', ')}`);

  if (a.rollback) { rollback(a, cfgs); return; }
  if (a.only.includes('web') && a.build) buildWeb();

  if (a.dryRun) {
    step('Dry-run: wrangler deploy --dry-run (không gửi gì lên Cloudflare)');
    for (const n of a.only) wr(['deploy', '--dry-run', '--outdir', join(ROOT, '.wrangler/dry', WORKERS[n]), '-c', cfgs[WORKERS[n]], '--env', a.env]);
    log('\nDry-run xong. Chưa deploy.');
    return;
  }

  if (a.migrate && a.only.includes('api')) {
    if (a.backup) backupD1(a, cfgs['api']);
    migrate(a, cfgs['api'], hasFinance, hasAudit);
  }
  checkSecrets(a, cfgs);
  for (const n of a.only) { step(`Deploy ${WORKERS[n]} (${a.env})`); wr(['deploy', '-c', cfgs[WORKERS[n]], '--env', a.env]); }
  await smoke(a);
  log(`\nXong. Việc tiếp theo: danh sách kiểm tra sau deploy trong docs/DEPLOY-CLOUDFLARE.md (SePay sandbox, đăng nhập, tạo chiến dịch thử).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => die(e.message));
