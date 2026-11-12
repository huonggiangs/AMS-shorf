import { describe, expect, it } from 'vitest';
import { crashable, SimulatedCrash, type TestRuntime } from '@ams/runtime';
import { createFinanceCore, createSpendFn, reconcileLedger, settleSpendRemainders, type ImpressionSpendRequest } from '../src/index.js';
import { mkCampaign, mkCustomer, mkRt } from './helpers.js';

/* P0 muc 4: chi tieu impression khu trung THEO TUNG su kien, hoi tu sau mat dien o bat ky ranh gioi ghi nao. Khong tru kep, khong mat tien. */

const PRICE = 20_500_000; // 20,5 VND moi impression: co phan du micro de thu cong don

async function setup(dialect: 'postgres' | 'sqlite', budget = 5_000_000) {
  const rt = await mkRt(dialect);
  const cust = await mkCustomer(rt, 'SC' + Math.random().toString(36).slice(2, 6).toUpperCase(), { balance: budget * 2 });
  const camp = await mkCampaign(rt, cust, budget);
  await createFinanceCore(rt).reserveForCampaign(camp, budget);
  return { rt, cust, camp };
}
const ev = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `evt-${from + i}`, micro: PRICE }));
function req(camp: string, cust: string, events: { id: string; micro: number }[], key: string): ImpressionSpendRequest {
  return { campaignId: camp, customerId: cust, amountMicroVnd: events.reduce((s, e) => s + e.micro, 0), impressions: events.length, idempotencyKey: key, firstTs: '2026-11-12T03:00:00.000Z', lastTs: '2026-11-12T03:00:01.000Z', events };
}
async function snap(rt: TestRuntime, cust: string, camp: string) {
  const c = (await rt.db.query<{ spent_vnd: unknown; reserved_vnd: unknown; spend_remainder_micro: unknown }>('SELECT spent_vnd, reserved_vnd, spend_remainder_micro FROM campaigns WHERE id = ?', [camp]))[0]!;
  const w = (await rt.db.query<{ balance_vnd: unknown; reserved_vnd: unknown; spent_vnd: unknown }>('SELECT balance_vnd, reserved_vnd, spent_vnd FROM ad_wallets WHERE customer_id = ?', [cust]))[0]!;
  const spendEntries = Number((await rt.db.query<{ s: unknown }>("SELECT COALESCE(SUM(amount_vnd),0) AS s FROM wallet_entries WHERE kind = 'spend' AND customer_id = ?", [cust]))[0]!.s);
  const claimed = Number((await rt.db.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM spend_events WHERE campaign_id = ?', [camp]))[0]!.n);
  return { spent: Number(c.spent_vnd), reserved: Number(c.reserved_vnd), remainder: Number(c.spend_remainder_micro), walletSpent: Number(w.spent_vnd), walletBalance: Number(w.balance_vnd), ledgerSpend: spendEntries, claimed };
}

describe.each(['sqlite', 'postgres'] as const)('chi tieu impression: khu trung theo su kien (%s)', (dialect) => {
  it('goi lai cung yeu cau nhieu lan va dong thoi: chi tinh mot lan', async () => {
    const { rt, cust, camp } = await setup(dialect);
    const spend = createSpendFn(rt);
    const r = req(camp, cust, ev(3), 'k-same');
    await Promise.all([spend(r), spend(r), spend(r)]);
    await spend(r);
    await spend(r);
    // 3 x 20,5 = 61,5 -> tru 61, du 0,5
    expect(await snap(rt, cust, camp)).toMatchObject({ spent: 61, walletSpent: 61, ledgerSpend: 61, remainder: 500_000, claimed: 3 });
    expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    await rt.close();
  }, 60_000);

  it('cung su kien nam trong cac lo KHAC NHAU (gom lai khac, khoa lo khac): moi su kien chi tinh mot lan', async () => {
    const { rt, cust, camp } = await setup(dialect);
    const spend = createSpendFn(rt);
    await spend(req(camp, cust, ev(2, 0), 'lo-1')); // e0,e1
    await spend(req(camp, cust, ev(2, 1), 'lo-2')); // e1,e2 : e1 trung
    await spend(req(camp, cust, ev(4, 0), 'lo-3')); // e0..e3 : chi e3 moi
    // 4 su kien duy nhat x 20,5 = 82 VND chinh xac
    expect(await snap(rt, cust, camp)).toMatchObject({ spent: 82, ledgerSpend: 82, remainder: 0, claimed: 4 });
    await rt.close();
  }, 60_000);

  it('MAT DIEN o moi ranh gioi ghi: replay hoi tu dung bang ket qua khong loi (khong tru kep, khong mat)', async () => {
    const events = ev(7);
    const gold = await setup(dialect);
    const probe = crashable(gold.rt);
    await createSpendFn(probe.rt)(req(gold.camp, gold.cust, events, 'k-crash'));
    const W = probe.ctl.writes;
    const expected = await snap(gold.rt, gold.cust, gold.camp);
    expect(expected).toMatchObject({ spent: 143, claimed: 7 }); // 7 x 20,5 = 143,5
    expect(W).toBeGreaterThan(5);
    await gold.rt.close();
    let crashes = 0;
    for (let k = 1; k <= W; k++) {
      const { rt, cust, camp } = await setup(dialect);
      const c = crashable(rt);
      c.ctl.armAt(k);
      try {
        await createSpendFn(c.rt)(req(camp, cust, events, 'k-crash'));
      } catch (e) {
        expect(e).toBeInstanceOf(SimulatedCrash);
        crashes++;
      }
      c.ctl.reset();
      // hang doi giao lai CUNG message (co the nhieu lan) — roi (hoac chi) job quet
      await createSpendFn(rt)(req(camp, cust, events, 'k-crash'));
      await createSpendFn(rt)(req(camp, cust, events, 'k-crash'));
      const got = await snap(rt, cust, camp);
      expect(got, `mat dien truoc lan ghi ${k}`).toEqual(expected);
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
      await rt.close();
    }
    expect(crashes).toBe(W);
  }, 300_000);

  it('mat dien giua ghi nhan (A) va quyet toan (B), khong co message giao lai: job settleSpendRemainders hoan tat', async () => {
    const { rt, cust, camp } = await setup(dialect);
    const c = crashable(rt);
    // 3 event = 61,5 VND: A xong (batch), chet ngay truoc B (lan ghi dau cua quyet toan = chiem phan du)
    c.ctl.armAt(1 + 1 + 1); // spend_dedupe (1), batch event (2), chiem phan du (3) => chet o day
    await expect(createSpendFn(c.rt)(req(camp, cust, ev(3), 'k-AB'))).rejects.toBeInstanceOf(SimulatedCrash);
    c.ctl.reset();
    const mid = await snap(rt, cust, camp);
    expect(mid).toMatchObject({ spent: 0, remainder: 3 * PRICE, claimed: 3 }); // da ghi nhan, chua quyet toan
    expect(await settleSpendRemainders(rt)).toBe(1);
    expect(await snap(rt, cust, camp)).toMatchObject({ spent: 61, remainder: 500_000, ledgerSpend: 61 });
    expect(await settleSpendRemainders(rt)).toBe(0); // da het phan nguyen
    await rt.close();
  }, 60_000);

  it('het phan giu giua chung: chi tru toi da phan giu, phan vuot bi bo, chien dich ket thuc, replay khong doi gi', async () => {
    const { rt, cust, camp } = await setup(dialect, 100); // giu 100 VND
    const spend = createSpendFn(rt);
    const e = ev(10); // 205 VND
    await spend(req(camp, cust, e, 'k-over'));
    await spend(req(camp, cust, e, 'k-over'));
    const s = await snap(rt, cust, camp);
    expect(s).toMatchObject({ spent: 100, reserved: 0, ledgerSpend: 100, walletBalance: 100 });
    expect((await rt.db.query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [camp]))[0]!.state).toBe('ended');
    expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    await rt.close();
  }, 60_000);

  it('duong cu (khong co danh sach su kien): van khu trung theo idempotencyKey', async () => {
    const { rt, cust, camp } = await setup(dialect);
    const spend = createSpendFn(rt);
    const { events: _omit, ...legacy } = req(camp, cust, ev(3), 'legacy');
    void _omit;
    await spend(legacy);
    await spend(legacy);
    expect(await snap(rt, cust, camp)).toMatchObject({ spent: 61, remainder: 500_000, claimed: 0 });
    await rt.close();
  }, 60_000);
});

describe('chi tieu tren engine KHONG hoan tac (mo phong D1)', () => {
  it('mat dien o bat ky ranh gioi nao: KHONG BAO GIO tru kep (toi da bo sot trong cua so quyet toan, nghieng ve phia khach)', async () => {
    const events = ev(7);
    const gold = await setup('sqlite');
    const probe = crashable(gold.rt, { nonAtomic: true });
    await createSpendFn(probe.rt)(req(gold.camp, gold.cust, events, 'k-d1'));
    const W = probe.ctl.writes;
    const expected = await snap(gold.rt, gold.cust, gold.camp);
    await gold.rt.close();
    let exact = 0;
    for (let k = 1; k <= W; k++) {
      const { rt, cust, camp } = await setup('sqlite');
      const c = crashable(rt, { nonAtomic: true });
      c.ctl.armAt(k);
      try {
        await createSpendFn(c.rt)(req(camp, cust, events, 'k-d1'));
      } catch (e) {
        expect(e).toBeInstanceOf(SimulatedCrash);
      }
      c.ctl.reset();
      const d1 = crashable(rt, { nonAtomic: true }).rt;
      await createSpendFn(d1)(req(camp, cust, events, 'k-d1'));
      await createSpendFn(d1)(req(camp, cust, events, 'k-d1'));
      await settleSpendRemainders(d1);
      const got = await snap(rt, cust, camp);
      expect(got.spent, `k=${k}`).toBeLessThanOrEqual(expected.spent); // khong bao gio nhieu hon
      expect(got.claimed).toBe(expected.claimed); // moi su kien duoc ghi nhan dung mot lan
      if (got.spent === expected.spent) exact++;
      await rt.close();
    }
    // da so ranh gioi hoi tu chinh xac; chi cua so "da chiem phan du - chua ghi so cai" cua B co the bo sot
    console.log(`[d1-like] ranh gioi hoi tu chinh xac: ${exact}/${W}`);
    expect(exact).toBeGreaterThanOrEqual(W - 2);
  }, 300_000);
});
