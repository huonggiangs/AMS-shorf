// "Dau van tay" CSDL de so sanh nguon va ban khoi phuc: so dong tung bang + checksum so cai vi + tong vi + so vi lech.
// Chay duoc tren Postgres (pg Client) va SQLite (node:sqlite) qua giao dien Q toi thieu.
import { createHash } from 'node:crypto';

export interface Q {
  kind: 'postgres' | 'sqlite';
  all(sql: string): Promise<Record<string, unknown>[]>;
}

export interface Fingerprint {
  tables: Record<string, number>;
  ledgerSha256: string;
  ledgerRows: number;
  walletSums: { balance: number; reserved: number; spent: number; entriesBalance: number };
  driftWallets: number;
}

const n = (v: unknown): number => Number(v ?? 0);

export async function listTables(q: Q): Promise<string[]> {
  const rows =
    q.kind === 'postgres'
      ? await q.all("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")
      : await q.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> 'd1_migrations' ORDER BY 1");
  return rows.map((r) => String(r['name']));
}

export async function fingerprint(q: Q, exclude: string[] = []): Promise<Fingerprint> {
  const tables: Record<string, number> = {};
  for (const t of await listTables(q)) {
    if (exclude.includes(t)) continue;
    tables[t] = n((await q.all(`SELECT COUNT(*) AS n FROM "${t}"`))[0]?.['n']);
  }
  const has = 'wallet_entries' in tables && 'ad_wallets' in tables;
  const h = createHash('sha256');
  let ledgerRows = 0;
  let walletSums = { balance: 0, reserved: 0, spent: 0, entriesBalance: 0 };
  let driftWallets = 0;
  if (has) {
    const rows = await q.all('SELECT id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, created_at FROM wallet_entries ORDER BY created_at, id');
    for (const r of rows) h.update(`${r['id']}|${r['customer_id']}|${r['kind']}|${n(r['amount_vnd'])}|${n(r['balance_after'])}|${n(r['reserved_after'])}|${r['ref_type'] ?? ''}|${r['ref_id'] ?? ''}|${r['created_at']}\n`);
    ledgerRows = rows.length;
    const s = (await q.all('SELECT COALESCE(SUM(balance_vnd),0) AS b, COALESCE(SUM(reserved_vnd),0) AS r, COALESCE(SUM(spent_vnd),0) AS s FROM ad_wallets'))[0]!;
    const e = (await q.all("SELECT COALESCE(SUM(CASE WHEN kind IN ('topup','adjust') THEN amount_vnd WHEN kind IN ('spend','refund') THEN -amount_vnd ELSE 0 END),0) AS b FROM wallet_entries"))[0]!;
    walletSums = { balance: n(s['b']), reserved: n(s['r']), spent: n(s['s']), entriesBalance: n(e['b']) };
    const d = await q.all(
      `SELECT w.customer_id AS c, COALESCE(e.b,0) AS b, COALESCE(e.r,0) AS r, COALESCE(e.s,0) AS s, w.balance_vnd AS wb, w.reserved_vnd AS wr, w.spent_vnd AS ws
       FROM ad_wallets w LEFT JOIN (SELECT customer_id,
         SUM(CASE WHEN kind IN ('topup','adjust') THEN amount_vnd WHEN kind IN ('spend','refund') THEN -amount_vnd ELSE 0 END) AS b,
         SUM(CASE WHEN kind = 'reserve' THEN amount_vnd WHEN kind IN ('release','spend') THEN -amount_vnd ELSE 0 END) AS r,
         SUM(CASE WHEN kind = 'spend' THEN amount_vnd ELSE 0 END) AS s FROM wallet_entries GROUP BY customer_id) e ON e.customer_id = w.customer_id`,
    );
    driftWallets = d.filter((x) => n(x['b']) !== n(x['wb']) || n(x['r']) !== n(x['wr']) || n(x['s']) !== n(x['ws'])).length;
  }
  return { tables, ledgerSha256: h.digest('hex'), ledgerRows, walletSums, driftWallets };
}

export interface Diff {
  ok: boolean;
  problems: string[];
}
export function compareFingerprints(a: Fingerprint, b: Fingerprint, opts: { ignoreTables?: string[] } = {}): Diff {
  const problems: string[] = [];
  const ign = new Set(opts.ignoreTables ?? []);
  for (const t of new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])) {
    if (ign.has(t)) continue;
    if (a.tables[t] === undefined) problems.push(`bang ${t}: chi co o ban khoi phuc`);
    else if (b.tables[t] === undefined) problems.push(`bang ${t}: THIEU o ban khoi phuc`);
    else if (a.tables[t] !== b.tables[t]) problems.push(`bang ${t}: ${a.tables[t]} != ${b.tables[t]}`);
  }
  if (a.ledgerSha256 !== b.ledgerSha256) problems.push(`checksum so cai khac (${a.ledgerRows} vs ${b.ledgerRows} dong)`);
  for (const k of ['balance', 'reserved', 'spent', 'entriesBalance'] as const) if (a.walletSums[k] !== b.walletSums[k]) problems.push(`tong vi ${k}: ${a.walletSums[k]} != ${b.walletSums[k]}`);
  if (b.driftWallets > 0) problems.push(`${b.driftWallets} vi lech so cai o ban khoi phuc`);
  return { ok: problems.length === 0, problems };
}
