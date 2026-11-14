#!/usr/bin/env tsx
// Chuyen du lieu Cloudflare D1 (SQLite) -> PostgreSQL 16 tren VPS, giu dung kieu, KIEM TRUOC KHI COMMIT.
//   d1-to-pg.ts --input export.sql|--sqlite file.db|--d1-db NAME [--env production --config wrangler.generated.toml]
//               --target-url postgres://ams:...@127.0.0.1:5432/ams [--create-db] [--batch 200] [--dry-run] [--out report.json]
// Quy trinh: (1) nguon -> SQLite tam (neu la .sql) doc o che do so nguyen lon; (2) dung schema PG bang migration cua repo (@ams/db);
// (3) nap theo thu tu khoa ngoai trong MOT giao dich; (4) so dong tung bang + checksum so cai + tong vi + vi lech;
// (5) chi COMMIT khi khop hoan toan, nguoc lai ROLLBACK (DB dich nguyen trang). Dich phai TRONG (bang bat bien khong cho TRUNCATE).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openPg } from './db.js';
import { compareFingerprints, fingerprint, listTables, type Fingerprint, type Q } from './fingerprint.js';
import { log, parseArgs, pgConn, run, withDb } from './lib.js';

const SKIP_TABLES = new Set(['_migrations', 'd1_migrations']);

export interface ConvertOptions {
  /** duong dan .sql (wrangler d1 export) hoac tep .sqlite/.db */
  source: string;
  targetUrl: string;
  createDb?: boolean;
  batch?: number;
  dryRun?: boolean;
  log?: (m: string) => void;
}
export interface ConvertReport {
  ok: boolean;
  committed: boolean;
  tables: { name: string; rows: number; loaded: number }[];
  source: Fingerprint;
  target: Fingerprint | null;
  problems: string[];
  warnings: string[];
  ms: number;
}

type Val = bigint | number | string | Uint8Array | null;

/** Doi gia tri SQLite -> tham so pg theo kieu cot dich. Nem loi (kem bang/cot) neu khong the doi an toan. */
export function convertValue(v: Val, pgType: string, where: string, warnings: string[]): unknown {
  if (v === null || v === undefined) return null;
  const t = pgType.toLowerCase();
  const isInt = t === 'bigint' || t === 'integer' || t === 'smallint';
  if (isInt) {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number' && Number.isInteger(v)) return String(v);
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return v.trim();
    throw new Error(`${where}: gia tri khong phai so nguyen cho cot ${t}: ${JSON.stringify(String(v)).slice(0, 40)}`);
  }
  if (t === 'boolean') {
    if (v === 0n || v === 0 || v === '0' || v === 'false') return false;
    if (v === 1n || v === 1 || v === '1' || v === 'true') return true;
    throw new Error(`${where}: gia tri khong phai boolean`);
  }
  if (t === 'double precision' || t === 'real' || t === 'numeric') {
    const n = typeof v === 'bigint' ? v.toString() : typeof v === 'number' ? v : Number(v);
    if (typeof n === 'number' && !Number.isFinite(n)) throw new Error(`${where}: khong phai so`);
    return n;
  }
  if (t === 'bytea') return typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v as Uint8Array);
  // text/varchar/json/...: BLOB -> utf8; so -> chuoi
  let s = v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : typeof v === 'bigint' ? v.toString() : String(v);
  if (s.includes('\u0000')) {
    warnings.push(`${where}: da bo ky tu NUL (Postgres khong luu duoc)`);
    s = s.replace(/\u0000/g, '');
  }
  return s;
}

function sqliteQ(db: DatabaseSync): Q {
  return { kind: 'sqlite', all: async (sql) => db.prepare(sql).all() as Record<string, unknown>[] };
}

/** Sap bang theo khoa ngoai (cha truoc con). Bang tu tham chieu duoc bo qua; vong that su -> tra ve theo ten + canh bao. */
export function topoOrder(tables: string[], fks: { child: string; parent: string }[]): { order: string[]; cyclic: string[] } {
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const f of fks) if (f.child !== f.parent && deps.has(f.child) && deps.has(f.parent)) deps.get(f.child)!.add(f.parent);
  const order: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => [...deps.get(t)!].every((p) => !left.has(p))).sort();
    if (!ready.length) return { order: [...order, ...[...left].sort()], cyclic: [...left].sort() };
    for (const t of ready) {
      order.push(t);
      left.delete(t);
    }
  }
  return { order, cyclic: [] };
}

