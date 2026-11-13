import type { Db, Runtime } from '@ams/runtime';
import { transitionCampaign } from '@ams/shared';
import { healActivation } from './activation.js';
import { FinanceError, type FundingResult, type SpendResult } from './port.js';
import { applyBalanceAtomic, releaseAtomic, reserveAtomic, spendAtomic } from './reconcile-atomic.js';
import { audit, iso, n, notify, withTx } from './util.js';

/**
 * So cai tien. Quy uoc:
 *  - wallet_entries chi INSERT; amount_vnd luon la so duong TRU kind='adjust' (co dau).
 *  - balance_vnd = tong tien trong vi (gom ca phan dang giu); reserved_vnd = phan dang giu; kha dung = balance - reserved.
 *  - campaigns.reserved_vnd = phan giu CON LAI chua chi cua chien dich; spent_vnd = da chi. Chi tru tu phan giu.
 *  - Khong FOR UPDATE: moi thay doi so du la UPDATE co dieu kien (kiem so dong anh huong / RETURNING) + UNIQUE.
 */

export interface WalletRow {
  balance_vnd: number;
  reserved_vnd: number;
}

export async function ensureWallet(db: Db, rt: Runtime, customerId: string): Promise<void> {
  await db.run(
    'INSERT INTO ad_wallets (customer_id, balance_vnd, reserved_vnd, spent_vnd, updated_at) VALUES (?,0,0,0,?) ON CONFLICT (customer_id) DO NOTHING',
    [customerId, iso(rt)],
  );
}

export async function getWallet(db: Db, customerId: string): Promise<{ balance: number; reserved: number; spent: number; available: number } | null> {
  const r = (await db.query<{ balance_vnd: unknown; reserved_vnd: unknown; spent_vnd: unknown }>(
    'SELECT balance_vnd, reserved_vnd, spent_vnd FROM ad_wallets WHERE customer_id = ?', [customerId]))[0];
  if (!r) return null;
  const balance = n(r.balance_vnd), reserved = n(r.reserved_vnd);
  return { balance, reserved, spent: n(r.spent_vnd), available: balance - reserved };
}

async function entry(
  db: Db, rt: Runtime,
  e: { customerId: string; kind: 'topup' | 'reserve' | 'release' | 'spend' | 'refund' | 'adjust'; amount: number; w: WalletRow; refType?: string; refId?: string; note?: string },
): Promise<string> {
  const id = rt.id();
  await db.run(
    'INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, e.customerId, e.kind, e.amount, e.w.balance_vnd, e.w.reserved_vnd, e.refType ?? null, e.refId ?? null, e.note ?? null, iso(rt)],
  );
  return id;
}

async function walletUpdate(db: Db, sql: string, params: unknown[]): Promise<WalletRow | null> {
  const rows = await db.query<{ balance_vnd: unknown; reserved_vnd: unknown }>(sql + ' RETURNING balance_vnd, reserved_vnd', params);
  const r = rows[0];
  return r ? { balance_vnd: n(r.balance_vnd), reserved_vnd: n(r.reserved_vnd) } : null;
}

