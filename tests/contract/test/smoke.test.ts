import { expect, it } from 'vitest';
import { Dev, createWorld, impression, settleMoney, snapshot, violations } from '../src/world.js';
it('world smoke', async () => {
  const w = await createWorld();
  const d = await Dev.create(w);
  const m = await d.manifest();
  expect(m.res.status).toBe(200);
  expect(m.json!.creatives.length).toBe(1);
  const ev = [impression(w), impression(w)];
  const r = await d.events(ev);
  expect(r.status).toBe(202);
  console.log(await r.clone().text());
  await settleMoney(w);
  console.log(JSON.stringify(await snapshot(w)));
  const acked = new Map([[w.campaignIds[0]!, new Set(ev.map((e) => e['event_id'] as string))]]);
  expect(await violations(w, { byCampaign: acked })).toEqual([]);
  await w.close();
});
