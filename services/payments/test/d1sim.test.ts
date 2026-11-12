import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { createFinanceCore, reconcileLedger } from '../src/index.js';
import { campaign, mkApp, mkCampaign, mkCustomer, mkRt, sign, wallet, webhookBody } from './helpers.js';

/**
 * Mo phong D1: giao dich KHONG hoan tac va cac cau lenh cua cac yeu cau dong thoi xen ke nhau
 * (tx() chi chay thang fn tren cung ket noi, interactiveTx=false). Chung minh tinh dung dan dua vao
 * UPDATE co dieu kien + UNIQUE, khong dua vao rollback/khoa dong.
 */
function d1Like(inner: Db): Db {
  const d: Db = {
    dialect: inner.dialect,
    interactiveTx: false,
    query: (s, p) => inner.query(s, p),
    run: (s, p) => inner.run(s, p),
    batch: (st) => inner.batch(st),
    tx: (fn) => fn(d),
  };
  return d;
}

describe('mo phong D1 (tx khong rollback, cau lenh xen ke) [sqlite]', () => {
  let rt: TestRuntime;
  beforeAll(async () => {
    const base = await mkRt('sqlite');
    rt = { ...base, db: d1Like(base.db) } as TestRuntime;
    (rt as unknown as { _base: TestRuntime })._base = base;
  });
  afterAll(async () => (rt as unknown as { _base: TestRuntime })._base.close());

  it('tranh chap so du: tong giu <= so du', async () => {
    const port = createFinanceCore(rt);
    const cid = await mkCustomer(rt, 'D1RACE', { balance: 100_000_000 });
    const ids = await Promise.all(Array.from({ length: 12 }, () => mkCampaign(rt, cid, 30_000_000)));
    const res = await Promise.all(ids.map((i) => port.reserveForCampaign(i, 30_000_000)));
    expect(res.filter((r) => r.state === 'active')).toHaveLength(3);
    const w = await wallet(rt, cid);
    expect(w.reserved).toBe(90_000_000);
    expect(w.reserved).toBeLessThanOrEqual(w.balance);
    // cung chien dich duyet dong thoi nhieu lan: chi giu mot lan
    const c = await mkCampaign(rt, cid, 5_000_000);
    await Promise.all(Array.from({ length: 6 }, () => port.reserveForCampaign(c, 5_000_000)));
    expect((await wallet(rt, cid)).reserved).toBe(95_000_000);
    expect((await reconcileLedger(rt)).mismatches).toEqual([]);
  });

  it('chi tieu dong thoi khong vuot phan da giu', async () => {
    const port = createFinanceCore(rt);
    const cid = await mkCustomer(rt, 'D1SPEND', { balance: 10_000_000 });
    const c = await mkCampaign(rt, cid, 10_000_000);
    await port.reserveForCampaign(c, 10_000_000);
    const rs = await Promise.all(Array.from({ length: 20 }, () => port.spendForCampaign(c, 1_000_000)));
    expect(rs.reduce((s, r) => s + r.charged, 0)).toBe(10_000_000);
    expect(await campaign(rt, c)).toMatchObject({ state: 'ended', reserved: 0, spent: 10_000_000 });
    expect(await wallet(rt, cid)).toEqual({ balance: 0, reserved: 0, spent: 10_000_000 });
    expect((await reconcileLedger(rt)).mismatches).toEqual([]);
  });

  it('webhook trung x8 dong thoi chi cong 1 lan', async () => {
    const { app } = mkApp(rt);
    const cid = await mkCustomer(rt, 'D1DUP');
    const body = webhookBody({ id: 990001, amount: 7_000_000, content: 'AMS D1DUP' });
    const h = await sign(rt, body);
    const rs = await Promise.all(Array.from({ length: 8 }, () => app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: h })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect((await wallet(rt, cid)).balance).toBe(7_000_000);
    expect(await rt.db.query("SELECT 1 AS x FROM wallet_entries WHERE customer_id = ? AND kind = 'topup'", [cid])).toHaveLength(1);
    expect((await reconcileLedger(rt)).mismatches).toEqual([]);
  });
});