/** Cong/tru so du (nap, dieu chinh). amount co dau chi voi 'adjust'. Tru khong duoc lam so du < phan dang giu. */
export async function applyBalance(
  db: Db, rt: Runtime,
  o: { customerId: string; amount: number; kind: 'topup' | 'adjust' | 'refund'; refType?: string; refId?: string; note?: string },
): Promise<WalletRow | null> {
  await ensureWallet(db, rt, o.customerId);
  const delta = o.kind === 'refund' ? -Math.abs(o.amount) : o.amount;
  if (db.interactiveTx === false) {
    // D1: so cai + cache trong MOT batch (khong con cua so giua UPDATE vi va INSERT so cai)
    return applyBalanceAtomic(db, rt, { customerId: o.customerId, delta, kind: o.kind, entryAmount: o.kind === 'refund' ? Math.abs(o.amount) : o.amount, ...(o.refType ? { refType: o.refType } : {}), ...(o.refId ? { refId: o.refId } : {}), ...(o.note ? { note: o.note } : {}) });
  }
  const w = await walletUpdate(
    db,
    'UPDATE ad_wallets SET balance_vnd = balance_vnd + ?, updated_at = ? WHERE customer_id = ? AND balance_vnd + ? >= reserved_vnd',
    [delta, iso(rt), o.customerId, delta],
  );
  if (!w) return null;
  await entry(db, rt, { customerId: o.customerId, kind: o.kind, amount: o.kind === 'refund' ? Math.abs(o.amount) : o.amount, w, ...(o.refType ? { refType: o.refType } : {}), ...(o.refId ? { refId: o.refId } : {}), ...(o.note ? { note: o.note } : {}) });
  return w;
}

/**
 * Ghi co mot lan cho mot topup: chiem (claim) trang thai truoc, roi cong vi, roi ghi so cai.
 * Chay lai bao nhieu lan cung chi cong mot lan (chiem thua -> 'already').
 */
export async function creditTopup(rt: Runtime, dbIn: Db, topupId: string, confirmedBy: string | null): Promise<'credited' | 'already' | 'not_found'> {
  const t = (await dbIn.query<{ customer_id: string; amount_vnd: unknown; status: string; provider: string | null; provider_txn_id: string | null }>(
    'SELECT customer_id, amount_vnd, status, provider, provider_txn_id FROM topups WHERE id = ?', [topupId]))[0];
  if (!t) return 'not_found';
  if (t.status !== 'pending' && t.status !== 'unmatched') {
    // da ghi co: co the lan truoc vi da duoc cong nhung runActivation chua chay/hong (mat dien, loi) -> chay lai (idempotent), khong de chien dich awaiting_funds ket
    if (t.status === 'credited') await healActivation(rt, dbIn, t.customer_id, topupId);
    return 'already';
  }
  // duong TU DONG (webhook/doi soat gui lai) khong bao gio cong topup dang cho nguoi xem ('unmatched'); chi nguoi xac nhan (confirmedBy) moi cong
  if (!confirmedBy && t.status === 'unmatched') return 'already';
  return withTx(dbIn, async (db) => {
    // --- bao ve cong kep (RECONCILIATION.md muc 2) ---
    // (a) mot giao dich ngan hang chi duoc cong mot lan, bat ke duong nao (webhook / doi soat bu / hang doi thu cong): khoa duy nhat claim_key.
    // (b) duong TU DONG (confirmedBy = null) gap khoan nap thu cong cung khach + cung so tien vua duoc nguoi xac nhan: giu lai cho nguoi xem, khong tu cong.
    const path = confirmedBy ? 'manual_confirm' : t.provider_txn_id ? 'auto' : 'auto_no_txn';
    if (!confirmedBy && t.provider_txn_id && t.status === 'pending') {
      const hours = Number(rt.config.env['DOUBLE_CREDIT_WINDOW_HOURS'] ?? 72);
      const since = new Date(rt.clock.now().getTime() - (Number.isFinite(hours) && hours > 0 ? hours : 72) * 3600_000).toISOString();
      const twin = (await db.query<{ id: string }>(
        `SELECT id FROM topups WHERE customer_id = ? AND id <> ? AND status = 'credited' AND provider_txn_id IS NULL AND confirmed_by IS NOT NULL
           AND amount_vnd = ? AND credited_at >= ? LIMIT 1`,
        [t.customer_id, topupId, n(t.amount_vnd), since]))[0];
      if (twin) {
        const held = await db.run("UPDATE topups SET status = 'unmatched', matched_by = 'manual:possible_double_credit' WHERE id = ? AND status = 'pending'", [topupId]);
        if (held.changes === 1) {
          await notify(db, rt, { kind: 'payment_manual_queue', title: 'Nghi cộng kép: khoản nạp trùng khoản đã xác nhận tay', body: `${n(t.amount_vnd)} ₫ · trùng topup ${twin.id}, chờ người xem`, refType: 'topup', refId: topupId });
          await audit(db, rt, { action: 'finance.topup.hold_possible_double_credit', type: 'topup', id: topupId, customer: t.customer_id, diff: { twin_topup_id: twin.id, amount_vnd: n(t.amount_vnd), txn: t.provider_txn_id } });
        }
        return 'already';
      }
    }
    const claimKey = t.provider_txn_id ? `txn:${t.provider ?? ''}:${t.provider_txn_id}` : `topup:${topupId}`;
    const ck = await db.run(
      'INSERT INTO topup_credit_claims (claim_key, topup_id, customer_id, amount_vnd, path, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT (claim_key) DO NOTHING',
      [claimKey, topupId, t.customer_id, n(t.amount_vnd), path, iso(rt)],
    );
    if (ck.changes !== 1) {
      const owner = (await db.query<{ topup_id: string }>('SELECT topup_id FROM topup_credit_claims WHERE claim_key = ?', [claimKey]))[0];
      if (owner && owner.topup_id !== topupId) {
        // giao dich ngan hang nay da duoc cong boi topup khac: khong cong lan hai, dong yeu cau thua
        await db.run("UPDATE topups SET status = 'rejected', matched_by = 'duplicate_txn' WHERE id = ? AND status IN ('pending','unmatched')", [topupId]);
        await audit(db, rt, { action: 'finance.topup.duplicate_txn_blocked', type: 'topup', id: topupId, customer: t.customer_id, diff: { claim_key: claimKey, owner_topup_id: owner.topup_id } });
        return 'already';
      }
      // owner = chinh topup nay: lan truoc dut giua chung (D1), chay tiep (idempotent)
    }
    const claim = await db.run(
      "UPDATE topups SET status = 'credited', credited_at = ?, confirmed_by = COALESCE(?, confirmed_by) WHERE id = ? AND status IN ('pending','unmatched')",
      [iso(rt), confirmedBy, topupId],
    );
    if (claim.changes !== 1) return 'already';
    const w = await applyBalance(db, rt, { customerId: t.customer_id, amount: n(t.amount_vnd), kind: 'topup', refType: 'topup', refId: topupId });
    if (!w) throw new FinanceError('wallet_update_failed', 'Không cập nhật được ví', 500);
    return 'credited';
  });
}

