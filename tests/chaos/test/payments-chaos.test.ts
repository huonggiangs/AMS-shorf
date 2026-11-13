// CHAOS tien: webhook SePay (lap, dong thoi, sai thu tu, DB loi truoc/sau commit, mat dien o MOI ranh gioi ghi) va chi tieu impression qua consumer.
// Bat bien: so cai == cache vi (reconcileLedger), khong cong/tru kep, moi giao dich/su kien dung mot lan sau khi he thong hoi tu.
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { crashable, createTestRuntime, SimulatedCrash, type Runtime, type TestRuntime } from '@ams/runtime';
import { hmacSha256Hex, uuidv7 } from '@ams/shared';
import { mountFinance, reconcileLedger, saveSepayConfig, creditTopup, sweepActivations, mailOutboxHandlers } from '@ams/payments';
import { processOutbox } from '@ams/runtime';
type ImpressionRow = { ts: string; event_id: string; device_id: string; screen_id: string | null; campaign_id: string; creative_id: string; slot_id: string | null; partner_id: string | null; region_id: string | null; vcr_pct: number; valid: 0 | 1; reject_reason: string | null; revenue_micro_vnd: number; reward_vnd: number };
import { createWorld, settleMoney, snapshot, violations, num, MICRO } from '../src/world.js';
import { flaky, mulberry32, sleep } from '../src/faults.js';
import { seeds } from '../src/seeds.js';

const NOW = '2026-11-12T03:00:00.000Z';
const SECRET = 'test-sepay-secret';
const DIALECTS = (process.env['CHAOS_DIALECTS'] ?? 'sqlite').split(',') as ('sqlite' | 'postgres')[];

