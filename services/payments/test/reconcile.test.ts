import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, TestRuntime } from '@ams/runtime';
import {
  createFinanceCore, createSpendFn, creditTopup, listRevenueDiscrepancies, reconcileLedger, reconcileRevenue, reconcileSepayWindow,
  repairLedgerDrift, resolveRevenueDiscrepancy, runDailyFinanceJobs,
} from '../src/index.js';
import { campaign, mkApp, mkCampaign, mkCustomer, mkRt, NOW, sign, wallet, webhookBody } from './helpers.js';

/** Mo phong D1: tx khong rollback, cau lenh cua cac yeu cau xen ke (batch van nguyen tu vi chay tren giao dich cua engine nen). */
function d1Like(inner: Db): Db {
  const d: Db = { dialect: inner.dialect, interactiveTx: false, query: (s, p) => inner.query(s, p), run: (s, p) => inner.run(s, p), batch: (st) => inner.batch(st), tx: (fn) => fn(d) };
  return d;
}

const DAY_TS = '2026-11-11T05:00:00.000Z'; // 12:00 ngay 11/11 gio VN (da ket thuc so voi NOW = 12/11 10:00 VN)
const DAY = '2026-11-11';

/** Dua impression qua dung duong that cua consumer: spend (chiem event) truoc, append (impression_hourly) sau. */
async function feed(rt: TestRuntime, camp: string, cust: string, evs: { id: string; micro: number; ts?: string }[], key: string): Promise<void> {
  const ts0 = evs[0]?.ts ?? DAY_TS;
  const prev = rt.clock.now();
  rt.clock.set(ts0);
  await createSpendFn(rt)({ campaignId: camp, customerId: cust, amountMicroVnd: evs.reduce((s, e) => s + e.micro, 0), impressions: evs.length, idempotencyKey: key, firstTs: ts0, lastTs: ts0, events: evs.map((e) => ({ id: e.id, micro: e.micro })) });
  await rt.events.append('ad_impression', evs.map((e) => ({ ts: e.ts ?? DAY_TS, event_id: e.id, campaign_id: camp, partner_id: 'P1', region_id: 'R1', valid: 1, revenue_micro_vnd: e.micro })));
  rt.clock.set(prev);
}

async function setup(rt: TestRuntime, tag: string, budget = 5_000_000): Promise<{ cust: string; camp: string }> {
  const cust = await mkCustomer(rt, tag, { balance: budget * 2 });
  const camp = await mkCampaign(rt, cust, budget);
  await createFinanceCore(rt).reserveForCampaign(camp, budget);
  return { cust, camp };
}

