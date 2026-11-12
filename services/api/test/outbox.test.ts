import { describe, expect, it } from 'vitest';
import { createTestRuntime, crashable, enqueueOutbox, outboxStats, processOutbox, SimulatedCrash, type Runtime, type TestRuntime } from '@ams/runtime';
import { MANIFEST_EPOCH_KEY } from '@ams/shared';
import { createFinancePort, reconcileLedger } from '../src/finance/index.js';
import { approvedKey, createOutboxHandlers, reconcileApprovals, runOutbox, sweepOutbox, TOPIC_CAMPAIGN_APPROVED } from '../src/outbox.js';
import type { FinancePort } from '../src/ports.js';

/* Outbox P0: duyet -> giu tien -> bao manifest. Moi buoc idempotent; mat dien o BAT KY ranh gioi ghi nao cung hoi tu ve cung ket qua. */

const NOW = '2026-11-12T03:00:00.000Z';
const APPROVED_AT = '2026-11-12T02:59:00.000Z';
const BUDGET = 5_000_000;

async function fixture(dialect: 'postgres' | 'sqlite') {
  const rt = await createTestRuntime({ dialect, now: NOW });
  await rt.db.run('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)', ['T1', 'AMS', NOW]);
  const cust = rt.id();
  await rt.db.run("INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, created_at) VALUES (?,?,?,?,?,'active',?)", [cust, 'T1', 'Cty', 'K', 'KP1', NOW]);
  await rt.db.run('INSERT INTO ad_wallets (customer_id, balance_vnd, reserved_vnd, spent_vnd, updated_at) VALUES (?,?,0,0,?)', [cust, 10_000_000, NOW]);
  await rt.db.run('INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, created_at) VALUES (?,?,?,?,?,0,?,?,?)', [rt.id(), cust, 'adjust', 10_000_000, 10_000_000, 'seed', null, NOW]);
  const camp = rt.id();
  // trang thai ngay sau buoc 1 cua approve: awaiting_funds + da duyet
  await rt.db.run(
    `INSERT INTO campaigns (id, customer_id, name, state, budget_cap_vnd, approved_budget_vnd, funding_state, approved_at, start_at, created_at, updated_at)
     VALUES (?,?,?, 'awaiting_funds', ?, ?, 'awaiting_funds', ?, '2026-11-01T00:00:00.000Z', ?, ?)`,
    [camp, cust, 'C', BUDGET, BUDGET, APPROVED_AT, NOW, NOW],
  );
  return { rt, cust, camp };
}
const finance = (): Promise<FinancePort> => Promise.resolve(createFinancePort());
const epoch = async (rt: TestRuntime) => Number((await rt.kv.get(MANIFEST_EPOCH_KEY)) ?? 0);
const enqueueApproved = (rt: TestRuntime, camp: string) =>
  enqueueOutbox(rt.db, rt, { topic: TOPIC_CAMPAIGN_APPROVED, payload: { campaignId: camp, actorId: null, approvedAt: APPROVED_AT }, dedupeKey: approvedKey(camp, APPROVED_AT) });