async function mkRt(dialect: 'sqlite' | 'postgres'): Promise<TestRuntime> {
  const rt = await createTestRuntime({ dialect, now: NOW });
  await rt.db.run('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)', ['T1', 'AMS', NOW]);
  await saveSepayConfig(rt, rt.db, { enabled: true, bank: 'MBBank', account_number: '0123456789', account_holder: 'CONG TY MAU', prefix: 'AMS', min_amount_vnd: 5_000_000, auto_activate: true }, 'test');
  return rt;
}
async function mkCustomer(rt: TestRuntime, code: string): Promise<string> {
  const id = rt.id();
  await rt.db.run('INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, email, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, 'T1', 'Cong ty ' + code, code, code, 'active', code.toLowerCase() + '@example.test', NOW]);
  return id;
}
const body = (id: number, amount: number, code: string) => JSON.stringify({ id, gateway: 'MBBank', transactionDate: '2026-11-12 10:00:00', accountNumber: '0123456789', content: `AMS ${code} chuyen khoan`, transferType: 'in', transferAmount: amount, referenceCode: 'FT' + id });
async function signedHeaders(rt: Runtime, raw: string): Promise<Record<string, string>> {
  const ts = String(Math.floor(rt.clock.now().getTime() / 1000));
  return { 'content-type': 'application/json', 'x-sepay-timestamp': ts, 'x-sepay-signature': 'sha256=' + (await hmacSha256Hex(SECRET, `${ts}.${raw}`)) };
}
/** SePay: gui lai den khi nhan 200 (HTTP khac 200 = se gui lai). Tra ve so lan gui. */
async function deliver(app: Hono, rt: Runtime, raw: string, max = 60): Promise<number> {
  for (let i = 1; i <= max; i++) {
    try {
      const r = await app.request('/webhooks/payments/sepay', { method: 'POST', body: raw, headers: await signedHeaders(rt, raw) });
      await r.arrayBuffer();
      if (r.status === 200) return i;
    } catch {
      /* mang/ngoai le: gui lai */
    }
    if (i % 4 === 0) await sleep(1);
  }
  throw new Error('webhook khong bao gio duoc nhan 200');
}
const bal = async (rt: TestRuntime, cid: string) => num((await rt.db.query<{ b: unknown }>('SELECT balance_vnd AS b FROM ad_wallets WHERE customer_id = ?', [cid]))[0]?.b);

describe.each(DIALECTS)('chaos webhook SePay (%s)', (dialect) => {
  it.each(seeds())('lap + dong thoi + sai thu tu + DB loi truoc/sau commit: moi giao dich dung mot lan [seed %i]', async (seed) => {
    const rand = mulberry32(seed);
    const rt = await mkRt(dialect);
    try {
      const F = flaky(rt, { db: 0.08, kv: 0.05, delay: 0.25, when: 'mixed' }, rand);
      const app = new Hono();
      mountFinance(app, F.rt);
      const custs = await Promise.all(['CA', 'CB', 'CC'].map((c) => mkCustomer(rt, c)));
      const codes = ['CA', 'CB', 'CC'];
      const txs = Array.from({ length: 24 }, (_, i) => ({ id: 880000 + i, ci: i % 3, amount: 5_000_000 + 1_000_000 * Math.floor(rand() * 5) }));
      const expected = new Map<string, number>();
      for (const t of txs) expected.set(custs[t.ci]!, (expected.get(custs[t.ci]!) ?? 0) + t.amount);
      // moi giao dich gui 1..4 lan (lap + dong thoi), thu tu xao tron, tat ca chay chong lan
      const jobs: Promise<unknown>[] = [];
      const plan = txs.flatMap((t) => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => t)).sort(() => rand() - 0.5);
      F.armed = true;
      for (const t of plan) jobs.push(deliver(app, F.rt, body(t.id, t.amount, codes[t.ci]!)));
      await Promise.all(jobs);
      F.armed = false;
      const info = `seed=${seed} loi=${JSON.stringify(F.injected)} lan_gui=${plan.length}`;
      for (const [cid, amt] of expected) expect(await bal(rt, cid), 'so du ' + info).toBe(amt);
      expect(num((await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM topups WHERE status = 'credited'"))[0]!.n), 'so topup ' + info).toBe(txs.length);
      expect(num((await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM wallet_entries WHERE kind = 'topup'"))[0]!.n), 'so dong so cai ' + info).toBe(txs.length);
      expect((await reconcileLedger(rt)).mismatches, info).toEqual([]);
      expect(F.injected.db + F.injected.kv, 'co chen loi that ' + info).toBeGreaterThan(0);
    } finally {
      await rt.close();
    }
  });

  it('chu ky hop le nhung timestamp cu hon 5 phut (phat lai muon) khong cong tien, ke ca khi cung giao dich da xu ly', async () => {
    const rt = await mkRt(dialect);
    try {
      const app = new Hono();
      mountFinance(app, rt);
      const cid = await mkCustomer(rt, 'REPL');
      const raw = body(990001, 6_000_000, 'REPL');
      const hdr = await signedHeaders(rt, raw);
      expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body: raw, headers: hdr })).status).toBe(200);
      rt.clock.advance(6 * 60_000);
      expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body: raw, headers: hdr })).status).toBe(401);
      expect(await bal(rt, cid)).toBe(6_000_000);
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    } finally {
      await rt.close();
    }
  });
});