for (const mode of ['postgres', 'sqlite', 'd1sim'] as const) {
  describe(`doi soat doanh thu vs impression log [${mode}]`, () => {
    let rt: TestRuntime;
    let base: TestRuntime;
    beforeAll(async () => {
      base = await mkRt(mode === 'postgres' ? 'postgres' : 'sqlite');
      rt = mode === 'd1sim' ? ({ ...base, db: d1Like(base.db) } as TestRuntime) : base;
    });
    afterAll(async () => base.close());

    it('du lieu di qua pipeline that: khop tuyet doi, khong co chenh lech', async () => {
      const { cust, camp } = await setup(rt, 'RV1' + mode.slice(0, 2).toUpperCase());
      await feed(rt, camp, cust, [{ id: `${camp}-e1`, micro: 400_000 }, { id: `${camp}-e2`, micro: 700_000 }, { id: `${camp}-e3`, micro: 2_500_000 }], `${camp}-b1`);
      const r = await reconcileRevenue(rt, { campaignId: camp });
      expect(r.checked).toBeGreaterThan(0);
      expect(r.found).toEqual([]);
      expect(await listRevenueDiscrepancies(rt, { campaignId: camp })).toEqual([]);
      const run = (await rt.db.query<{ status: string }>("SELECT status FROM reconcile_runs WHERE id = ?", [r.run_id]))[0]!;
      expect(run.status).toBe('ok');
    });

    it('inject: thieu claim (co impression, khong tru tien) -> thu thieu, roi tu dong dong khi vá', async () => {
      const { cust, camp } = await setup(rt, 'RV2' + mode.slice(0, 2).toUpperCase());
      await feed(rt, camp, cust, [{ id: `${camp}-e1`, micro: 3_000_000 }, { id: `${camp}-e2`, micro: 3_000_000 }], `${camp}-b1`);
      await rt.db.run('DELETE FROM spend_events WHERE event_id = ?', [`${camp}-e2`]);
      const r = await reconcileRevenue(rt, { campaignId: camp });
      // thieu claim: thu thieu so voi impression; dong thoi so cai (da ghi 6 VND theo lo) > claim con lai (3 VND) nen ledger_vs_claim cung bao thu thua
      expect(r.found.map((f) => f.kind).sort()).toEqual(['claim_vs_impression', 'ledger_vs_claim']);
      expect(r.found.find((f) => f.kind === 'claim_vs_impression')).toMatchObject({ campaign_id: camp, day: DAY, expected_micro: 6_000_000, actual_micro: 3_000_000, diff_micro: -3_000_000 });
      const open = await listRevenueDiscrepancies(rt, { campaignId: camp });
      expect(open).toHaveLength(2);
      expect(open.every((o) => o.status === 'open')).toBe(true);
      // chay lai: khong nhan doi dong (UNIQUE)
      await reconcileRevenue(rt, { campaignId: camp });
      expect(await rt.db.query('SELECT 1 FROM revenue_discrepancies WHERE campaign_id = ?', [camp])).toHaveLength(2);
      // va lai claim -> lan chay sau tu dong dong
      await rt.db.run('INSERT INTO spend_events (event_id, campaign_id, amount_micro_vnd, claim, created_at) VALUES (?,?,?,?,?)', [`${camp}-e2`, camp, 3_000_000, 'fix', DAY_TS]);
      const r2 = await reconcileRevenue(rt, { campaignId: camp });
      expect(r2.found).toEqual([]);
      expect(r2.resolved).toBe(2);
      expect(await listRevenueDiscrepancies(rt, { campaignId: camp })).toEqual([]);
      expect(await listRevenueDiscrepancies(rt, { campaignId: camp, status: 'resolved' })).toHaveLength(2);
    });

    it('inject: thu thua (claim khong co impression) + impression thua; dung sai: lech nho khong ghi', async () => {
      const { cust, camp } = await setup(rt, 'RV3' + mode.slice(0, 2).toUpperCase());
      await feed(rt, camp, cust, [{ id: `${camp}-e1`, micro: 10_000_000 }], `${camp}-b1`);
      // claim mo coi 2 VND (khong co dong impression)
      await rt.db.run('INSERT INTO spend_events (event_id, campaign_id, amount_micro_vnd, claim, created_at) VALUES (?,?,?,?,?)', [`${camp}-ghost`, camp, 2_000_000, 'x', DAY_TS]);
      let r = await reconcileRevenue(rt, { campaignId: camp });
      expect(r.found).toHaveLength(1);
      expect(r.found[0]).toMatchObject({ kind: 'claim_vs_impression', diff_micro: 2_000_000 });
      // dung sai: nang tolerance len 3 VND -> het bao, dong da open tu dong resolved
      r = await reconcileRevenue(rt, { campaignId: camp, toleranceAbsMicro: 3_000_000, tolerancePct: 0 });
      expect(r.found).toEqual([]);
      expect(r.resolved).toBe(1);
      // lech 0,5 VND nho hon dung sai mac dinh 1 VND
      await rt.db.run('DELETE FROM spend_events WHERE event_id = ?', [`${camp}-ghost`]);
      await rt.db.run('UPDATE impression_hourly SET revenue_micro_vnd = revenue_micro_vnd + 500000 WHERE campaign_id = ?', [camp]);
      expect((await reconcileRevenue(rt, { campaignId: camp })).found).toEqual([]);
      // impression_hourly cao hon 5 VND (ghi doanh thu ma khong tru tien) -> bao
      await rt.db.run('UPDATE impression_hourly SET revenue_micro_vnd = revenue_micro_vnd + 5000000 WHERE campaign_id = ?', [camp]);
      const r3 = await reconcileRevenue(rt, { campaignId: camp });
      expect(r3.found.map((f) => [f.kind, f.diff_micro < 0])).toEqual([['claim_vs_impression', true]]);
    });

    it('inject: so cai thu thua so voi claim (ledger_vs_claim); admin bo qua thi job khong mo lai', async () => {
      const { cust, camp } = await setup(rt, 'RV4' + mode.slice(0, 2).toUpperCase());
      await feed(rt, camp, cust, [{ id: `${camp}-e1`, micro: 2_000_000 }], `${camp}-b1`);
      expect((await reconcileRevenue(rt, { campaignId: camp })).found).toEqual([]);
      await rt.db.run('UPDATE spend_dedupe SET charged_vnd = 9 WHERE campaign_id = ?', [camp]);
      const r = await reconcileRevenue(rt, { campaignId: camp });
      expect(r.found).toHaveLength(1);
      expect(r.found[0]).toMatchObject({ kind: 'ledger_vs_claim', expected_micro: 2_000_000, actual_micro: 9_000_000 });
      const row = (await listRevenueDiscrepancies(rt, { campaignId: camp }))[0]!;
      expect(await resolveRevenueDiscrepancy(rt, row.id, { status: 'ignored', note: 'da dieu tra', actor: 'F1' })).toBe(true);
      expect(await resolveRevenueDiscrepancy(rt, row.id, { status: 'resolved', note: 'x', actor: 'F1' })).toBe(false); // da dong
      await reconcileRevenue(rt, { campaignId: camp });
      expect(await listRevenueDiscrepancies(rt, { campaignId: camp })).toEqual([]);
      expect(await listRevenueDiscrepancies(rt, { campaignId: camp, status: 'ignored' })).toHaveLength(1);
    });

    it('khong xet ngay chua ket thuc (su kien dang bay) va runDailyFinanceJobs co chay doi soat', async () => {
      const { cust, camp } = await setup(rt, 'RV5' + mode.slice(0, 2).toUpperCase());
      const today = '2026-11-12T02:00:00.000Z'; // hom nay (VN), chua ket thuc
      await feed(rt, camp, cust, [{ id: `${camp}-e1`, micro: 5_000_000, ts: today }], `${camp}-b1`);
      await rt.db.run('DELETE FROM spend_events WHERE event_id = ?', [`${camp}-e1`]);
      expect((await reconcileRevenue(rt, { campaignId: camp })).found).toEqual([]);
      const d = await runDailyFinanceJobs(rt);
      expect(d.revenue).toBeDefined();
      expect(d.repair).toBeDefined();
    });
  });
}

