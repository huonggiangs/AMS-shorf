#!/usr/bin/env tsx
// Sao luu co ma hoa + giu N ban + sao chep ra ngoai + bao cao cho API.
//   backup.ts postgres [--database-url URL] [--out DIR] [--keep 14] [--copy-to DIR | --rclone remote:path] [--docker-container NAME --pg-user U --pg-db DB] [--no-report] [--no-encrypt]
//   backup.ts d1 --d1-db ams-core-production [--env production] [--config wrangler.generated.toml] [--out DIR] [--keep 14] [--copy-to DIR]
// Bi mat: BACKUP_ENC_KEY (>= 16 ky tu; luu RIENG voi sao luu), DATABASE_URL, OPS_REPORT_URL + OPS_REPORT_TOKEN (tuy chon). Xem docs/ops/DISASTER-RECOVERY.md.
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runToFile } from './db.js';
import { applyRetention, copyOffsite, encryptFile, fileSize, log, parseArgs, pgConn, reportBackup, run, sha256File, utcStamp, writeSha } from './lib.js';

export interface BackupResult {
  file: string;
  bytes: number;
  sha256: string;
  encrypted: boolean;
  removed: string[];
  offsite: string | null;
  report: string;
  startedAt: string;
  finishedAt: string;
  ms: number;
}

export interface BackupOptions {
  kind: 'postgres' | 'd1';
  out: string;
  keep: number;
  databaseUrl?: string;
  docker?: { container: string; user: string; db: string };
  d1?: { db: string; env?: string; config?: string };
  copyTo?: string;
  rclone?: string;
  encKey?: string; // undefined = khong ma hoa (chi khi --no-encrypt)
  label?: string; // ten envi (staging/production) cho bao cao
  report?: boolean;
}

export async function backup(o: BackupOptions): Promise<BackupResult> {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const out = resolve(o.out);
  await mkdir(out, { recursive: true, mode: 0o700 });
  const stamp = utcStamp();
  let prefix: string;
  let plain: string;
  if (o.kind === 'postgres') {
    let dbName: string;
    if (o.docker) {
      dbName = o.docker.db;
      prefix = `postgres-${dbName}`;
      plain = join(out, `${prefix}-${stamp}.dump`);
      const r = await runToFile('docker', ['exec', '-i', o.docker.container, 'pg_dump', '-Fc', '--no-owner', '--no-privileges', '-U', o.docker.user, o.docker.db], plain);
      if (r.code !== 0) throw new Error(`pg_dump (docker) that bai: ${r.stderr.slice(0, 200)}`);
    } else {
      const url = o.databaseUrl ?? process.env['DATABASE_URL'];
      if (!url) throw new Error('thieu DATABASE_URL (hoac --database-url)');
      const c = pgConn(url);
      dbName = c.database;
      prefix = `postgres-${dbName}`;
      plain = join(out, `${prefix}-${stamp}.dump`);
      const r = await run('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '--file', plain, '--dbname', dbName], { env: c.env });
      if (r.code !== 0) {
        await rm(plain, { force: true });
        throw new Error(`pg_dump that bai: ${r.stderr.slice(0, 200)}`);
      }
    }
  } else {
    if (!o.d1) throw new Error('thieu --d1-db');
    prefix = `d1-${o.d1.db}`;
    plain = join(out, `${prefix}-${stamp}.sql`);
    const args = ['d1', 'export', o.d1.db, '--remote', '--output', plain];
    if (o.d1.env) args.push('--env', o.d1.env);
    if (o.d1.config) args.push('-c', o.d1.config);
    const r = await run('npx', ['wrangler', ...args]);
    if (r.code !== 0) throw new Error(`wrangler d1 export that bai: ${r.stderr.slice(0, 200) || r.stdout.slice(0, 200)}`);
  }
  let file = plain;
  let encrypted = false;
  if (o.encKey) {
    file = `${plain}.enc`;
    await encryptFile(plain, file, o.encKey);
    await rm(plain, { force: true }); // KHONG de ban ro tren dia
    encrypted = true;
  } else log('CANH BAO: sao luu KHONG ma hoa (--no-encrypt). Khong dung cho production.');
  const sha256 = await sha256File(file);
  await writeSha(file, sha256);
  const bytes = await fileSize(file);
  const removed = await applyRetention(out, prefix, o.keep);
  let offsite: string | null = null;
  if (o.copyTo) offsite = await copyOffsite([file, `${file}.sha256`], o.copyTo, 'dir');
  else if (o.rclone) offsite = await copyOffsite([file, `${file}.sha256`], o.rclone, 'rclone');
  const finishedAt = new Date().toISOString();
  const report = o.report === false ? 'skipped' : await reportBackup({ kind: o.kind, env: o.label, target: offsite ?? 'local', bytes, sha256, encrypted, ok: true, started_at: startedAt, finished_at: finishedAt });
  return { file, bytes, sha256, encrypted, removed, offsite, report, startedAt, finishedAt, ms: Date.now() - t0 };
}

async function main(): Promise<void> {
  const { pos, opt, flag } = parseArgs(process.argv.slice(2), ['no-report', 'no-encrypt', 'help']);
  const kind = pos[0];
  if (flag.has('help') || (kind !== 'postgres' && kind !== 'd1')) {
    console.log('Dung: backup.ts postgres|d1 [tuy chon]. Xem dau tep nay.');
    process.exit(kind ? 1 : 0);
  }
  const keep = Number(opt['keep'] ?? process.env['BACKUP_KEEP'] ?? 14);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep phai la so nguyen >= 1');
  const encKey = flag.has('no-encrypt') ? undefined : process.env['BACKUP_ENC_KEY'];
  if (!flag.has('no-encrypt') && !encKey) throw new Error('thieu BACKUP_ENC_KEY (hoac dung --no-encrypt cho moi truong thu)');
  const base: BackupOptions = { kind, out: opt['out'] ?? process.env['BACKUP_DIR'] ?? 'backups', keep, ...(encKey ? { encKey } : {}), report: !flag.has('no-report') };
  if (opt['database-url']) base.databaseUrl = opt['database-url'];
  if (opt['copy-to'] ?? process.env['BACKUP_COPY_TO']) base.copyTo = (opt['copy-to'] ?? process.env['BACKUP_COPY_TO'])!;
  if (opt['rclone'] ?? process.env['BACKUP_RCLONE']) base.rclone = (opt['rclone'] ?? process.env['BACKUP_RCLONE'])!;
  if (opt['label']) base.label = opt['label'];
  if (opt['docker-container']) base.docker = { container: opt['docker-container'], user: opt['pg-user'] ?? 'ams', db: opt['pg-db'] ?? 'ams' };
  if (kind === 'd1') base.d1 = { db: opt['d1-db'] ?? '', ...(opt['env'] ? { env: opt['env'] } : {}), ...(opt['config'] ? { config: opt['config'] } : {}) };
  try {
    const r = await backup(base);
    log(`xong ${kind}: ${r.file} (${r.bytes} byte, ${r.encrypted ? 'da ma hoa' : 'KHONG ma hoa'}, sha256 ${r.sha256.slice(0, 12)}..., ${r.ms} ms); da xoa ${r.removed.length} ban cu; ngoai-may: ${r.offsite ?? 'khong'}; bao cao API: ${r.report}`);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[ops] SAO LUU THAT BAI: ${msg}`);
    await reportBackup({ kind, env: opt['label'], ok: false, note: msg.slice(0, 250), finished_at: new Date().toISOString() });
    process.exit(1);
  }
}
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('backup.ts')) void main();
