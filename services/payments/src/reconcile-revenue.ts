import type { Runtime } from '@ams/runtime';
import { audit, iso, n, notify } from './util.js';

/**
 * Doi soat doanh thu/chi tieu voi impression log theo (chien dich, ngay Viet Nam). Xem docs/RECONCILIATION.md muc 1.
 *
 *  claim_vs_impression: micro-VND da chiem trong spend_events  vs  doanh thu impression HOP LE trong impression_hourly
 *     (hai ben cung ghi boi consumer: spend truoc, append sau; moi event dung dung mot lan => phai KHOP TUYET DOI khi het do tre).
 *     diff = chiem - impression:  duong = thu thua (tru tien ma khong co impression), am = thu thieu (co impression ma chua tru).
 *  ledger_vs_claim: VND da ghi so cai (spend_dedupe.charged_vnd) vs micro da chiem: chi bao thu THUA so cai (so cai > chiem + dung sai).
 *     Khong bao thu thieu vi phan du < 1 VND duoc don sang lo sau, chien dich het ngan sach bi tu choi hop le, va settleSpendRemainders khong cong vao spend_dedupe.
 *
 * Khong tu sua tien: chi ghi `revenue_discrepancies` (UNIQUE kind+campaign+day) + audit + thong bao. Lan chay sau tu dong dong ('resolved') ban ghi da het lech.
 * Chi xet NGAY DA KET THUC (+ do tre `graceMinutes`) de khong bao oan cho su kien dang bay (spend truoc, append sau).
 */

export interface RevenueReconcileOptions {
  /** so ngay (da ket thuc) quet lai, mac dinh 3 (env REVENUE_RECONCILE_DAYS). Lech do su kien tre van duoc xem lai trong cac ngay sau. */
  days?: number;
  /** dung sai tuyet doi micro-VND (mac dinh 1_000_000 = 1 VND; env REVENUE_RECONCILE_TOLERANCE_MICRO) */
  toleranceAbsMicro?: number;
  /** dung sai theo ty le cua doanh thu impression (mac dinh 0.005 = 0,5%; env REVENUE_RECONCILE_TOLERANCE_PCT) */
  tolerancePct?: number;
  /** do tre cho phep sau khi ngay ket thuc, phut (mac dinh 60; env REVENUE_RECONCILE_GRACE_MIN) */
  graceMinutes?: number;
  campaignId?: string;
  /** nguoi goi (admin) de ghi vet kiem toan; job dinh ky de trong */
  actor?: string | null;
}

export interface RevenueDiscrepancy {
  kind: 'claim_vs_impression' | 'ledger_vs_claim';
  campaign_id: string;
  day: string;
  expected_micro: number;
  actual_micro: number;
  diff_micro: number;
  tolerance_micro: number;
  impressions_valid: number;
}

export interface RevenueReconcileResult {
  run_id: string;
  from: string;
  to: string;
  checked: number;
  found: RevenueDiscrepancy[];
  resolved: number;
}

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3600_000;
const MICRO = 1_000_000;

