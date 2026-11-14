// Ham dung chung cho sao luu/khoi phuc/dien tap/chuyen D1->Postgres. Khong in bi mat. Viet cho Node 22 (Linux va Windows).
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, readFile, rename, rm, stat, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

export const ENC_MAGIC = Buffer.from('Salted__'); // tuong thich `openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter N`
export const iterOf = (env = process.env): number => {
  const n = Number(env['BACKUP_PBKDF2_ITER'] ?? 200_000);
  return Number.isInteger(n) && n >= 10_000 ? n : 200_000;
};

function keyIv(pass: string, salt: Buffer, iter: number): { key: Buffer; iv: Buffer } {
  const d = pbkdf2Sync(pass, salt, iter, 48, 'sha256');
  return { key: d.subarray(0, 32), iv: d.subarray(32, 48) };
}

/**
 * Ma hoa AES-256-CBC + PBKDF2-SHA256, dinh dang "Salted__"+salt(8)+du lieu = giai ma duoc bang openssl:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter 200000 -pass env:BACKUP_ENC_KEY -in X.enc -out X
 * CBC khong tu xac thuc: toan ven kiem bang .sha256 cua tep ma hoa + pg_restore --list.
 */
export async function encryptFile(inPath: string, outPath: string, pass: string, iter = iterOf()): Promise<void> {
  if (!pass || pass.length < 16) throw new Error('BACKUP_ENC_KEY phai co it nhat 16 ky tu');
  const salt = randomBytes(8);
  const { key, iv } = keyIv(pass, salt, iter);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const out = createWriteStream(outPath, { mode: 0o600 });
  out.write(Buffer.concat([ENC_MAGIC, salt]));
  await pipeline(createReadStream(inPath), cipher, out);
}

export async function decryptFile(inPath: string, outPath: string, pass: string, iter = iterOf()): Promise<void> {
  const fh = await (await import('node:fs/promises')).open(inPath, 'r');
  const head = Buffer.alloc(16);
  await fh.read(head, 0, 16, 0);
  await fh.close();
  if (!head.subarray(0, 8).equals(ENC_MAGIC)) throw new Error('tep khong phai dinh dang ma hoa (thieu "Salted__")');
  const { key, iv } = keyIv(pass, head.subarray(8, 16), iter);
  const dec = createDecipheriv('aes-256-cbc', key, iv);
  try {
    await pipeline(createReadStream(inPath, { start: 16 }), dec, createWriteStream(outPath, { mode: 0o600 }));
  } catch (e) {
    await rm(outPath, { force: true });
    throw new Error(`giai ma that bai (sai BACKUP_ENC_KEY/BACKUP_PBKDF2_ITER hoac tep hong): ${(e as Error).message.slice(0, 80)}`);
  }
}

export async function sha256File(p: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(p), h);
  return h.digest('hex');
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Chay lenh (khong qua shell). `env` duoc gop vao moi truong hien tai. */
export function run(cmd: string, args: string[], opts: { env?: Record<string, string>; input?: string; cwd?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32' && /^(wrangler|npx|pnpm|rclone)$/.test(cmd);
    const p = spawn(win ? `${cmd}.cmd` : cmd, args, { env: { ...process.env, ...(opts.env ?? {}) }, cwd: opts.cwd, shell: win, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => reject(new Error(`khong chay duoc "${cmd}": ${e.message}`)));
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (opts.input !== undefined) p.stdin.end(opts.input);
    else p.stdin.end();
  });
}

export interface PgConn {
  env: Record<string, string>;
  database: string;
  host: string;
}
/** postgres://user:pass@host:port/db -> bien PG* (mat khau khong di vao dong lenh). */
export function pgConn(url: string): PgConn {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('DATABASE_URL phai bat dau bang postgres://');
  const env: Record<string, string> = { PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username) };
  if (u.password) env['PGPASSWORD'] = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) env['PGSSLMODE'] = sslmode;
  return { env, database: decodeURIComponent(u.pathname.replace(/^\//, '')), host: u.hostname };
}
export const withDb = (url: string, db: string): string => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

export const utcStamp = (d = new Date()): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Giu `keep` ban moi nhat cua tien to `<prefix>-`, xoa ban cu hon va tep .sha256 di kem. Tra ve ten da xoa. */
export async function applyRetention(dir: string, prefix: string, keep: number): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.startsWith(`${prefix}-`) && /\.enc$/.test(f)).sort();
  const old = files.slice(0, Math.max(0, files.length - keep));
  for (const f of old) {
    await rm(join(dir, f), { force: true });
    await rm(join(dir, `${f}.sha256`), { force: true });
  }
  return old;
}

export async function writeSha(file: string, sha: string): Promise<void> {
  await writeFile(`${file}.sha256`, `${sha}  ${basename(file)}\n`, { mode: 0o600 });
}
export async function readSha(file: string): Promise<string | null> {
  try {
    return (await readFile(`${file}.sha256`, 'utf8')).trim().split(/\s+/)[0] ?? null;
  } catch {
    return null;
  }
}

/** Sao chep sang noi khac: thu muc (o dia ngoai/chia se mang) hoac rclone `remote:path`. Tra ve mo ta (khong chua bi mat). */
export async function copyOffsite(files: string[], dest: string, kind: 'dir' | 'rclone'): Promise<string> {
  if (kind === 'rclone') {
    for (const f of files) {
      const r = await run('rclone', ['copyto', f, `${dest.replace(/\/$/, '')}/${basename(f)}`]);
      if (r.code !== 0) throw new Error(`rclone that bai: ${r.stderr.slice(0, 160)}`);
    }
    return `rclone:${dest.split(':')[0]}`;
  }
  await mkdir(dest, { recursive: true });
  for (const f of files) await copyFile(f, join(dest, basename(f)));
  return `dir:${basename(dest)}`;
}

/** Bao cao ket qua cho API (POST /ops/backup-report) de tran Canh bao biet sao luu con tuoi. Khong nem loi. */
export async function reportBackup(body: Record<string, unknown>, env = process.env): Promise<'sent' | 'skipped' | string> {
  const url = env['OPS_REPORT_URL'];
  const token = env['OPS_REPORT_TOKEN'];
  if (!url || !token) return 'skipped';
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    return res.ok ? 'sent' : `HTTP ${res.status}`;
  } catch (e) {
    return (e as Error).name;
  }
}

export async function moveFile(a: string, b: string): Promise<void> {
  await mkdir(dirname(b), { recursive: true });
  await rename(a, b);
}
export const fileSize = async (p: string): Promise<number> => (await stat(p)).size;

/** Doc doi so dang `--key value` / `--flag`; phan con lai la positional. */
export function parseArgs(argv: string[], flags: string[] = []): { pos: string[]; opt: Record<string, string>; flag: Set<string> } {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  const flag = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (flags.includes(k)) flag.add(k);
      else {
        const v = argv[++i];
        if (v === undefined) throw new Error(`thieu gia tri cho --${k}`);
        opt[k] = v;
      }
    } else pos.push(a);
  }
  return { pos, opt, flag };
}
export const log = (m: string): void => console.log(`[ops] ${m}`);