for (const dialect of ['sqlite', 'postgres'] as const) {
  describe(`cong tien kep qua nhieu duong [${dialect}]`, () => {
    let rt: TestRuntime;
    beforeAll(async () => {
      rt = await mkRt(dialect);
    });
    afterAll(async () => rt.close());

    const mkTopup = async (cust: string, amount: number, o: { txn?: string | null; status?: string; by?: string | null; creditedAt?: string } = {}): Promise<string> => {
      const id = rt.id();
      await rt.db.run(
        "INSERT INTO topups (id, code, customer_id, amount_vnd, method, provider, provider_txn_id, status, confirmed_by, requested_at, credited_at) VALUES (?,?,?,?, 'bank_transfer', ?, ?, ?, ?, ?, ?)",
        [id, 'NAP-' + id.slice(-8), cust, amount, o.txn ? 'sepay' : null, o.txn ?? null, o.status ?? 'pending', o.by ?? null, NOW, o.creditedAt ?? null],
      );
      return id;
    };

    it('cung ma giao dich ngan hang o hai topup (hai duong): chi cong mot lan, topup thu hai bi dong', async () => {
      const cust = await mkCustomer(rt, 'DC1');
      const a = await mkTopup(cust, 3_000_000, { txn: 'BANK-1' });
      expect(await creditTopup(rt, rt.db, a, null)).toBe('credited');
      // mo phong duong khac chen duoc mot dong cung giao dich (khac provider_txn_id chuoi nhung cung claim_key) -> khoa claim chan
      const b = rt.id();
      await rt.db.run("INSERT INTO topups (id, code, customer_id, amount_vnd, method, provider, provider_txn_id, status, requested_at) VALUES (?,?,?,?, 'bank_transfer', 'sepay', ?, 'unmatched', ?)", [b, 'NAP-B' + b.slice(-6), cust, 3_000_000, 'BANK-1x', NOW]);
      await rt.db.run("UPDATE topup_credit_claims SET claim_key = 'txn:sepay:BANK-1x' WHERE topup_id = ?", [a]); // gia lap: topup a da chiem khoa cua giao dich nay
      expect(await creditTopup(rt, rt.db, b, 'ADMIN1')).toBe('already');
      expect((await wallet(rt, cust)).balance).toBe(3_000_000);
      expect((await rt.db.query<{ status: string }>('SELECT status FROM topups WHERE id = ?', [b]))[0]!.status).toBe('rejected');
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    });

    it('confirm tay roi webhook cung khach + cung so tien: webhook bi giu lai, khong cong lan hai; nguoi xem xac nhan thi moi cong', async () => {
      const { app } = mkApp(rt);
      const cust = await mkCustomer(rt, 'DC2');
      const manual = await mkTopup(cust, 7_000_000); // khach tao QR, chua co ma giao dich
      expect(await creditTopup(rt, rt.db, manual, 'ADMIN1')).toBe('credited'); // admin xac nhan tay
      expect((await wallet(rt, cust)).balance).toBe(7_000_000);
      const body = webhookBody({ id: 770001, amount: 7_000_000, content: 'AMS DC2' });
      expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: await sign(rt, body) })).status).toBe(200);
      expect((await wallet(rt, cust)).balance).toBe(7_000_000); // khong cong kep
      const held = (await rt.db.query<{ id: string; status: string; matched_by: string }>("SELECT id, status, matched_by FROM topups WHERE provider_txn_id = '770001'"))[0]!;
      expect(held).toMatchObject({ status: 'unmatched', matched_by: 'manual:possible_double_credit' });
      // gui lai cung webhook: van khong cong
      expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: await sign(rt, body) })).status).toBe(200);
      expect((await wallet(rt, cust)).balance).toBe(7_000_000);
      // nguoi xem xac nhan day la khoan thu hai that
      expect(await creditTopup(rt, rt.db, held.id, 'ADMIN2')).toBe('credited');
      expect(await creditTopup(rt, rt.db, held.id, 'ADMIN2')).toBe('already');
      expect((await wallet(rt, cust)).balance).toBe(14_000_000);
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    });

    it('credit lien tuc dong thoi cung topup: mot lan', async () => {
      const cust = await mkCustomer(rt, 'DC3');
      const t = await mkTopup(cust, 1_000_000, { txn: 'BANK-3' });
      const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => creditTopup(rt, rt.db, t, i % 2 ? 'A' : null)));
      expect(rs.filter((r) => r === 'credited')).toHaveLength(1);
      expect((await wallet(rt, cust)).balance).toBe(1_000_000);
    });
  });
}

