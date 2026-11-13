import type { Db, Runtime } from '@ams/runtime';
import { transitionCampaign } from '@ams/shared';
import { audit, bumpManifest, iso, n, notify, withTx } from './util.js';

/**
 * Bien the NGUYEN TU cho DB khong co giao dich tuong tac (D1: `db.interactiveTx === false`) va sweeper sua lech so cai/cache.
 *
 * Y tuong: moi thao tac tien tren D1 la MOT `db.batch` (D1 chay batch trong mot giao dich ngam: tat ca hoac khong cai nao), trong do
 *   1. chen dong so cai (INSERT ... SELECT ... WHERE <dieu kien du tien/dung trang thai>)  -> chi ra dong khi dieu kien dung
 *   2. cac UPDATE cache (campaigns/ad_wallets) co them `AND EXISTS (SELECT 1 FROM wallet_entries WHERE id = <dong vua chen>)`
 * Dong so cai vua la bang chung "dieu kien dung" vua la cong tac cho cac UPDATE sau no. Khong con cua so "so cai co ma cache chua doi" hay nguoc lai.
 * Dieu kien chi dung duoc vi batch D1 tuan tu hoa; tren Postgres dong thoi (READ COMMITTED) KHONG dung cach nay (xem docs/RECONCILIATION.md).
 */

const ENTRY_COLS = 'id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, note, created_at';
const T = (p = '?'): string => `CAST(${p} AS TEXT)`;
const B = (p = '?'): string => `CAST(${p} AS BIGINT)`;

type Stmt = { sql: string; params: unknown[] };

async function entrySnapshot(db: Db, id: string): Promise<{ balance_vnd: number; reserved_vnd: number } | null> {
  const r = (await db.query<{ balance_after: unknown; reserved_after: unknown }>('SELECT balance_after, reserved_after FROM wallet_entries WHERE id = ?', [id]))[0];
  return r ? { balance_vnd: n(r.balance_after), reserved_vnd: n(r.reserved_after) } : null;
}

/** Cong/tru so du (nap, dieu chinh, hoan) nguyen tu. null = khong ap dung (khong du so du de tru, hoac khoa idempotent da ton tai). */
export async function applyBalanceAtomic(
  db: Db, rt: Runtime,
  o: { customerId: string; delta: number; kind: 'topup' | 'adjust' | 'refund'; entryAmount: number; refType?: string; refId?: string; note?: string },
): Promise<{ balance_vnd: number; reserved_vnd: number } | null> {
  const id = rt.id();
  const now = iso(rt);
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO wallet_entries (${ENTRY_COLS})
            SELECT ${T()}, w.customer_id, ${T()}, ${B()}, w.balance_vnd + ${B()}, w.reserved_vnd, ${T()}, ${T()}, ${T()}, ${T()}
            FROM ad_wallets w WHERE w.customer_id = ? AND w.balance_vnd + ${B()} >= w.reserved_vnd
            ON CONFLICT DO NOTHING`,
      params: [id, o.kind, o.entryAmount, o.delta, o.refType ?? null, o.refId ?? null, o.note ?? null, now, o.customerId, o.delta],
    },
    {
      sql: 'UPDATE ad_wallets SET balance_vnd = balance_vnd + ?, updated_at = ? WHERE customer_id = ? AND EXISTS (SELECT 1 FROM wallet_entries WHERE id = ?)',
      params: [o.delta, now, o.customerId, id],
    },
  ];
  const r = await db.batch(stmts);
  if (r[0]?.changes !== 1) return null;
  return entrySnapshot(db, id);
}

/** Giu tien nguyen tu: chen so cai 'reserve' (neu du kha dung + chien dich con awaiting_funds) + doi trang thai chien dich + tang phan giu cua vi. */
export async function reserveAtomic(
  db: Db, rt: Runtime,
  o: { campaignId: string; customerId: string; amount: number; targetState: 'active' | 'scheduled' | 'paused' },
): Promise<boolean> {
  const id = rt.id();
  const now = iso(rt);
  const existsEntry = 'EXISTS (SELECT 1 FROM wallet_entries WHERE id = ?)';
  // chuyen trang thai van di qua transitionCampaign: ghi lai cau lenh thay vi chay ngay, roi dua vao batch
  const captured: Stmt[] = [];
  await transitionCampaign(
    { run: async (sql, params) => (captured.push({ sql, params: params ?? [] }), { changes: 1 }) },
    {
      id: o.campaignId, from: 'awaiting_funds', to: o.targetState, nowIso: now, allowNone: true,
      set: { funding_state: 'reserved', reserved_vnd: o.amount, approved_budget_vnd: o.amount, approved_at: { sql: 'COALESCE(approved_at, ?)', params: [now] } },
      where: { sql: `funding_state <> 'reserved' AND ${existsEntry}`, params: [id] },
    },
  );
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO wallet_entries (${ENTRY_COLS})
            SELECT ${T()}, c.customer_id, 'reserve', ${B()}, w.balance_vnd, w.reserved_vnd + ${B()}, 'campaign', c.id, ${T()}, ${T()}
            FROM campaigns c JOIN ad_wallets w ON w.customer_id = c.customer_id
            WHERE c.id = ? AND c.state = 'awaiting_funds' AND c.funding_state <> 'reserved' AND w.balance_vnd - w.reserved_vnd >= ${B()}`,
      params: [id, o.amount, o.amount, 'Giữ ngân sách chiến dịch', now, o.campaignId, o.amount],
    },
    ...captured,
    {
      sql: `UPDATE ad_wallets SET reserved_vnd = reserved_vnd + ?, updated_at = ? WHERE customer_id = ? AND ${existsEntry}`,
      params: [o.amount, now, o.customerId, id],
    },
  ];
  const r = await db.batch(stmts);
  return r[0]?.changes === 1;
}

