// CHAOS su kien -> chi tieu: thiet bi (mang khong dang tin) -> gateway -> queue -> ingest-consumer -> vi/so cai.
// Bat bien sau khi he thong yen: khong mat su kien da duoc 202, khong ghi trung, khong tru kep/mat tien, so cai == cache vi, manifest nhat quan.
import { describe, expect, it } from 'vitest';
import { Dev, createWorld, settle, settleMoney, snapshot, violations, num, type World } from '../src/world.js';
import { flaky, lossy, mulberry32, type FaultConfig, type NetConfig } from '../src/faults.js';
import { newAcked, runLoad, pushBatch, makeBatch } from '../src/driver.js';
import { seeds } from '../src/seeds.js';

// x2: loi kv tren creative:sha256:* | creative:rendition:* da duoc sua (suy giam tung creative, khong cache ban suy giam) => khong con khoa nao bi bo qua.
const SKIP: string[] = [];
const injectedBy = new Map<string, number>();
const DIALECTS = (process.env['CHAOS_DIALECTS'] ?? 'sqlite').split(',') as ('sqlite' | 'postgres')[];

interface Scenario {
  name: string;
  net?: NetConfig;
  faults?: FaultConfig;
  /** chi chen loi o gateway, o consumer, hoac ca hai */
  where?: 'both' | 'gateway' | 'consumer';
}
const scenarios: Scenario[] = [
  { name: 'mang: mat yeu cau, mat phan hoi, gui trung', net: { dropReq: 0.2, dropResp: 0.25, dup: 0.2 } },
  { name: 'hang doi: gui trung + giu & giao sai thu tu', faults: { queueDup: 0.4, queueHold: 0.4, delay: 0.3 } },
  { name: 'hang doi: send that bai (gateway tra 5xx, thiet bi gui lai)', faults: { queueSend: 0.3, queueDup: 0.2 }, where: 'gateway' },
  { name: 'DB that bai truoc/sau commit o consumer (giao lai message)', faults: { db: 0.12, when: 'mixed', delay: 0.2 }, where: 'consumer' },
  { name: 'KV that bai (khu trung nhanh, nonce, gioi han toc do)', faults: { kv: 0.15, delay: 0.2, kvSkipGet: SKIP } },
  { name: 'tat ca cung luc', net: { dropReq: 0.1, dropResp: 0.15, dup: 0.1 }, faults: { kvSkipGet: SKIP, db: 0.06, kv: 0.08, queueSend: 0.1, queueDup: 0.2, queueHold: 0.2, delay: 0.2, when: 'mixed' } },
];

describe.each(DIALECTS)('chaos su kien (%s)', (dialect) => {
  for (const sc of scenarios) {
    it.each(seeds())(`${sc.name} [seed %i]`, async (seed) => {
      const rand = mulberry32(seed);
      // loi chi gan cho gateway/consumer qua `wrap`; hai bo boc dung CHUNG mot Flaky de dem loi va giu tin
      let gwF!: ReturnType<typeof flaky>;
      const w = await createWorld({
        dialect,
        campaigns: 2,
        budgetVnd: 5_000_000, // du lon: khong het ngan sach (da co test het ngan sach rieng)
        wrap: (rt) => {
          gwF = flaky(rt, sc.faults ?? {}, rand);
          return gwF.rt;
        },
      });
      try {
        const devs: Dev[] = [];
        for (let i = 0; i < 3; i++) devs.push(await Dev.create(w, { region: i === 2 ? 'HCM' : 'HN' }));
        const nets = devs.map((d) => {
          const t = lossy(d.transport, sc.net ?? {}, rand);
          d.transport = t;
          return t;
        });
        const acked = newAcked();
        gwF.armed = true;
        await runLoad(w, devs, acked, rand, { camps: [0, 1], batchesPerDev: 6 });
        // het chen loi: giao nốt tin dang giu, de he thong yen, thu tin chet (dead letter) bang cach phat lai thu cong
        gwF.armed = false;
        nets.forEach((n) => (n.clean = true));
        await gwF.flushQueue();
        await settle(w);
        const dead = (w.rt.queue as { dead: { topic: string; msg: unknown }[] }).dead.splice(0);
        if (process.env['CHAOS_DEBUG']) console.warn(`[chaos] ${sc.name} seed=${seed} dead=${dead.length} injected=${JSON.stringify(gwF.injected)}`);
        for (const m of dead) await w.rt.queue.send(m.topic, m.msg); // van hanh phat lai DLQ
        await settleMoney(w);
        const v = await violations(w, acked);
        injectedBy.set(sc.name, (injectedBy.get(sc.name) ?? 0) + gwF.injected.db + gwF.injected.kv + gwF.injected.queue + nets.reduce((a, n) => a + n.stats.dropReq + n.stats.dropResp + n.stats.dup, 0));
        const info = `seed=${seed} dialect=${dialect} loi=${JSON.stringify(gwF.injected)} dead=${dead.length} resent=${[...acked.attempts.values()].filter((x) => x > 1).length}/${acked.attempts.size}`;
        expect(acked.flagged.size, 'su kien hop le bi danh dau khong hop le khi co loi ' + info).toBe(0);
        expect(acked.rejected, info + ' ' + JSON.stringify(acked.rejected.slice(0, 3))).toEqual([]);
        expect(v, info).toEqual([]);
        expect(acked.attempts.size, 'tai that su sinh su kien ' + info).toBeGreaterThan(20);
      } finally {
        await w.close();
      }
    });
  }
});

