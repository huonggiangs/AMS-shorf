import { describe, expect, it } from 'vitest';
import { createFinanceCore, createSpendFn } from '@ams/payments';
import { DbEventStore, createTestRuntime, crashable, SimulatedCrash, type EventStore, type TestRuntime } from '@ams/runtime';
import { uuidv7 } from '@ams/shared';
import { createIngestConsumer } from '../src/consumer.js';
import type { ImpressionRow, IngestMessage } from '../src/contract.js';

/* P0 muc 4: thu tu chi tieu -> ghi su kien -> danh dau xong; mat dien o bat ky ranh gioi nao + giao lai (ke ca gom lo khac) khong tru kep, khong mat tien. */

const NOW = '2026-11-12T03:00:00.000Z';
const PRICE = 20_500_000;

async function setup(dialect: 'sqlite' | 'postgres') {
  const rt = await createTestRuntime({ dialect, now: NOW });
  await rt.db.run('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)', ['T1', 't', NOW]);
  await rt.db.run("INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, created_at) VALUES ('C1','T1','k','k','K1','active',?)", [NOW]);
  await rt.db.run("INSERT INTO ad_wallets (customer_id, balance_vnd, reserved_vnd, spent_vnd, updated_at) VALUES ('C1',20000000,0,0,?)", [NOW]);
  await rt.db.run("INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, created_at) VALUES ('E0','C1','adjust',20000000,20000000,0,'seed',NULL,?)", [NOW]);
  await rt.db.run("INSERT INTO campaigns (id, customer_id, name, state, budget_cap_vnd, approved_budget_vnd, created_at, updated_at) VALUES ('K1','C1','c','awaiting_funds',10000000,10000000,?,?)", [NOW, NOW]);
  await createFinanceCore(rt).reserveForCampaign('K1', 10_000_000);
  return rt;
}
const row = (id: string): ImpressionRow => ({
  ts: NOW, event_id: id, device_id: 'd1', screen_id: null, campaign_id: 'K1', creative_id: 'cr', slot_id: null, partner_id: null, region_id: 'HN',
  vcr_pct: 100, valid: 1, reject_reason: null, revenue_micro_vnd: PRICE, reward_vnd: 0,
});
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => uuidv7(1_700_000_000_000 + from + i));
const msg = (list: string[]): IngestMessage => ({ v: 1, device_id: 'd1', impressions: list.map(row), pops: [] });
async function state(rt: TestRuntime) {
  const q = async (sql: string) => Number((await rt.db.query<{ n: unknown }>(sql))[0]!.n);
  return {
    spent: await q("SELECT spent_vnd AS n FROM campaigns WHERE id = 'K1'"),
    ledgerSpend: await q("SELECT COALESCE(SUM(amount_vnd),0) AS n FROM wallet_entries WHERE kind = 'spend'"),
    remainder: await q("SELECT spend_remainder_micro AS n FROM campaigns WHERE id = 'K1'"),
    events: await q('SELECT COUNT(*) AS n FROM ev_ad_impression'),
    hourly: await q('SELECT COALESCE(SUM(impressions),0) AS n FROM impression_hourly'),
    claimed: await q('SELECT COUNT(*) AS n FROM spend_events'),
  };
}

