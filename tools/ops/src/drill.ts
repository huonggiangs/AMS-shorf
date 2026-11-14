#!/usr/bin/env tsx
// Dien tap khoi phuc: sao luu ma hoa -> khoi phuc vao DB TAM -> so dong tung bang + checksum so cai + tong vi + bat bien, do thoi gian.
//   drill.ts postgres --source-url postgres://... [--scratch-db ams_drill] [--no-markers] [--out DIR]
//   drill.ts d1-file  --input export.sql                      (ban export D1 -> ma hoa -> giai ma -> SQLite tam -> so khop; + D1->Postgres neu co --target-url)
//   drill.ts dev [--impressions 50000] [--devices 30]          (TU DUNG Postgres nhung + du lieu SQLite seed; chay ca hai; dung tren may dev)
// Dau ra: bang so do RPO/RTO + JSON. SO DO TREN MAY DEV KHONG DAI DIEN PRODUCTION (xem docs/ops/DISASTER-RECOVERY.md muc 7).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from './backup.js';
import { buildSqliteDataset, dumpAsD1Sql } from './dataset.js';
import { convert } from './d1-to-pg.js';
import { openPg, openSqliteQ } from './db.js';
import { startDevPg } from './dev-pg.js';
import { compareFingerprints, fingerprint, type Fingerprint } from './fingerprint.js';
import { decryptFile, encryptFile, log, parseArgs, pgConn, sha256File, withDb } from './lib.js';
import { restore } from './restore.js';

export interface DrillReport {
  kind: string;
  ok: boolean;
  problems: string[];
  rows: number;
  tables: number;
  ledgerRows: number;
  dumpBytes: number;
  backupMs: number;
  restoreMs: number;
  verifyMs: number;
  rtoMs: number;
  rpoMs: number | null;
  markerBeforeRestored: boolean | null;
  markerAfterAbsent: boolean | null;
  immutableTriggersOk: boolean | null;
  fingerprint: Fingerprint;
}
const sum = (f: Fingerprint) => Object.values(f.tables).reduce((a, b) => a + b, 0);

