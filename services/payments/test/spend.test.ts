import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestRuntime } from '@ams/runtime';
import { createFinanceCore, createSpendFn } from '../src/index.js';
import { mkCampaign, mkCustomer, mkRt } from './helpers.js';

describe.each(['sqlite', 'postgres'] as const)('createSpendFn (%s)', (dialect) => {
  let rt: TestRuntime;
  beforeAll(async () => {
    rt = await mkRt(dialect);
  });
  afterAll(async () => {
    await rt.close?.();
  });

  async function setup(budget: number) {
    const cust = await mkCustomer(rt, 'SP' + Math.random().toString(36).slice(2, 6).toUpperCase(), { balance: budget * 2 });
    const camp = await mkCampaign(rt, cust, budget);
    const port = createFinanceCore(rt);
    await port.reserveForCampaign(camp, budget);
    return { cust, camp };
  }
  const req = (camp: string, cust: string, micro: number, key: string) => ({ campaignId: camp, customerId: cust, amountMicroVnd: micro, impressions: 1, idempotencyKey: key, firstTs: '2026-11-12T03:00:00.000Z', lastTs: '2026-11-12T03:00:01.000Z' });
  const spent = async (cust: string) => Number((await rt.db.query<{ s: unknown }>('SELECT spent_vnd AS s FROM ad_wallets WHERE customer_id = ?', [cust]))[0]!.s);

  it('goi lai cung idempotencyKey khong tru lan hai', async () => {
    const { cust, camp } = await setup(5_000_000);
    const spend = createSpendFn(rt);
    await spend(req(camp, cust, 3_000_000, 'k1'));
    await spend(req(camp, cust, 3_000_000, 'k1'));
    expect(await spent(cust)).toBe(3);
  });

  it('cong don phan du micro-VND giua cac lo', async () => {
    const { cust, camp } = await setup(5_000_000);
    const spend = createSpendFn(rt);
    await spend(req(camp, cust, 600_000, 'a')); // 0,6 VND -> chua tru
    expect(await spent(cust)).toBe(0);
    await spend(req(camp, cust, 600_000, 'b')); // tong 1,2 -> tru 1
    expect(await spent(cust)).toBe(1);
  });
});