describe('doi soat SePay cua so dai + phan trang [sqlite]', () => {
  let rt: TestRuntime;
  beforeAll(async () => {
    rt = await mkRt('sqlite');
  });
  afterAll(async () => rt.close());

  const tx = (id: number, amount: number, code: string, whenMs: number) => ({ id, gateway: 'MBBank', transactionDate: new Date(whenMs).toISOString(), accountNumber: '0123456789', content: `AMS ${code}`, transferType: 'in', transferAmount: amount, referenceCode: 'FT' + id });

  it('lay giao dich cach 5 ngay (ngoai 48h cu), phan trang nhieu trang, chay lai khong cong kep', async () => {
    const cust = await mkCustomer(rt, 'SPW');
    const now = rt.clock.now().getTime();
    const all = [
      ...Array.from({ length: 5 }, (_, i) => tx(5000 + i, 1_000_000, 'SPW', now - 5 * 86_400_000 + i * 60_000)), // 5 ngay truoc
      tx(5100, 2_000_000, 'SPW', now - 3_600_000), // 1 gio truoc
    ];
    const calls: { page: number; sinceIso: string; untilIso: string; limit: number }[] = [];
    const fetchPage = async (q: { page: number; sinceIso: string; untilIso: string; limit: number }) => {
      calls.push(q);
      const inWin = all.filter((t) => Date.parse(t.transactionDate) >= Date.parse(q.sinceIso) && Date.parse(t.transactionDate) < Date.parse(q.untilIso));
      return inWin.slice((q.page - 1) * q.limit, q.page * q.limit);
    };
    const r = await reconcileSepayWindow(rt, fetchPage, { lookbackHours: 7 * 24, pageSize: 2, sliceHours: 24 });
    expect(r).toMatchObject({ checked: 6, credited: 6, errors: 0, truncated: false });
    expect(r.pages).toBeGreaterThan(r.slices); // co phan trang: lat cat 5 ngay truoc co 5 giao dich => 3 trang
    expect((await wallet(rt, cust)).balance).toBe(5 * 1_000_000 + 2_000_000);
    const again = await reconcileSepayWindow(rt, fetchPage, { lookbackHours: 7 * 24, pageSize: 2 });
    expect(again).toMatchObject({ credited: 0, skipped: 6 });
    expect((await wallet(rt, cust)).balance).toBe(7_000_000);
    // cua so 48h cu khong thay giao dich 5 ngay truoc
    const w48 = await reconcileSepayWindow(rt, fetchPage, { lookbackHours: 48 });
    expect(w48.checked).toBe(1);
  });

  it('API bo qua tham so page: khong lap vo han; tran so trang danh dau truncated', async () => {
    await mkCustomer(rt, 'SPL');
    const now = rt.clock.now().getTime();
    const page1 = [tx(6000, 1, 'SPL', now - 1000), tx(6001, 1, 'SPL', now - 900)];
    let calls = 0;
    const r = await reconcileSepayWindow(rt, async () => (calls++, page1), { lookbackHours: 1, pageSize: 2, sliceHours: 24 });
    expect(r.pages).toBeLessThanOrEqual(2);
    expect(r.checked).toBe(2);
    expect(calls).toBeLessThanOrEqual(2);
    const t = await reconcileSepayWindow(rt, async (q) => Array.from({ length: q.limit }, (_, i) => tx(7000 + q.page * 100 + i, 1, 'SPL', now - 500)), { lookbackHours: 1, pageSize: 3, maxPagesPerSlice: 2 });
    expect(t.truncated).toBe(true);
  });
});

