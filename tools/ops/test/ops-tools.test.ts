import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { backup } from '../src/backup.js';
import { buildSqliteDataset, dumpAsD1Sql } from '../src/dataset.js';
import { convert, convertValue, topoOrder } from '../src/d1-to-pg.js';
import { openPg } from '../src/db.js';
import { startDevPg, type DevPg } from '../src/dev-pg.js';
import { drillPostgres } from '../src/drill.js';
import { fingerprint } from '../src/fingerprint.js';
import { decryptFile, encryptFile, applyRetention } from '../src/lib.js';
import { restore } from '../src/restore.js';

const KEY = 'test-only-key-0123456789abcdef';
let pg: DevPg;
let dir: string;
let sql: string;

beforeAll(async () => {
  pg = await startDevPg();
  dir = await mkdtemp(join(tmpdir(), 'ams-ops-test-'));
  const ds = await buildSqliteDataset({ devices: 5, impressions: 300 });
  // gia tri BIGINT vuot 2^53 phai giu nguyen khi chuyen sang Postgres
  sql = await dumpAsD1Sql({ query: (s) => ds.db.query(s) });
  sql += "UPDATE ev_ad_impression SET revenue_micro_vnd = 9007199254740993 WHERE event_id = 'drill-ev-1';\n";
}, 120_000);
afterAll(async () => {
  await pg?.stop();
  await rm(dir, { recursive: true, force: true });
});

describe('ma hoa tep sao luu', () => {
  it('round-trip, sai khoa that bai, tuong thich openssl', async () => {
    const p = join(dir, 'a.bin');
    await writeFile(p, Buffer.from('du lieu thu '.repeat(1000)));
    await encryptFile(p, `${p}.enc`, KEY);
    expect((await readFile(`${p}.enc`)).subarray(0, 8).toString()).toBe('Salted__');
    await decryptFile(`${p}.enc`, `${p}.dec`, KEY);
    expect((await readFile(`${p}.dec`)).equals(await readFile(p))).toBe(true);
    await expect(decryptFile(`${p}.enc`, `${p}.bad`, 'sai-khoa-sai-khoa-sai-khoa')).rejects.toThrow(/giai ma that bai/);
    const o = spawnSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-md', 'sha256', '-iter', '200000', '-pass', `pass:${KEY}`, '-in', `${p}.enc`, '-out', `${p}.ossl`]);
    if (o.error) return; // may khong co openssl: bo qua
    expect(o.status).toBe(0);
    expect((await readFile(`${p}.ossl`)).equals(await readFile(p))).toBe(true);
  });
  it('giu N ban moi nhat', async () => {
    const d = await mkdtemp(join(dir, 'ret-'));
    for (const n of ['a-1', 'a-2', 'a-3', 'a-4']) {
      await writeFile(join(d, `${n}.dump.enc`), 'x');
      await writeFile(join(d, `${n}.dump.enc.sha256`), 'x');
    }
    const removed = await applyRetention(d, 'a', 2);
    expect(removed).toEqual(['a-1.dump.enc', 'a-2.dump.enc']);
    expect((await readdir(d)).sort()).toEqual(['a-3.dump.enc', 'a-3.dump.enc.sha256', 'a-4.dump.enc', 'a-4.dump.enc.sha256']);
  });
});

