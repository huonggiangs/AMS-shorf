// Tạo Super admin đầu tiên trên D1 (staging/production) bằng đúng hàm bootstrap() của @ams/db.
// Mật khẩu nhập qua biến môi trường BOOTSTRAP_ADMIN_PASSWORD (ps1 hỏi bằng ô ẩn), KHÔNG ghi ra màn hình.
// Cách làm: chạy bootstrap() trên một "db ghi lại" -> sinh tệp SQL INSERT -> wrangler d1 execute --remote --file -> xóa tệp.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootstrap, type SeedRuntime } from '../packages/db/src/index.js';

const envName = process.argv[2] ?? 'staging';
const email = process.env['BOOTSTRAP_ADMIN_EMAIL'] ?? '';
const password = process.env['BOOTSTRAP_ADMIN_PASSWORD'] ?? '';
if (!['staging', 'production'].includes(envName)) { console.error('Dùng: bootstrap-d1.ts <staging|production>'); process.exit(2); }
const cfg = resolve('infra/cloudflare/api/wrangler.generated.toml');
const dbName = `ams-core-${envName}`;

const q = (a: string) => (process.platform === 'win32' && /[\s&|<>^()%!]/.test(a) && !/^".*"$/.test(a)) ? `"${a}"` : a;
function wrangler(args: string[], capture = false) {
  const full = ['--yes', 'wrangler@4.161.0', ...args];
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnSync(cmd, full.map(q), { encoding: 'utf8', shell: process.platform === 'win32', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
}
const lit = (v: unknown): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`;

// 1) D1 đã có tenant chưa? (tránh tạo trùng)
const chk = wrangler(['d1', 'execute', dbName, '--remote', '-c', cfg, '--env', envName, '--json', '--command', 'SELECT COUNT(*) AS n FROM tenants'], true);
const m = /"n":\s*(\d+)/.exec(chk.stdout ?? '');
if (chk.status !== 0 || !m) { console.error('Không đọc được D1 (đã chạy migration chưa?).\n' + (chk.stderr ?? '').slice(-400)); process.exit(1); }
if (Number(m[1]) > 0) { console.log('D1 đã có dữ liệu (tenant). Bỏ qua, không tạo thêm Super admin.'); process.exit(0); }

// 2) Chạy bootstrap() trên db ghi lại
const stmts: string[] = [];
const db = {
  dialect: 'sqlite' as const,
  async query() { return [{ n: 0 }] as never; },
  async run(sql: string, params: unknown[] = []) { let i = 0; stmts.push(sql.replace(/\?/g, () => lit(params[i++])) + ';'); return { changes: 1 }; },
  async tx<T>(fn: (t: typeof db) => Promise<T>) { return fn(db); },
};
// SEPAY_WEBHOOK_SECRET/FIELD_ENC_KEY ở đây chỉ để qua kiểm tra của bootstrap; bí mật thật nằm ở Worker.
const rt: SeedRuntime = {
  db, clock: { now: () => new Date() }, id: () => crypto.randomUUID(),
  config: { env: { AMS_ENV: envName, SEPAY_MODE: envName === 'production' ? 'production' : 'sandbox', FIELD_ENC_KEY: randomBytes(32).toString('base64'), SEPAY_WEBHOOK_SECRET: randomBytes(32).toString('hex'), BOOTSTRAP_ADMIN_EMAIL: email } },
};
const r = await bootstrap(rt, { adminEmail: email, adminPassword: password });
if (r.skipped) { console.log('Bỏ qua (đã có dữ liệu).'); process.exit(0); }

// 3) Nạp lên D1 rồi xóa tệp tạm
const dir = mkdtempSync(join(tmpdir(), 'ams-bootstrap-'));
const file = join(dir, 'bootstrap.sql');
writeFileSync(file, stmts.join('\n') + '\n', { mode: 0o600 });
try {
  const ex = wrangler(['d1', 'execute', dbName, '--remote', '-c', cfg, '--env', envName, '--yes', '--file', file]);
  if (ex.status !== 0) { console.error('Nạp D1 thất bại.'); process.exit(1); }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\nĐã tạo Super admin ${r.adminEmail} trên ${dbName}.\nLần đăng nhập đầu: đổi mật khẩu, rồi quét mã QR để bật 2FA (TOTP).`);