for (const mode of ['sqlite', 'd1sim', 'postgres'] as const) {
  describe(`D1: thao tac tien nguyen tu qua batch + sweeper sua lech [${mode}]`, () => {
    let rt: TestRuntime;
    let base: TestRuntime;
    beforeAll(async () => {
      base = await mkRt(mode === 'postgres' ? 'postgres' : 'sqlite');
      rt = mode === 'd1sim' ? ({ ...base, db: d1Like(base.db) } as TestRuntime) : base;
    });
    afterAll(async () => base.close());

    it('reserve -> spend -> release nhat quan (so cai khop cache, doi soat sach)', async () => {
      const port = createFinanceCore(rt);
      const cust = await mkCustomer(rt, 'AT1' + mode.slice(0, 2).toUpperCase(), { balance: 20_000_000 });
      const camp = await mkCampaign(rt, cust, 10_000_000);
      expect((await port.reserveForCampaign(camp, 10_000_000)).state).toBe('active');
      expect((await port.reserveForCampaign(camp, 10_000_000)).state).toBe('active'); // idempotent
      expect(await wallet(rt, cust)).toEqual({ balance: 20_000_000, reserved: 10_000_000, spent: 0 });
      const s = await port.spendForCampaign(camp, 4_000_000);
      expect(s).toMatchObject({ charged: 4_000_000, remaining: 6_000_000, exhausted: false });
      expect((await port.spendForCampaign(camp, 9_000_000))).toMatchObject({ charged: 6_000_000, rejected: 3_000_000, exhausted: true });
      expect(await campaign(rt, camp)).toMatchObject({ state: 'ended', reserved: 0, spent: 10_000_000 });
      expect(await wallet(rt, cust)).toEqual({ balance: 10_000_000, reserved: 0, spent: 10_000_000 });
      const camp2 = await mkCampaign(rt, cust, 5_000_000);
      await port.reserveForCampaign(camp2, 5_000_000);
      expect(await port.releaseForCampaign(camp2)).toEqual({ released: 5_000_000 });
      expect(await port.releaseForCampaign(camp2)).toEqual({ released: 0 });
      expect(await wallet(rt, cust)).toEqual({ balance: 10_000_000, reserved: 0, spent: 10_000_000 });
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    });

    it('khong du tien: reserve that bai khong de lai dau vet (khong so cai mo coi, khong doi trang thai)', async () => {
      const port = createFinanceCore(rt);
      const cust = await mkCustomer(rt, 'AT2' + mode.slice(0, 2).toUpperCase(), { balance: 1_000_000 });
      const camp = await mkCampaign(rt, cust, 5_000_000);
      expect((await port.reserveForCampaign(camp, 5_000_000)).state).toBe('awaiting_funds');
      expect(await wallet(rt, cust)).toEqual({ balance: 1_000_000, reserved: 0, spent: 0 });
      expect((await rt.db.query("SELECT 1 FROM wallet_entries WHERE kind = 'reserve' AND customer_id = ?", [cust]))).toHaveLength(0);
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    });

    it('sweeper: phat lai topup credited thieu so cai; ket thuc chien dich het tien bi dut; dua phan giu cache ve chien dich; chi bao cao lech balance', async () => {
      const port = createFinanceCore(rt);
      const cust = await mkCustomer(rt, 'AT3' + mode.slice(0, 2).toUpperCase(), { balance: 10_000_000 });
      const camp = await mkCampaign(rt, cust, 4_000_000);
      await port.reserveForCampaign(camp, 4_000_000);
      // (1) topup da credited, nhung dut truoc khi cong vi
      const tid = rt.id();
      await rt.db.run("INSERT INTO topups (id, code, customer_id, amount_vnd, method, provider, provider_txn_id, status, requested_at, credited_at) VALUES (?,?,?,?, 'bank_transfer','sepay',?, 'credited', ?, ?)", [tid, 'NAP-' + tid.slice(-8), cust, 2_500_000, 'ORPH-' + tid, NOW, '2026-11-12T00:00:00.000Z']);
      // (2) chien dich het tien nhung chua chuyen 'ended' (dut sau lan chi cuoi)
      await rt.db.run("UPDATE campaigns SET reserved_vnd = 0, spent_vnd = 4000000, updated_at = '2026-11-12T00:00:00.000Z' WHERE id = ?", [camp]);
      await rt.db.run('UPDATE ad_wallets SET reserved_vnd = 0, balance_vnd = balance_vnd - 4000000, spent_vnd = 4000000, updated_at = ? WHERE customer_id = ?', ['2026-11-12T00:00:00.000Z', cust]);
      await rt.db.run("INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, created_at) VALUES (?,?, 'spend', 4000000, 6000000, 0, 'campaign', ?, ?)", [rt.id(), cust, camp, NOW]);
      await rt.db.run("INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, created_at) VALUES (?,?, 'release', 0, 6000000, 0, 'seed', NULL, ?)", [rt.id(), cust, NOW]).catch(() => undefined);
      const before = await reconcileLedger(rt);
      expect(before.mismatches.length).toBeGreaterThan(0);

      const dry = await repairLedgerDrift(rt, { dryRun: true });
      expect(dry.actions.some((a) => a.type === 'replay_topup_credit' && a.topup_id === tid && !a.applied)).toBe(true);
      expect((await wallet(rt, cust)).balance).toBe(6_000_000); // dry-run khong ghi

      const r = await repairLedgerDrift(rt);
      const mine = r.actions.filter((a) => a.customer_id === cust);
      expect(mine.find((a) => a.type === 'replay_topup_credit')).toMatchObject({ topup_id: tid, applied: true });
      expect(mine.find((a) => a.type === 'finish_exhausted_campaign')).toMatchObject({ campaign_id: camp, applied: true });
      expect(await campaign(rt, camp)).toMatchObject({ state: 'ended', funding: 'released' });
      expect((await wallet(rt, cust)).balance).toBe(8_500_000);
      // chay lai: idempotent, khong cong lan hai
      const r2 = await repairLedgerDrift(rt);
      expect(r2.actions.filter((a) => a.customer_id === cust && a.applied)).toEqual([]);
      expect((await wallet(rt, cust)).balance).toBe(8_500_000);

      // (3) cache giu lech so voi chien dich dang giu: dua ve chien dich (CAS)
      const c2 = await mkCampaign(rt, cust, 1_000_000);
      await port.reserveForCampaign(c2, 1_000_000);
      await rt.db.run("UPDATE ad_wallets SET reserved_vnd = 3000000, updated_at = '2026-11-12T00:00:00.000Z' WHERE customer_id = ?", [cust]);
      const r3 = await repairLedgerDrift(rt);
      expect(r3.actions.find((a) => a.customer_id === cust && a.type === 'wallet_reserved_to_campaign_hold')).toMatchObject({ before: 3_000_000, after: 1_000_000, applied: true });
      expect((await wallet(rt, cust)).reserved).toBe(1_000_000);
      // (4) balance cache lech so cai: chi bao cao mac dinh, sua khi bat co
      await rt.db.run("UPDATE ad_wallets SET balance_vnd = balance_vnd + 123, updated_at = '2026-11-12T00:00:00.000Z' WHERE customer_id = ?", [cust]);
      const r4 = await repairLedgerDrift(rt);
      expect(r4.actions.find((a) => a.customer_id === cust && a.field === 'balance')).toMatchObject({ type: 'ledger_drift_reported', applied: false });
      const r5 = await repairLedgerDrift(rt, { fixCacheFromLedger: true });
      expect(r5.actions.find((a) => a.customer_id === cust && a.field === 'balance')).toMatchObject({ type: 'wallet_cache_from_ledger', applied: true });
      expect((await wallet(rt, cust)).balance).toBe(8_500_000);
    });

    it('sweeper khong dung vao vi vua duoc cap nhat (minAgeSec)', async () => {
      const cust = await mkCustomer(rt, 'AT4' + mode.slice(0, 2).toUpperCase(), { balance: 1_000_000 });
      await rt.db.run('UPDATE ad_wallets SET balance_vnd = 999, updated_at = ? WHERE customer_id = ?', [rt.clock.now().toISOString(), cust]);
      const r = await repairLedgerDrift(rt, { fixCacheFromLedger: true });
      expect(r.actions.filter((a) => a.customer_id === cust)).toEqual([]);
    });
  });
}

