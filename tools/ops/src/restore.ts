#!/usr/bin/env tsx
// Khoi phuc tu ban sao luu (kiem sha256, giai ma, nap, in dau van tay de doi chieu).
//   restore.ts FILE.enc --kind postgres --target-url postgres://... [--create-db] [--clean] [--yes]
//   restore.ts FILE.enc --kind sqlite --target-file ./restored.sqlite      (ban d1 .sql -> SQLite cuc bo de doc/doi chieu)
//   restore.ts FILE.enc --kind d1 --d1-db ams-core-production-restore [--env production] [--config ...]   (nap vao D1 MOI; xem DR 2.2)
// --clean (ghi de DB co san: pg_restore --clean --if-exists) bat buoc --yes. Mac dinh KHONG ghi de.
import { rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { openPg, openSqliteQ } from './db.js';
import { fingerprint } from './fingerprint.js';
import { decryptFile, log, parseArgs, pgConn, readSha, run, sha256File, withDb } from './lib.js';

export interface RestoreOptions {
  file: string;
  kind: 'postgres' | 'sqlite' | 'd1';
  encKey?: string;
  targetUrl?: string;
  targetFile?: string;
  createDb?: boolean;
  clean?: boolean;
  d1?: { db: string; env?: string; config?: string };
  verifySha?: boolean;
}

export async function restore(o: RestoreOptions): Promise<{ ms: number; steps: Record<string, number> }> {
  const t0 = Date.now();
  const steps: Record<string, number> = {};
  const mark = (k: string, t: number) => (steps[k] = Date.now() - t);
  const expect = o.verifySha === false ? null : await readSha(o.file);
  let t = Date.now();
  if (expect) {
    const got = await sha256File(o.file);
    if (got !== expect) throw new Error('SHA-256 tep sao luu KHONG khop (tep hong hoac bi sua). Dung lai.');
  }
  mark('sha256', t);
  const dir = await mkdtemp(join(tmpdir(), 'ams-restore-'));
  try {
    let plain = o.file;
    t = Date.now();
    if (o.file.endsWith('.enc')) {
      if (!o.encKey) throw new Error('thieu BACKUP_ENC_KEY de giai ma');
      plain = join(dir, basename(o.file).replace(/\.enc$/, ''));
      await decryptFile(o.file, plain, o.encKey);
    }
    mark('decrypt', t);
    t = Date.now();
    if (o.kind === 'postgres') {
      if (!o.targetUrl) throw new Error('thieu --target-url');
      const c = pgConn(o.targetUrl);
      if (o.createDb) {
        const admin = await openPg(withDb(o.targetUrl, 'postgres'));
        try {
          const ex = await admin.q.all(`SELECT 1 AS x FROM pg_database WHERE datname = '${c.database.replace(/'/g, "''")}'`);
          if (!ex.length) await admin.client.query(`CREATE DATABASE "${c.database.replace(/"/g, '""')}"`);
        } finally {
          await admin.close();
        }
      }
      const args = ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', c.database, ...(o.clean ? ['--clean', '--if-exists'] : []), plain];
      const r = await run('pg_restore', args, { env: c.env });
      if (r.code !== 0) throw new Error(`pg_restore that bai: ${r.stderr.slice(0, 300)}`);
    } else if (o.kind === 'sqlite') {
      if (!o.targetFile) throw new Error('thieu --target-file');
      await rm(o.targetFile, { force: true });
      const { readFile } = await import('node:fs/promises');
      const s = await openSqliteQ(o.targetFile);
      try {
        s.db.exec('PRAGMA foreign_keys = OFF');
        s.db.exec('BEGIN');
        s.db.exec(await readFile(plain, 'utf8'));
        s.db.exec('COMMIT');
      } finally {
        s.close();
      }
    } else {
      if (!o.d1) throw new Error('thieu --d1-db');
      const args = ['wrangler', 'd1', 'execute', o.d1.db, '--remote', '--yes', '--file', plain, ...(o.d1.env ? ['--env', o.d1.env] : []), ...(o.d1.config ? ['-c', o.d1.config] : [])];
      const r = await run('npx', args);
      if (r.code !== 0) throw new Error(`wrangler d1 execute that bai: ${r.stderr.slice(0, 300) || r.stdout.slice(0, 300)}`);
    }
    mark('load', t);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { ms: Date.now() - t0, steps };
}

async function main(): Promise<void> {
  const { pos, opt, flag } = parseArgs(process.argv.slice(2), ['create-db', 'clean', 'yes', 'no-verify-sha']);
  const file = pos[0];
  const kind = (opt['kind'] ?? 'postgres') as RestoreOptions['kind'];
  if (!file || !['postgres', 'sqlite', 'd1'].includes(kind)) {
    console.log('Dung: restore.ts FILE --kind postgres|sqlite|d1 ... (xem dau tep)');
    process.exit(1);
  }
  if (flag.has('clean') && !flag.has('yes')) throw new Error('--clean GHI DE du lieu hien co: them --yes de xac nhan (dung API/gateway truoc, xem DR muc 3)');
  const o: RestoreOptions = { file, kind, verifySha: !flag.has('no-verify-sha'), createDb: flag.has('create-db'), clean: flag.has('clean') };
  if (process.env['BACKUP_ENC_KEY']) o.encKey = process.env['BACKUP_ENC_KEY'];
  if (opt['target-url']) o.targetUrl = opt['target-url'];
  if (opt['target-file']) o.targetFile = opt['target-file'];
  if (opt['d1-db']) o.d1 = { db: opt['d1-db'], ...(opt['env'] ? { env: opt['env'] } : {}), ...(opt['config'] ? { config: opt['config'] } : {}) };
  const r = await restore(o);
  log(`khoi phuc xong trong ${r.ms} ms (${Object.entries(r.steps).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  if (kind === 'postgres' && o.targetUrl) {
    const c = await openPg(o.targetUrl);
    try {
      const fp = await fingerprint(c.q);
      log(`dau van tay: ${Object.keys(fp.tables).length} bang, so cai ${fp.ledgerRows} dong sha256=${fp.ledgerSha256.slice(0, 16)}..., vi lech: ${fp.driftWallets}`);
    } finally {
      await c.close();
    }
  }
}
if (process.argv[1]?.endsWith('restore.ts')) main().catch((e) => { console.error(`[ops] KHOI PHUC THAT BAI: ${(e as Error).message}`); process.exit(1); });