/** Giai phong phan giu nguyen tu. 'inconsistent' = chien dich con giu `amount` nhung vi khong du phan giu (khong thay doi gi). */
export async function releaseAtomic(
  db: Db, rt: Runtime,
  o: { campaignId: string; customerId: string; amount: number },
): Promise<'released' | 'retry' | 'inconsistent'> {
  const now = iso(rt);
  if (o.amount <= 0) {
    const r = await db.run("UPDATE campaigns SET reserved_vnd = 0, funding_state = 'released', updated_at = ? WHERE id = ? AND funding_state = 'reserved' AND reserved_vnd = 0", [now, o.campaignId]);
    return r.changes === 1 ? 'released' : 'retry';
  }
  const id = rt.id();
  const existsEntry = 'EXISTS (SELECT 1 FROM wallet_entries WHERE id = ?)';
  const r = await db.batch([
    {
      sql: `INSERT INTO wallet_entries (${ENTRY_COLS})
            SELECT ${T()}, c.customer_id, 'release', ${B()}, w.balance_vnd, w.reserved_vnd - ${B()}, 'campaign', c.id, ${T()}, ${T()}
            FROM campaigns c JOIN ad_wallets w ON w.customer_id = c.customer_id
            WHERE c.id = ? AND c.funding_state = 'reserved' AND c.reserved_vnd = ${B()} AND w.reserved_vnd >= ${B()}`,
      params: [id, o.amount, o.amount, 'Hoàn phần giữ chưa dùng', now, o.campaignId, o.amount, o.amount],
    },
    {
      sql: `UPDATE campaigns SET reserved_vnd = 0, funding_state = 'released', updated_at = ? WHERE id = ? AND funding_state = 'reserved' AND reserved_vnd = ? AND ${existsEntry}`,
      params: [now, o.campaignId, o.amount, id],
    },
    {
      sql: `UPDATE ad_wallets SET reserved_vnd = reserved_vnd - ?, updated_at = ? WHERE customer_id = ? AND ${existsEntry}`,
      params: [o.amount, now, o.customerId, id],
    },
  ]);
  if (r[0]?.changes === 1) return 'released';
  const c = (await db.query<{ funding_state: string; reserved_vnd: unknown }>('SELECT funding_state, reserved_vnd FROM campaigns WHERE id = ?', [o.campaignId]))[0];
  return c && c.funding_state === 'reserved' && n(c.reserved_vnd) === o.amount ? 'inconsistent' : 'retry';
}