export async function convert(o: ConvertOptions): Promise<ConvertReport> {
  const t0 = Date.now();
  const say = o.log ?? log;
  const warnings: string[] = [];
  const problems: string[] = [];
  const { DatabaseSync } = await import('node:sqlite');
  const tmp = await mkdtemp(join(tmpdir(), 'ams-d1pg-'));
  let src: DatabaseSync | null = null;
  const report: ConvertReport = { ok: false, committed: false, tables: [], source: { tables: {}, ledgerSha256: '', ledgerRows: 0, walletSums: { balance: 0, reserved: 0, spent: 0, entriesBalance: 0 }, driftWallets: 0 }, target: null, problems, warnings, ms: 0 };
  let pgc: Awaited<ReturnType<typeof openPg>> | null = null;
  try {
    // (1) nguon
    if (/\.sql$/i.test(o.source)) {
      const f = join(tmp, 'd1.sqlite');
      src = new DatabaseSync(f);
      src.exec('PRAGMA foreign_keys = OFF'); // DB tam: cho phep nap bang theo thu tu bat ky
      src.exec('BEGIN');
      src.exec(await readFile(o.source, 'utf8'));
      src.exec('COMMIT');
      say(`da nap ban export SQL vao SQLite tam`);
    } else src = new DatabaseSync(resolve(o.source), { readOnly: true });
    const sq = sqliteQ(src);
    const srcTables = (await listTables(sq)).filter((t) => !SKIP_TABLES.has(t));
    report.source = await fingerprint({ kind: 'sqlite', all: async (s) => (src!.prepare(s).all() as Record<string, unknown>[]) }, [...SKIP_TABLES]);

    // (2) dich + schema
    if (o.createDb) {
      const c = pgConn(o.targetUrl);
      const admin = await openPg(withDb(o.targetUrl, 'postgres'));
      try {
        if (!(await admin.q.all(`SELECT 1 AS x FROM pg_database WHERE datname = '${c.database.replace(/'/g, "''")}'`)).length) await admin.client.query(`CREATE DATABASE "${c.database.replace(/"/g, '""')}"`);
      } finally {
        await admin.close();
      }
    }
    const { createPgPool, PgDb } = await import('@ams/runtime/pg');
    const { migrate } = await import('@ams/db');
    const pool = await createPgPool(o.targetUrl);
    try {
      const res = await migrate(new PgDb(pool));
      say(`schema Postgres: ap ${res.applied.length} migration moi, ${res.skipped.length} da co`);
      // migration nguon phai nam trong tap migration cua repo (neu khong, ma repo cu hon CSDL)
      if (srcTables.length && (await listTables(sq)).includes('_migrations')) {
        const known = new Set([...res.applied, ...res.skipped]);
        const unknown = (src.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name).filter((n) => !known.has(n));
        if (unknown.length) problems.push(`nguon da ap migration repo khong co: ${unknown.join(', ')}. Cap nhat ma nguon truoc.`);
      }
    } finally {
      await pool.end();
    }
    if (problems.length) return finish(report, t0);

    pgc = await openPg(o.targetUrl);
    const pq = pgc.q;
    const meta = await pq.all("SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position");
    const colType = new Map<string, Map<string, string>>();
    for (const m of meta) {
      const t = String(m['t']);
      if (!colType.has(t)) colType.set(t, new Map());
      colType.get(t)!.set(String(m['c']), String(m['d']));
    }
    const pgTables = new Set(colType.keys());
    const notEmpty: string[] = [];
    for (const t of pgTables) if (!SKIP_TABLES.has(t) && Number((await pq.all(`SELECT COUNT(*) AS n FROM "${t}"`))[0]!['n']) > 0) notEmpty.push(t);
    if (notEmpty.length) {
      problems.push(`DB dich khong trong (${notEmpty.slice(0, 5).join(', ')}...). Dung DB moi (--create-db). Bang bat bien khong cho TRUNCATE.`);
      return finish(report, t0);
    }
    for (const t of srcTables) if (!pgTables.has(t)) problems.push(`bang nguon "${t}" khong co o Postgres (thieu migration?)`);
    if (problems.length) return finish(report, t0);

    const fkRows = await pq.all("SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace");
    const { order, cyclic } = topoOrder(srcTables, fkRows.map((r) => ({ child: String(r['child']).replace(/"/g, ''), parent: String(r['parent']).replace(/"/g, '') })));
    if (cyclic.length) warnings.push(`khoa ngoai vong giua: ${cyclic.join(', ')} (nap theo ten, co the vi pham FK)`);

    // (3) nap trong MOT giao dich
    const batch = Math.max(1, o.batch ?? 200);
    await pgc.client.query('BEGIN');
    try {
      for (const t of order) {
        const pgCols = colType.get(t)!;
        const sCols = (src.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
        const extra = sCols.filter((c) => !pgCols.has(c));
        if (extra.length) throw new Error(`bang ${t}: cot nguon khong co o Postgres: ${extra.join(', ')} (se mat du lieu)`);
        const total = Number((src.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number | bigint }).n);
        let loaded = 0;
        if (total > 0) {
          const colList = sCols.map((c) => `"${c}"`).join(', ');
          const stmt = src.prepare(`SELECT ${colList} FROM "${t}"`);
          stmt.setReadBigInts(true); // so nguyen lon giu nguyen (BIGINT tien)
          let buf: unknown[][] = [];
          const flush = async () => {
            if (!buf.length) return;
            const ph = buf.map((_, i) => `(${sCols.map((__, j) => `$${i * sCols.length + j + 1}`).join(',')})`).join(',');
            await pgc!.client.query(`INSERT INTO "${t}" (${colList}) VALUES ${ph}`, buf.flat());
            loaded += buf.length;
            buf = [];
          };
          let rowNo = 0;
          for (const row of stmt.iterate() as Iterable<Record<string, Val>>) {
            rowNo++;
            buf.push(sCols.map((c) => convertValue(row[c] as Val, pgCols.get(c)!, `${t}[#${rowNo}].${c}`, warnings)));
            if (buf.length >= batch) await flush();
          }
          await flush();
        }
        report.tables.push({ name: t, rows: total, loaded });
        say(`  ${t}: ${loaded}/${total}`);
      }
      // (4) kiem tra trong giao dich
      report.target = await fingerprint(pq, [...SKIP_TABLES]);
      const cmp = compareFingerprints(report.source, report.target, { ignoreTables: [...SKIP_TABLES] });
      problems.push(...cmp.problems);
      if (cmp.ok && !o.dryRun) {
        await pgc.client.query('COMMIT');
        report.committed = true;
      } else {
        await pgc.client.query('ROLLBACK');
        if (o.dryRun && cmp.ok) say('dry-run: khop, da ROLLBACK (khong ghi gi)');
      }
    } catch (e) {
      await pgc.client.query('ROLLBACK').catch(() => undefined);
      problems.push((e as Error).message);
    }
    if (report.committed) await pgc.client.query('ANALYZE').catch(() => undefined);
    report.ok = problems.length === 0;
    return finish(report, t0);
  } finally {
    src?.close();
    await pgc?.close().catch(() => undefined);
    await rm(tmp, { recursive: true, force: true });
  }
}
function finish(r: ConvertReport, t0: number): ConvertReport {
  r.ms = Date.now() - t0;
  return r;
}

