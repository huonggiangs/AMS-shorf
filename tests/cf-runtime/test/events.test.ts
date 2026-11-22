// Duong tien thuc: thiet bi (Ed25519) -> gateway Worker -> D1 + queue -> consumer -> chi tieu vi. Chay tren workerd.
import { afterAll, describe, expect, it } from 'vitest';
import { Dev, getWorld, impression, moneyViolations, seedMoney, settle, snapshot, sleep, waitFor, countImpressions, PRICE_MICRO, MICRO } from '../src/world.js';

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;

describe('thiet bi tren workerd', () => {
  it('register 201 -> heartbeat -> manifest co creative', async () => {
    const w = await getWorld();
    const m = await seedMoney(w);
    const d = await Dev.create(w, { region: 'HN' });
    const hb = await d.call('POST', '/v1/heartbeat', { state: 1, app_ver: '1.0.0' });
    expect(hb.status).toBe(200);
    const mf = await d.call('GET', '/v1/manifest');
    expect(mf.status).toBe(200);
    const man = await J(mf);
    expect(JSON.stringify(man)).toContain(m.fixture.campaigns[0]!.creatives[0]!.id);
    // chong phat lai that tren DO: cung nonce -> 409
    const n = 'nonce-replay-0123456789ab';
    expect((await d.call('POST', '/v1/heartbeat', { state: 1 }, { nonce: n })).status).toBe(200);
    expect((await d.call('POST', '/v1/heartbeat', { state: 1 }, { nonce: n })).status).toBe(409);
  });

  it('impression hop le: 202, ghi D1, tru vi dung (so cai == cache == chien dich), PoP khu trung', async () => {
    const w = await getWorld();
    const m = await seedMoney(w);
    const d = await Dev.create(w);
    await d.call('GET', '/v1/manifest');
    const evs = Array.from({ length: 10 }, () => impression(m));
    const r = await d.events(evs);
    expect(r.status).toBe(202);
    expect(await J(r)).toMatchObject({ accepted: 10, valid: 10 });
    await settle(w, m, 10);
    const ack = new Map([[m.campaignIds[0]!, new Set(evs.map((e) => e['event_id'] as string))]]);
    expect(await moneyViolations(w, m, ack)).toEqual([]);
    // gui lai y het: khong cong them
    expect((await d.events(evs)).status).toBe(202);
    await sleep(1500);
    await settle(w, m, 10);
    expect(await moneyViolations(w, m, ack)).toEqual([]);
    // PoP trung event_id chi 1 dong
    const pop = { type: 'proof_of_play', event_id: impression(m)['event_id'], ts: new Date().toISOString(), creative_id: m.fixture.campaigns[0]!.creatives[0]!.id, duration_ms: 15000 };
    expect((await d.events([pop, pop])).status).toBe(202);
    expect((await d.events([pop])).status).toBe(202);
    await waitFor(async () => (await w.rt.db.query('SELECT 1 FROM ev_pop_seen WHERE event_id = ?', [pop.event_id])).length > 0, 'pop duoc ghi');
    await sleep(800);
    expect((await w.rt.db.query('SELECT 1 FROM ev_pop_seen WHERE event_id = ?', [pop.event_id])).length).toBe(1);
  });

  it('tran gio: 130 event moi trong 1 gio -> dung 120 hop le (D1 batch RETURNING), 10 rate_cap; gui lai khong tru tran lan hai', async () => {
    const w = await getWorld();
    const m = await seedMoney(w);
    const d = await Dev.create(w);
    await d.call('GET', '/v1/manifest');
    const evs = Array.from({ length: 130 }, () => impression(m));
    const rs = [];
    for (let i = 0; i < 130; i += 40) rs.push(await J(await d.events(evs.slice(i, i + 40)))); // than <= 16 KiB: toi da ~50 event/lo
    expect(rs.reduce((a, x) => a + x.accepted, 0)).toBe(130);
    expect(rs.reduce((a, x) => a + x.valid, 0)).toBe(120);
    expect(rs.reduce((a, x) => a + x.flagged, 0)).toBe(10);
    const r2 = await J(await d.events(evs.slice(0, 20))); // giao lai: khong duoc tinh them
    expect(r2.accepted).toBe(20);
    await settle(w, m, 120);
    const ok = new Set(evs.slice(0, 120).map((e) => e['event_id'] as string));
    const rows = await w.rt.db.query<{ event_id: string }>('SELECT event_id FROM ev_ad_impression WHERE campaign_id = ? AND valid = 1', [m.campaignIds[0]!]);
    expect(rows.length).toBe(120);
    for (const x of rows) expect(ok.has(x.event_id)).toBe(true);
    expect(await moneyViolations(w, m, new Map([[m.campaignIds[0]!, ok]]))).toEqual([]);
  });

  it('DONG THOI: 12 lo giong het nhau song song (Promise.all) -> khong tru kep, khong thuong kep', async () => {
    const w = await getWorld();
    const m = await seedMoney(w);
    const d = await Dev.create(w);
    await d.call('GET', '/v1/manifest');
    const evs = Array.from({ length: 25 }, () => impression(m));
    const res = await Promise.all(Array.from({ length: 12 }, () => d.events(evs)));
    expect(res.map((x) => x.status)).toEqual(Array(12).fill(202));
    await settle(w, m, 25);
    await sleep(1500);
    await settle(w, m, 25);
    expect(await countImpressions(w, m.campaignIds)).toBe(25);
    const ack = new Map([[m.campaignIds[0]!, new Set(evs.map((e) => e['event_id'] as string))]]);
    expect(await moneyViolations(w, m, ack)).toEqual([]);
    const s = await snapshot(w, m);
    expect(s.campaigns[0]!.spent * MICRO + s.campaigns[0]!.remainder).toBe(25 * PRICE_MICRO);
  });

  it('DONG THOI: 3 thiet bi x 4 lo khac nhau song song + trung lap cheo -> tong dung, so cai khop', async () => {
    const w = await getWorld();
    const m = await seedMoney(w, { campaigns: 2 });
    const devs = await Promise.all([Dev.create(w), Dev.create(w), Dev.create(w)]);
    await Promise.all(devs.map((d) => d.call('GET', '/v1/manifest')));
    const ack = new Map<string, Set<string>>(m.campaignIds.map((c) => [c, new Set<string>()]));
    const jobs: Promise<Response>[] = [];
    for (const d of devs) {
      for (let b = 0; b < 4; b++) {
        const camp = b % 2;
        const evs = Array.from({ length: 8 }, () => impression(m, { camp }));
        for (const e of evs) ack.get(m.campaignIds[camp]!)!.add(e['event_id'] as string);
        jobs.push(d.events(evs), d.events(evs)); // moi lo gui 2 lan dong thoi
      }
    }
    expect((await Promise.all(jobs)).every((x) => x.status === 202)).toBe(true);
    await settle(w, m, 96);
    await sleep(1500);
    await settle(w, m, 96);
    expect(await moneyViolations(w, m, ack)).toEqual([]);
  });
});

describe('consumer batch lon tren D1', () => {
  it('5 thiet bi x 40 event song song (> 100 event_id trong mot lo queue): khong mat, khong trung, tien khop (gioi han 100 tham so D1)', async () => {
    const w = await getWorld();
    const m = await seedMoney(w);
    const devs = await Promise.all(Array.from({ length: 5 }, () => Dev.create(w)));
    await Promise.all(devs.map((d) => d.call('GET', '/v1/manifest')));
    const ack = new Set<string>();
    const res = await Promise.all(devs.map((d) => {
      const evs = Array.from({ length: 40 }, () => impression(m));
      for (const e of evs) ack.add(e['event_id'] as string);
      return d.events(evs);
    }));
    expect(res.every((r) => r.status === 202)).toBe(true);
    await settle(w, m, 200);
    await sleep(2000);
    await settle(w, m, 200);
    expect(await moneyViolations(w, m, new Map([[m.campaignIds[0]!, ack]]))).toEqual([]);
  });
});
afterAll(async () => void 0);