/** Chi tieu nguyen tu: tru phan giu chien dich + vi (balance, reserved, spent) + so cai, hoac khong gi ca. */
export async function spendAtomic(
  db: Db, rt: Runtime,
  o: { campaignId: string; customerId: string; amount: number; refType: string; refId: string },
): Promise<{ ok: true; left: number } | { ok: false; inconsistent: boolean }> {
  const id = rt.id();
  const now = iso(rt);
  const existsEntry = 'EXISTS (SELECT 1 FROM wallet_entries WHERE id = ?)';
  const r = await db.batch([
    {
      sql: `INSERT INTO wallet_entries (${ENTRY_COLS})
            SELECT ${T()}, c.customer_id, 'spend', ${B()}, w.balance_vnd - ${B()}, w.reserved_vnd - ${B()}, ${T()}, ${T()}, ${T()}, ${T()}
            FROM campaigns c JOIN ad_wallets w ON w.customer_id = c.customer_id
            WHERE c.id = ? AND c.funding_state = 'reserved' AND c.reserved_vnd >= ${B()} AND w.reserved_vnd >= ${B()} AND w.balance_vnd >= ${B()}`,
      params: [id, o.amount, o.amount, o.amount, o.refType, o.refId, 'Chi phát quảng cáo', now, o.campaignId, o.amount, o.amount, o.amount],
    },
    {
      sql: `UPDATE campaigns SET reserved_vnd = reserved_vnd - ?, spent_vnd = spent_vnd + ?, updated_at = ? WHERE id = ? AND funding_state = 'reserved' AND reserved_vnd >= ? AND ${existsEntry}`,
      params: [o.amount, o.amount, now, o.campaignId, o.amount, id],
    },
    {
      sql: `UPDATE ad_wallets SET balance_vnd = balance_vnd - ?, reserved_vnd = reserved_vnd - ?, spent_vnd = spent_vnd + ?, updated_at = ? WHERE customer_id = ? AND ${existsEntry}`,
      params: [o.amount, o.amount, o.amount, now, o.customerId, id],
    },
  ]);
  if (r[0]?.changes === 1) {
    const left = n((await db.query<{ reserved_vnd: unknown }>('SELECT reserved_vnd FROM campaigns WHERE id = ?', [o.campaignId]))[0]?.reserved_vnd);
    return { ok: true, left };
  }
  // khong ap dung: do dua (da co chi tieu khac lam phan giu giam) hay vi khong khop chien dich?
  const c = (await db.query<{ funding_state: string; reserved_vnd: unknown }>('SELECT funding_state, reserved_vnd FROM campaigns WHERE id = ?', [o.campaignId]))[0];
  const w = (await db.query<{ balance_vnd: unknown; reserved_vnd: unknown }>('SELECT balance_vnd, reserved_vnd FROM ad_wallets WHERE customer_id = ?', [o.customerId]))[0];
  const campaignCan = !!c && c.funding_state === 'reserved' && n(c.reserved_vnd) >= o.amount;
  const walletCan = !!w && n(w.reserved_vnd) >= o.amount && n(w.balance_vnd) >= o.amount;
  return { ok: false, inconsistent: campaignCan && !walletCan };
}

// ---------------------------------------------------------------------------
// Sweeper sua lech so cai <-> cache
// ---------------------------------------------------------------------------

export interface RepairAction {
  type: 'replay_topup_credit' | 'finish_exhausted_campaign' | 'wallet_reserved_to_campaign_hold' | 'wallet_cache_from_ledger' | 'ledger_drift_reported';
  customer_id?: string;
  campaign_id?: string;
  topup_id?: string;
  field?: string;
  before?: number;
  after?: number;
  applied: boolean;
}

export interface RepairOptions {
  /** chi sua vi co `updated_at` cu hon X giay (tranh dap vao thao tac dang chay). Mac dinh 300. */
  minAgeSec?: number;
  /** true = cung ghi de balance/spent cua cache theo so cai (so cai la nguon su that). Mac dinh false: chi bao cao. */
  fixCacheFromLedger?: boolean;
  /** true = khong ghi gi, chi liet ke. */
  dryRun?: boolean;
  limit?: number;
}