// ---------------------------------------------------------------------------
// Giu / giai phong / chi cho chien dich
// ---------------------------------------------------------------------------

interface CampRow {
  id: string;
  customer_id: string;
  state: string;
  funding_state: string;
  start_at: string | null;
  activate_on_approve: unknown;
  approved_budget_vnd: unknown;
  reserved_vnd: unknown;
  spent_vnd: unknown;
}

const CAMP_COLS = 'id, customer_id, state, funding_state, start_at, activate_on_approve, approved_budget_vnd, reserved_vnd, spent_vnd';

async function loadCampaign(db: Db, id: string): Promise<CampRow> {
  const c = (await db.query<CampRow>(`SELECT ${CAMP_COLS} FROM campaigns WHERE id = ?`, [id]))[0];
  if (!c) throw new FinanceError('campaign_not_found', 'Không tìm thấy chiến dịch', 404);
  return c;
}

function targetState(rt: Runtime, c: CampRow): 'active' | 'scheduled' | 'paused' {
  if (Number(c.activate_on_approve) === 0) return 'paused';
  return !c.start_at || c.start_at <= iso(rt) ? 'active' : 'scheduled';
}

/** Thu giu `amount` cho chien dich. true = da giu; false = khong du kha dung (khong thay doi gi). */
async function tryReserve(db: Db, rt: Runtime, c: CampRow, amount: number): Promise<boolean> {
  await ensureWallet(db, rt, c.customer_id);
  if (db.interactiveTx === false) return reserveAtomic(db, rt, { campaignId: c.id, customerId: c.customer_id, amount, targetState: targetState(rt, c) });
  const w = await walletUpdate(
    db,
    'UPDATE ad_wallets SET reserved_vnd = reserved_vnd + ?, updated_at = ? WHERE customer_id = ? AND balance_vnd - reserved_vnd >= ?',
    [amount, iso(rt), c.customer_id, amount],
  );
  if (!w) return false;
  const st = targetState(rt, c);
  // chuyen trang thai qua module duy nhat (awaiting_funds -> active|scheduled|paused); changes = 0 => da giu roi / da doi trang thai
  const claimed = await transitionCampaign(db, {
    id: c.id, from: 'awaiting_funds', to: st, nowIso: iso(rt), allowNone: true,
    set: { funding_state: 'reserved', reserved_vnd: amount, approved_budget_vnd: amount, approved_at: { sql: 'COALESCE(approved_at, ?)', params: [iso(rt)] } },
    where: { sql: "funding_state <> 'reserved'" },
  });
  const claim = { changes: claimed };
  if (claim.changes !== 1) {
    // dong thoi da giu roi (hoac khong the tai tro): tra lai phan vua giu
    await db.run('UPDATE ad_wallets SET reserved_vnd = reserved_vnd - ?, updated_at = ? WHERE customer_id = ? AND reserved_vnd >= ?', [amount, iso(rt), c.customer_id, amount]);
    return false;
  }
  await entry(db, rt, { customerId: c.customer_id, kind: 'reserve', amount, w, refType: 'campaign', refId: c.id, note: 'Giữ ngân sách chiến dịch' });
  return true;
}