async function main(): Promise<void> {
  const { opt, flag } = parseArgs(process.argv.slice(2), ['create-db', 'dry-run']);
  let source = opt['input'] ?? opt['sqlite'];
  if (!source && opt['d1-db']) {
    const tmp = await mkdtemp(join(tmpdir(), 'ams-d1exp-'));
    source = join(tmp, 'd1-export.sql');
    const args = ['wrangler', 'd1', 'export', opt['d1-db'], '--remote', '--output', source, ...(opt['env'] ? ['--env', opt['env']] : []), ...(opt['config'] ? ['-c', opt['config']] : [])];
    log('xuat D1 (wrangler d1 export --remote)...');
    const r = await run('npx', args);
    if (r.code !== 0) throw new Error(`wrangler d1 export that bai: ${r.stderr.slice(0, 200)}`);
  }
  const target = opt['target-url'] ?? process.env['DATABASE_URL'];
  if (!source || !target) {
    console.log('Dung: d1-to-pg.ts --input FILE.sql | --sqlite FILE.db | --d1-db NAME  --target-url postgres://...  (xem dau tep)');
    process.exit(1);
  }
  const rep = await convert({ source, targetUrl: target, createDb: flag.has('create-db'), dryRun: flag.has('dry-run'), ...(opt['batch'] ? { batch: Number(opt['batch']) } : {}) });
  if (opt['out']) await writeFile(opt['out'], JSON.stringify(rep, null, 2));
  log(`${rep.ok ? 'THANH CONG' : 'THAT BAI'}: ${rep.tables.length} bang, ${rep.tables.reduce((a, t) => a + t.loaded, 0)} dong, so cai ${rep.source.ledgerRows} dong, ${rep.ms} ms, ${rep.committed ? 'DA COMMIT' : 'KHONG commit'}`);
  for (const w of rep.warnings) log(`canh bao: ${w}`);
  for (const p of rep.problems) console.error(`[ops] VAN DE: ${p}`);
  process.exit(rep.ok ? 0 : 1);
}
if (process.argv[1]?.endsWith('d1-to-pg.ts')) main().catch((e) => { console.error(`[ops] LOI: ${(e as Error).message}`); process.exit(1); });