export async function drillPostgres(o: { sourceUrl: string; scratchDb?: string; markers?: boolean; outDir?: string; encKey: string }): Promise<DrillReport> {
  const problems: string[] = [];
  const out = o.outDir ?? (await mkdtemp(join(tmpdir(), 'ams-drill-')));
  const src = await openPg(o.sourceUrl);
  const scratch = o.scratchDb ?? `${pgConn(o.sourceUrl).database}_drill_${process.pid}`;
  const scratchUrl = withDb(o.sourceUrl, scratch);
  let markersOn = o.markers !== false;
  const iso = () => new Date().toISOString();
  try {
    if (markersOn) {
      await src.client.query("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('drill.marker.before', 'x', NULL, $1) ON CONFLICT (key) DO UPDATE SET updated_at = excluded.updated_at", [iso()]);
    }
    const base = await fingerprint(src.q);
    // 1) sao luu
    const b = await backup({ kind: 'postgres', out, keep: 3, databaseUrl: o.sourceUrl, encKey: o.encKey, report: false });
    const snapshotAt = new Date(b.startedAt).getTime();
    // 2) ghi them SAU sao luu (se la phan "mat" theo RPO), roi gia lap su co
    if (markersOn) await src.client.query("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('drill.marker.after', 'x', NULL, $1)", [iso()]);
    const tFail = Date.now();
    // 3) khoi phuc vao DB tam
    const admin = await openPg(withDb(o.sourceUrl, 'postgres'));
    try {
      await admin.client.query(`DROP DATABASE IF EXISTS "${scratch}"`);
    } finally {
      await admin.close();
    }
    const r = await restore({ file: b.file, kind: 'postgres', encKey: o.encKey, targetUrl: scratchUrl, createDb: true });
    // 4) kiem chung
    const tv = Date.now();
    const dst = await openPg(scratchUrl);
    let markerBefore: boolean | null = null;
    let markerAfterAbsent: boolean | null = null;
    let triggersOk: boolean | null = null;
    let fp: Fingerprint;
    try {
      fp = await fingerprint(dst.q);
      const cmp = compareFingerprints(base, fp);
      problems.push(...cmp.problems);
      if (markersOn) {
        markerBefore = (await dst.q.all("SELECT 1 AS x FROM settings WHERE key = 'drill.marker.before'")).length === 1;
        markerAfterAbsent = (await dst.q.all("SELECT 1 AS x FROM settings WHERE key = 'drill.marker.after'")).length === 0;
        if (!markerBefore) problems.push('moc TRUOC sao luu khong co o ban khoi phuc');
        if (!markerAfterAbsent) problems.push('moc SAU sao luu lai co o ban khoi phuc (khong the)');
      }
      // bat bien: UPDATE tren so cai/audit phai bi tu choi
      triggersOk = true;
      for (const t of ['audit_log', 'wallet_entries']) {
        try {
          await dst.client.query('BEGIN');
          await dst.client.query(`UPDATE ${t} SET id = id`);
          await dst.client.query('ROLLBACK');
          if ((fp.tables[t] ?? 0) > 0) {
            triggersOk = false;
            problems.push(`bang ${t} mat trigger bat bien sau khoi phuc`);
          }
        } catch {
          await dst.client.query('ROLLBACK').catch(() => undefined);
        }
      }
    } finally {
      await dst.close();
    }
    const verifyMs = Date.now() - tv;
    const rtoMs = Date.now() - tFail;
    const a2 = await openPg(withDb(o.sourceUrl, 'postgres'));
    try {
      await a2.client.query(`DROP DATABASE IF EXISTS "${scratch}"`);
    } finally {
      await a2.close();
    }
    if (markersOn) await src.client.query("DELETE FROM settings WHERE key IN ('drill.marker.before','drill.marker.after')");
    return { kind: 'postgres', ok: problems.length === 0, problems, rows: sum(fp), tables: Object.keys(fp.tables).length, ledgerRows: fp.ledgerRows, dumpBytes: b.bytes, backupMs: b.ms, restoreMs: r.ms, verifyMs, rtoMs, rpoMs: tFail - snapshotAt, markerBeforeRestored: markerBefore, markerAfterAbsent, immutableTriggersOk: triggersOk, fingerprint: fp };
  } finally {
    markersOn = false;
    await src.close();
  }
}

