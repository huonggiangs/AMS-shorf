import { describe, expect, it } from 'vitest';
import { Recorder, VirtualDevice, createInProcessEnv, percentile, runFleet } from '../src/index.js';

describe('stats', () => {
  it('percentile nearest-rank', () => {
    const a = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(a, 50)).toBe(50);
    expect(percentile(a, 95)).toBe(95);
    expect(percentile(a, 99)).toBe(99);
    expect(percentile([], 99)).toBe(0);
    expect(percentile([7], 99)).toBe(7);
  });
  it('Recorder dem loi theo trang thai', () => {
    const r = new Recorder();
    r.add('x', 1, 200);
    r.add('x', 3, 503);
    r.add('x', 2, 304);
    const s = r.summary();
    expect(s['x']).toMatchObject({ count: 3, errors: 1, p50: 2, max: 3 });
    expect(s['ALL']!.errors).toBe(1);
  });
});

describe('thiet bi ao', () => {
  it('2.000 thiet bi ao chay het luong (dang ky, ghep doi, heartbeat x2 voi jitter, manifest, su kien) trong-tien-trinh', async () => {
    const env = await createInProcessEnv();
    try {
      const N = 2000;
      const r = await runFleet({ devices: N, concurrency: 100, cycles: 2, eventsPerDevice: 4, transport: env.transport, confirmPairing: env.confirmPairing, region: (i) => (i % 2 ? 'HN' : 'HCM') });
      await env.settle();
      expect(r.registered).toBe(N);
      expect(r.paired).toBe(N);
      expect(r.completed).toBe(N);
      expect(r.deviceErrors).toBe(0);
      expect(r.endpoints['ALL']!.errors).toBe(0);
      expect(r.heartbeats).toBe(N * 2);
      expect(r.eventsSent).toBe(N * 4);
      expect(r.eventsValid).toBe(N * 4);
      // jitter: moi next_interval nam trong +-20% cua co so; va thuc su phan tan
      for (const iv of r.intervals) {
        expect(iv.next).toBeGreaterThanOrEqual(Math.ceil(iv.base * 0.8));
        expect(iv.next).toBeLessThanOrEqual(Math.floor(iv.base * 1.2));
      }
      expect(new Set(r.intervals.map((i) => i.next)).size).toBeGreaterThan(40);
      // doi chieu DB <-> thiet bi <-> chi tieu
      const q = async (sql: string) => Number((await env.rt.db.query<{ n: number }>(sql))[0]!.n);
      expect(await q('SELECT COUNT(*) AS n FROM devices')).toBe(N);
      expect(await q('SELECT COUNT(*) AS n FROM devices WHERE trust_level >= 1')).toBe(N);
      expect(await q('SELECT COUNT(*) AS n FROM ev_ad_impression')).toBe(N * 4);
      expect(await q('SELECT SUM(impressions) AS n FROM impression_hourly')).toBe(N * 4);
      expect(await q('SELECT COUNT(*) AS n FROM ev_heartbeat')).toBe(N * 2);
      expect(env.spends.reduce((s, x) => s + x.impressions, 0)).toBe(N * 4);
      expect(env.spends.reduce((s, x) => s + x.amountMicroVnd, 0)).toBe(N * 4 * 20_000_000);
      expect(env.rt.queue.dead.length).toBe(0);
      // manifest: lan sau co etag thi nhan 304 (heartbeat tra etag trung nen khong goi lai)
      expect(r.manifestFetches).toBe(N);
      console.log(`[sim 2000] ${r.requests} req / ${r.wallSeconds.toFixed(1)}s = ${r.throughputRps.toFixed(0)} req/s; ALL p50/p95/p99 = ${r.endpoints['ALL']!.p50.toFixed(1)}/${r.endpoints['ALL']!.p95.toFixed(1)}/${r.endpoints['ALL']!.p99.toFixed(1)} ms (concurrency 100, in-process sqlite)`);
    } finally {
      await env.close();
    }
  }, 180_000);

  it('thiet bi ton trong Retry-After + backoff khi bi giam tai (503), roi chay het luong', async () => {
    let shedLeft = 2;
    const env = await createInProcessEnv({ gateway: { load: () => (shedLeft-- > 0 ? 5 : 0) } });
    try {
      const r = await runFleet({ devices: 10, concurrency: 1, cycles: 1, eventsPerDevice: 1, transport: env.transport, confirmPairing: env.confirmPairing, timeScale: 1e-6 });
      // 2 lan hoi tai dau tien bi giam (503 + Retry-After): thiet bi ngu theo Retry-After (nen ~0) roi thu lai bang nonce moi
      await env.settle();
      expect(r.retries).toBe(2);
      expect(r.completed).toBe(10);
      expect(r.endpoints['heartbeat']!.statuses['503']).toBe(2);
    } finally {
      await env.close();
    }
  });

  it('nonce moi cho moi lan thu lai (khong bi 409 replay) va chu ky luon dung', async () => {
    let fail = 2;
    const env = await createInProcessEnv({ gateway: { load: () => (fail-- > 0 ? 9 : 0) } });
    try {
      const rec = new Recorder();
      const d = new VirtualDevice({ transport: env.transport, rec, confirmPairing: env.confirmPairing, rng: () => 0 });
      expect(await d.register()).toBe(true);
      fail = 2;
      const hb = await d.heartbeat(1);
      expect(hb).not.toBeNull();
      const st = rec.summary()['heartbeat']!.statuses;
      expect(st['503']).toBe(2);
      expect(st['200']).toBe(1);
      expect(st['409']).toBeUndefined();
    } finally {
      await env.close();
    }
  });

  it('chay cung luong tren pglite (Postgres) 150 thiet bi', async () => {
    const env = await createInProcessEnv({ dialect: 'postgres' });
    try {
      const r = await runFleet({ devices: 150, concurrency: 25, cycles: 2, eventsPerDevice: 3, transport: env.transport, confirmPairing: env.confirmPairing });
      await env.settle();
      expect(r.completed).toBe(150);
      expect(Number((await env.rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression'))[0]!.n)).toBe(450);
      expect(r.endpoints['ALL']!.errors).toBe(0);
    } finally {
      await env.close();
    }
  }, 120_000);
});
