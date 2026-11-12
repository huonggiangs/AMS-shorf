#!/usr/bin/env node
// AMS - triển khai lên Cloudflare từng bước (staging | production). Xem docs/DEPLOY-CLOUDFLARE.md.
//
//   node scripts/deploy-cloudflare.mjs --env staging --preflight        CHỈ kiểm tra (token, zone, quyền). Không tạo/sửa gì.
//   node scripts/deploy-cloudflare.mjs --env staging --dry-run          chạy cả quy trình ở chế độ xem trước: preflight (chỉ đọc),
//                                                                        liệt kê việc sẽ làm, build + `wrangler deploy --dry-run`
//   node scripts/deploy-cloudflare.mjs --env staging                    deploy thật, tuần tự từng bước
//   node scripts/deploy-cloudflare.mjs --env staging --steps preflight,resources   chỉ chạy các bước chọn
//   node scripts/deploy-cloudflare.mjs --env production --rollback      quay lui mã Worker (không đụng dữ liệu D1)
//
// Các bước (theo thứ tự): preflight -> resources (D1/KV/Queues/R2) -> build (web) -> migrate (D1) -> secrets -> deploy
//                          -> domains (custom domain/route/DNS) -> smoke (/health)
// Tùy chọn: --only api,gateway,web  --skip-migrate --skip-build --skip-backup --skip-secrets --skip-domains
//   --generate-secrets   tự sinh SESSION_SECRET và FIELD_ENC_KEY nếu thiếu (lưu bản sao ở backups/, không in ra màn hình)
//   --secrets-file F     tệp .env chứa giá trị bí mật (nên ngoài repo); ngoài ra đọc biến môi trường AMS_SECRET_<TÊN>
//   --overwrite-secrets  đặt lại cả bí mật đã có trên Worker (mặc định chỉ đặt cái còn thiếu)
//   --pause              dừng hỏi Enter trước mỗi bước có ghi (cần terminal)
//   --fake-ids           CI/ngoại tuyến: dùng ID giả, KHÔNG gọi Cloudflare, bắt buộc đi kèm --dry-run
//   --yes                bỏ hỏi xác nhận production (dùng trong CI)
//
// Biến bắt buộc: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (môi trường hoặc tệp .env). Tùy chọn: CLOUDFLARE_ZONE_NAME (mặc định anio.vn).
// Tên miền: production ams.anio.vn (+ /api/*) và gw-ams.anio.vn; staging ams-stg.anio.vn và gw-ams-stg.anio.vn (đọc từ
// infra/cloudflare/*/wrangler.toml). Zone phải nằm trong tài khoản Cloudflare.
// An toàn: token và bí mật KHÔNG bao giờ được in ra (mọi đầu ra đi qua redact), không ghi vào wrangler.generated.toml.
// Chế độ --dry-run không tạo/sửa/xóa/deploy gì trên Cloudflare: chỉ gọi API ĐỌC (GET).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CF = join(ROOT, 'infra/cloudflare');
const WRANGLER_VERSION = process.env.WRANGLER_VERSION || '4.161.0'; // ghim phiên bản đã dry-run thành công; đổi có chủ ý
const WRANGLER = process.env.WRANGLER_BIN ? [process.env.WRANGLER_BIN] : ['npx', '--yes', `wrangler@${WRANGLER_VERSION}`];
const API = process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4'; // CF_API_BASE chỉ để thử với máy chủ giả
const WORKERS = { gateway: 'edge-gateway', api: 'api', web: 'web-admin' }; // thứ tự deploy: gateway (chủ Durable Object) -> api -> web
const STEPS = ['preflight', 'resources', 'build', 'migrate', 'secrets', 'deploy', 'domains', 'smoke'];

// Bí mật theo Worker. gen: có thể tự sinh khi có --generate-secrets. required: thiếu thì không deploy tiếp / báo lỗi cuối.
// SEPAY_WEBHOOK_SECRET KHÔNG tự sinh: phải trùng giá trị dán vào my.sepay.vn nên chủ sở hữu tự đặt.
export const SECRETS = {
  api: [
    { name: 'SESSION_SECRET', required: true, gen: 'hex' },
    { name: 'FIELD_ENC_KEY', required: true, gen: 'b64' },
    { name: 'SEPAY_WEBHOOK_SECRET', required: true },
    { name: 'R2_ACCOUNT_ID', required: false },
    { name: 'R2_ACCESS_KEY_ID', required: false },
    { name: 'R2_SECRET_ACCESS_KEY', required: false },
    { name: 'MAIL_HTTP_URL', required: false },
    { name: 'MAIL_HTTP_KEY', required: false },
    { name: 'MAIL_FROM', required: false },
  ],
  gateway: [],
};

// Quyền token (tên nhóm quyền trên dashboard) dùng cho kiểm tra chủ động qua API token, và thăm dò quyền ĐỌC từng nhóm tài nguyên.
export const REQUIRED_PERMS = [
  'Workers Scripts Write', 'D1 Write', 'Workers KV Storage Write', 'Workers R2 Storage Write', 'Queues Write',
  'Workers Routes Write', 'DNS Write', 'Zone Read',
];

