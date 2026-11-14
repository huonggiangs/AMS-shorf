// N1 / N4 / R1-12: tran gio/thiet bi khu trung theo event_id (lo giao lai khong bi tru hai lan) va gom lo kv (khong 50 lan incr tuan tu).
import { describe, expect, it } from 'vitest';
import { TestDevice, harness, impression } from './helpers.js';

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;

describe('tran gio idempotent theo event_id (N1)', () => {
  it('lo gui lai nguyen van (mat phan hoi) khong tru tran lan hai; su kien moi van du tran', async () => {
    const he = await harness({ env: { EVENTS_LIMIT_PER_MIN: '1000' }, gw: { policy: { maxPerDeviceHour: 60 } } });
    try {
      const d = await TestDevice.create(he);
      await d.pair();
      const first = Array.from({ length: 50 }, () => impression(he));
      const r1 = await J(await d.call('POST', '/v1/events', { events: first }));
      expect(r1.valid).toBe(50);
      // thiet bi khong nhan duoc phan hoi => gui lai CUNG lo
      const r2 = await J(await d.call('POST', '/v1/events', { events: first }));
      expect(r2.valid).toBe(50);
      // 10 su kien moi cuoi gio van du tran (60 = 50 + 10); neu lo giao lai bi dem lai thi chi con 0 cho
      const more = Array.from({ length: 10 }, () => impression(he));
      const r3 = await J(await d.call('POST', '/v1/events', { events: more }));
      expect(r3.valid).toBe(10);
      expect(r3.flagged).toBe(0);
      // su kien thu 61 moi => rate_cap
      const r4 = await J(await d.call('POST', '/v1/events', { events: [impression(he)] }));
      expect(r4.valid).toBe(0);
      expect(r4.flagged).toBe(1);
      await he.rt.queue.drain();
      const n = (await he.rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression WHERE valid = 1'))[0]!.n;
      expect(Number(n)).toBe(60); // ingest cung khu trung theo event_id
    } finally {
      await he.close();
    }
  });

  it('mot lo 50 su kien = toi da 2 vong kv (chiem + cong tran), khong con 50 lan incr', async () => {
    const he = await harness({ env: { EVENTS_LIMIT_PER_MIN: '1000' } });
    try {
      const d = await TestDevice.create(he);
      await d.pair();
      const kv = he.rt.kv as unknown as { incr: (...a: unknown[]) => Promise<number>; incrMany: (...a: unknown[]) => Promise<number[]> };
      let single = 0;
      let many = 0;
      const oi = kv.incr.bind(he.rt.kv);
      const om = kv.incrMany.bind(he.rt.kv);
      kv.incr = (...a) => (single++, oi(...a));
      kv.incrMany = (...a) => (many++, om(...a));
      const r = await J(await d.call('POST', '/v1/events', { events: Array.from({ length: 50 }, () => impression(he)) }));
      expect(r.valid).toBe(50);
      // rate limit cua duong dan (1 incr) + dung 2 lan incrMany cho tran gio
      expect(many).toBe(2);
      expect(single).toBeLessThanOrEqual(2);
    } finally {
      await he.close();
    }
  });
});