describe('D1 -> Postgres', () => {
  it('chuyen dung, giu BIGINT lon, so cai khop, commit', async () => {
    const f = join(dir, 'd1.sql');
    await writeFile(f, sql);
    const rep = await convert({ source: f, targetUrl: pg.url('ams_conv'), createDb: true, log: () => undefined });
    expect(rep.problems).toEqual([]);
    expect(rep.ok && rep.committed).toBe(true);
    expect(rep.source.ledgerRows).toBeGreaterThan(40);
    const c = await openPg(pg.url('ams_conv'));
    try {
      const r = await c.client.query("SELECT revenue_micro_vnd::text AS v FROM ev_ad_impression WHERE event_id = 'drill-ev-1'");
      expect(r.rows[0].v).toBe('9007199254740993');
      expect((await fingerprint(c.q)).driftWallets).toBe(0);
    } finally {
      await c.close();
    }
  }, 60_000);

  it('du lieu hong (chu trong cot so) -> ROLLBACK, DB dich van trong', async () => {
    const f = join(dir, 'bad.sql');
    await writeFile(f, `${sql}UPDATE ad_wallets SET balance_vnd = 'abc';\n`);
    const rep = await convert({ source: f, targetUrl: pg.url('ams_bad'), createDb: true, log: () => undefined });
    expect(rep.ok).toBe(false);
    expect(rep.committed).toBe(false);
    expect(rep.problems.join(' ')).toMatch(/ad_wallets.*so nguyen/);
    const c = await openPg(pg.url('ams_bad'));
    try {
      expect(Number((await c.q.all('SELECT COUNT(*) AS n FROM ad_wallets'))[0]!['n'])).toBe(0);
      expect(Number((await c.q.all('SELECT COUNT(*) AS n FROM wallet_entries'))[0]!['n'])).toBe(0);
    } finally {
      await c.close();
    }
  }, 60_000);

  it('vi lech so cai o nguon -> khong commit (khong chuyen du lieu hong sang)', async () => {
    const f = join(dir, 'drift.sql');
    await writeFile(f, `${sql}UPDATE ad_wallets SET balance_vnd = balance_vnd + 7 WHERE rowid = 1;\n`);
    const rep = await convert({ source: f, targetUrl: pg.url('ams_drift'), createDb: true, log: () => undefined });
    expect(rep.committed).toBe(false);
    expect(rep.problems.join(' ')).toMatch(/vi lech/);
  }, 60_000);

  it('tu choi DB dich khong trong', async () => {
    const f = join(dir, 'd1.sql');
    const rep = await convert({ source: f, targetUrl: pg.url('ams_conv'), log: () => undefined });
    expect(rep.ok).toBe(false);
    expect(rep.problems.join(' ')).toMatch(/khong trong/);
  }, 60_000);

  it('convertValue + topoOrder', () => {
    const w: string[] = [];
    expect(convertValue(9007199254740993n, 'bigint', 'x', w)).toBe('9007199254740993');
    expect(convertValue(1n, 'boolean', 'x', w)).toBe(true);
    expect(() => convertValue('abc', 'integer', 'x', w)).toThrow();
    expect(convertValue('a\u0000b', 'text', 'x', w)).toBe('ab');
    expect(w).toHaveLength(1);
    expect(topoOrder(['c', 'p', 'g'], [{ child: 'c', parent: 'p' }, { child: 'p', parent: 'g' }, { child: 'g', parent: 'g' }]).order).toEqual(['g', 'p', 'c']);
  });
});

describe('sao luu / khoi phuc / dien tap Postgres', () => {
  it('dien tap: khoi phuc vao DB tam, so khop, moc truoc co/moc sau vang, trigger bat bien con', async () => {
    const rep = await drillPostgres({ sourceUrl: pg.url('ams_conv'), encKey: KEY, outDir: join(dir, 'drill') });
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
    expect(rep.markerBeforeRestored).toBe(true);
    expect(rep.markerAfterAbsent).toBe(true);
    expect(rep.immutableTriggersOk).toBe(true);
    expect(rep.restoreMs).toBeGreaterThan(0);
  }, 120_000);

  it('tep bi sua -> SHA-256 chan; khong de ban ro tren dia; sai khoa that bai', async () => {
    const out = join(dir, 'bk');
    const b = await backup({ kind: 'postgres', out, keep: 2, databaseUrl: pg.url('ams_conv'), encKey: KEY, report: false });
    expect((await readdir(out)).filter((f) => !f.endsWith('.enc') && !f.endsWith('.sha256'))).toEqual([]);
    const buf = await readFile(b.file);
    buf[buf.length - 20] = buf[buf.length - 20]! ^ 0xff;
    await writeFile(b.file, buf);
    await expect(restore({ file: b.file, kind: 'postgres', encKey: KEY, targetUrl: pg.url('ams_x1'), createDb: true })).rejects.toThrow(/SHA-256/);
    const b2 = await backup({ kind: 'postgres', out: join(dir, 'bk2'), keep: 2, databaseUrl: pg.url('ams_conv'), encKey: KEY, report: false });
    await expect(restore({ file: b2.file, kind: 'postgres', encKey: 'khac-khoa-khac-khoa-khac', targetUrl: pg.url('ams_x2'), createDb: true })).rejects.toThrow(/giai ma that bai|pg_restore/);
  }, 120_000);
});
