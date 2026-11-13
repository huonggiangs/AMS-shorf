import type { Runtime } from '@ams/runtime';
import { reconcileSepay } from './webhook.js';
import { iso } from './util.js';

/**
 * Doi soat bu SePay voi cua so DAI (mac dinh 7 ngay, toi da 90) + phan trang. Xem docs/RECONCILIATION.md muc 3.
 * Tai su dung `reconcileSepay` (webhook.ts) cho tung trang: moi giao dich van di qua `processIncoming` => cung khu trung (payment_webhooks.event_id,
 * topups.provider_txn_id UNIQUE, topup_credit_claims) nen chay chong len nhau hay chay lai deu vo hai.
 */

export interface SepayPageRequest {
  /** [sinceIso, untilIso) theo gio UTC */
  sinceIso: string;
  untilIso: string;
  page: number;
  limit: number;
}
export type FetchSepayPage = (req: SepayPageRequest) => Promise<unknown[]>;

export interface SepayWindowOptions {
  /** gio, mac dinh 168 (env SEPAY_RECONCILE_LOOKBACK_HOURS), tran 2160 */
  lookbackHours?: number;
  /** do dai moi lat cat thoi gian, gio (mac dinh 24, env SEPAY_RECONCILE_SLICE_HOURS) */
  sliceHours?: number;
  /** so giao dich moi trang (mac dinh 200, env SEPAY_RECONCILE_PAGE_SIZE) */
  pageSize?: number;
  /** tran so trang moi lat cat (chong vong lap vo han khi API bo qua tham so page) */
  maxPagesPerSlice?: number;
  /** tran tong so giao dich moi lan chay */
  maxItems?: number;
}

export interface SepayWindowResult {
  from: string;
  to: string;
  slices: number;
  pages: number;
  checked: number;
  missing: number;
  credited: number;
  queued: number;
  skipped: number;
  errors: number;
  truncated: boolean;
}

const MAX_LOOKBACK_H = 2160;

const numEnv = (v: string | undefined, d: number): number => {
  const x = v === undefined ? NaN : Number(v);
  return Number.isFinite(x) && x > 0 ? x : d;
};

export async function reconcileSepayWindow(rt: Runtime, fetchPage: FetchSepayPage, opts: SepayWindowOptions = {}): Promise<SepayWindowResult> {
  const env = rt.config.env;
  const lookback = Math.min(MAX_LOOKBACK_H, opts.lookbackHours ?? numEnv(env['SEPAY_RECONCILE_LOOKBACK_HOURS'], 168));
  const slice = Math.max(1, opts.sliceHours ?? numEnv(env['SEPAY_RECONCILE_SLICE_HOURS'], 24));
  const limit = Math.max(1, Math.min(500, opts.pageSize ?? numEnv(env['SEPAY_RECONCILE_PAGE_SIZE'], 200)));
  const maxPages = opts.maxPagesPerSlice ?? 50;
  const maxItems = opts.maxItems ?? 20_000;
  const nowMs = rt.clock.now().getTime();
  const fromMs = nowMs - lookback * 3600_000;
  const out: SepayWindowResult = { from: new Date(fromMs).toISOString(), to: new Date(nowMs).toISOString(), slices: 0, pages: 0, checked: 0, missing: 0, credited: 0, queued: 0, skipped: 0, errors: 0, truncated: false };
  const runId = rt.id();
  await rt.db.run("INSERT INTO reconcile_runs (id, kind, started_at, window_from, window_to, status, params) VALUES (?, 'sepay', ?, ?, ?, 'running', ?)", [runId, iso(rt), out.from, out.to, JSON.stringify({ lookback, slice, limit })]);
  try {
    // lat cat tu CU den MOI: neu bi cat cut (maxItems) thi phan moi nhat van duoc lam o lan chay ke tiep (nho khu trung)
    for (let s = fromMs; s < nowMs && !out.truncated; s += slice * 3600_000) {
      out.slices++;
      const sinceIso = new Date(s).toISOString();
      const untilIso = new Date(Math.min(s + slice * 3600_000, nowMs + 1000)).toISOString();
      const seen = new Set<string>();
      for (let page = 1; page <= maxPages; page++) {
        const items = await fetchPage({ sinceIso, untilIso, page, limit });
        out.pages++;
        // loc trung id trong lat cat: API bo qua `page` thi trang 2 giong trang 1 => dung (khong lap vo han)
        const fresh = items.filter((it) => {
          const id = String((it as { id?: unknown } | null)?.id ?? JSON.stringify(it));
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (fresh.length > 0) {
          const r = await reconcileSepay(rt, async () => fresh);
          out.checked += r.checked; out.missing += r.missing; out.credited += r.credited; out.queued += r.queued; out.skipped += r.skipped; out.errors += r.errors;
        }
        if (out.checked >= maxItems) {
          out.truncated = true;
          break;
        }
        if (fresh.length === 0 || items.length < limit) break; // het du lieu (hoac trang chi con lap lai)
        if (page === maxPages) out.truncated = true;
      }
    }
    await rt.db.run("UPDATE reconcile_runs SET status = 'ok', finished_at = ?, checked = ?, found = ?, resolved = ? WHERE id = ?", [iso(rt), out.checked, out.missing, out.credited, runId]);
    return out;
  } catch (e) {
    await rt.db.run("UPDATE reconcile_runs SET status = 'error', finished_at = ?, checked = ?, error = ? WHERE id = ?", [iso(rt), out.checked, String((e as Error).message ?? e).slice(0, 500), runId]);
    throw e;
  }
}

/**
 * Ham lay trang tu API SePay that. CHUA kiem chung voi dich vu that (tai lieu userapi: transaction_date_min/max, limit; tham so `page` la gia dinh):
 * neu API bo qua `page`, reconcileSepayWindow tu dung o trang lap lai nhung se chi thay toi `limit` giao dich moi lat cat => thu nho `sliceHours`.
 */
export function createSepayPagedFetcher(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): FetchSepayPage {
  const fmt = (iso: string): string => new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
  return async ({ sinceIso, untilIso, page, limit }) => {
    const token = env['SEPAY_API_TOKEN'];
    if (!token) throw new Error('Thiếu SEPAY_API_TOKEN');
    const q = `transaction_date_min=${encodeURIComponent(fmt(sinceIso))}&transaction_date_max=${encodeURIComponent(fmt(untilIso))}&limit=${limit}&page=${page}`;
    const r = await fetchImpl(`https://my.sepay.vn/userapi/transactions/list?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`SePay API ${r.status}`);
    const j = (await r.json()) as { transactions?: Record<string, unknown>[] };
    return (j.transactions ?? []).map((t) => ({
      id: t['id'],
      gateway: t['bank_brand_name'],
      transactionDate: t['transaction_date'],
      accountNumber: t['account_number'],
      subAccount: t['sub_account'],
      code: t['code'],
      content: t['transaction_content'],
      transferType: Number(t['amount_in']) > 0 ? 'in' : 'out',
      transferAmount: Number(t['amount_in']) > 0 ? Number(t['amount_in']) : Number(t['amount_out']),
      referenceCode: t['reference_number'],
    }));
  };
}