/** 'YYYY-MM-DDTHH...' (gio UTC) -> ngay Viet Nam 'YYYY-MM-DD' */
export function vnDayOfHour(hourPrefix: string): string {
  const t = Date.parse(hourPrefix.slice(0, 13) + ':00:00.000Z');
  return new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function startOfVnDayMs(ms: number): number {
  return Math.floor((ms + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
}

const num = (v: string | undefined, d: number): number => {
  const x = v === undefined ? NaN : Number(v);
  return Number.isFinite(x) && x >= 0 ? x : d;
};

type Key = string;
const keyOf = (campaign: string, day: string): Key => `${campaign}|${day}`;

interface Cell { campaign: string; day: string; impMicro: number; impValid: number; claimMicro: number; claims: number; ledgerMicro: number }

async function hasEventTable(rt: Runtime): Promise<boolean> {
  try {
    await rt.db.query('SELECT 1 AS x FROM ev_ad_impression LIMIT 1');
    return true;
  } catch {
    return false; // ClickHouse/khong co bang su kien trong DB: dung created_at cua spend_events de chia ngay
  }
}

export async function reconcileRevenue(rt: Runtime, opts: RevenueReconcileOptions = {}): Promise<RevenueReconcileResult> {
  const env = rt.config.env;
  const days = Math.max(1, Math.min(60, Math.floor(opts.days ?? num(env['REVENUE_RECONCILE_DAYS'], 3))));
  const tolAbs = opts.toleranceAbsMicro ?? num(env['REVENUE_RECONCILE_TOLERANCE_MICRO'], MICRO);
  const tolPct = opts.tolerancePct ?? num(env['REVENUE_RECONCILE_TOLERANCE_PCT'], 0.005);
  const grace = opts.graceMinutes ?? num(env['REVENUE_RECONCILE_GRACE_MIN'], 60);
  const nowMs = rt.clock.now().getTime();
  const toMs = startOfVnDayMs(nowMs - grace * 60_000); // ngay dau tien CHUA xet (loai tru)
  const fromMs = toMs - days * DAY_MS;
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  const runId = rt.id();
  await rt.db.run(
    "INSERT INTO reconcile_runs (id, kind, started_at, window_from, window_to, status, params) VALUES (?, 'revenue', ?, ?, ?, 'running', ?)",
    [runId, iso(rt), from, to, JSON.stringify({ days, tolAbs, tolPct, grace, campaignId: opts.campaignId ?? null })],
  );
  try {
    const cells = new Map<Key, Cell>();
    const cell = (campaign: string, day: string): Cell => {
      const k = keyOf(campaign, day);
      let c = cells.get(k);
      if (!c) cells.set(k, (c = { campaign, day, impMicro: 0, impValid: 0, claimMicro: 0, claims: 0, ledgerMicro: 0 }));
      return c;
    };
    const cf = opts.campaignId ? ' AND campaign_id = ?' : '';
    const cp = opts.campaignId ? [opts.campaignId] : [];

    // 1. impression hop le (doc TRUOC: consumer chiem spend truoc khi ghi impression, nen moi impression da co claim khi ta doc claim sau)
    const imps = await rt.db.query<{ campaign_id: string; hour: string; m: unknown; v: unknown }>(
      `SELECT campaign_id, hour, SUM(revenue_micro_vnd) AS m, SUM(valid) AS v FROM impression_hourly WHERE hour >= ? AND hour < ?${cf} GROUP BY campaign_id, hour`,
      [from, to, ...cp],
    );
    for (const r of imps) {
      const c = cell(r.campaign_id, vnDayOfHour(r.hour));
      c.impMicro += n(r.m);
      c.impValid += n(r.v);
    }

    // 2. claim: chia ngay theo ts cua impression (join event_id) neu co bang su kien; claim chua co impression chia theo created_at
    const sf = opts.campaignId ? ' AND s.campaign_id = ?' : '';
    if (await hasEventTable(rt)) {
      const joined = await rt.db.query<{ campaign_id: string; h: string; m: unknown; k: unknown }>(
        `SELECT s.campaign_id AS campaign_id, substr(i.ts, 1, 13) AS h, SUM(s.amount_micro_vnd) AS m, COUNT(*) AS k
         FROM spend_events s JOIN ev_ad_impression i ON i.event_id = s.event_id
         WHERE i.ts >= ? AND i.ts < ?${sf} GROUP BY s.campaign_id, substr(i.ts, 1, 13)`,
        [from, to, ...cp],
      );
      for (const r of joined) {
        const c = cell(r.campaign_id, vnDayOfHour(r.h));
        c.claimMicro += n(r.m);
        c.claims += n(r.k);
      }
      const orphan = await rt.db.query<{ campaign_id: string; h: string; m: unknown; k: unknown }>(
        `SELECT s.campaign_id AS campaign_id, substr(s.created_at, 1, 13) AS h, SUM(s.amount_micro_vnd) AS m, COUNT(*) AS k
         FROM spend_events s
         WHERE s.created_at >= ? AND s.created_at < ?${sf} AND NOT EXISTS (SELECT 1 FROM ev_ad_impression i WHERE i.event_id = s.event_id)
         GROUP BY s.campaign_id, substr(s.created_at, 1, 13)`,
        [from, to, ...cp],
      );
      for (const r of orphan) {
        const c = cell(r.campaign_id, vnDayOfHour(r.h));
        c.claimMicro += n(r.m);
        c.claims += n(r.k);
      }
    } else {
      const flat = await rt.db.query<{ campaign_id: string; h: string; m: unknown; k: unknown }>(
        `SELECT s.campaign_id AS campaign_id, substr(s.created_at, 1, 13) AS h, SUM(s.amount_micro_vnd) AS m, COUNT(*) AS k
         FROM spend_events s WHERE s.created_at >= ? AND s.created_at < ?${sf} GROUP BY s.campaign_id, substr(s.created_at, 1, 13)`,
        [from, to, ...cp],
      );
      for (const r of flat) {
        const c = cell(r.campaign_id, vnDayOfHour(r.h));
        c.claimMicro += n(r.m);
        c.claims += n(r.k);
      }
    }

    // 3. so cai (VND da ghi theo lo) chia ngay theo created_at cua ban ghi lo
    const led = await rt.db.query<{ campaign_id: string; h: string; v: unknown }>(
      `SELECT campaign_id, substr(created_at, 1, 13) AS h, SUM(charged_vnd) AS v FROM spend_dedupe
       WHERE created_at >= ? AND created_at < ?${cf} GROUP BY campaign_id, substr(created_at, 1, 13)`,
      [from, to, ...cp],
    );
    for (const r of led) cell(r.campaign_id, vnDayOfHour(r.h)).ledgerMicro += n(r.v) * MICRO;

    // 4. so sanh
    const found: RevenueDiscrepancy[] = [];
    for (const c of cells.values()) {
      const tol = Math.max(tolAbs, Math.floor(c.impMicro * tolPct));
      if (Math.abs(c.claimMicro - c.impMicro) > tol) {
        found.push({ kind: 'claim_vs_impression', campaign_id: c.campaign, day: c.day, expected_micro: c.impMicro, actual_micro: c.claimMicro, diff_micro: c.claimMicro - c.impMicro, tolerance_micro: tol, impressions_valid: c.impValid });
      }
      // so cai: bo qua ngay khong co claim nao (client cu goi spend khong kem `events`)
      if (c.claims > 0 && c.ledgerMicro > c.claimMicro + tol) {
        found.push({ kind: 'ledger_vs_claim', campaign_id: c.campaign, day: c.day, expected_micro: c.claimMicro, actual_micro: c.ledgerMicro, diff_micro: c.ledgerMicro - c.claimMicro, tolerance_micro: tol, impressions_valid: c.impValid });
      }
    }

    // 5. ghi/ cap nhat; dong cac dong open trong cua so ma khong con lech
    const now = iso(rt);
    const foundKeys = new Set(found.map((f) => `${f.kind}|${f.campaign_id}|${f.day}`));
    let newlyOpened = 0;
    for (const f of found) {
      const prev = (await rt.db.query<{ status: string }>('SELECT status FROM revenue_discrepancies WHERE kind = ? AND campaign_id = ? AND day = ?', [f.kind, f.campaign_id, f.day]))[0];
      await rt.db.run(
        `INSERT INTO revenue_discrepancies (id, kind, campaign_id, day, expected_micro, actual_micro, diff_micro, tolerance_micro, impressions_valid, status, first_seen_at, last_seen_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'open', ?, ?)
         ON CONFLICT (kind, campaign_id, day) DO UPDATE SET
           expected_micro = excluded.expected_micro, actual_micro = excluded.actual_micro, diff_micro = excluded.diff_micro,
           tolerance_micro = excluded.tolerance_micro, impressions_valid = excluded.impressions_valid, last_seen_at = excluded.last_seen_at,
           status = CASE WHEN revenue_discrepancies.status = 'ignored' THEN 'ignored' ELSE 'open' END,
           resolved_at = CASE WHEN revenue_discrepancies.status = 'resolved' THEN NULL ELSE revenue_discrepancies.resolved_at END`,
        [rt.id(), f.kind, f.campaign_id, f.day, f.expected_micro, f.actual_micro, f.diff_micro, f.tolerance_micro, f.impressions_valid, now, now],
      );
      if (!prev || prev.status === 'resolved') newlyOpened++;
    }
    const fromDay = vnDayOfHour(from);
    const toDay = vnDayOfHour(new Date(toMs - 1).toISOString());
    const open = await rt.db.query<{ id: string; kind: string; campaign_id: string; day: string }>(
      `SELECT id, kind, campaign_id, day FROM revenue_discrepancies WHERE status = 'open' AND day >= ? AND day <= ?${cf}`,
      [fromDay, toDay, ...cp],
    );
    let resolved = 0;
    for (const o of open) {
      if (foundKeys.has(`${o.kind}|${o.campaign_id}|${o.day}`)) continue;
      const r = await rt.db.run("UPDATE revenue_discrepancies SET status = 'resolved', resolved_at = ?, note = COALESCE(note, 'tự đóng: đã khớp trong dung sai') WHERE id = ? AND status = 'open'", [now, o.id]);
      resolved += r.changes;
    }

    if (newlyOpened > 0) {
      await audit(rt.db, rt, { actor: opts.actor ?? null, action: 'finance.reconcile.revenue_discrepancy', type: 'ledger', diff: { from, to, opened: newlyOpened, total_open_in_window: found.length, sample: found.slice(0, 20) } });
      await notify(rt.db, rt, { kind: 'reconcile_revenue', title: 'Đối soát doanh thu lệch impression log', body: `${newlyOpened} chênh lệch mới (chiến dịch-ngày), xem revenue_discrepancies.` });
    }
    await rt.db.run("UPDATE reconcile_runs SET status = 'ok', finished_at = ?, checked = ?, found = ?, resolved = ? WHERE id = ?", [iso(rt), cells.size, found.length, resolved, runId]);
    return { run_id: runId, from, to, checked: cells.size, found, resolved };
  } catch (e) {
    await rt.db.run("UPDATE reconcile_runs SET status = 'error', finished_at = ?, error = ? WHERE id = ?", [iso(rt), String((e as Error).message ?? e).slice(0, 500), runId]);
    throw e;
  }
}

export interface DiscrepancyRow {
  id: string; kind: string; campaign_id: string; day: string;
  expected_micro: number; actual_micro: number; diff_micro: number; tolerance_micro: number; impressions_valid: number;
  status: string; first_seen_at: string; last_seen_at: string; resolved_at: string | null; resolved_by: string | null; note: string | null;
}

/** Cho man hinh admin: liet ke chenh lech (mac dinh: dang open), moi nhat truoc. */
export async function listRevenueDiscrepancies(rt: Runtime, o: { status?: 'open' | 'resolved' | 'ignored'; campaignId?: string; limit?: number } = {}): Promise<DiscrepancyRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  where.push('status = ?');
  params.push(o.status ?? 'open');
  if (o.campaignId) {
    where.push('campaign_id = ?');
    params.push(o.campaignId);
  }
  const rows = await rt.db.query<Record<string, unknown>>(
    `SELECT id, kind, campaign_id, day, expected_micro, actual_micro, diff_micro, tolerance_micro, impressions_valid, status, first_seen_at, last_seen_at, resolved_at, resolved_by, note
     FROM revenue_discrepancies WHERE ${where.join(' AND ')} ORDER BY day DESC, campaign_id, kind LIMIT ?`,
    [...params, Math.max(1, Math.min(500, o.limit ?? 100))],
  );
  return rows.map((r) => ({
    id: String(r['id']), kind: String(r['kind']), campaign_id: String(r['campaign_id']), day: String(r['day']),
    expected_micro: n(r['expected_micro']), actual_micro: n(r['actual_micro']), diff_micro: n(r['diff_micro']), tolerance_micro: n(r['tolerance_micro']), impressions_valid: n(r['impressions_valid']),
    status: String(r['status']), first_seen_at: String(r['first_seen_at']), last_seen_at: String(r['last_seen_at']),
    resolved_at: (r['resolved_at'] as string | null) ?? null, resolved_by: (r['resolved_by'] as string | null) ?? null, note: (r['note'] as string | null) ?? null,
  }));
}

/** Nguoi dong/bo qua mot chenh lech (da dieu tra). 'ignored' khong bi job tu mo lai. */
export async function resolveRevenueDiscrepancy(rt: Runtime, id: string, o: { status: 'resolved' | 'ignored'; note: string; actor: string }): Promise<boolean> {
  const r = await rt.db.run(
    "UPDATE revenue_discrepancies SET status = ?, resolved_at = ?, resolved_by = ?, note = ? WHERE id = ? AND status = 'open'",
    [o.status, iso(rt), o.actor, o.note.slice(0, 500), id],
  );
  if (r.changes === 1) await audit(rt.db, rt, { actor: o.actor, action: 'finance.reconcile.revenue_discrepancy_' + o.status, type: 'revenue_discrepancy', id, diff: { note: o.note } });
  return r.changes === 1;
}
