// Du lieu thu cho dien tap: SQLite (seed repo + so cai vi nhieu dong + impression) va ban "export D1" dang .sql giong `wrangler d1 export`.
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { seed } from '@ams/db';

export interface DatasetOptions {
  devices?: number;
  impressions?: number;
  topupsPerCustomer?: number;
}

/** Tao CSDL SQLite trong bo nho da co du lieu seed + so cai vi nhat quan (khop cong thuc doi soat) + `impressions` dong ev_ad_impression. */
export async function buildSqliteDataset(o: DatasetOptions = {}): Promise<TestRuntime> {
  const rt = await createTestRuntime({ dialect: 'sqlite', env: { SCRYPT_N: '1024' } });
  await seed(rt, { log: false, passwordParams: { N: 1024 }, deviceCount: o.devices ?? 30 });
  const now = rt.clock.now().toISOString();
  const wallets = await rt.db.query<{ customer_id: string }>('SELECT customer_id FROM ad_wallets ORDER BY customer_id');
  let seq = 0;
  const entry = (cid: string, kind: string, amt: number, bal: number, res: number, ref?: string) =>
    rt.db.run('INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [
      `drill-we-${String(++seq).padStart(6, '0')}`, cid, kind, amt, bal, res, ref ? 'topup' : null, ref ?? null, 'drill', new Date(Date.parse(now) + seq * 1000).toISOString(),
    ]);
  for (const w of wallets) {
    let bal = 0;
    const n = o.topupsPerCustomer ?? 5;
    for (let i = 0; i < n; i++) {
      bal += 1_000_000;
      await entry(w.customer_id, 'topup', 1_000_000, bal, 0);
    }
    await entry(w.customer_id, 'reserve', 2_000_000, bal, 2_000_000);
    bal -= 300_000;
    await entry(w.customer_id, 'spend', 300_000, bal, 1_700_000);
  }
  // bo nho dem cua vi dung bang tong so cai (cung cong thuc doi soat) => nhat quan, ke ca voi dong so cai co san tu seed
  await rt.db.run(`UPDATE ad_wallets SET
    balance_vnd = COALESCE((SELECT SUM(CASE WHEN kind IN ('topup','adjust') THEN amount_vnd WHEN kind IN ('spend','refund') THEN -amount_vnd ELSE 0 END) FROM wallet_entries e WHERE e.customer_id = ad_wallets.customer_id),0),
    reserved_vnd = COALESCE((SELECT SUM(CASE WHEN kind = 'reserve' THEN amount_vnd WHEN kind IN ('release','spend') THEN -amount_vnd ELSE 0 END) FROM wallet_entries e WHERE e.customer_id = ad_wallets.customer_id),0),
    spent_vnd = COALESCE((SELECT SUM(CASE WHEN kind = 'spend' THEN amount_vnd ELSE 0 END) FROM wallet_entries e WHERE e.customer_id = ad_wallets.customer_id),0)`);
  const imp = o.impressions ?? 0;
  const camp = (await rt.db.query<{ id: string }>('SELECT id FROM campaigns LIMIT 1'))[0]?.id ?? 'camp-drill';
  for (let i = 0; i < imp; i += 500) {
    const vals: string[] = [];
    const params: unknown[] = [];
    for (let j = i; j < Math.min(imp, i + 500); j++) {
      vals.push('(?,?,?,?,?,?,?)');
      params.push(new Date(Date.parse(now) + j * 1000).toISOString(), `drill-ev-${j}`, `dev-${j % 50}`, camp, 100, 1, 2_500_000_000 + j);
    }
    await rt.db.run(`INSERT INTO ev_ad_impression (ts, event_id, device_id, campaign_id, vcr_pct, valid, revenue_micro_vnd) VALUES ${vals.join(',')}`, params);
  }
  return rt;
}

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** Dang export SQL giong `wrangler d1 export`: PRAGMA, CREATE TABLE, INSERT INTO "t" VALUES(...), roi CREATE INDEX/TRIGGER. */
export async function dumpAsD1Sql(db: { query: (sql: string) => Promise<Record<string, unknown>[]> }): Promise<string> {
  const master = await db.query("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid");
  const out: string[] = ['PRAGMA defer_foreign_keys=TRUE;'];
  const tables = master.filter((m) => m['type'] === 'table');
  for (const t of tables) out.push(`${String(t['sql'])};`);
  for (const t of tables) {
    const name = String(t['name']);
    const rows = await db.query(`SELECT * FROM "${name}"`);
    for (const r of rows) out.push(`INSERT INTO "${name}" VALUES(${Object.values(r).map(lit).join(',')});`);
  }
  for (const m of master.filter((x) => x['type'] !== 'table')) out.push(`${String(m['sql'])};`);
  return out.join('\n') + '\n';
}
