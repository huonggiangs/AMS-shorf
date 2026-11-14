import type { Runtime } from '@ams/runtime';
import { transitionCampaign } from '@ams/shared';
import { sweepActivations } from './activation.js';
import { releaseCampaign } from './ledger.js';
import { pruneRejectedWebhooks } from './webhook.js';
import { pruneSpendEvents, settleSpendRemainders } from './spend.js';
import { repairLedgerDrift, type RepairOptions } from './reconcile-atomic.js';
import { reconcileRevenue } from './reconcile-revenue.js';
import { audit, bumpManifest, iso, n, notify } from './util.js';

export * from './reconcile-revenue.js';
export * from './reconcile-sepay.js';
export { repairLedgerDrift, type RepairAction, type RepairOptions } from './reconcile-atomic.js';

export interface LedgerMismatch {
  customer_id: string;
  field: 'balance' | 'reserved' | 'spent' | 'campaign_hold';
  cache: number;
  ledger: number;
}

/**
 * Doi soat hang ngay: tong wallet_entries phai khop ad_wallets (so du, phan giu, da chi) va tong phan giu cua chien dich.
 * Khong tu sua: lech thi ghi audit + thong bao cho tai chinh.
 */
export async function reconcileLedger(rt: Runtime): Promise<{ checked: number; mismatches: LedgerMismatch[] }> {
  const rows = await rt.db.query<{ customer_id: string; b: unknown; r: unknown; s: unknown; wb: unknown; wr: unknown; ws: unknown; ch: unknown }>(
    `SELECT w.customer_id AS customer_id,
       COALESCE(e.b,0) AS b, COALESCE(e.r,0) AS r, COALESCE(e.s,0) AS s,
       w.balance_vnd AS wb, w.reserved_vnd AS wr, w.spent_vnd AS ws,
       COALESCE((SELECT SUM(c.reserved_vnd) FROM campaigns c WHERE c.customer_id = w.customer_id AND c.funding_state = 'reserved'),0) AS ch
     FROM ad_wallets w
     LEFT JOIN (
       SELECT customer_id,
         SUM(CASE WHEN kind IN ('topup','adjust') THEN amount_vnd WHEN kind IN ('spend','refund') THEN -amount_vnd ELSE 0 END) AS b,
         SUM(CASE WHEN kind = 'reserve' THEN amount_vnd WHEN kind IN ('release','spend') THEN -amount_vnd ELSE 0 END) AS r,
         SUM(CASE WHEN kind = 'spend' THEN amount_vnd ELSE 0 END) AS s
       FROM wallet_entries GROUP BY customer_id
     ) e ON e.customer_id = w.customer_id`,
  );
  const mismatches: LedgerMismatch[] = [];
  for (const x of rows) {
    if (n(x.b) !== n(x.wb)) mismatches.push({ customer_id: x.customer_id, field: 'balance', cache: n(x.wb), ledger: n(x.b) });
    if (n(x.r) !== n(x.wr)) mismatches.push({ customer_id: x.customer_id, field: 'reserved', cache: n(x.wr), ledger: n(x.r) });
    if (n(x.s) !== n(x.ws)) mismatches.push({ customer_id: x.customer_id, field: 'spent', cache: n(x.ws), ledger: n(x.s) });
    if (n(x.ch) !== n(x.wr)) mismatches.push({ customer_id: x.customer_id, field: 'campaign_hold', cache: n(x.wr), ledger: n(x.ch) });
  }
  // topup da ghi co nhung khong co dong so cai (dut giua chung tren D1)
  const orphans = await rt.db.query<{ id: string; customer_id: string }>(
    `SELECT t.id AS id, t.customer_id AS customer_id FROM topups t
     WHERE t.status = 'credited' AND t.provider IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM wallet_entries e WHERE e.kind = 'topup' AND e.ref_type = 'topup' AND e.ref_id = t.id)`,
  );
  for (const o of orphans) mismatches.push({ customer_id: o.customer_id, field: 'balance', cache: 0, ledger: -1 });
  if (mismatches.length) {
    await audit(rt.db, rt, { action: 'finance.reconcile.mismatch', type: 'ledger', diff: { mismatches, orphan_topups: orphans.map((o) => o.id) } });
    await notify(rt.db, rt, { kind: 'reconcile_mismatch', title: 'Đối soát ví lệch sổ cái', body: `${mismatches.length} chênh lệch, xem nhật ký.` });
  }
  return { checked: rows.length, mismatches };
}