describe('D1 mo phong: dong thoi tren duong atomic [sqlite]', () => {
  let rt: TestRuntime;
  let base: TestRuntime;
  beforeAll(async () => {
    base = await mkRt('sqlite');
    rt = { ...base, db: d1Like(base.db) } as TestRuntime;
  });
  afterAll(async () => base.close());

  it('reserve/spend/release dong thoi khong vuot so du, so cai luon khop', async () => {
    const port = createFinanceCore(rt);
    const cust = await mkCustomer(rt, 'ATC', { balance: 50_000_000 });
    const ids = await Promise.all(Array.from({ length: 8 }, () => mkCampaign(rt, cust, 10_000_000)));
    const res = await Promise.all(ids.map((i) => port.reserveForCampaign(i, 10_000_000)));
    expect(res.filter((r) => r.state === 'active')).toHaveLength(5);
    const funded = ids.filter((_, i) => res[i]!.state === 'active');
    await Promise.all(funded.flatMap((c) => [port.spendForCampaign(c, 3_000_000), port.spendForCampaign(c, 3_000_000), port.spendForCampaign(c, 3_000_000)]));
    await Promise.all(funded.map((c) => port.releaseForCampaign(c)));
    const w = await wallet(rt, cust);
    expect(w.spent).toBe(5 * 9_000_000);
    expect(w.reserved).toBeLessThanOrEqual(w.balance);
    expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    expect((await repairLedgerDrift(rt, { minAgeSec: 0 })).actions.filter((a) => a.applied)).toEqual([]);
  });
});