export async function reserveCampaign(rt: Runtime, dbIn: Db, campaignId: string, approvedBudgetVnd: number): Promise<FundingResult> {
  if (!Number.isSafeInteger(approvedBudgetVnd) || approvedBudgetVnd <= 0) throw new FinanceError('invalid_budget', 'Ngân sách duyệt phải là số nguyên dương (đồng)', 422);
  return withTx(dbIn, async (db) => {
    const c = await loadCampaign(db, campaignId);
    if (c.funding_state === 'reserved') {
      // idempotent: da giu, tra trang thai hien tai
      const s = c.state === 'awaiting_funds' ? 'active' : c.state;
      return { state: (['active', 'scheduled', 'paused'].includes(s) ? s : 'active') as FundingResult['state'], shortfall: 0 };
    }
    if (c.state === 'ended' || c.state === 'rejected') throw new FinanceError('campaign_not_fundable', 'Chiến dịch đã kết thúc hoặc bị từ chối', 409);
    if (c.state !== 'awaiting_funds') throw new FinanceError('invalid_state', 'Chỉ giữ tiền được cho chiến dịch đã duyệt (đang chờ nạp tiền)', 409);
    if (await tryReserve(db, rt, c, approvedBudgetVnd)) return { state: targetState(rt, c), shortfall: 0 };
    const w = (await getWallet(db, c.customer_id))!;
    // state da la awaiting_funds (kiem o tren): chi ghi tien/funding_state, KHONG doi state
    await db.run(
      `UPDATE campaigns SET funding_state = 'awaiting_funds', approved_budget_vnd = ?, approved_at = COALESCE(approved_at, ?), updated_at = ?
       WHERE id = ? AND state = 'awaiting_funds' AND funding_state <> 'reserved'`,
      [approvedBudgetVnd, iso(rt), iso(rt), campaignId],
    );
    const shortfall = Math.max(0, approvedBudgetVnd - w.available);
    await notify(db, rt, { customer: c.customer_id, kind: 'campaign_awaiting_funds', title: 'Chiến dịch chờ nạp tiền', body: `Còn thiếu ${shortfall} ₫ để chạy chiến dịch.`, refType: 'campaign', refId: campaignId });
    return { state: 'awaiting_funds', shortfall };
  });
}

