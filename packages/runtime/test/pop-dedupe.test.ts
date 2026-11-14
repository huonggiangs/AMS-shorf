// N8: proof-of-play khu trung THEO event_id trong DB (khong chi KV 7 ngay), tren Postgres (pglite) va SQLite/D1.
import { afterAll, describe, expect, it } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../src/test.js';

const row = (id: string, extra: Record<string, unknown> = {}) => ({ event_id: id, ts: '2026-11-14T01:00:00.000Z', screen_id: 's1', creative_id: 'c1', duration_ms: 10_000, source: 'device', ...extra });

for (const dialect of ['postgres', 'sqlite'] as const) {
  describe(`ev_proof_of_play UNIQUE theo event_id (${dialect})`, () => {
    let rt: TestRuntime;
    afterAll(async () => rt?.close());
    it('ghi lai cung event_id (KV mat/het han, giao lai) khong ghi doi; trong cung lo cung vay', async () => {
      rt = await createTestRuntime({ dialect });
      await rt.events.append('proof_of_play', [row('e1'), row('e2'), row('e1')]);
      await rt.events.append('proof_of_play', [row('e1'), row('e2'), row('e3')]);
      const n = (await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_proof_of_play'))[0]!.n;
      expect(Number(n)).toBe(3);
      const seen = (await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_pop_seen'))[0]!.n;
      expect(Number(seen)).toBe(3);
    });
    it('hang khong co event_id (client cu) van ghi nhu truoc', async () => {
      await rt.events.append('proof_of_play', [{ ts: '2026-11-14T02:00:00.000Z', screen_id: 's1', creative_id: 'c1', duration_ms: 1 }]);
      const n = (await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_proof_of_play'))[0]!.n;
      expect(Number(n)).toBe(4);
    });
    it('hai lo dong thoi cung event_id: chi mot ban ghi', async () => {
      await Promise.all(Array.from({ length: 5 }, () => rt.events.append('proof_of_play', [row('race-1')])));
      const n = (await rt.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM ev_proof_of_play WHERE creative_id = 'c1' AND ts = '2026-11-14T01:00:00.000Z'"))[0]!.n;
      expect(Number(n)).toBe(4); // e1,e2,e3,race-1
    });
  });
}
