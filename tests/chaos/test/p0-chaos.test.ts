// CHAOS cac thanh phan P0: spend_events (khu trung theo su kien), outbox (at-least-once), device_commands (giao lai/ack).
// Chi dung API cong khai: createSpendFn, enqueueOutbox/processOutbox, enqueueCommand + heartbeat/ack qua HTTP.
import { describe, expect, it } from 'vitest';
import { enqueueOutbox, processOutbox, outboxStats, type OutboxHandlers } from '@ams/runtime';
import { createSpendFn, settleSpendRemainders, reconcileLedger, type ImpressionSpendRequest } from '@ams/payments';
import { enqueueCommand } from '@ams/edge-gateway';
import { Dev, createWorld, num, MICRO } from '../src/world.js';
import { flaky, lossy, mulberry32, InjectedFault } from '../src/faults.js';
import { seeds } from '../src/seeds.js';
import { createTestRuntime } from '@ams/runtime';

describe('spend_events: cac lo chong lan + loi DB truoc/sau commit + dong thoi', () => {
  it.each(seeds())('moi event_id tinh dung mot lan; spend_events == so event duy nhat; vi == so cai [seed %i]', async (seed) => {
    const rand = mulberry32(seed);
    let F!: ReturnType<typeof flaky>;
    const w = await createWorld({ budgetVnd: 5_000_000, wrap: (rt) => (F = flaky(rt, { db: 0.1, delay: 0.3, when: 'mixed' }, rand)).rt });
    try {
      const spend = createSpendFn(F.rt);
      const pool = Array.from({ length: 40 }, (_, i) => ({ id: `evt-${seed}-${i}`, micro: w.priceMicro }));
      const used = new Set<string>();
      const jobs: Promise<void>[] = [];
      F.armed = true;
      for (let b = 0; b < 25; b++) {
        const size = 1 + Math.floor(rand() * 10);
        const start = Math.floor(rand() * (pool.length - size));
        const events = pool.slice(start, start + size);
        events.forEach((e) => used.add(e.id));
        const req: ImpressionSpendRequest = { campaignId: w.campaignIds[0]!, customerId: w.customerId, amountMicroVnd: size * w.priceMicro, impressions: size, idempotencyKey: `k${seed}-${b}`, firstTs: '2026-11-12T00:00:00.000Z', lastTs: '2026-11-12T00:00:01.000Z', events };
        jobs.push((async () => { for (let a = 0; a < 80; a++) { try { await spend(req); return; } catch { /* giao lai */ } } throw new Error('khong thanh cong'); })());
        if (rand() < 0.5) jobs.push(spend(req).catch(() => undefined)); // giao trung dong thoi
      }
      await Promise.all(jobs);
      F.armed = false;
      await settleSpendRemainders(w.rt);
      const info = `seed=${seed} loi=${JSON.stringify(F.injected)}`;
      const claimed = num((await w.rt.db.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM spend_events WHERE campaign_id = ?', [w.campaignIds[0]]))[0]!.n);
      expect(claimed, info).toBe(used.size);
      const c = (await w.rt.db.query<Record<string, unknown>>('SELECT spent_vnd, spend_remainder_micro FROM campaigns WHERE id = ?', [w.campaignIds[0]]))[0]!;
      expect(num(c['spent_vnd']) * MICRO + num(c['spend_remainder_micro']), 'khong tru kep/mat ' + info).toBe(used.size * w.priceMicro);
      expect((await reconcileLedger(w.rt)).mismatches, info).toEqual([]);
    } finally {
      await w.close();
    }
  });
});

describe('outbox: at-least-once duoi loi', () => {
  it.each(seeds())('duplicate dedupe_key chi tao mot viec; handler/DB loi -> thu lai, xong dung mot lan, khong dead, nhieu worker dong thoi [seed %i]', async (seed) => {
    const rand = mulberry32(seed);
    const rt = await createTestRuntime({ dialect: 'sqlite', now: '2026-11-12T03:00:00.000Z' });
    try {
      await rt.db.run('CREATE TABLE IF NOT EXISTS chaos_effect (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)');
      const F = flaky(rt, { db: 0.1, delay: 0.3, when: 'mixed' }, rand);
      let invocations = 0;
      const handlers: OutboxHandlers = {
        'chaos.work': async (m, r) => {
          invocations++;
          const k = (m.payload as { k: string }).k;
          // hieu ung idempotent (UNIQUE) + bo dem so lan chay de thay at-least-once
          await r.db.run('INSERT INTO chaos_effect (k, n) VALUES (?, 1) ON CONFLICT (k) DO UPDATE SET n = n + 1', [k]);
          if (rand() < 0.2) throw new InjectedFault('handler');
        },
      };
      const keys = Array.from({ length: 20 }, (_, i) => `job-${i}`);
      let created = 0;
      for (const k of [...keys, ...keys, ...keys.slice(0, 10)]) {
        for (let a = 0; a < 40; a++) {
          try { if (await enqueueOutbox(rt.db, rt, { topic: 'chaos.work', payload: { k }, dedupeKey: k })) created++; break; } catch { /* thu lai */ }
        }
      }
      expect(created).toBe(20);
      F.armed = true;
      for (let round = 0; round < 60; round++) {
        await Promise.all([processOutbox(F.rt, handlers, { limit: 7, maxAttempts: 100 }), processOutbox(F.rt, handlers, { limit: 7, maxAttempts: 100 })]).catch(() => undefined);
        rt.clock.advance(61_000); // het thue + lui
        const st = await outboxStats(rt.db).catch(() => null);
        if (st && st.pending === 0) break;
      }
      F.armed = false;
      const info = `seed=${seed} loi=${JSON.stringify(F.injected)} lan_chay=${invocations}`;
      const st = await outboxStats(rt.db);
      expect(st, info).toMatchObject({ pending: 0, dead: 0, done: 20 });
      const eff = await rt.db.query<{ k: string; n: unknown }>('SELECT k, n FROM chaos_effect');
      expect(eff.length, 'moi viec co hieu ung ' + info).toBe(20);
      expect(Math.min(...eff.map((e) => num(e.n))), info).toBeGreaterThanOrEqual(1);
      expect(invocations, info).toBeGreaterThanOrEqual(20);
    } finally {
      await rt.close();
    }
  });
});

describe('device_commands: giao lai + ack qua mang khong dang tin', () => {
  it.each(seeds())('moi lenh den thiet bi it nhat mot lan va cuoi cung acked; idempotency_key khong tao lenh trung; thiet bi khu trung theo id [seed %i]', async (seed) => {
    const rand = mulberry32(seed);
    let F!: ReturnType<typeof flaky>;
    const w = await createWorld({ wrap: (rt) => (F = flaky(rt, { db: 0.05, kv: 0.05, delay: 0.2, when: 'mixed' }, rand)).rt });
    try {
      const d = await Dev.create(w);
      const ids = new Set<string>();
      for (let i = 0; i < 8; i++) {
        const a = await enqueueCommand(w.rt, d.id, { type: i % 2 ? 'refresh_manifest' : 'reboot' }, { idempotencyKey: `cmd-${seed}-${i}` });
        const b = await enqueueCommand(w.rt, d.id, { type: i % 2 ? 'refresh_manifest' : 'reboot' }, { idempotencyKey: `cmd-${seed}-${i}` });
        expect(b, 'idempotency_key trung phai tra cung id').toBe(a);
        ids.add(a);
      }
      expect(num((await w.rt.db.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM device_commands WHERE device_id = ?', [d.id]))[0]!.n)).toBe(8);
      const net = lossy(d.transport, { dropReq: 0.2, dropResp: 0.3, dup: 0.1 }, rand);
      d.transport = net;
      F.armed = true;
      const executed = new Map<string, number>(); // id -> so lan GIAO (thiet bi chi thuc thi lan dau)
      const done = new Set<string>();
      for (let hb = 0; hb < 200 && done.size < ids.size; hb++) {
        w.rt.clock.advance(121_000); // vuot han giao lai
        let res: Response;
        try { res = await d.call('POST', '/v1/heartbeat', { state: 1 }); } catch { continue; }
        if (res.status !== 200) continue;
        const cmds = ((await res.json()).commands ?? []) as { id: string }[];
        const acks: { id: string; status: 'ok' }[] = [];
        for (const c of cmds) {
          executed.set(c.id, (executed.get(c.id) ?? 0) + 1);
          acks.push({ id: c.id, status: 'ok' });
        }
        if (acks.length) {
          try { const r = await d.call('POST', '/v1/commands/ack', { acks }); if (r.status === 200) acks.forEach((a) => done.add(a.id)); } catch { /* mat ack: se duoc giao lai */ }
        }
      }
      F.armed = false;
      const info = `seed=${seed} loi=${JSON.stringify(F.injected)} mang=${JSON.stringify(net.stats)}`;
      expect([...ids].filter((i) => !executed.has(i)), 'lenh MAT (khong bao gio duoc giao) ' + info).toEqual([]);
      const rows = await w.rt.db.query<{ id: string; status: string }>('SELECT id, status FROM device_commands WHERE device_id = ?', [d.id]);
      expect(rows.length, info).toBe(8);
      // ack mat (mang) co the de lenh 'delivered' roi duoc giao lai; sau khi he thong yen mot heartbeat sach + ack sach phai dong het
      net.clean = true;
      for (let i = 0; i < 4; i++) {
        w.rt.clock.advance(121_000);
        const cmds = ((await (await d.call('POST', '/v1/heartbeat', { state: 1 })).json()).commands ?? []) as { id: string }[];
        if (cmds.length) await d.call('POST', '/v1/commands/ack', { acks: cmds.map((c) => ({ id: c.id, status: 'ok' })) });
      }
      const fin = await w.rt.db.query<{ status: string }>('SELECT status FROM device_commands WHERE device_id = ?', [d.id]);
      expect(fin.map((r) => r.status).filter((s) => s !== 'acked'), 'tat ca lenh phai acked ' + info).toEqual([]);
    } finally {
      await w.close();
    }
  });
});