async function expectConverged(rt: TestRuntime, cust: string, camp: string) {
  const c = (await rt.db.query<{ state: string; funding_state: string; reserved_vnd: unknown }>('SELECT state, funding_state, reserved_vnd FROM campaigns WHERE id = ?', [camp]))[0]!;
  expect([c.state, c.funding_state, Number(c.reserved_vnd)]).toEqual(['active', 'reserved', BUDGET]);
  const w = (await rt.db.query<{ balance_vnd: unknown; reserved_vnd: unknown }>('SELECT balance_vnd, reserved_vnd FROM ad_wallets WHERE customer_id = ?', [cust]))[0]!;
  expect([Number(w.balance_vnd), Number(w.reserved_vnd)]).toEqual([10_000_000, BUDGET]); // giu DUNG MOT LAN
  expect(Number((await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM wallet_entries WHERE kind = 'reserve' AND ref_id = ?", [camp]))[0]!.n)).toBe(1);
  expect(await outboxStats(rt.db)).toEqual({ pending: 0, done: 2, dead: 0 }); // campaign.approved + manifest.bump (khoa khu trung: dung 2 dong)
  expect(await epoch(rt)).toBeGreaterThanOrEqual(1);
  expect((await reconcileLedger(rt)).mismatches).toEqual([]);
}

describe.each(['sqlite', 'postgres'] as const)('outbox: duyet -> giu tien -> manifest (%s)', (dialect) => {
  it('duong thuong: mot lan xu ly di het chuoi, ket qua dung', async () => {
    const { rt, cust, camp } = await fixture(dialect);
    expect(await enqueueApproved(rt, camp)).toBe(true);
    expect(await enqueueApproved(rt, camp)).toBe(false); // khoa khu trung
    const r = await runOutbox(rt, finance);
    expect(r).toMatchObject({ processed: 2, failed: 0, dead: 0 });
    await expectConverged(rt, cust, camp);
    await rt.close();
  }, 60_000);

  it('chay lai nhieu lan / nhieu worker dong thoi: khong giu tien hai lan', async () => {
    const { rt, cust, camp } = await fixture(dialect);
    await enqueueApproved(rt, camp);
    const rs = await Promise.all(Array.from({ length: 4 }, () => runOutbox(rt, finance)));
    expect(rs.reduce((s, x) => s + x.processed, 0)).toBe(2);
    await runOutbox(rt, finance);
    await expectConverged(rt, cust, camp);
    await rt.close();
  }, 60_000);

  it('MAT DIEN o moi ranh gioi ghi (xu ly outbox, giu tien, ghi manifest.bump, kv): sau khi thu lai deu hoi tu ve cung ket qua', async () => {
    // do tong so lan ghi cua mot lan chay lien mach
    const base = await fixture(dialect);
    await enqueueApproved(base.rt, base.camp);
    const probe = crashable(base.rt);
    await runOutbox(probe.rt, finance);
    const W = probe.ctl.writes;
    expect(W).toBeGreaterThan(10);
    await base.rt.close();
    let crashes = 0;
    for (let k = 1; k <= W; k++) {
      const { rt, cust, camp } = await fixture(dialect);
      await enqueueApproved(rt, camp);
      const c = crashable(rt);
      c.ctl.armAt(k);
      try {
        await runOutbox(c.rt, finance); // handler loi -> ghi lai + thu lai sau; loi ngoai handler -> SimulatedCrash
      } catch (e) {
        expect(e).toBeInstanceOf(SimulatedCrash);
        crashes++;
      }
      c.ctl.reset();
      // tien trinh moi khoi dong: thoi gian troi qua (het hop dong thue + lui), chay lai khong loi
      for (let i = 0; i < 4; i++) {
        rt.clock.advance(30 * 60_000);
        await runOutbox(rt, finance);
      }
      await expectConverged(rt, cust, camp);
      await rt.close();
    }
    expect(crashes).toBeGreaterThan(0);
  }, 300_000);

  it('buoc giu tien thanh cong nhung ghi manifest.bump that bai: thu lai KHONG giu them, van ra dung mot bump (khoa khu trung)', async () => {
    const { rt, cust, camp } = await fixture(dialect);
    await enqueueApproved(rt, camp);
    let fail = true;
    const handlers = createOutboxHandlers(finance);
    const flaky = { ...handlers, [TOPIC_CAMPAIGN_APPROVED]: async (m: Parameters<(typeof handlers)[string]>[0], r: Runtime) => {
      await handlers[TOPIC_CAMPAIGN_APPROVED]!(m, r);
      if (fail) {
        fail = false;
        throw new Error('chet sau khi giu tien');
      }
    } };
    const a = await processOutbox(rt, flaky);
    expect(a.failed).toBe(1);
    const row = (await rt.db.query<{ status: string; attempts: number; last_error: string }>("SELECT status, attempts, last_error FROM outbox WHERE topic = ?", [TOPIC_CAMPAIGN_APPROVED]))[0]!;
    expect([row.status, Number(row.attempts)]).toEqual(['pending', 1]);
    expect(row.last_error).toContain('chet sau khi giu tien');
    expect(Number((await rt.db.query<{ r: unknown }>('SELECT reserved_vnd AS r FROM ad_wallets WHERE customer_id = ?', [cust]))[0]!.r)).toBe(BUDGET); // da giu roi
    expect(a.processed).toBe(1); // manifest.bump (ghi truoc khi handler chet) da xong ngay trong cung lan quet
    // chua den han thu lai: khong xu ly lai
    expect(await processOutbox(rt, flaky)).toMatchObject({ processed: 0, failed: 0 });
    rt.clock.advance(60_000);
    await processOutbox(rt, flaky);
    await expectConverged(rt, cust, camp);
    await rt.close();
  }, 60_000);

  it('handler loi mai: lui luy thua, het so lan thi dead (khong chay lai mai), co last_error', async () => {
    const { rt, camp } = await fixture(dialect);
    await enqueueApproved(rt, camp);
    const always = { [TOPIC_CAMPAIGN_APPROVED]: async () => { throw new Error('tai chinh sap'); } };
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await processOutbox(rt, always, { maxAttempts: 4 });
      seen.push(r.failed + r.dead * 10);
      rt.clock.advance(20 * 60_000);
    }
    expect(seen.filter((x) => x === 1)).toHaveLength(3); // 3 lan thu lai
    expect(seen.filter((x) => x === 10)).toHaveLength(1); // roi dead
    const row = (await rt.db.query<{ status: string; attempts: number; last_error: string }>('SELECT status, attempts, last_error FROM outbox'))[0]!;
    expect([row.status, Number(row.attempts)]).toEqual(['dead', 4]);
    expect(row.last_error).toContain('tai chinh sap');
    await rt.close();
  }, 60_000);

  it('worker chet khi dang giu viec (hop dong thue): trong thoi gian thue worker khac khong nhan; het thue thi nhan lai, khong mat viec', async () => {
    const { rt, cust, camp } = await fixture(dialect);
    await enqueueApproved(rt, camp);
    // worker A chiem (giong het processOutbox) roi chet: khong danh dau done, khong tra lai
    const lease = new Date(rt.clock.now().getTime() + 60_000).toISOString();
    const claim = await rt.db.run("UPDATE outbox SET attempts = attempts + 1, available_at = ? WHERE status = 'pending' AND attempts = 0", [lease]);
    expect(claim.changes).toBe(1);
    expect((await runOutbox(rt, finance)).processed).toBe(0);
    rt.clock.advance(61_000);
    await runOutbox(rt, finance);
    await expectConverged(rt, cust, camp);
    expect(Number((await rt.db.query<{ a: unknown }>('SELECT attempts AS a FROM outbox WHERE topic = ?', [TOPIC_CAMPAIGN_APPROVED]))[0]!.a)).toBe(2);
    await rt.close();
  }, 60_000);

  it('mat dien giua UPDATE trang thai duyet va INSERT outbox (D1): reconcileApprovals ghi bu, idempotent', async () => {
    const { rt, cust, camp } = await fixture(dialect); // fixture = da awaiting_funds, CHUA co dong outbox
    expect(await reconcileApprovals(rt)).toBe(1);
    expect(await reconcileApprovals(rt)).toBe(0);
    const r = await sweepOutbox(rt, finance);
    expect(r.processed).toBe(2);
    await expectConverged(rt, cust, camp);
    // chien dich dang cho tien (khong du so du) co dong outbox done => khong bi ghi bu lien tuc
    expect(await reconcileApprovals(rt)).toBe(0);
    await rt.close();
  }, 60_000);

  it('chien dich bi tra lai/ket thuc truoc khi worker chay: khong giu tien', async () => {
    const { rt, cust, camp } = await fixture(dialect);
    await enqueueApproved(rt, camp);
    await rt.db.run("UPDATE campaigns SET state = 'rejected', funding_state = 'released' WHERE id = ?", [camp]);
    const r = await runOutbox(rt, finance);
    expect(r.failed).toBe(0);
    expect(Number((await rt.db.query<{ r: unknown }>('SELECT reserved_vnd AS r FROM ad_wallets WHERE customer_id = ?', [cust]))[0]!.r)).toBe(0);
    await rt.close();
  }, 60_000);

  it('thieu tien: handler xong (khong loi), chien dich o awaiting_funds; nap tien sau do tu chay (khong qua outbox)', async () => {
    const { rt, cust, camp } = await fixture(dialect);
    await rt.db.run('UPDATE ad_wallets SET balance_vnd = 1000000 WHERE customer_id = ?', [cust]);
    await enqueueApproved(rt, camp);
    await runOutbox(rt, finance);
    const c = (await rt.db.query<{ state: string; funding_state: string }>('SELECT state, funding_state FROM campaigns WHERE id = ?', [camp]))[0]!;
    expect([c.state, c.funding_state]).toEqual(['awaiting_funds', 'awaiting_funds']);
    expect(await outboxStats(rt.db)).toMatchObject({ pending: 0, dead: 0 });
    await rt.close();
  }, 60_000);
});