describe.each(['sqlite', 'postgres'] as const)('ingest + chi tieu: mat dien va giao lai (%s)', (dialect) => {
  it('chet SAU chi tieu, TRUOC khi ghi su kien: giao lai ghi su kien, chi tieu khong lap lai', async () => {
    const rt = await setup(dialect);
    const list = ids(5);
    let boom = true;
    const sink: EventStore = {
      countImpressions: (c, s) => rt.events.countImpressions(c, s),
      append: async (t, rows) => {
        if (boom) {
          boom = false;
          throw new Error('chet truoc khi ghi su kien');
        }
        await rt.events.append(t, rows);
      },
    };
    const c = createIngestConsumer(rt, { spend: createSpendFn(rt), sink });
    await expect(c.handle(msg(list))).rejects.toThrow('chet truoc');
    expect(await state(rt)).toMatchObject({ spent: 102, events: 0, claimed: 5 }); // da tru (5 x 20,5 = 102,5), chua co su kien
    await c.handle(msg(list)); // queue giao lai
    await c.handle(msg(list));
    expect(await state(rt)).toMatchObject({ spent: 102, ledgerSpend: 102, remainder: 500_000, events: 5, hourly: 5 });
    await rt.close();
  }, 60_000);

  it('ghi su kien DO DANG (mot nua roi chet): giao lai khong tru kep phan da ghi, du su kien', async () => {
    const rt = await setup(dialect);
    const list = ids(6);
    let boom = true;
    const sink: EventStore = {
      countImpressions: (c, s) => rt.events.countImpressions(c, s),
      append: async (t, rows) => {
        if (boom) {
          boom = false;
          await rt.events.append(t, rows.slice(0, 3)); // sink ngoai (vd ClickHouse) khong atomic: ghi duoc mot nua
          throw new Error('chet giua chung');
        }
        await rt.events.append(t, rows);
      },
    };
    const c = createIngestConsumer(rt, { spend: createSpendFn(rt), sink });
    await expect(c.handle(msg(list))).rejects.toThrow('giua chung');
    expect((await state(rt)).events).toBe(3);
    await c.handle(msg(list));
    expect(await state(rt)).toMatchObject({ spent: 123, ledgerSpend: 123, events: 6, hourly: 6, claimed: 6 }); // 6 x 20,5 = 123
    await rt.close();
  }, 60_000);

  it('thiet bi gui lai cac su kien cu trong lo MOI (gom khac): chi su kien moi duoc tinh tien', async () => {
    const rt = await setup(dialect);
    const all = ids(4);
    const c = createIngestConsumer(rt, { spend: createSpendFn(rt) });
    await c.handle(msg(all.slice(0, 2)));
    await c.handle(msg(all.slice(0, 3))); // 0,1 da xu ly; 2 moi
    await c.handle(msg(all)); // 0,1,2 da xu ly; 3 moi
    expect(await state(rt)).toMatchObject({ spent: 82, events: 4, hourly: 4, claimed: 4 });
    // sau khi cho "xong" (kv) het han / mat: van khong tru kep vi khu trung ben vung o spend_events + UNIQUE su kien
    for (const id of all) await rt.kv.del(`ingest:done:${id}`);
    await createIngestConsumer(rt, { spend: createSpendFn(rt) }).handle(msg(all));
    expect(await state(rt)).toMatchObject({ spent: 82, events: 4, hourly: 4 });
    await rt.close();
  }, 60_000);

  it('MAT DIEN o moi ranh gioi ghi trong consumer.handle (spend + su kien + kv): giao lai hoi tu dung bang ket qua khong loi', async () => {
    const list = ids(5);
    const gold = await setup(dialect);
    const gc = crashable(gold);
    await createIngestConsumer(gc.rt, { spend: createSpendFn(gc.rt), sink: new DbEventStore(gc.rt.db) }).handle(msg(list));
    const W = gc.ctl.writes;
    const expected = await state(gold);
    expect(expected).toMatchObject({ spent: 102, events: 5, hourly: 5 });
    expect(W).toBeGreaterThan(10);
    await gold.close();
    for (let k = 1; k <= W; k++) {
      const rt = await setup(dialect);
      const c = crashable(rt);
      c.ctl.armAt(k);
      const first = createIngestConsumer(c.rt, { spend: createSpendFn(c.rt), sink: new DbEventStore(c.rt.db) });
      try {
        await first.handle(msg(list));
      } catch (e) {
        expect(e).toBeInstanceOf(SimulatedCrash);
      }
      c.ctl.reset();
      // tien trinh moi (bo nho trong consumer mat), queue giao lai nhieu lan
      for (let i = 0; i < 2; i++) await createIngestConsumer(rt, { spend: createSpendFn(rt) }).handle(msg(list));
      expect(await state(rt), `mat dien truoc lan ghi ${k}`).toEqual(expected);
      await rt.close();
    }
  }, 300_000);

  it('LO nhieu thong diep dong thoi (gom lo, chong lan id) + mat dien o moi ranh gioi ghi: giao lai tung thong diep hoi tu dung bang ket qua khong loi', async () => {
    const all = ids(8);
    const parts = [all.slice(0, 4), all.slice(2, 6), all.slice(5, 8)]; // chong lan 2,3 va 5
    const gold = await setup(dialect);
    const gc = crashable(gold);
    await Promise.all(parts.map((p) => createIngestConsumer(gc.rt, { spend: createSpendFn(gc.rt), sink: new DbEventStore(gc.rt.db) }).handle(msg(p))));
    const expected = await state(gold);
    expect(expected).toMatchObject({ spent: 164, events: 8, hourly: 8, claimed: 8 }); // 8 x 20,5
    const W = gc.ctl.writes;
    await gold.close();
    for (let k = 1; k <= W; k += 2) {
      const rt = await setup(dialect);
      const c = crashable(rt);
      c.ctl.armAt(k);
      const first = createIngestConsumer(c.rt, { spend: createSpendFn(c.rt), sink: new DbEventStore(c.rt.db) });
      await Promise.allSettled(parts.map((p) => first.handle(msg(p))));
      c.ctl.reset();
      const redo = createIngestConsumer(rt, { spend: createSpendFn(rt) });
      for (let i = 0; i < 2; i++) await Promise.all(parts.map((p) => redo.handle(msg(p))));
      expect(await state(rt), `mat dien truoc lan ghi ${k}`).toEqual(expected);
      await rt.close();
    }
  }, 300_000);
});