/** scheduled -> active khi den ngay bat dau (chi khi da giu tien). */
export async function startDueCampaigns(rt: Runtime): Promise<number> {
  const changed = await transitionCampaign(rt.db, {
    from: 'scheduled', to: 'active', nowIso: iso(rt),
    where: { sql: "funding_state = 'reserved' AND start_at IS NOT NULL AND start_at <= ?", params: [iso(rt)] },
  });
  if (changed > 0) await bumpManifest(rt);
  return changed;
}

/**
 * Het han (end_at): hoan phan giu chua dung roi ket thuc. THU TU: hoan tien truoc (idempotent), doi trang thai sau;
 * mat dien giua chung thi lan quet ke tiep van thay chien dich (state chua doi) va chay lai ca hai buoc.
 */
export async function endDueCampaigns(rt: Runtime): Promise<number> {
  const due = await rt.db.query<{ id: string }>(
    "SELECT id FROM campaigns WHERE state IN ('active','scheduled','paused') AND end_at IS NOT NULL AND end_at < ?", [iso(rt)]);
  for (const c of due) {
    await releaseCampaign(rt, rt.db, c.id);
    await transitionCampaign(rt.db, { id: c.id, from: ['active', 'scheduled', 'paused'], to: 'ended', nowIso: iso(rt), allowNone: true, set: { funding_state: { sql: "CASE WHEN funding_state = 'none' THEN 'none' ELSE 'released' END" } } });
  }
  if (due.length) await bumpManifest(rt);
  return due.length;
}

/** Canh bao vi duoi nguong % (so voi tong da nap). Mot thong bao moi ngay moi khach. */
export async function lowBalanceAlerts(rt: Runtime): Promise<number> {
  const rows = await rt.db.query<{ customer_id: string; pct: unknown; bal: unknown; res: unknown; funded: unknown }>(
    `SELECT w.customer_id AS customer_id, w.low_balance_alert_pct AS pct, w.balance_vnd AS bal, w.reserved_vnd AS res,
       COALESCE((SELECT SUM(amount_vnd) FROM topups t WHERE t.customer_id = w.customer_id AND t.status = 'credited'),0) AS funded
     FROM ad_wallets w`);
  let sent = 0;
  const day = iso(rt).slice(0, 10);
  for (const w of rows) {
    const funded = n(w.funded);
    if (funded <= 0) continue;
    if ((n(w.bal) - n(w.res)) * 100 >= funded * n(w.pct)) continue;
    const dup = (await rt.db.query("SELECT 1 AS x FROM notifications WHERE customer_id = ? AND kind = 'low_balance' AND created_at >= ?", [w.customer_id, day]))[0];
    if (dup) continue;
    await notify(rt.db, rt, { customer: w.customer_id, kind: 'low_balance', title: `Ví dưới ${n(w.pct)}% số đã nạp`, body: 'Vui lòng nạp thêm để chiến dịch không bị gián đoạn.' });
    sent++;
  }
  return sent;
}

const guarded = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
  try {
    return await fn();
  } catch (e) {
    return { error: String((e as Error).message ?? e).slice(0, 300) }; // mot job doi soat hong khong duoc chan cac job con lai
  }
};

/**
 * Job tan suat cao (node: interval 10 phut qua `scheduled(rt, '*\/10 * * * *')`; CF: cron `*\/10`): sweeper sua lech so cai/cache (chi cac sua an toan).
 * `scheduled()` cua routes.ts chua goi ham nay: xem docs/RECONCILIATION.md muc 5 (yeu cau thay doi cho chu routes.ts).
 */
export async function runFrequentFinanceJobs(rt: Runtime, repair: RepairOptions = {}) {
  return { repair: await guarded(() => repairLedgerDrift(rt, repair)), activations: await guarded(() => sweepActivations(rt)) };
}

/** Gom cac job dinh ky (cron Cloudflare `15 2 * * *` / Docker scheduler). Doi soat bu SePay goi rieng: reconcileSepayWindow(rt, createSepayPagedFetcher(env)). */
export async function runDailyFinanceJobs(rt: Runtime) {
  const started = await startDueCampaigns(rt);
  const ended = await endDueCampaigns(rt);
  const ledger = await reconcileLedger(rt);
  const alerts = await lowBalanceAlerts(rt);
  const settled = await settleSpendRemainders(rt);
  const pruned = await pruneSpendEvents(rt);
  const prunedWebhooks = await guarded(() => pruneRejectedWebhooks(rt));
  const repair = await guarded(() => repairLedgerDrift(rt));
  const revenue = await guarded(() => reconcileRevenue(rt));
  return { started, ended, ledger, alerts, settled, pruned, prunedWebhooks, repair, revenue };
}