// ---------------------------------------------------------------- tham số
export function parseArgs(argv) {
  const a = {
    env: '', only: ['gateway', 'api', 'web'], steps: [...STEPS], dryRun: false, preflightOnly: false, fakeIds: false,
    migrate: true, build: true, backup: true, secrets: true, domains: true, genSecrets: false, secretsFile: '', overwriteSecrets: false,
    pause: false, rollback: false, yes: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--env') a.env = argv[++i] ?? '';
    else if (k === '--only') a.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (k === '--steps') a.steps = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (k === '--preflight') a.preflightOnly = true;
    else if (k === '--bootstrap') a.steps = ['preflight', 'resources']; // tương thích bản cũ: chỉ tạo tài nguyên
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--fake-ids') a.fakeIds = true;
    else if (k === '--skip-migrate') a.migrate = false;
    else if (k === '--skip-build') a.build = false;
    else if (k === '--skip-backup') a.backup = false;
    else if (k === '--skip-secrets') a.secrets = false;
    else if (k === '--skip-domains') a.domains = false;
    else if (k === '--generate-secrets') a.genSecrets = true;
    else if (k === '--secrets-file') a.secretsFile = argv[++i] ?? '';
    else if (k === '--overwrite-secrets') a.overwriteSecrets = true;
    else if (k === '--pause') a.pause = true;
    else if (k === '--rollback') a.rollback = true;
    else if (k === '--yes' || k === '-y') a.yes = true;
    else if (k === '-h' || k === '--help') a.help = true;
    else throw new Error(`Tham số không rõ: ${k}`);
  }
  for (const s of a.steps) if (!STEPS.includes(s)) throw new Error(`--steps không hợp lệ: ${s} (${STEPS.join('|')})`);
  if (a.preflightOnly) a.steps = ['preflight'];
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

// ---------------------------------------------------------------- in ấn + che bí mật
const sensitive = new Set(); // token và giá trị bí mật: mọi đầu ra đi qua redact()
export function redact(s) {
  let out = String(s ?? '');
  for (const v of sensitive) if (v && v.length >= 6) out = out.split(v).join('***');
  return out;
}
const log = (m) => console.log(redact(m));
const warn = (m) => console.log(redact(`CẢNH BÁO: ${m}`));
const step = (m) => console.log(`\n=== ${redact(m)} ===`);
function die(m) { console.error(`\nLỖI: ${redact(m)}`); process.exit(1); }

function sh(cmd, args, { cwd = ROOT, allowFail = false, capture = false, env = {}, input } = {}) {
  const piped = capture || input !== undefined;
  const r = spawnSync(cmd, args, {
    cwd, encoding: 'utf8', input, stdio: piped ? [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32', env: { ...process.env, ...env },
  });
  if (r.error) die(`Không chạy được "${cmd}": ${r.error.message}`);
  if (r.status !== 0 && !allowFail) die(`Lệnh thất bại (mã ${r.status}): ${[cmd, ...args].join(' ')}\n${(r.stdout || '').slice(-600)}${(r.stderr || '').slice(-600)}`);
  return r;
}
const wr = (args, o) => sh(WRANGLER[0], [...WRANGLER.slice(1), ...args], o);

// ---------------------------------------------------------------- API Cloudflare (token chỉ đi trong header, không bao giờ in)
async function cf(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    let json = null;
    try { json = await res.json(); } catch { /* không phải JSON */ }
    const errs = (json?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
    return { ok: res.ok && json?.success !== false, status: res.status, result: json?.result, info: json?.result_info, error: errs };
  } catch (e) {
    return { ok: false, status: 0, result: null, error: `không kết nối được api.cloudflare.com (${e.cause?.code || e.name})` };
  }
}
const isAuthErr = (r) => r.status === 401 || r.status === 403;

// ---------------------------------------------------------------- ID tài nguyên + dựng cấu hình
const ID_KEYS = { __D1_CORE_ID__: 'd1_core_id', __D1_FINANCE_ID__: 'd1_finance_id', __D1_AUDIT_ID__: 'd1_audit_id', __KV_ID__: 'kv_id' };
const idsPath = (env) => join(CF, `ids.${env}.json`);
const FAKE_IDS = {
  d1_core_id: '11111111-1111-4111-8111-111111111111', d1_finance_id: '22222222-2222-4222-8222-222222222222',
  d1_audit_id: '33333333-3333-4333-8333-333333333333', kv_id: '0123456789abcdef0123456789abcdef',
};

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

// Lấy tên Worker + route của một môi trường từ wrangler.toml (nguồn sự thật duy nhất cho bước "domains").
export function extractRoutes(toml, env) {
  const m = new RegExp(`^\\[env\\.${env}\\]\\s*\\n([\\s\\S]*?)(?=^\\[)`, 'm').exec(toml);
  if (!m) return { name: null, routes: [] };
  const block = m[1];
  const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? null;
  const routes = [];
  for (const r of block.matchAll(/\{\s*pattern\s*=\s*"([^"]+)"([^}]*)\}/g)) routes.push({ pattern: r[1], customDomain: /custom_domain\s*=\s*true/.test(r[2]) });
  return { name, routes };
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

function prepareConfigs(a, ids) {
  const mdir = join(ROOT, 'packages/db/migrations');
  const fin = existsSync(join(mdir, 'finance')), aud = existsSync(join(mdir, 'audit'));
  const gen = join(CF, '.generated');
  if (!existsSync(mdir)) die('Không thấy packages/db/migrations.');
  const nCore = stageD1Migrations(mdir, join(gen, 'd1-migrations'));
  if (!nCore) die('packages/db/migrations không có tệp .sql dùng được cho D1.');
  if (fin) stageD1Migrations(join(mdir, 'finance'), join(gen, 'd1-migrations-finance'));
  if (aud) stageD1Migrations(join(mdir, 'audit'), join(gen, 'd1-migrations-audit'));
  log(`Migration D1: ${nCore} tệp (đã loại tệp .postgres, đổi .sqlite -> .sql) tại infra/cloudflare/.generated/`);
  const out = {}, routes = {};
  for (const w of a.only.map((n) => WORKERS[n] ?? die(`--only không hợp lệ: ${n} (gateway|api|web)`))) {
    const tpl = join(CF, w, 'wrangler.toml');
    if (!existsSync(tpl)) die(`Thiếu ${tpl}`);
    const raw = readFileSync(tpl, 'utf8');
    const text = renderConfig(raw, { ids, financeMigrations: fin, auditMigrations: aud });
    const left = [...new Set(text.match(/__[A-Z0-9_]+__/g) ?? [])];
    if (left.length) die(`${w}: còn dấu chưa thay: ${left.join(', ')} (thiếu ID tài nguyên; chạy bước resources).`);
    const dst = join(CF, w, 'wrangler.generated.toml');
    writeFileSync(dst, text);
    out[w] = dst;
    routes[w] = extractRoutes(raw, a.env);
  }
  return { cfgs: out, routes, hasFinance: fin, hasAudit: aud };
}

// ---------------------------------------------------------------- xác nhận
let rl = null;
async function ask(q) {
  if (!process.stdin.isTTY) die(`Cần terminal tương tác để hỏi: "${q}". Dùng --yes (CI) hoặc chạy trong terminal.`);
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
  return (await rl.question(q)).trim();
}
async function confirmProd(a) {
  if (a.env !== 'production' || a.yes || a.dryRun || a.preflightOnly) return;
  if ((await ask('Bạn sắp deploy PRODUCTION. Gõ "production" để tiếp tục: ')) !== 'production') die('Đã hủy.');
}
async function gate(a, what) {
  if (a.pause && !a.dryRun) await ask(`\n[--pause] Sắp làm: ${what}. Nhấn Enter để tiếp tục (Ctrl+C để dừng): `);
}

// ================================================================ BƯỚC 1: PREFLIGHT
// Chỉ đọc. Trả về { fails, zoneId, accountId } và in bảng kết quả rõ ràng.
async function preflight(a, expectHosts) {
  step(`Preflight (${a.env}) - chỉ đọc, không thay đổi gì`);
  let fails = 0, warns = 0;
  const ok = (m) => log(`  [OK]    ${m}`);
  const bad = (m) => { fails++; log(`  [LỖI]   ${m}`); };
  const wn = (m) => { warns++; log(`  [CHÚ Ý] ${m}`); };

  // Máy cục bộ
  const major = Number(process.versions.node.split('.')[0]);
  major >= 22 ? ok(`Node ${process.versions.node}`) : bad(`Cần Node >= 22 (đang ${process.versions.node}).`);
  const w = wr(['--version'], { capture: true, allowFail: true });
  w.status === 0 ? ok(`wrangler ${(w.stdout || '').trim().split('\n').pop()}`) : bad(`Không chạy được wrangler (${WRANGLER.join(' ')}). Cần mạng tới registry npm.`);

  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (token) sensitive.add(token);
  if (!token) bad('Thiếu CLOUDFLARE_API_TOKEN (đặt trong .env hoặc môi trường).');
  if (!account) bad('Thiếu CLOUDFLARE_ACCOUNT_ID (dash.cloudflare.com > Workers & Pages > Account ID).');
  if (!token || !account) return { fails, warns, zoneId: null };
  if (!/^[0-9a-f]{32}$/i.test(account)) bad('CLOUDFLARE_ACCOUNT_ID phải là chuỗi 32 ký tự hex.');

  // Token hợp lệ? Token thuộc tài khoản dùng /accounts/{id}/tokens/verify, token của người dùng dùng /user/tokens/verify.
  let v = await cf(`/accounts/${account}/tokens/verify`);
  let tokenKind = 'tài khoản';
  if (!v.ok) { v = await cf('/user/tokens/verify'); tokenKind = 'người dùng'; }
  let tokenId = null;
  if (!v.ok) {
    bad(`Token không hợp lệ hoặc không đủ quyền xác minh (${v.error || `HTTP ${v.status}`}). Tạo lại token theo docs/DEPLOY-CLOUDFLARE.md mục 3.`);
    return { fails, warns, zoneId: null };
  }
  tokenId = v.result?.id;
  v.result?.status === 'active' ? ok(`Token hợp lệ (loại ${tokenKind}, trạng thái active)`) : bad(`Token có trạng thái "${v.result?.status}" (cần active).`);
  if (v.result?.expires_on) {
    const days = Math.round((Date.parse(v.result.expires_on) - Date.now()) / 864e5);
    days < 0 ? bad('Token đã hết hạn.') : days < 14 ? wn(`Token hết hạn sau ${days} ngày.`) : ok(`Token hết hạn sau ${days} ngày`);
  }

  // Tài khoản
  const acc = await cf(`/accounts/${account}`);
  if (acc.ok) ok(`Tài khoản: ${acc.result?.name ?? account}`);
  else if (isAuthErr(acc)) wn('Không đọc được thông tin tài khoản (thiếu quyền "Account Settings: Read"); không chặn, nhưng nên thêm.');
  else bad(`Không truy cập được tài khoản ${account}: ${acc.error || `HTTP ${acc.status}`} (sai Account ID, hoặc token không thuộc tài khoản này).`);

  // Zone: anio.vn có trong tài khoản?
  const zoneName = process.env.CLOUDFLARE_ZONE_NAME || 'anio.vn';
  let zoneId = null;
  const z = await cf(`/zones?name=${encodeURIComponent(zoneName)}&per_page=50`);
  if (!z.ok) {
    bad(`Không liệt kê được zone (${z.error || `HTTP ${z.status}`}): thiếu quyền "Zone: Read" cho zone ${zoneName}, hoặc token không bao gồm zone này.`);
  } else {
    const mine = (z.result ?? []).filter((x) => x.name === zoneName && (!x.account?.id || x.account.id === account));
    if (!mine.length) {
      bad(`Zone "${zoneName}" KHÔNG có trong tài khoản ${account} (hoặc token không được phép thấy). Worker không gắn được tên miền ngoài Cloudflare.\n` +
          '           Xử lý: docs/DEPLOY-CLOUDFLARE.md mục 1 (Add a site + đổi nameserver), rồi đảm bảo token có Zone Resources gồm zone này.');
    } else {
      zoneId = mine[0].id;
      mine[0].status === 'active' ? ok(`Zone ${zoneName} có trong tài khoản, trạng thái active (id ${zoneId})`)
        : bad(`Zone ${zoneName} có trạng thái "${mine[0].status}" (cần active: nameserver tại nhà đăng ký tên miền phải trỏ về Cloudflare).`);
      if (mine[0].type === 'partial') wn('Zone ở chế độ partial (CNAME): custom domain của Workers có thể không hoạt động; nên chuyển nameserver hẳn về Cloudflare.');
    }
  }

  // Thăm dò quyền ĐỌC theo nhóm (không ghi thử). Quyền Edit thật chỉ lộ ra khi ghi; xem phần chính sách token ở dưới.
  const probes = [
    ['Workers Scripts', `/accounts/${account}/workers/scripts`],
    ['D1', `/accounts/${account}/d1/database?per_page=1`],
    ['Workers KV Storage', `/accounts/${account}/storage/kv/namespaces?per_page=1`],
    ['Workers R2 Storage', `/accounts/${account}/r2/buckets?per_page=1`],
    ['Queues', `/accounts/${account}/queues`],
    ['Workers Custom Domains (Scripts)', `/accounts/${account}/workers/domains`],
  ];
  if (zoneId) probes.push(['Workers Routes (zone)', `/zones/${zoneId}/workers/routes`], ['DNS (zone)', `/zones/${zoneId}/dns_records?per_page=1`]);
  for (const [name, p] of probes) {
    const r = await cf(p);
    if (r.ok) ok(`Đọc được: ${name}`);
    else if (isAuthErr(r)) bad(`Thiếu quyền cho: ${name} (${r.error || `HTTP ${r.status}`})`);
    else wn(`${name}: HTTP ${r.status} ${r.error} (có thể chưa bật dịch vụ trong tài khoản, ví dụ R2 cần bật + thẻ thanh toán, Queues cần gói phù hợp)`);
  }

  // Đọc chính sách của chính token (nếu token được phép) để đối chiếu quyền Edit
  if (tokenId && tokenKind === 'người dùng') {
    const t = await cf(`/user/tokens/${tokenId}`);
    if (t.ok) {
      const have = new Set((t.result?.policies ?? []).flatMap((p) => (p.permission_groups ?? []).map((g) => g.name)));
      const miss = REQUIRED_PERMS.filter((n) => ![...have].some((h) => h.toLowerCase() === n.toLowerCase()));
      miss.length ? bad(`Token thiếu nhóm quyền: ${miss.join(', ')}`) : ok('Chính sách token có đủ nhóm quyền ghi cần thiết');
    } else wn('Không đọc được chính sách token (cần "API Tokens: Read"): quyền GHI chưa kiểm được, sẽ lộ ra khi tạo tài nguyên.');
  } else wn('Quyền GHI (Edit) không thể kiểm bằng GET: đối chiếu thủ công với bảng ở docs/DEPLOY-CLOUDFLARE.md mục 3. Thiếu quyền ghi sẽ báo lỗi ở bước tạo tài nguyên, trước khi deploy.');

  // Tên miền sẽ dùng: đã có bản ghi DNS khác chưa?
  if (zoneId) {
    for (const h of expectHosts) {
      const d = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(h)}&per_page=5`);
      if (!d.ok) continue;
      const recs = d.result ?? [];
      recs.length ? wn(`Đã có ${recs.length} bản ghi DNS cho ${h} (${recs.map((r) => r.type).join(',')}). Nếu không phải do lần deploy trước, custom domain sẽ báo xung đột: xóa/đổi bản ghi đó trước khi deploy.`) : ok(`Tên miền ${h} còn trống`);
    }
  }
  log(`\nPreflight: ${fails ? `${fails} LỖI` : 'không có lỗi'}, ${warns} chú ý.`);
  return { fails, warns, zoneId };
}

// ================================================================ BƯỚC 2: TÀI NGUYÊN (idempotent: có rồi thì bỏ qua)
const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

async function listExisting(account, env) {
  const found = { d1: {}, kv: {}, queues: new Set(), r2: new Set(), ok: true };
  const d1 = await cf(`/accounts/${account}/d1/database?per_page=100`);
  const kv = await cf(`/accounts/${account}/storage/kv/namespaces?per_page=100`);
  const qs = await cf(`/accounts/${account}/queues`);
  const r2 = await cf(`/accounts/${account}/r2/buckets?per_page=100`);
  if (!d1.ok || !kv.ok) found.ok = false;
  for (const x of d1.result ?? []) found.d1[x.name] = x.uuid ?? x.id;
  for (const x of kv.result ?? []) found.kv[x.title] = x.id;
  for (const x of qs.result ?? []) found.queues.add(x.queue_name ?? x.name);
  for (const x of r2.result?.buckets ?? r2.result ?? []) found.r2.add(x.name);
  if (!qs.ok || !r2.ok) found.partial = true;
  return found;
}

async function resources(a) {
  step(`Tài nguyên Cloudflare (${a.env}): D1, KV, Queues, R2`);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const ids = readIds(a.env) ?? {};
  const want = {
    d1: [['d1_core_id', `ams-core-${a.env}`], ['d1_finance_id', `ams-finance-${a.env}`], ['d1_audit_id', `ams-audit-${a.env}`]],
    kv: [['kv_id', `ams-kv-${a.env}`]],
    queues: ['ingest', 'ingest-dlq', 'jobs', 'jobs-dlq'].map((q) => `ams-${q}-${a.env}`),
    r2: ['media', 'reports', 'audit'].map((b) => `ams-${b}-${a.env}`),
  };
  const have = process.env.CLOUDFLARE_API_TOKEN ? await listExisting(account, a.env) : null;
  if (!have) { warn('Không có token: không liệt kê được tài nguyên hiện có.'); return ids; }
  if (!have.ok) warn('Không liệt kê được D1/KV (thiếu quyền?): dùng ID trong ids.<env>.json nếu có.');

  for (const [key, name] of want.d1) {
    if (have.d1[name]) { ids[key] = have.d1[name]; log(`D1 ${name}: đã có`); continue; }
    if (a.dryRun) { log(`[dry-run] sẽ tạo D1 ${name} (vùng apac)`); continue; }
    await gate(a, `tạo D1 ${name}`);
    const r = wr(['d1', 'create', name, '--location', 'apac'], { capture: true, allowFail: true });
    const id = uuid.exec((r.stdout || '') + (r.stderr || ''))?.[1];
    if (!id) die(`Không tạo/đọc được D1 ${name}. Đầu ra:\n${r.stdout}${r.stderr}`);
    ids[key] = id; log(`D1 ${name}: đã tạo`);
  }
  for (const [key, name] of want.kv) {
    if (have.kv[name]) { ids[key] = have.kv[name]; log(`KV ${name}: đã có`); continue; }
    if (a.dryRun) { log(`[dry-run] sẽ tạo KV ${name}`); continue; }
    await gate(a, `tạo KV ${name}`);
    const r = wr(['kv', 'namespace', 'create', name], { capture: true, allowFail: true });
    const id = /\b([0-9a-f]{32})\b/.exec((r.stdout || '') + (r.stderr || ''))?.[1];
    if (!id) die(`Không tạo/đọc được KV ${name}. Đầu ra:\n${r.stdout}${r.stderr}`);
    ids[key] = id; log(`KV ${name}: đã tạo`);
  }
  for (const q of want.queues) {
    if (have.queues.has(q)) { log(`Queue ${q}: đã có`); continue; }
    if (a.dryRun) { log(`[dry-run] sẽ tạo Queue ${q}`); continue; }
    await gate(a, `tạo Queue ${q}`);
    const r = wr(['queues', 'create', q], { capture: true, allowFail: true });
    if (r.status !== 0) die(`Không tạo được Queue ${q} (Queues có thể cần gói Workers phù hợp): ${(r.stdout || '') + (r.stderr || '')}`);
    log(`Queue ${q}: đã tạo`);
  }
  for (const b of want.r2) {
    if (have.r2.has(b)) { log(`R2 ${b}: đã có`); continue; }
    if (a.dryRun) { log(`[dry-run] sẽ tạo R2 bucket ${b}`); continue; }
    await gate(a, `tạo R2 bucket ${b}`);
    const r = wr(['r2', 'bucket', 'create', b], { capture: true, allowFail: true });
    if (r.status !== 0) die(`Không tạo được R2 bucket ${b} (R2 cần được bật trong tài khoản, có thẻ thanh toán): ${(r.stdout || '') + (r.stderr || '')}`);
    log(`R2 ${b}: đã tạo`);
  }
  if (!a.dryRun) { writeFileSync(idsPath(a.env), JSON.stringify(ids, null, 2) + '\n'); log(`Đã ghi ${idsPath(a.env)} (chỉ chứa ID, không commit).`); }
  return ids;
}

// ================================================================ BƯỚC 3-4: build + migration
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
  if (r.status === 0) log(`Đã lưu ${f}`); else warn('không export được (DB mới/rỗng?). D1 còn có Time Travel 30 ngày để khôi phục.');
}

function migrate(a, cfg, hasFinance, hasAudit) {
  step('Migration D1 (nguồn: packages/db/migrations)');
  const dbs = ['ams-core'];
  if (hasFinance) dbs.push('ams-finance');
  if (hasAudit) dbs.push('ams-audit');
  if (!hasFinance || !hasAudit) log('Ghi chú: chưa có packages/db/migrations/{finance,audit}; D1 finance/audit để trống cho đến khi migration được tách theo miền.');
  for (const name of dbs) {
    if (a.dryRun) { log(`[dry-run] sẽ chạy: wrangler d1 migrations apply ${name}-${a.env} --remote`); continue; }
    wr(['d1', 'migrations', 'apply', `${name}-${a.env}`, '--remote', '-c', cfg, '--env', a.env]); // wrangler tự hỏi xác nhận ở terminal
  }
}

// ================================================================ BƯỚC 5: BÍ MẬT (không bao giờ in giá trị)
function readSecretSources(a) {
  const vals = {};
  if (a.secretsFile) {
    const f = resolve(a.secretsFile);
    if (!existsSync(f)) die(`--secrets-file: không thấy ${f}`);
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
      if (m && m[2].trim() && !m[1].startsWith('CLOUDFLARE_')) vals[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('AMS_SECRET_') && v) vals[k.slice('AMS_SECRET_'.length)] = v;
  for (const v of Object.values(vals)) sensitive.add(v);
  return vals;
}

function genValue(kind) {
  return kind === 'b64' ? randomBytes(32).toString('base64') : randomBytes(36).toString('hex'); // hex 72 ký tự
}

// phase: 'pre' (trước deploy) hoặc 'post' (sau deploy; Worker mới tạo lần đầu). Trả về danh sách bí mật bắt buộc còn thiếu.
function ensureSecrets(a, cfgs, phase, state) {
  step(`Bí mật Worker (${phase === 'pre' ? 'trước' : 'sau'} deploy) - giá trị không bao giờ được in`);
  const supplied = (state.supplied ??= readSecretSources(a));
  const missingRequired = [];
  for (const [key, w] of [['api', 'api'], ['gateway', 'edge-gateway']]) {
    const spec = SECRETS[key];
    if (!cfgs[w] || !spec.length) continue;
    if (state.done?.has(key)) continue;
    const r = a.fakeIds ? { status: 1 } : wr(['secret', 'list', '-c', cfgs[w], '--env', a.env], { capture: true, allowFail: true });
    const exists = r.status === 0;
    if (!exists && phase === 'pre') { log(`${w}: Worker chưa tồn tại: đặt bí mật sau lần deploy đầu.`); state.deferred = true; continue; }
    if (!exists) { missingRequired.push(...spec.filter((s) => s.required).map((s) => s.name)); warn(`${w}: không đọc được danh sách bí mật.`); continue; }
    const have = new Set([...(r.stdout.matchAll(/"name":\s*"([^"]+)"/g))].map((m) => m[1]));
    const toSet = {}, generated = {};
    for (const s of spec) {
      const present = have.has(s.name);
      if (present && !a.overwriteSecrets) continue;
      let val = supplied[s.name];
      if (!val && s.gen && a.genSecrets && !present) { val = genValue(s.gen); sensitive.add(val); generated[s.name] = val; }
      if (val) toSet[s.name] = val;
      else if (!present && s.required) missingRequired.push(s.name);
    }
    for (const s of spec) log(`  ${w}.${s.name}: ${have.has(s.name) ? (toSet[s.name] ? 'sẽ ghi đè' : 'đã có') : (toSet[s.name] ? (generated[s.name] ? 'sẽ tự sinh' : 'sẽ đặt') : (s.required ? 'THIẾU (bắt buộc)' : 'chưa đặt (tùy chọn)'))}`);
    const names = Object.keys(toSet);
    if (!names.length) continue;
    if (a.dryRun) { log(`[dry-run] ${w}: sẽ đặt ${names.join(', ')}`); continue; }
    if (Object.keys(generated).length) { // lưu bản sao để sao lưu khóa; KHÔNG in giá trị
      const dir = join(ROOT, 'backups');
      mkdirSync(dir, { recursive: true });
      const f = join(dir, `secrets-${a.env}-${new Date().toISOString().replace(/[:.]/g, '-')}.env`);
      writeFileSync(f, Object.entries(generated).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
      try { chmodSync(f, 0o600); } catch { /* Windows */ }
      log(`  Đã tự sinh ${Object.keys(generated).join(', ')} và lưu bản sao SAO LƯU ở ${f} (quyền 600, đã nằm trong .gitignore). Cất vào nơi an toàn rồi xóa tệp này khỏi máy.`);
    }
    const put = wr(['secret', 'bulk', '-c', cfgs[w], '--env', a.env], { input: JSON.stringify(toSet), allowFail: true });
    if (put.status !== 0) die(`${w}: đặt bí mật thất bại (mã ${put.status}). ${(put.stderr || '').slice(-400)}`);
    log(`  ${w}: đã đặt ${names.join(', ')}`);
    (state.done ??= new Set()).add(key);
    for (const n of names) { const i = missingRequired.indexOf(n); if (i >= 0) missingRequired.splice(i, 1); }
  }
  return missingRequired;
}

// ================================================================ BƯỚC 7: TÊN MIỀN / ROUTE / DNS
async function domains(a, zoneId, routes) {
  step(`Tên miền, route, DNS (${a.env})`);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  let bad = 0;
  if (a.dryRun) { // chỉ in kế hoạch, không gọi API
    for (const { name, routes: rs } of Object.values(routes)) for (const r of rs) log(`[dry-run] ${r.customDomain ? 'custom domain' : 'route'} ${r.pattern} -> ${name}`);
    return 0;
  }
  const zoneName = process.env.CLOUDFLARE_ZONE_NAME || 'anio.vn';
  if (!zoneId) {
    const z = await cf(`/zones?name=${encodeURIComponent(zoneName)}&per_page=50`);
    zoneId = (z.result ?? []).find((x) => x.name === zoneName && (!x.account?.id || x.account.id === account))?.id ?? null;
  }
  if (!zoneId) { warn(`Không tìm thấy zone ${zoneName} trong tài khoản: bỏ qua gắn tên miền (chạy --preflight để biết nguyên nhân).`); return 1; }
  for (const [w, { name, routes: rs }] of Object.entries(routes)) {
    for (const r of rs) {
      if (r.customDomain) {
        const host = r.pattern;
        if (a.dryRun) { log(`[dry-run] custom domain ${host} -> ${name}`); continue; }
        let cur = await cf(`/accounts/${account}/workers/domains?hostname=${encodeURIComponent(host)}`);
        let hit = (cur.result ?? []).find((d) => d.hostname === host);
        if (hit && hit.service !== name) { bad++; log(`  [LỖI]   ${host} đang gắn với Worker khác (${hit.service}), mong đợi ${name}.`); continue; }
        if (!hit) {
          await gate(a, `gắn custom domain ${host} -> ${name}`);
          const put = await cf(`/accounts/${account}/workers/domains`, { method: 'PUT', body: { hostname: host, service: name, zone_id: zoneId, environment: 'production' } });
          if (!put.ok) { bad++; log(`  [LỖI]   không gắn được ${host}: ${put.error || `HTTP ${put.status}`}. Nếu báo xung đột DNS: xóa bản ghi DNS cũ của ${host}.`); continue; }
          log(`  [OK]    đã gắn custom domain ${host} -> ${name}`);
        } else log(`  [OK]    custom domain ${host} -> ${name}`);
      } else if (r.pattern.includes('/')) { // route theo đường dẫn, ví dụ ams.anio.vn/api/*
        if (a.dryRun) { log(`[dry-run] route ${r.pattern} -> ${name}`); continue; }
        const cur = await cf(`/zones/${zoneId}/workers/routes`);
        const hit = (cur.result ?? []).find((x) => x.pattern === r.pattern);
        if (hit && hit.script !== name) { bad++; log(`  [LỖI]   route ${r.pattern} đang trỏ Worker khác (${hit.script}), mong đợi ${name}.`); continue; }
        if (!hit) {
          await gate(a, `tạo route ${r.pattern} -> ${name}`);
          const put = await cf(`/zones/${zoneId}/workers/routes`, { method: 'POST', body: { pattern: r.pattern, script: name } });
          if (!put.ok) { bad++; log(`  [LỖI]   không tạo được route ${r.pattern}: ${put.error || `HTTP ${put.status}`}`); continue; }
          log(`  [OK]    đã tạo route ${r.pattern} -> ${name}`);
        } else log(`  [OK]    route ${r.pattern} -> ${name}`);
      }
      const hostOnly = r.pattern.split('/')[0];
      if (!a.dryRun && r.customDomain) {
        const d = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostOnly)}&per_page=5`);
        log(`          DNS ${hostOnly}: ${d.ok && (d.result ?? []).length ? (d.result.map((x) => `${x.type}${x.proxied ? ' (proxied)' : ''}`).join(', ')) : 'bản ghi do Workers quản lý (có thể không hiện trong danh sách DNS thường)'}`);
      }
    }
    if (!name) { bad++; log(`  [LỖI]   ${w}: không đọc được tên Worker của môi trường ${a.env} từ wrangler.toml`); }
  }
  return bad;
}

// ================================================================ BƯỚC 8: SMOKE
async function smoke(a, routes) {
  step('Smoke test /health');
  const app = a.env === 'production' ? 'ams.anio.vn' : 'ams-stg.anio.vn';
  const gw = a.env === 'production' ? 'gw-ams.anio.vn' : 'gw-ams-stg.anio.vn';
  void routes;
  const targets = [`https://${app}/`, `https://${app}/api/health`, `https://${gw}/health`];
  let bad = 0;
  for (const u of targets) {
    let res = 'không kết nối';
    for (let i = 0; i < 6; i++) { try { const r = await fetch(u, { signal: AbortSignal.timeout(8000) }); res = r.status; if (r.status === 200) break; } catch (e) { res = e.cause?.code || e.name; } await new Promise((r) => setTimeout(r, 5000)); }
    log(`${res === 200 ? 'OK ' : 'LỖI'} ${u} -> ${res}`);
    if (res !== 200) bad++;
  }
  if (bad) log('\nCó điểm lỗi: chứng chỉ/DNS của tên miền mới có thể cần vài phút, hoặc Worker chưa có /health. Nếu kéo dài: chạy --rollback.');
  return bad;
}

function rollback(a, cfgs) {
  step(`Quay lui Worker (${a.env}) về phiên bản triển khai liền trước`);
  for (const w of [...a.only].reverse()) { // web -> api -> gateway
    const name = WORKERS[w];
    if (cfgs[name]) wr(['rollback', '-c', cfgs[name], '--env', a.env, '--message', 'AMS-rollback']);
  }
  log('\nDữ liệu D1 KHÔNG tự quay lui. Nếu migration gây lỗi, khôi phục bằng Time Travel:');
  log(`  npx wrangler d1 time-travel restore ams-core-${a.env} --timestamp=<ISO-8601 trước khi deploy> --env ${a.env}`);
  log('  hoặc nạp tệp sao lưu trong thư mục backups/ (xem docs/DEPLOY-CLOUDFLARE.md, mục Quay lui).');
}

// ---------------------------------------------------------------- main
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 27).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  if (!['staging', 'production'].includes(a.env)) die('Cần --env staging hoặc --env production.');
  if (a.fakeIds && !a.dryRun) die('--fake-ids chỉ dùng cùng --dry-run (ID giả không được phép đi vào deploy thật).');
  loadDotEnv();
  if (process.env.CLOUDFLARE_API_TOKEN) sensitive.add(process.env.CLOUDFLARE_API_TOKEN);
  const has = (s) => a.steps.includes(s);
  const online = !a.fakeIds && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!online && !a.dryRun && !a.rollback) {
    const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !process.env[k]);
    die(`Thiếu biến môi trường: ${missing.join(', ')}.\n  Điền vào .env (xem .env.example mục 12) hoặc đặt trong CI secrets. Hướng dẫn tạo token: docs/DEPLOY-CLOUDFLARE.md mục 3.`);
  }
  if (!online && a.dryRun) log('(dry-run, không gọi Cloudflare: thiếu token/Account ID hoặc --fake-ids). Preflight và liệt kê tài nguyên được bỏ qua.');
  await confirmProd(a);

  // Tên miền dự kiến (đọc từ wrangler.toml) để preflight kiểm DNS
  const expectHosts = [];
  const routeInfo = {};
  for (const n of a.only) {
    const w = WORKERS[n] ?? die(`--only không hợp lệ: ${n} (gateway|api|web)`);
    const raw = readFileSync(join(CF, w, 'wrangler.toml'), 'utf8');
    routeInfo[w] = extractRoutes(raw, a.env);
    for (const r of routeInfo[w].routes) if (r.customDomain) expectHosts.push(r.pattern);
  }

  let zoneId = null;
  if (has('preflight') && online && !a.rollback) {
    const p = await preflight(a, expectHosts);
    zoneId = p.zoneId;
    if (p.fails && !a.dryRun) die(`Preflight có ${p.fails} lỗi. Sửa rồi chạy lại (chưa có thay đổi nào trên Cloudflare).`);
    if (p.fails) warn('Preflight có lỗi (dry-run vẫn tiếp tục phần ngoại tuyến).');
  } else if (has('preflight') && !online) log('Bỏ qua preflight (ngoại tuyến).');
  if (a.preflightOnly) return;

  // ID tài nguyên
  let ids;
  if (a.fakeIds) ids = { ...FAKE_IDS };
  else if (has('resources') && online && !a.rollback) ids = await resources(a);
  else ids = readIds(a.env) ?? {};
  if (!a.fakeIds) {
    const need = Object.values(ID_KEYS).filter((k) => !ids[k]);
    if (need.length && a.dryRun) { warn(`thiếu ID ${need.join(', ')} (chưa tạo tài nguyên): dry-run dùng ID giả.`); ids = { ...FAKE_IDS, ...Object.fromEntries(Object.entries(ids).filter(([, v]) => v)) }; }
    else if (need.length && has('resources') === false) die(`Thiếu ID tài nguyên (${need.join(', ')}) trong infra/cloudflare/ids.${a.env}.json: chạy bước resources.`);
    else if (need.length) die(`Thiếu ID tài nguyên (${need.join(', ')}).`);
  }
  const { cfgs, routes, hasFinance, hasAudit } = prepareConfigs(a, ids);
  log(`Cấu hình dựng xong cho: ${Object.keys(cfgs).join(', ')}`);

  if (a.rollback) { rollback(a, cfgs); return; }
  if (has('build') && a.build && a.only.includes('web')) buildWeb();

  if (a.dryRun) {
    if (has('migrate') && a.migrate && a.only.includes('api')) migrate(a, cfgs['api'], hasFinance, hasAudit);
    if (has('secrets') && a.secrets && online) ensureSecrets(a, cfgs, 'pre', {});
    step('Dry-run: wrangler deploy --dry-run (không gửi gì lên Cloudflare)');
    for (const n of a.only) wr(['deploy', '--dry-run', '--outdir', join(ROOT, '.wrangler/dry', WORKERS[n]), '-c', cfgs[WORKERS[n]], '--env', a.env]);
    if (has('domains') && a.domains) await domains(a, zoneId, routes);
    log('\nDry-run xong. KHÔNG có gì được tạo/sửa/deploy trên Cloudflare.');
    return;
  }

  const secState = {};
  if (has('migrate') && a.migrate && a.only.includes('api')) {
    await gate(a, 'migration D1 (có sao lưu trước)');
    if (a.backup) backupD1(a, cfgs['api']);
    migrate(a, cfgs['api'], hasFinance, hasAudit);
  }
  if (has('secrets') && a.secrets) {
    const miss = ensureSecrets(a, cfgs, 'pre', secState);
    if (miss.length) die(`Worker api đã tồn tại nhưng thiếu bí mật bắt buộc: ${[...new Set(miss)].join(', ')}.\n  Cung cấp bằng --secrets-file hoặc biến AMS_SECRET_<TÊN>; SESSION_SECRET/FIELD_ENC_KEY có thể tự sinh bằng --generate-secrets.`);
  }
  if (has('deploy')) {
    for (const n of a.only) { await gate(a, `deploy ${WORKERS[n]}`); step(`Deploy ${WORKERS[n]} (${a.env})`); wr(['deploy', '-c', cfgs[WORKERS[n]], '--env', a.env]); }
  }
  let exit = 0;
  if (has('secrets') && a.secrets && secState.deferred) {
    const miss = ensureSecrets(a, cfgs, 'post', secState);
    if (miss.length) { exit = 1; warn(`Worker api đang chạy NHƯNG thiếu bí mật bắt buộc: ${[...new Set(miss)].join(', ')}. API sẽ lỗi cho đến khi đặt (xem docs/DEPLOY-CLOUDFLARE.md mục 5).`); }
  }
  if (has('domains') && a.domains) { const bad = await domains(a, zoneId, routes); if (bad) exit = 1; }
  if (has('smoke')) { const bad = await smoke(a, routes); if (bad) exit = 1; }
  log(`\n${exit ? 'Xong nhưng CÓ CẢNH BÁO/LỖI ở trên.' : 'Xong.'} Việc tiếp theo: danh sách kiểm tra sau deploy trong docs/DEPLOY-CLOUDFLARE.md (SePay sandbox, đăng nhập, tạo chiến dịch thử).`);
  rl?.close();
  if (exit) process.exit(exit);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => die(e.message));
