import { describe, expect, it } from 'vitest';
import { TestDevice, harness, impression } from './helpers.js';

// Cung mot luong end-to-end tren ca hai dialect SQL (PLAN §7: Postgres/pglite va SQLite/D1).
describe.each(['postgres', 'sqlite'] as const)('luong thiet bi tron ven tren %s', (dialect) => {
  it('register -> pair -> heartbeat -> manifest -> events -> consumer', async () => {
    const h = await harness({ dialect, env: { HB_MIN_GAP_S: '0' }, fixture: { campaigns: 2, creativesPerCampaign: 2 } });
    try {
      const d = await TestDevice.create(h);
      await d.pair();
      const hb = (await (await d.call('POST', '/v1/heartbeat', { state: 1 })).json()) as { manifest_etag: string };
      const m = (await (await d.call('GET', '/v1/manifest')).json()) as { etag: string; creatives: unknown[] };
      expect(m.etag).toBe(hb.manifest_etag);
      expect(m.creatives.length).toBe(4);
      expect((await d.call('GET', `/v1/manifest?etag=${m.etag}`)).status).toBe(304);
      const evs = [impression(h), impression(h, { camp: 1 }), impression(h)];
      expect((await d.call('POST', '/v1/events', { events: evs })).status).toBe(202);
      expect((await d.call('POST', '/v1/events', { events: evs })).status).toBe(202);
      await h.rt.queue.drain();
      await h.gw.flush();
      expect(Number((await h.rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression'))[0]!.n)).toBe(3);
      expect(h.spends.reduce((s, x) => s + x.impressions, 0)).toBe(3);
      expect((await h.rt.db.query('SELECT 1 FROM ev_heartbeat')).length).toBe(1);
    } finally {
      await h.close();
    }
  }, 60_000);
});