export async function releaseCampaign(rt: Runtime, dbIn: Db, campaignId: string): Promise<{ released: number }> {
  return withTx(dbIn, async (db) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const c = await loadCampaign(db, campaignId);
      if (c.funding_state === 'awaiting_funds') {
        await db.run("UPDATE campaigns SET funding_state = 'released', updated_at = ? WHERE id = ? AND funding_state = 'awaiting_funds'", [iso(rt), campaignId]);
        return { released: 0 };
      }
      if (c.funding_state !== 'reserved') return { released: 0 };
      const amt = n(c.reserved_vnd);
      if (db.interactiveTx === false) {
        const r = await releaseAtomic(db, rt, { campaignId, customerId: c.customer_id, amount: amt });
        if (r === 'inconsistent') throw new FinanceError('wallet_inconsistent', 'Số tiền giữ của ví không khớp chiến dịch', 500);
        if (r === 'retry') continue;
        if (amt > 0) await runAwaitingFunds(db, rt, c.customer_id, null);
        return { released: amt };
      }
      const claim = await db.run(
        "UPDATE campaigns SET reserved_vnd = 0, funding_state = 'released', updated_at = ? WHERE id = ? AND funding_state = 'reserved' AND reserved_vnd = ?",
        [iso(rt), campaignId, amt],
      );
      if (claim.changes !== 1) continue; // co chi tieu dong thoi: doc lai
      if (amt > 0) {
        const w = await walletUpdate(db, 'UPDATE ad_wallets SET reserved_vnd = reserved_vnd - ?, updated_at = ? WHERE customer_id = ? AND reserved_vnd >= ?', [amt, iso(rt), c.customer_id, amt]);
        if (!w) throw new FinanceError('wallet_inconsistent', 'Số tiền giữ của ví không khớp chiến dịch', 500);
        await entry(db, rt, { customerId: c.customer_id, kind: 'release', amount: amt, w, refType: 'campaign', refId: campaignId, note: 'Hoàn phần giữ chưa dùng' });
        await runAwaitingFunds(db, rt, c.customer_id, null); // tien vua giai phong co the cap cho chien dich dang cho
      }
      return { released: amt };
    }
    throw new FinanceError('release_contention', 'Không giải phóng được do tranh chấp, thử lại', 409);
  });
}