/** Ban export D1 (.sql): ma hoa -> giai ma -> nap SQLite tam -> so khop voi nguon; (tuy chon) D1 -> Postgres tam. */
export async function drillD1(o: { sql: string; sourceFp: Fingerprint; encKey: string; targetUrl?: string }): Promise<DrillReport> {
  const problems: string[] = [];
  const dir = await mkdtemp(join(tmpdir(), 'ams-drill-d1-'));
  try {
    const plain = join(dir, 'd1-export.sql');
    await writeFile(plain, o.sql);
    let t = Date.now();
    const enc = `${plain}.enc`;
    await encryptFile(plain, enc, o.encKey);
    const sha = await sha256File(enc);
    const backupMs = Date.now() - t;
    const tFail = Date.now();
    const rf = join(dir, 'restored.sqlite');
    const r = await restore({ file: enc, kind: 'sqlite', encKey: o.encKey, targetFile: rf, verifySha: false });
    t = Date.now();
    const s = await openSqliteQ(rf);
    let fp: Fingerprint;
    try {
      fp = await fingerprint(s.q, ['_migrations', 'd1_migrations']);
    } finally {
      s.close();
    }
    const cmp = compareFingerprints(o.sourceFp, fp, { ignoreTables: ['_migrations', 'd1_migrations'] });
    problems.push(...cmp.problems);
    const verifyMs = Date.now() - t;
    void sha;
    const rtoMs = Date.now() - tFail; // chua tinh buoc chuyen sang Postgres
    let extra = '';
    if (o.targetUrl) {
      const c = await convert({ source: plain, targetUrl: o.targetUrl, createDb: true, log: () => undefined });
      problems.push(...c.problems.map((p) => `D1->PG: ${p}`));
      extra = ` D1->PG ${c.ok ? 'OK' : 'LOI'} ${c.ms} ms`;
    }
    log(`d1-file: ma hoa ${backupMs} ms, khoi phuc ${r.ms} ms, kiem chung ${verifyMs} ms.${extra}`);
    return { kind: 'd1-sql', ok: problems.length === 0, problems, rows: sum(fp), tables: Object.keys(fp.tables).length, ledgerRows: fp.ledgerRows, dumpBytes: Buffer.byteLength(o.sql), backupMs, restoreMs: r.ms, verifyMs, rtoMs, rpoMs: null, markerBeforeRestored: null, markerAfterAbsent: null, immutableTriggersOk: null, fingerprint: fp };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const fmt = (r: DrillReport) =>
  `| ${r.kind} | ${r.ok ? 'DAT' : 'KHONG DAT'} | ${r.tables} bang / ${r.rows} dong (so cai ${r.ledgerRows}) | ${(r.dumpBytes / 1024).toFixed(0)} KB | sao luu ${r.backupMs} ms; khoi phuc ${r.restoreMs} ms; kiem chung ${r.verifyMs} ms | RTO ${r.rtoMs} ms | RPO ${r.rpoMs === null ? 'n/a' : `${r.rpoMs} ms`} |`;

async function main(): Promise<void> {
  const { pos, opt, flag } = parseArgs(process.argv.slice(2), ['no-markers']);
  const kind = pos[0];
  const encKey = process.env['BACKUP_ENC_KEY'] ?? (kind === 'dev' ? 'drill-only-key-not-a-secret-0123456789' : '');
  if (!encKey) throw new Error('thieu BACKUP_ENC_KEY');
  const reports: DrillReport[] = [];
  if (kind === 'postgres') {
    const url = opt['source-url'] ?? process.env['DATABASE_URL'];
    if (!url) throw new Error('thieu --source-url');
    reports.push(await drillPostgres({ sourceUrl: url, encKey, markers: !flag.has('no-markers'), ...(opt['scratch-db'] ? { scratchDb: opt['scratch-db'] } : {}), ...(opt['out'] ? { outDir: opt['out'] } : {}) }));
  } else if (kind === 'd1-file') {
    if (!opt['input']) throw new Error('thieu --input');
    throw new Error('d1-file doc nguon tu --input: dung "dev" cho dien tap day du, hoac d1-to-pg.ts de chuyen/kiem');
  } else if (kind === 'dev') {
    const pg = await startDevPg();
    try {
      log('dung du lieu SQLite (seed + so cai + impression)...');
      const ds = await buildSqliteDataset({ impressions: Number(opt['impressions'] ?? 20_000), devices: Number(opt['devices'] ?? 30) });
      const sql = await dumpAsD1Sql({ query: (s) => ds.db.query(s) });
      const srcFp = await fingerprint({ kind: 'sqlite', all: (s) => ds.db.query(s) }, ['_migrations']);
      log(`nguon: ${Object.keys(srcFp.tables).length} bang, ${sum(srcFp)} dong, so cai ${srcFp.ledgerRows} dong, ban export ${(Buffer.byteLength(sql) / 1048576).toFixed(1)} MB`);
      reports.push(await drillD1({ sql, sourceFp: srcFp, encKey, targetUrl: pg.url('ams_from_d1') }));
      // Postgres nguon cho dien tap pg_dump: chinh DB vua chuyen tu D1
      reports.push(await drillPostgres({ sourceUrl: pg.url('ams_from_d1'), encKey }));
    } finally {
      await pg.stop();
    }
  } else {
    console.log('Dung: drill.ts postgres|dev ... (xem dau tep)');
    process.exit(1);
  }
  console.log('\n| Kich ban | Ket qua | Du lieu | Dump | Thoi gian | RTO do duoc | RPO do duoc |\n|---|---|---|---|---|---|---|');
  for (const r of reports) console.log(fmt(r));
  for (const r of reports) for (const p of r.problems) console.error(`[ops] VAN DE (${r.kind}): ${p}`);
  if (opt['json']) await writeFile(opt['json'], JSON.stringify(reports, null, 2));
  process.exit(reports.every((r) => r.ok) ? 0 : 1);
}
if (process.argv[1]?.endsWith('drill.ts')) main().catch((e) => { console.error(`[ops] LOI: ${(e as Error).message}`); process.exit(1); });
