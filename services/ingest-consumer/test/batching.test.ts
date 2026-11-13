import { describe, expect, it } from 'vitest';
import { createTestRuntime, type EventStore } from '@ams/runtime';
import { uuidv7 } from '@ams/shared';
import { createIngestConsumer, DEAD_LETTER_TOPIC, type SpendRequest } from '../src/consumer.js';
import type { ImpressionRow, IngestMessage } from '../src/contract.js';

async function setup() {
  const rt = await createTestRuntime({ dialect: 'sqlite' });
  const now = rt.clock.now().toISOString();
  const [tenant, cust, camp1, camp2] = [rt.id(), rt.id(), rt.id(), rt.id()];
  await rt.db.run('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)', [tenant, 't', now]);
  await rt.db.run(`INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, created_at) VALUES (?,?,?,?,?,'active',?)`, [cust, tenant, 'k', 'k', 'K1', now]);
  for (const c of [camp1, camp2]) await rt.db.run(`INSERT INTO campaigns (id, customer_id, name, state, created_at, updated_at) VALUES (?,?,?,'active',?,?)`, [c, cust, 'c', now, now]);
  const row = (campaign: string): ImpressionRow => ({
    ts: now, event_id: uuidv7(), device_id: 'd1', screen_id: null, campaign_id: campaign, creative_id: 'cr', slot_id: null, partner_id: null, region_id: 'HN',
    vcr_pct: 100, valid: 1, reject_reason: null, revenue_micro_vnd: 20_000_000, reward_vnd: 0,
  });
  const msg = (rows: ImpressionRow[]): IngestMessage => ({ v: 1, device_id: 'd1', impressions: rows, pops: [] });
  return { rt, camp1, camp2, row, msg };
}
const count = async (rt: Awaited<ReturnType<typeof setup>>['rt']) => Number((await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression'))[0]!.n);

describe('ingest-consumer: gom lo, thu lai co gioi han, dead-letter', () => {
  it('thong diep den dong thoi duoc gom: mot lan chi tieu moi chien dich, mot lo, du lieu day du, khong trung', async () => {
    const s = await setup();
    const spends: SpendRequest[] = [];
    const c = createIngestConsumer(s.rt, { spend: async (r) => void spends.push(r) });
    const msgs = Array.from({ length: 20 }, (_, i) => s.msg([s.row(i % 2 ? s.camp1 : s.camp2)]));
    await Promise.all(msgs.map((m) => c.handle(m)));
    expect(await count(s.rt)).toBe(20);
    expect(spends.length).toBe(2);
    expect(spends.reduce((t, r) => t + r.impressions, 0)).toBe(20);
    expect(c.stats.batches).toBe(1);
    await Promise.all(msgs.map((m) => c.handle(m))); // giao lai ca loat: khong ghi/tru them
    expect(await count(s.rt)).toBe(20);
    expect(spends.length).toBe(2);
    await s.rt.close();
  });

  it('maxBatch chia lo; thong diep khong hop le / rong khong chan lo', async () => {
    const s = await setup();
    const c = createIngestConsumer(s.rt, { spend: async () => undefined, maxBatch: 4 });
    const msgs = Array.from({ length: 10 }, () => s.msg([s.row(s.camp1)]));
    await Promise.all([...msgs.map((m) => c.handle(m)), c.handle({ v: 2 } as unknown as IngestMessage), c.handle(s.msg([]))]);
    expect(await count(s.rt)).toBe(10);
    expect(c.stats.batches).toBe(3);
    await s.rt.close();
  });

  it('thong diep doc: chi no that bai (lo duoc tach), thu lai toi maxAttempts roi dead-letter + ack, thong diep tot khong bi anh huong', async () => {
    const s = await setup();
    const poison = s.row(s.camp1);
    const sink: EventStore = {
      countImpressions: (cc, since) => s.rt.events.countImpressions(cc, since),
      append: async (t, rows) => {
        if (rows.some((r) => r['event_id'] === poison.event_id)) throw new Error('poison');
        await s.rt.events.append(t, rows);
      },
    };
    const logs: string[] = [];
    const c = createIngestConsumer(s.rt, { sink, spend: async () => undefined, maxAttempts: 3, log: (m) => logs.push(m) });
    const good = Array.from({ length: 5 }, () => s.msg([s.row(s.camp2)]));
    const bad = s.msg([poison]);
    const res = await Promise.allSettled([...good.map((m) => c.handle(m)), c.handle(bad)]);
    expect(res.slice(0, 5).every((r) => r.status === 'fulfilled')).toBe(true);
    expect(res[5]!.status).toBe('rejected'); // lan 1
    expect(await count(s.rt)).toBe(5);
    await expect(c.handle(bad)).rejects.toThrow('poison'); // lan 2
    expect(c.stats.deadLettered).toBe(0);
    await expect(c.handle(bad)).resolves.toBeUndefined(); // lan 3: dead-letter + ack
    expect(c.stats.deadLettered).toBe(1);
    const dead = s.rt.queue.sent.filter((x) => x.topic === DEAD_LETTER_TOPIC);
    expect(dead.length).toBe(1);
    expect(dead[0]!.msg).toMatchObject({ attempts: 3, error: 'poison', msg: { impressions: [{ event_id: poison.event_id }] } });
    expect(logs.some((l) => l.includes('dead-letter'))).toBe(true);
    expect(await count(s.rt)).toBe(5);
    await s.rt.close();
  });

  it('loi tam thoi: thanh cong o lan thu lai thi KHONG dead-letter; khong dead-letter duoc (queue hong) thi van nem loi', async () => {
    const s = await setup();
    let fail = 2;
    const c = createIngestConsumer(s.rt, { spend: async () => { if (fail-- > 0) throw new Error('tam thoi'); }, maxAttempts: 3 });
    const m = s.msg([s.row(s.camp1)]);
    await expect(c.handle(m)).rejects.toThrow('tam thoi');
    await expect(c.handle(m)).rejects.toThrow('tam thoi');
    await c.handle(m);
    expect(c.stats.deadLettered).toBe(0);
    expect(await count(s.rt)).toBe(1);

    const s2 = await setup();
    s2.rt.queue.send = async () => { throw new Error('queue hong'); };
    const c2 = createIngestConsumer(s2.rt, { spend: async () => { throw new Error('mai mai loi'); }, maxAttempts: 1 });
    await expect(c2.handle(s2.msg([s2.row(s2.camp1)]))).rejects.toThrow('mai mai loi');
    expect(c2.stats.deadLettered).toBe(0);
    await s.rt.close();
    await s2.rt.close();
  });
});