describe('xac nhan chen loi that su xay ra', () => {
  it('moi kich ban da chen it nhat mot loi tren tong cac seed (khong "xanh gia" vi chua chay loi)', () => {
    for (const sc of scenarios) expect(injectedBy.get(sc.name) ?? 0, sc.name).toBeGreaterThan(0);
  });
});

describe('chaos: het ngan sach duoi tai dong thoi', () => {
  it.each(seeds())('4 thiet bi x gui trung, ngan sach 100 VND: khong chi vuot ngan sach, chi het dung 100, chien dich dung, manifest go chien dich [seed %i]', async (seed) => {
    const rand = mulberry32(seed);
    let F!: ReturnType<typeof flaky>;
    const w = await createWorld({ campaigns: 1, budgetVnd: 100, walletVnd: 1_000, wrap: (rt) => (F = flaky(rt, { kvSkipGet: SKIP, db: 0.04, kv: 0.04, queueDup: 0.3, queueHold: 0.2, delay: 0.2, when: 'mixed' }, rand)).rt });
    try {
      const devs: Dev[] = [];
      for (let i = 0; i < 4; i++) devs.push(await Dev.create(w));
      const man0 = (await devs[0]!.manifest()).json!;
      expect(man0.creatives.length).toBe(1);
      const acked = newAcked();
      F.armed = true;
      await runLoad(w, devs, acked, rand, { batchesPerDev: 5, maxBatch: 6, resendProb: 0.5 });
      F.armed = false;
      await F.flushQueue();
      await settle(w);
      for (const m of (w.rt.queue as { dead: { topic: string; msg: unknown }[] }).dead.splice(0)) await w.rt.queue.send(m.topic, m.msg);
      await settleMoney(w);
      const info = `seed=${seed} loi=${JSON.stringify(F.injected)}`;
      const s = await snapshot(w);
      const c = s.campaigns[0]!;
      const demandMicro = (acked.byCampaign.get(w.campaignIds[0]!)?.size ?? 0) * w.priceMicro;
      expect(demandMicro, 'cau hinh: nhu cau phai vuot ngan sach ' + info).toBeGreaterThan(100 * 1_000_000);
      expect(c.spent, 'het ngan sach thi chi dung bang ngan sach ' + info).toBe(100);
      expect(c.reserved, info).toBe(0);
      expect(c.state, info).toBe('ended');
      expect(s.wallet.balance, info).toBe(1_000 - 100);
      expect(s.wallet.reserved, info).toBe(0);
      expect(await violations(w, acked), info).toEqual([]);
      // manifest nhat quan: chien dich da dung bien mat khoi manifest sau khi cache het han (epoch da tang khi het ngan sach)
      w.rt.clock.advance(20_000);
      const man1 = (await devs[0]!.manifest()).json!;
      expect(man1.creatives, info).toEqual([]);
      expect(man1.schedule, info).toEqual([]);
      expect(man1.etag, info).not.toBe(man0.etag);
    } finally {
      await w.close();
    }
  });
});

describe('chaos: manifest nhat quan khi KV/DB loi', () => {
  it.each(seeds())('loi khong bao gio sinh ra manifest tham chieu creative thieu / etag khong on dinh; loi tra dung phong bi { error } [seed %i]', async (seed) => {
    const rand = mulberry32(seed);
    let F!: ReturnType<typeof flaky>;
    const w = await createWorld({ campaigns: 2, creativesPerCampaign: 2, wrap: (rt) => (F = flaky(rt, { db: 0.1, kv: 0.15, delay: 0.2, when: 'before', kvSkipGet: SKIP }, rand)).rt });
    try {
      const d = await Dev.create(w);
      const ref = (await d.manifest()).json!;
      F.armed = true;
      let ok = 0;
      let err = 0;
      for (let i = 0; i < 80; i++) {
        if (i % 20 === 19) w.rt.clock.advance(20_000);
        const { res, json, text } = await d.manifest().catch(() => ({ res: undefined, json: null, text: '' }));
        if (!res) continue;
        if (res.status === 200) {
          ok++;
          const ids = new Set(json!.creatives.map((c) => c.id));
          for (const s of json!.schedule) for (const id of s.creative_ids) expect(ids.has(id), `seed=${seed} lich tham chieu creative thieu`).toBe(true);
          expect(json!.etag, `seed=${seed} etag doi du noi dung khong doi`).toBe(ref.etag);
          expect(json!.creatives.map((c) => c.sha256).sort()).toEqual(ref.creatives.map((c) => c.sha256).sort());
        } else if (res.status !== 304) {
          err++;
          const b = (text ? JSON.parse(text) : {}) as { error?: { code: string } };
          expect(b.error?.code, `seed=${seed} HTTP ${res.status} khong co phong bi loi`).toBeTruthy();
          expect(res.status, `seed=${seed}`).toBeGreaterThanOrEqual(400);
        }
      }
      expect(ok + err).toBeGreaterThan(0);
      F.armed = false;
      const after = (await d.manifest()).json!;
      expect(after.etag).toBe(ref.etag);
    } finally {
      await w.close();
    }
  });
});

