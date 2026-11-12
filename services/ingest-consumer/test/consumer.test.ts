import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '@ams/runtime';
import { uuidv7 } from '@ams/shared';
import { createIngestConsumer, type SpendRequest } from '../src/consumer.js';
import { INGEST_TOPIC, type ImpressionRow, type IngestMessage } from '../src/contract.js';

async function setup() {
  const rt = await createTestRuntime({ dialect: 'sqlite' });
  const now = rt.clock.now().toISOString();
  const [tenant, cust, camp1, camp2] = [rt.id(), rt.id(), rt.id(), rt.id()];
  await rt.db.run('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)', [tenant, 't', now]);
  await rt.db.run(`INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, created_at) VALUES (?,?,?,?,?,'active',?)`, [cust, tenant, 'k', 'k', 'K1', now]);
  for (const c of [camp1, camp2])
    await rt.db.run(`INSERT INTO campaigns (id, customer_id, name, state, created_at, updated_at) VALUES (?,?,?,'active',?,?)`, [c, cust, 'c', now, now]);
  const row = (campaign: string, o: Partial<ImpressionRow> = {}): ImpressionRow => ({
    ts: now, event_id: uuidv7(), device_id: 'd1', screen_id: null, campaign_id: campaign, creative_id: 'cr', slot_id: null, partner_id: null, region_id: 'HN',
    vcr_pct: 100, valid: 1, reject_reason: null, revenue_micro_vnd: 20_000_000, reward_vnd: 0, ...o,
  });
  const msg = (rows: ImpressionRow[]): IngestMessage => ({ v: 1, device_id: 'd1', impressions: rows, pops: [] });
  const spends: SpendRequest[] = [];
  return { rt, cust, camp1, camp2, row, msg, spends };
}
const count = async (rt: Awaited<ReturnType<typeof setup>>['rt'], sql = 'SELECT COUNT(*) AS n FROM ev_ad_impression') => Number((await rt.db.query<{ n: number }>(sql))[0]!.n);

describe('ingest-consumer', () => {
  it('khu trung, ghi event store + impression_hourly, tru chi tieu theo chien dich (tham so inject)', async () => {
    const s = await setup();
    const c = createIngestConsumer(s.rt, { spend: async (r) => void s.spends.push(r) });
    const a = s.row(s.camp1), b = s.row(s.camp1), x = s.row(s.camp2);
    await c.handle(s.msg([a, b, x, a])); // a trung trong lo
    await c.handle(s.msg([a, b])); // giao lai
    expect(await count(s.rt)).toBe(3);
    expect(await count(s.rt, 'SELECT SUM(impressions) AS n FROM impression_hourly')).toBe(3);
    expect(s.spends.length).toBe(2);
    expect(s.spends.find((r) => r.campaignId === s.camp1)).toMatchObject({ customerId: s.cust, impressions: 2, amountMicroVnd: 40_000_000 });
    expect(c.stats.duplicates).toBe(3);
    await s.rt.close();
  });

  it('chi tieu that bai -> nem loi (queue giao lai), khong mat chi tieu, khong ghi hai lan, cung idempotencyKey', async () => {
    const s = await setup();
    let fail = true;
    const keys: string[] = [];
    const c = createIngestConsumer(s.rt, {
      spend: async (r) => {
        keys.push(r.idempotencyKey);
        if (fail) throw new Error('payments tam thoi loi');
        s.spends.push(r);
      },
    });
    const rows = [s.row(s.camp1), s.row(s.camp1)];
    await expect(c.handle(s.msg(rows))).rejects.toThrow('payments');
    expect(await count(s.rt)).toBe(0);
    fail = false;
    await c.handle(s.msg(rows));
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
    expect(s.spends.length).toBe(1);
    expect(await count(s.rt)).toBe(2);
    await s.rt.close();
  });

  it('ghi su kien that bai sau khi da tru -> giao lai tru-lai cung khoa (payments no-op), du lieu ghi dung mot lan', async () => {
    const s = await setup();
    let broken = true;
    const sink = {
      async append(t: string, rows: Record<string, unknown>[]) {
        if (broken) throw new Error('event store sap');
        return s.rt.events.append(t as 'ad_impression', rows);
      },
      countImpressions: s.rt.events.countImpressions.bind(s.rt.events),
    };
    const seen = new Map<string, number>(); // mo phong payments idempotent
    const c = createIngestConsumer(s.rt, { sink, spend: async (r) => void seen.set(r.idempotencyKey, (seen.get(r.idempotencyKey) ?? 0) + r.impressions) });
    const rows = [s.row(s.camp1), s.row(s.camp1), s.row(s.camp1)];
    await expect(c.handle(s.msg(rows))).rejects.toThrow('event store');
    broken = false;
    await c.handle(s.msg(rows));
    expect(seen.size).toBe(1); // cung mot khoa
    expect(await count(s.rt)).toBe(3);
    expect(await count(s.rt, 'SELECT SUM(impressions) AS n FROM impression_hourly')).toBe(3);
    await s.rt.close();
  });

  it('impression valid=0 hoac doanh thu 0 duoc ghi nhung KHONG chi tieu; khong co SpendFn thi dem spendSkippedNoFn', async () => {
    const s = await setup();
    const c = createIngestConsumer(s.rt, { spend: async (r) => void s.spends.push(r) });
    await c.handle(s.msg([s.row(s.camp1, { valid: 0, reject_reason: 'vcr_low', revenue_micro_vnd: 0 }), s.row(s.camp1, { revenue_micro_vnd: 0 })]));
    expect(await count(s.rt)).toBe(2);
    expect(s.spends.length).toBe(0);
    const c2 = createIngestConsumer(s.rt, {});
    await c2.handle(s.msg([s.row(s.camp1)]));
    expect(c2.stats.spendSkippedNoFn).toBe(1);
    await s.rt.close();
  });

  it('subscribe qua queue (ingest.events + events.* cua CfEventStore); retry cua queue khong lam chi tieu 2 lan', async () => {
    const s = await setup();
    const c = createIngestConsumer(s.rt, { spend: async (r) => void s.spends.push(r) });
    c.subscribe();
    const r1 = s.row(s.camp1);
    await s.rt.queue.send(INGEST_TOPIC, s.msg([r1]));
    await s.rt.queue.send('events.ad_impression', [r1, s.row(s.camp2)]);
    await s.rt.queue.send('events.proof_of_play', [{ ts: new Date().toISOString(), screen_id: 's1', creative_id: 'cr', duration_ms: 1000 }]);
    await s.rt.queue.drain();
    expect(await count(s.rt)).toBe(2);
    expect(await count(s.rt, 'SELECT COUNT(*) AS n FROM ev_proof_of_play')).toBe(1);
    expect(s.rt.queue.dead.length).toBe(0);
    await s.rt.close();
  });
});