describe.each(DIALECTS)('mat dien o MOI ranh gioi ghi (%s)', (dialect) => {
  for (const nonAtomic of [false, true]) {
    it(`webhook: crash truoc lan ghi thu k roi gui lai -> dung mot lan, so cai khop (${nonAtomic ? 'D1: giao dich khong hoan tac' : 'pg/sqlite: giao dich hoan tac'})`, async () => {
      // dem so lan ghi cua mot webhook thanh cong
      const probe = await mkRt(dialect);
      const pc = crashable(probe, { nonAtomic });
      const papp = new Hono();
      mountFinance(papp, pc.rt);
      await mkCustomer(probe, 'SWEEP');
      pc.ctl.reset();
      await deliver(papp, pc.rt, body(1, 7_000_000, 'SWEEP'));
      const W = pc.ctl.writes;
      await probe.close();
      expect(W).toBeGreaterThan(4);
      const unrecovered: number[] = [];
      for (let k = 1; k <= W; k++) {
        const rt = await mkRt(dialect);
        try {
          const c = crashable(rt, { nonAtomic });
          const app = new Hono();
          mountFinance(app, c.rt);
          const cid = await mkCustomer(rt, 'SWEEP');
          const raw = body(1, 7_000_000, 'SWEEP');
          c.ctl.reset();
          c.ctl.armAt(k);
          let first: number | string;
          try {
            first = (await app.request('/webhooks/payments/sepay', { method: 'POST', body: raw, headers: await signedHeaders(rt, raw) })).status;
          } catch (e) {
            first = e instanceof SimulatedCrash ? 'crash' : String(e);
          }
          expect(first, `k=${k}/${W}: mat dien phai khong the tra 200 (SePay se khong gui lai)`).not.toBe(200);
          if (!nonAtomic) {
            // giao dich that: sau mat dien KHONG de lai trang thai do (khong co dong so cai mo coi, khong lech cache)
            const rec = await reconcileLedger(rt);
            expect(rec.mismatches, `k=${k}/${W} lech so cai ngay sau mat dien (chua gui lai)`).toEqual([]);
          }
          c.ctl.reset();
          expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body: raw, headers: await signedHeaders(rt, raw) })).status, `k=${k} gui lai`).toBe(200);
          await app.request('/webhooks/payments/sepay', { method: 'POST', body: raw, headers: await signedHeaders(rt, raw) });
          const balance = await bal(rt, cid);
          const entries = num((await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM wallet_entries WHERE kind = 'topup' AND customer_id = ?", [cid]))[0]!.n);
          const mism = (await reconcileLedger(rt)).mismatches;
          expect(balance, `k=${k}/${W} CONG KEP`).toBeLessThanOrEqual(7_000_000);
          expect(entries, `k=${k}/${W} so dong so cai`).toBeLessThanOrEqual(1);
          if (!nonAtomic) {
            expect(balance, `k=${k}/${W} so du`).toBe(7_000_000);
            expect(entries).toBe(1);
            expect(mism, `k=${k}/${W}`).toEqual([]);
          } else if (balance !== 7_000_000 || entries !== 1) {
            // D1: khong tu hoi phuc duoc (topup da 'credited' truoc khi cong vi). BAT BIEN toi thieu: khong mat tien IM LANG — doi soat phai phat hien.
            unrecovered.push(k);
            expect(mism.length, `k=${k}/${W} MAT TIEN NAP IM LANG: vi=${balance} nhung reconcileLedger khong bao lech`).toBeGreaterThan(0);
          } else expect(mism, `k=${k}/${W}`).toEqual([]);
        } finally {
          await rt.close();
        }
      }
      if (unrecovered.length) console.warn(`[chaos] webhook D1: ${unrecovered.length}/${W} diem mat dien can doi soat thu cong (k=${unrecovered.join(',')}) — xem ops/agents/t2-contract-chaos.requests.md`);
    });
  }

  for (const nonAtomic of [false, true]) {
    it(`consumer chi tieu: crash truoc lan ghi thu k roi giao lai message -> khong tru kep, khong mat tien, khong mat su kien (${nonAtomic ? 'D1' : 'tx that'})`, async () => {
      const mkRows = (w: Awaited<ReturnType<typeof createWorld>>, n: number): ImpressionRow[] =>
        Array.from({ length: n }, (_, i) => ({
          ts: new Date(w.rt.clock.now().getTime() - 5000 - i).toISOString(),
          event_id: uuidv7(w.rt.clock.now().getTime() - 5000 - i),
          device_id: 'DEV1',
          screen_id: null,
          campaign_id: w.campaignIds[0]!,
          creative_id: w.fixture.campaigns[0]!.creatives[0]!.id,
          slot_id: w.fixture.campaigns[0]!.slotId,
          partner_id: null,
          region_id: null,
          vcr_pct: 100,
          valid: 1,
          reject_reason: null,
          revenue_micro_vnd: w.priceMicro,
          reward_vnd: 0,
        }));
      // dem so lan ghi
      let W = 0;
      {
        let ctl!: ReturnType<typeof crashable>['ctl'];
        const w = await createWorld({ wrap: (rt) => { const c = crashable(rt, { nonAtomic }); ctl = c.ctl; return c.rt; } });
        ctl.reset();
        await w.consumer.handle({ v: 1, device_id: 'DEV1', impressions: mkRows(w, 5), pops: [] });
        W = ctl.writes;
        await w.close();
      }
      expect(W).toBeGreaterThan(5);
      const underCharged: string[] = [];
      const detectedOnly: number[] = [];
      for (let k = 1; k <= W; k++) {
        let ctl!: ReturnType<typeof crashable>['ctl'];
        const w = await createWorld({ wrap: (rt) => { const c = crashable(rt, { nonAtomic }); ctl = c.ctl; return c.rt; } });
        try {
          const rows = mkRows(w, 5);
          const msg = { v: 1 as const, device_id: 'DEV1', impressions: rows, pops: [] };
          ctl.reset();
          ctl.armAt(k);
          let crashed = false;
          await w.consumer.handle(msg).catch((e) => {
            crashed = true;
            expect(e).toBeInstanceOf(SimulatedCrash);
          });
          expect(crashed, `k=${k}/${W}: crash phai noi len de queue giao lai`).toBe(true);
          ctl.reset();
          await w.consumer.handle(msg); // giao lai
          await w.consumer.handle(msg); // giao lai lan nua (at-least-once)
          await settleMoney(w);
          const acked = { byCampaign: new Map([[w.campaignIds[0]!, new Set(rows.map((r) => r.event_id))]]) };
          let v = await violations(w, acked, { allowUnderCharge: nonAtomic });
          if (nonAtomic) {
            // D1 khong hoan tac: cho phep lech vi/chien dich NEU reconcileLedger phat hien (khong duoc lech IM LANG); khong bao gio tru kep
            const ledgerish = (m: string) => /^(reconcileLedger lech|tong spent_vnd|tong so cai|so du )/.test(m);
            const silent = v.filter((m) => !ledgerish(m));
            const detected = v.some((m) => m.startsWith('reconcileLedger lech'));
            if (v.some(ledgerish) && !detected) silent.push('lech vi/chien dich IM LANG (reconcileLedger khong phat hien)');
            if (v.some(ledgerish)) detectedOnly.push(k);
            v = silent;
          }
          expect(v, `k=${k}/${W}`).toEqual([]);
          if (nonAtomic) {
            const sn = await snapshot(w);
            const charged = sn.campaigns[0]!.spent * MICRO + sn.campaigns[0]!.remainder;
            if (charged < 5 * w.priceMicro) underCharged.push(`k=${k}: thieu ${(5 * w.priceMicro - charged) / MICRO} VND`);
          }
        } finally {
          await w.close();
        }
      }
      if (detectedOnly.length) console.warn(`[chaos] consumer D1: ${detectedOnly.length}/${W} diem mat dien de lai lech vi/chien dich (chi doi soat phat hien, khong tu hoi phuc): k=${detectedOnly.join(',')}`);
      if (underCharged.length) console.warn(`[chaos] consumer D1: ${underCharged.length}/${W} diem mat dien thu thieu tien (nghieng ve khach, reconcileLedger KHONG phat hien): ${underCharged.slice(0, 4).join('; ')}`);
    });
  }
});