/**
 * Quet va sua lech so cai/cache (bo sung cho `reconcileLedger` chi bao cao). Moi sua deu: dieu kien CAS (chi doi neu gia tri van nhu da doc),
 * ghi audit_log voi truoc/sau, idempotent. Hanh vi:
 *  1. topup 'credited' nhung khong co dong so cai: phat lai cong nguyen tu (khoa duy nhat uq_wallet_entries_ref chong cong hai lan). Tren D1 cong ghi so cai + vi la
 *     mot batch nen "da cong vi ma thieu so cai" khong xay ra; con lai chi la "da danh dau credited, chua cong".
 *  2. chien dich funding_state='reserved' va reserved_vnd=0 ma van scheduled/active/paused (dut sau lan chi cuoi): chuyen ended + released.
 *  3. vi.reserved_vnd khac tong reserved_vnd cua chien dich dang giu: chien dich la nguon su that cua phan giu => dua cache ve tong do (CAS).
 *  4. vi.balance/spent khac tong so cai: mac dinh CHI BAO CAO (khong ro ben nao dung neu mot buoc cu bi dut); bat `fixCacheFromLedger` de dua cache ve so cai.
 */
export async function repairLedgerDrift(rt: Runtime, opts: RepairOptions = {}): Promise<{ checked: number; actions: RepairAction[] }> {
  const dry = opts.dryRun === true;
  const limit = opts.limit ?? 200;
  const cutoff = new Date(rt.clock.now().getTime() - (opts.minAgeSec ?? 300) * 1000).toISOString();
  const actions: RepairAction[] = [];

  // 1. topup da credited nhung chua co dong so cai
  const orphans = await rt.db.query<{ id: string; customer_id: string; amount_vnd: unknown; credited_at: string | null }>(
    `SELECT t.id AS id, t.customer_id AS customer_id, t.amount_vnd AS amount_vnd, t.credited_at AS credited_at FROM topups t
     WHERE t.status = 'credited' AND t.credited_at IS NOT NULL AND t.credited_at < ?
       AND NOT EXISTS (SELECT 1 FROM wallet_entries e WHERE e.kind = 'topup' AND e.ref_type = 'topup' AND e.ref_id = t.id)
     ORDER BY t.id LIMIT ?`,
    [cutoff, limit],
  );
  for (const t of orphans) {
    let applied = false;
    if (!dry) {
      await rt.db.run('INSERT INTO ad_wallets (customer_id, balance_vnd, reserved_vnd, spent_vnd, updated_at) VALUES (?,0,0,0,?) ON CONFLICT (customer_id) DO NOTHING', [t.customer_id, iso(rt)]);
      applied = (await applyBalanceAtomic(rt.db, rt, { customerId: t.customer_id, delta: n(t.amount_vnd), kind: 'topup', entryAmount: n(t.amount_vnd), refType: 'topup', refId: t.id, note: 'Sweeper: phát lại cộng ví' })) !== null;
      if (applied) await audit(rt.db, rt, { action: 'finance.repair.replay_topup_credit', type: 'topup', id: t.id, customer: t.customer_id, diff: { amount_vnd: n(t.amount_vnd) } });
    }
    actions.push({ type: 'replay_topup_credit', customer_id: t.customer_id, topup_id: t.id, after: n(t.amount_vnd), applied });
  }

  // 2. chien dich het tien nhung chua dung
  const stuck = await rt.db.query<{ id: string; customer_id: string }>(
    `SELECT id, customer_id FROM campaigns WHERE funding_state = 'reserved' AND reserved_vnd = 0 AND spent_vnd > 0
       AND state IN ('scheduled','active','paused') AND updated_at < ? ORDER BY id LIMIT ?`,
    [cutoff, limit],
  );
  let manifest = false;
  for (const c of stuck) {
    let applied = false;
    if (!dry) {
      const ch = await transitionCampaign(rt.db, {
        id: c.id, from: ['scheduled', 'active', 'paused'], to: 'ended', nowIso: iso(rt), allowNone: true,
        set: { funding_state: 'released' }, where: { sql: "funding_state = 'reserved' AND reserved_vnd = 0" },
      });
      applied = ch === 1;
      if (applied) {
        manifest = true;
        await audit(rt.db, rt, { action: 'finance.repair.finish_exhausted_campaign', type: 'campaign', id: c.id, customer: c.customer_id });
      }
    }
    actions.push({ type: 'finish_exhausted_campaign', customer_id: c.customer_id, campaign_id: c.id, applied });
  }
  if (manifest) await bumpManifest(rt);

  // 3-4. cache vi vs so cai / phan giu chien dich
  const rows = await rt.db.query<{ customer_id: string; b: unknown; s: unknown; wb: unknown; wr: unknown; ws: unknown; ch: unknown; updated_at: string | null }>(
    `SELECT w.customer_id AS customer_id,
       COALESCE(e.b,0) AS b, COALESCE(e.s,0) AS s,
       w.balance_vnd AS wb, w.reserved_vnd AS wr, w.spent_vnd AS ws, w.updated_at AS updated_at,
       COALESCE((SELECT SUM(c.reserved_vnd) FROM campaigns c WHERE c.customer_id = w.customer_id AND c.funding_state = 'reserved'),0) AS ch
     FROM ad_wallets w
     LEFT JOIN (
       SELECT customer_id,
         SUM(CASE WHEN kind IN ('topup','adjust') THEN amount_vnd WHEN kind IN ('spend','refund') THEN -amount_vnd ELSE 0 END) AS b,
         SUM(CASE WHEN kind = 'spend' THEN amount_vnd ELSE 0 END) AS s
       FROM wallet_entries GROUP BY customer_id
     ) e ON e.customer_id = w.customer_id
     WHERE w.updated_at IS NULL OR w.updated_at < ?
     ORDER BY w.customer_id LIMIT ?`,
    [cutoff, limit],
  );
  for (const x of rows) {
    if (n(x.wr) !== n(x.ch)) {
      let applied = false;
      if (!dry) {
        applied = (await rt.db.run('UPDATE ad_wallets SET reserved_vnd = ?, updated_at = ? WHERE customer_id = ? AND reserved_vnd = ? AND balance_vnd >= ?', [n(x.ch), iso(rt), x.customer_id, n(x.wr), n(x.ch)])).changes === 1;
        if (applied) await audit(rt.db, rt, { action: 'finance.repair.wallet_reserved', type: 'wallet', id: x.customer_id, customer: x.customer_id, diff: { before: n(x.wr), after: n(x.ch) } });
      }
      actions.push({ type: 'wallet_reserved_to_campaign_hold', customer_id: x.customer_id, field: 'reserved', before: n(x.wr), after: n(x.ch), applied });
    }
    for (const [field, cacheV, ledgerV, col] of [['balance', n(x.wb), n(x.b), 'balance_vnd'], ['spent', n(x.ws), n(x.s), 'spent_vnd']] as const) {
      if (cacheV === ledgerV) continue;
      let applied = false;
      if (!dry && opts.fixCacheFromLedger) {
        applied = (await rt.db.run(`UPDATE ad_wallets SET ${col} = ?, updated_at = ? WHERE customer_id = ? AND ${col} = ?`, [ledgerV, iso(rt), x.customer_id, cacheV])).changes === 1;
        if (applied) await audit(rt.db, rt, { action: 'finance.repair.wallet_cache', type: 'wallet', id: x.customer_id, customer: x.customer_id, diff: { field, before: cacheV, after: ledgerV } });
      }
      actions.push({ type: opts.fixCacheFromLedger ? 'wallet_cache_from_ledger' : 'ledger_drift_reported', customer_id: x.customer_id, field, before: cacheV, after: ledgerV, applied });
    }
  }

  const applied = actions.filter((a) => a.applied).length;
  if (!dry && actions.length) {
    await withTx(rt.db, async (db) => {
      await audit(db, rt, { action: 'finance.repair.run', type: 'ledger', diff: { actions: actions.length, applied, report_only: actions.filter((a) => !a.applied).length } });
      if (actions.some((a) => !a.applied)) await notify(db, rt, { kind: 'ledger_drift', title: 'Lệch sổ cái/ví cần người xem', body: `${actions.filter((a) => !a.applied).length} chênh lệch chưa tự sửa, xem nhật ký.` });
    });
  }
  return { checked: rows.length + orphans.length + stuck.length, actions };
}