export async function spendCampaign(rt: Runtime, dbIn: Db, campaignId: string, amountVnd: number, ref?: { type: string; id: string }): Promise<SpendResult> {
  if (!Number.isSafeInteger(amountVnd) || amountVnd <= 0) throw new FinanceError('invalid_amount', 'Số tiền chi phải là số nguyên dương (đồng)', 422);
  return withTx(dbIn, async (db) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const c = await loadCampaign(db, campaignId);
      const remaining = c.funding_state === 'reserved' ? n(c.reserved_vnd) : 0;
      const amt = Math.min(amountVnd, remaining);
      if (amt <= 0) return { charged: 0, rejected: amountVnd, remaining, exhausted: remaining === 0 };
      let left: number;
      if (db.interactiveTx === false) {
        // D1: mot batch nguyen tu (so cai + chien dich + vi); khong con cua so "chien dich da tru, vi chua tru"
        const r = await spendAtomic(db, rt, { campaignId, customerId: c.customer_id, amount: amt, refType: ref?.type ?? 'campaign', refId: ref?.id ?? campaignId });
        if (!r.ok) {
          if (r.inconsistent) throw new FinanceError('wallet_inconsistent', 'Số tiền giữ của ví không khớp chiến dịch', 500);
          continue; // co chi tieu dong thoi: doc lai
        }
        left = r.left;
      } else {
        const claim = await db.query<{ reserved_vnd: unknown }>(
          "UPDATE campaigns SET reserved_vnd = reserved_vnd - ?, spent_vnd = spent_vnd + ?, updated_at = ? WHERE id = ? AND funding_state = 'reserved' AND reserved_vnd >= ? RETURNING reserved_vnd",
          [amt, amt, iso(rt), campaignId, amt],
        );
        if (!claim[0]) continue;
        left = n(claim[0].reserved_vnd); // con lai chinh xac sau khi tru (khong dung gia tri doc cu khi co chi tieu dong thoi)
        const w = await walletUpdate(
          db,
          'UPDATE ad_wallets SET balance_vnd = balance_vnd - ?, reserved_vnd = reserved_vnd - ?, spent_vnd = spent_vnd + ?, updated_at = ? WHERE customer_id = ? AND reserved_vnd >= ? AND balance_vnd >= ?',
          [amt, amt, amt, iso(rt), c.customer_id, amt, amt],
        );
        if (!w) {
          await db.run('UPDATE campaigns SET reserved_vnd = reserved_vnd + ?, spent_vnd = spent_vnd - ? WHERE id = ?', [amt, amt, campaignId]);
          throw new FinanceError('wallet_inconsistent', 'Số tiền giữ của ví không khớp chiến dịch', 500);
        }
        await entry(db, rt, { customerId: c.customer_id, kind: 'spend', amount: amt, w, refType: ref?.type ?? 'campaign', refId: ref?.id ?? campaignId, note: 'Chi phát quảng cáo' });
      }
      let exhausted = false;
      if (left === 0) {
        const stopped = await transitionCampaign(db, {
          id: campaignId, from: ['scheduled', 'active', 'paused'], to: 'ended', nowIso: iso(rt), allowNone: true,
          set: { funding_state: 'released' }, where: { sql: "funding_state = 'reserved' AND reserved_vnd = 0" },
        });
        exhausted = stopped === 1;
        if (exhausted) {
          await notify(db, rt, { customer: c.customer_id, kind: 'budget_exhausted', title: 'Chiến dịch hết ngân sách và đã dừng', refType: 'campaign', refId: campaignId });
          await audit(db, rt, { action: 'finance.campaign.budget_exhausted', type: 'campaign', id: campaignId, customer: c.customer_id });
        }
      }
      return { charged: amt, rejected: amountVnd - amt, remaining: left, exhausted };
    }
    throw new FinanceError('spend_contention', 'Tranh chấp khi trừ tiền, thử lại', 409);
  });
}

/**
 * Tu chay: chien dich awaiting_funds duoc giu tien THEO THU TU DUYET (approved_at, created_at, id).
 * Dung o chien dich dau tien khong du tien (khong nhay coc de khong bo doi chien dich lon hon da duyet truoc).
 */
export async function runAwaitingFunds(
  db: Db, rt: Runtime, customerId: string, triggerTopupId: string | null,
): Promise<{ campaign_id: string; state: string; reserved_vnd: number }[]> {
  const out: { campaign_id: string; state: string; reserved_vnd: number }[] = [];
  const rows = await db.query<CampRow>(
    `SELECT ${CAMP_COLS} FROM campaigns WHERE customer_id = ? AND funding_state = 'awaiting_funds' AND state = 'awaiting_funds'
     ORDER BY approved_at ASC, created_at ASC, id ASC`,
    [customerId],
  );
  for (const c of rows) {
    const amt = n(c.approved_budget_vnd);
    if (amt <= 0) continue;
    if (!(await tryReserve(db, rt, c, amt))) break;
    out.push({ campaign_id: c.id, state: targetState(rt, c), reserved_vnd: amt });
    await notify(db, rt, { customer: customerId, kind: 'campaign_autorun', title: 'Chiến dịch đã được giữ ngân sách và tự chạy', refType: 'campaign', refId: c.id });
  }
  if (out.length) await audit(db, rt, { action: 'finance.campaign.autorun', type: 'customer', id: customerId, customer: customerId, diff: { trigger_topup_id: triggerTopupId, campaigns: out } });
  return out;
}