describe.each(DIALECTS)('nap tien dong thoi voi chi tieu + kich hoat tu dong (%s)', (dialect) => {
  it.each(seeds())('webhook nap (lap) kich hoat chien dich dang cho tien trong khi impression van chi tieu: vi == so cai, giu tien dung mot lan [seed %i]', async (seed) => {
    const rand = mulberry32(seed);
    let F!: ReturnType<typeof flaky>;
    const w = await createWorld({ dialect, campaigns: 1, budgetVnd: 1_000_000, walletVnd: 1_000_000, wrap: (rt) => (F = flaky(rt, { db: 0.05, kv: 0.05, delay: 0.3, when: 'mixed' }, rand)).rt });
    try {
      // chien dich thu hai da duyet, dang cho tien (vi chi du cho chien dich 1)
      const camp2 = w.rt.id();
      await w.rt.db.run(
        `INSERT INTO campaigns (id, customer_id, name, state, budget_cap_vnd, approved_budget_vnd, funding_state, start_at, created_at, updated_at, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [camp2, w.customerId, 'Cho tien', 'awaiting_funds', 3_000_000, 3_000_000, 'awaiting_funds', '2026-01-01T00:00:00.000Z', NOW, NOW, NOW],
      );
      await w.rt.db.run("UPDATE customers SET payment_code = 'ACT1' WHERE id = ?", [w.customerId]);
      await saveSepayConfig(w.rt, w.rt.db, { enabled: true, bank: 'MBBank', account_number: '0123456789', account_holder: 'CTY', prefix: 'AMS', min_amount_vnd: 5_000_000, auto_activate: true }, 'test');
      const app = new Hono();
      mountFinance(app, F.rt);
      const { Dev } = await import('../src/world.js');
      const { newAcked, runLoad } = await import('../src/driver.js');
      const devs = [await Dev.create(w), await Dev.create(w)];
      const acked = newAcked();
      F.armed = true;
      const hooks = [1, 2, 3, 4].flatMap((i) => [body(770000 + i, 5_000_000, 'ACT1'), body(770000 + i, 5_000_000, 'ACT1')]).sort(() => rand() - 0.5);
      await Promise.all([runLoad(w, devs, acked, rand, { batchesPerDev: 5 }), ...hooks.map((h) => deliver(app, F.rt, h))]);
      F.armed = false;
      await F.flushQueue();
      await w.rt.queue.drain();
      for (const m of (w.rt.queue as { dead: { topic: string; msg: unknown }[] }).dead.splice(0)) await w.rt.queue.send(m.topic, m.msg);
      await settleMoney(w);
      const info = `seed=${seed} loi=${JSON.stringify(F.injected)}`;
      const rec = await reconcileLedger(w.rt);
      expect(rec.mismatches, info).toEqual([]);
      // 4 giao dich x 5.000.000 cong dung mot lan
      const topups = num((await w.rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM wallet_entries WHERE kind = 'topup' AND ref_type = 'topup'"))[0]!.n);
      expect(topups, info).toBe(4);
      const s = await snapshot(w);
      const c2 = (await w.rt.db.query<Record<string, unknown>>('SELECT state, funding_state, reserved_vnd FROM campaigns WHERE id = ?', [camp2]))[0]!;
      // Kich hoat co the mat khi loi roi vao khe giua cong vi va runActivation: LOI DA BIET (requests muc 2, co test tat dinh rieng) nen khong khang dinh o day
      if (c2['funding_state'] === 'reserved') {
        expect(num(c2['reserved_vnd']), info).toBe(3_000_000);
        expect(['active', 'scheduled'], info).toContain(c2['state']);
      } else expect(num(c2['reserved_vnd']), info).toBe(0);
      expect(s.wallet.reserved, 'vi.reserved == tong giu cua chien dich ' + info).toBe(s.campaigns.reduce((a, c) => a + c.reserved, 0));
      // chi tieu impression chien dich 1: khong tru kep/mat (violations kiem tra tong spent; so du nap them nen kiem rieng)
      const c1 = s.campaigns.find((c) => c.id === w.campaignIds[0])!;
      const n = acked.byCampaign.get(w.campaignIds[0]!)?.size ?? 0;
      expect(c1.spent * MICRO + c1.remainder, 'tru dung so impression ' + info).toBe(n * w.priceMicro);
      expect(s.impressionRows.length, info).toBe(n);
    } finally {
      await w.close();
    }
  });
});

describe.each(DIALECTS)('webhook + kich hoat tu dong: mat dien o moi ranh gioi ghi (%s, tx that)', (dialect) => {
  // x2: da sua (creditTopup 'already' -> healActivation) => it() thuong.
  it('crash truoc lan ghi thu k roi SePay gui lai: chien dich cho tien duoc giu tien dung mot lan', async () => {
    const setup = async (rt: TestRuntime) => {
      const cid = await mkCustomer(rt, 'ACTV');
      await rt.db.run(`INSERT INTO campaigns (id, customer_id, name, state, budget_cap_vnd, approved_budget_vnd, funding_state, start_at, created_at, updated_at, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [rt.id(), cid, 'C', 'awaiting_funds', 5_000_000, 5_000_000, 'awaiting_funds', '2026-01-01T00:00:00.000Z', NOW, NOW, NOW]);
      return cid;
    };
    const probe = await mkRt(dialect);
    const pc = crashable(probe);
    const papp = new Hono();
    mountFinance(papp, pc.rt);
    await setup(probe);
    pc.ctl.reset();
    await deliver(papp, pc.rt, body(1, 7_000_000, 'ACTV'));
    const W = pc.ctl.writes;
    await probe.close();
    const bad: string[] = [];
    for (let k = 1; k <= W; k++) {
      const rt = await mkRt(dialect);
      try {
        const c = crashable(rt);
        const app = new Hono();
        mountFinance(app, c.rt);
        const cid = await setup(rt);
        const raw = body(1, 7_000_000, 'ACTV');
        c.ctl.reset();
        c.ctl.armAt(k);
        try { await (await app.request('/webhooks/payments/sepay', { method: 'POST', body: raw, headers: await signedHeaders(rt, raw) })).arrayBuffer(); } catch { /* mat dien */ }
        c.ctl.reset();
        await deliver(app, c.rt, raw);
        const camp = (await rt.db.query<Record<string, unknown>>('SELECT funding_state, reserved_vnd FROM campaigns WHERE customer_id = ?', [cid]))[0]!;
        const w = (await rt.db.query<Record<string, unknown>>('SELECT balance_vnd, reserved_vnd FROM ad_wallets WHERE customer_id = ?', [cid]))[0]!;
        if (camp['funding_state'] !== 'reserved' || num(camp['reserved_vnd']) !== 5_000_000 || num(w['reserved_vnd']) !== 5_000_000 || num(w['balance_vnd']) !== 7_000_000) bad.push(`k=${k}/${W}: campaign=${JSON.stringify(camp)} wallet=${JSON.stringify(w)}`);
        const mism = (await reconcileLedger(rt)).mismatches;
        if (mism.length) bad.push(`k=${k}/${W}: reconcile ${JSON.stringify(mism)}`);
      } finally {
        await rt.close();
      }
    }
    expect(bad).toEqual([]);
  });
});

describe.each(DIALECTS)('kich hoat hoi tu: thu chao hong + sweeper (%s)', (dialect) => {
  const mkPending = async (rt: TestRuntime, code: string) => {
    const id = rt.id();
    await rt.db.run('INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, email, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, 'T1', 'Cong ty ' + code, code, code, 'pending_payment', code.toLowerCase() + '@example.test', NOW]);
    await rt.db.run(`INSERT INTO campaigns (id, customer_id, name, state, budget_cap_vnd, approved_budget_vnd, funding_state, start_at, created_at, updated_at, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [rt.id(), id, 'C', 'awaiting_funds', 1_000_000, 1_000_000, 'awaiting_funds', '2026-01-01T00:00:00.000Z', NOW, NOW, NOW]);
    return id;
  };
  const st = async (rt: TestRuntime, cid: string) => ({
    cust: (await rt.db.query<{ state: string }>('SELECT state FROM customers WHERE id = ?', [cid]))[0]!.state,
    camp: (await rt.db.query<{ funding_state: string }>('SELECT funding_state FROM campaigns WHERE customer_id = ?', [cid]))[0]!.funding_state,
  });

  it('R1-05: SMTP hong khong chan kich hoat; thu nam trong outbox, thu lai duoc gui dung mot lan khi SMTP phuc hoi', async () => {
    const rt = await mkRt(dialect);
    try {
      const app = new Hono();
      mountFinance(app, rt);
      const cid = await mkPending(rt, 'MAILF');
      let down = true;
      const sent: string[] = [];
      rt.mail.send = async (m) => { if (down) throw new Error('smtp down'); sent.push(m.to); };
      const raw = body(5001, 6_000_000, 'MAILF');
      expect(await deliver(app, rt, raw)).toBe(1); // 200 ngay lan dau
      expect(await st(rt, cid)).toEqual({ cust: 'active', camp: 'reserved' });
      expect(sent).toEqual([]);
      const pending = (await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM outbox WHERE topic = 'mail.send' AND status = 'pending'"))[0]!.n;
      expect(num(pending)).toBe(1);
      down = false;
      rt.clock.advance(3600_000);
      await processOutbox(rt, mailOutboxHandlers());
      await processOutbox(rt, mailOutboxHandlers()); // chay lai: khong gui lan hai
      expect(sent).toEqual(['mailf@example.test']);
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    } finally {
      await rt.close();
    }
  });

  it('sweeper: vi da duoc cong (creditTopup) ma runActivation chua tung chay => sweepActivations kich hoat + giu tien, chay lai khong lam gi them', async () => {
    const rt = await mkRt(dialect);
    try {
      const cid = await mkPending(rt, 'SWEEP');
      const tid = rt.id();
      await rt.db.run("INSERT INTO topups (id, code, customer_id, amount_vnd, method, provider, provider_txn_id, status, requested_at) VALUES (?,?,?,?, 'bank_transfer', 'sepay', ?, 'pending', ?)", [tid, 'NAP-S', cid, 6_000_000, '7001', NOW]);
      expect(await creditTopup(rt, rt.db, tid, null)).toBe('credited'); // chua runActivation (mo phong mat dien)
      expect(await st(rt, cid)).toEqual({ cust: 'pending_payment', camp: 'awaiting_funds' });
      const r1 = await sweepActivations(rt);
      expect(r1.failed).toBe(0);
      expect(await st(rt, cid)).toEqual({ cust: 'active', camp: 'reserved' });
      const w1 = await bal(rt, cid);
      const r2 = await sweepActivations(rt);
      expect(r2.activated).toBe(0);
      expect(await bal(rt, cid)).toBe(w1);
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    } finally {
      await rt.close();
    }
  });

  it('webhook gui lai sau khi vi da cong ma kich hoat chua chay: hoi tu qua heal-on-retry', async () => {
    const rt = await mkRt(dialect);
    try {
      const app = new Hono();
      mountFinance(app, rt);
      const cid = await mkPending(rt, 'HEAL');
      const raw = body(7002, 6_000_000, 'HEAL');
      // lan 1: cong vi nhung KHONG kich hoat (gia lap dut): tao topup + credit truc tiep, webhook chua xong
      const tid = rt.id();
      await rt.db.run("INSERT INTO topups (id, code, customer_id, amount_vnd, method, provider, provider_txn_id, status, requested_at) VALUES (?,?,?,?, 'bank_transfer', 'sepay', ?, 'pending', ?)", [tid, 'NAP-H', cid, 6_000_000, '7002', NOW]);
      await creditTopup(rt, rt.db, tid, null);
      await deliver(app, rt, raw); // SePay gui lai
      expect(await st(rt, cid)).toEqual({ cust: 'active', camp: 'reserved' });
      expect(await bal(rt, cid)).toBe(6_000_000);
    } finally {
      await rt.close();
    }
  });
});