describe('chaos: giao lai message dong thoi (consumer)', () => {
  it('cung mot message giao 20 lan dong thoi + sai thu tu: chi tinh mot lan', async () => {
    const w = await createWorld({ campaigns: 1 });
    try {
      const d = await Dev.create(w);
      const evs = makeBatch(w, mulberry32(7), 30);
      const acked = newAcked();
      await pushBatch(w, d, evs, acked);
      await settle(w);
      const msgs = w.rt.queue.sent.filter((m) => m.topic === 'ingest.events').map((m) => m.msg);
      expect(msgs.length).toBeGreaterThan(0);
      const copies = Array.from({ length: 20 }, () => msgs).flat().sort(() => mulberry32(3)() - 0.5);
      await Promise.all(copies.map((m) => w.consumer.handle(m as never)));
      await settleMoney(w);
      expect(await violations(w, acked)).toEqual([]);
      expect(num((await snapshot(w)).impressionRows.length)).toBe(30);
    } finally {
      await w.close();
    }
  });
});

describe('loi KV/objects khi dung manifest (x2: da sua)', () => {
  it('kv.get(creative:sha256:*) that bai KHONG duoc lam manifest mat creative (hien tra 200 voi creatives rong, event hop le bi tu choi not_in_manifest)', async () => {
    let on = false;
    const w = await createWorld({ wrap: (rt) => ({ ...rt, kv: { get: async (k: string) => { if (on && k.startsWith('creative:sha256:')) throw new Error('kv loi'); return rt.kv.get(k); }, set: (k, v, t) => rt.kv.set(k, v, t), del: (k) => rt.kv.del(k), incr: (k, t) => rt.kv.incr(k, t) } }) });
    try {
      const d = await Dev.create(w);
      expect((await d.manifest()).json!.creatives.length).toBe(1);
      w.rt.clock.advance(120_000);
      await w.rt.kv.del('manifest:HN.all.tv');
      await w.rt.kv.incr('manifest:epoch');
      on = true;
      const r = await d.manifest();
      expect(r.res.status === 200 ? r.json!.creatives.length : 1).toBe(1);
    } finally {
      await w.close();
    }
  });

  it('kv.set(creative:sha256:*) va kv.get/set(creative:rendition:*) that bai: van du creative, khong go', async () => {
    let on = false;
    const w = await createWorld({ wrap: (rt) => ({ ...rt, kv: {
      get: async (k: string) => { if (on && k.startsWith('creative:')) throw new Error('kv loi'); return rt.kv.get(k); },
      set: async (k: string, v: string, t?: number) => { if (on && k.startsWith('creative:')) throw new Error('kv loi'); return rt.kv.set(k, v, t); },
      del: (k) => rt.kv.del(k), incr: (k, t) => rt.kv.incr(k, t) } }) });
    try {
      const d = await Dev.create(w);
      w.rt.clock.advance(120_000);
      await w.rt.kv.del('manifest:HN.all.tv');
      await w.rt.kv.incr('manifest:epoch');
      on = true;
      const r = await d.manifest();
      expect(r.res.status).toBe(200);
      expect(r.json!.creatives.length).toBe(1);
    } finally {
      await w.close();
    }
  });

  it('objects.get tam thoi that bai: khong cache manifest thieu; hoi lai khi objects phuc hoi thi day du', async () => {
    let on = false;
    const w = await createWorld({ wrap: (rt) => ({ ...rt, objects: { ...rt.objects, get: async (k: string) => { if (on) throw new Error('objects loi'); return rt.objects.get(k); } } as typeof rt.objects }) });
    try {
      const d = await Dev.create(w);
      expect((await d.manifest()).json!.creatives.length).toBe(1);
      w.rt.clock.advance(120_000);
      await w.rt.kv.del('manifest:HN.all.tv');
      await w.rt.kv.del(`creative:sha256:${(await w.rt.db.query<{ id: string }>('SELECT id FROM creatives'))[0]!.id}`);
      await w.rt.kv.incr('manifest:epoch');
      on = true;
      const r1 = await d.manifest();
      // suy giam: hoac ban cu day du, hoac 5xx; KHONG BAO GIO ban rong duoc cache
      expect(r1.res.status === 200 ? r1.json!.creatives.length : 1).toBe(1);
      expect(await w.rt.kv.get('manifest:HN.all.tv')).toBeNull();
      on = false;
      const r2 = await d.manifest();
      expect(r2.json!.creatives.length).toBe(1);
    } finally {
      await w.close();
    }
  });
});
