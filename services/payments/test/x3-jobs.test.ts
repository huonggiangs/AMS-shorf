import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestRuntime } from '@ams/runtime';
import { enqueueOutbox } from '@ams/runtime';
import { pruneMailOutbox, runFrequentFinanceJobs } from '../src/index.js';
import { mkCampaign, mkCustomer, mkRt } from './helpers.js';

describe('x3: job tan suat cao + thu chao', () => {
  let rt: TestRuntime;
  beforeAll(async () => {
    rt = await mkRt('sqlite');
  });
  afterAll(async () => {
    await rt.close?.();
  });

  it('runFrequentFinanceJobs chay sweepActivations: chien dich awaiting_funds du so du duoc giu tien', async () => {
    const cust = await mkCustomer(rt, 'X3A', { balance: 20_000_000 });
    const camp = await mkCampaign(rt, cust, 5_000_000);
    await rt.db.run("UPDATE campaigns SET approved_budget_vnd = 5000000, funding_state = 'awaiting_funds', approved_at = ? WHERE id = ?", ['2026-11-12T02:00:00.000Z', camp]);
    const r = await runFrequentFinanceJobs(rt);
    expect((r.activations as { activated: number }).activated).toBeGreaterThanOrEqual(1);
    const row = (await rt.db.query<{ state: string; funding_state: string }>('SELECT state, funding_state FROM campaigns WHERE id = ?', [camp]))[0]!;
    expect(row.funding_state).toBe('reserved');
    expect(['active', 'scheduled']).toContain(row.state);
  });

  it('pruneMailOutbox: xoa thu da gui qua 6 gio va thu chet qua 72 gio, giu thu dang cho', async () => {
    const mk = (k: string) => enqueueOutbox(rt.db, rt, { topic: 'mail.send', dedupeKey: k, payload: { to: 'a@b.vn', subject: 's', html: 'token=zzz' } });
    await mk('p:done'); await mk('p:dead'); await mk('p:pending'); await mk('p:fresh');
    const ago = (h: number) => new Date(rt.clock.now().getTime() - h * 3_600_000).toISOString();
    await rt.db.run("UPDATE outbox SET status='done', processed_at=? WHERE dedupe_key='p:done'", [ago(7)]);
    await rt.db.run("UPDATE outbox SET status='dead', processed_at=? WHERE dedupe_key='p:dead'", [ago(73)]);
    await rt.db.run("UPDATE outbox SET status='done', processed_at=? WHERE dedupe_key='p:fresh'", [ago(1)]);
    expect(await pruneMailOutbox(rt)).toBe(2);
    const left = (await rt.db.query<{ dedupe_key: string }>("SELECT dedupe_key FROM outbox WHERE dedupe_key LIKE 'p:%' ORDER BY dedupe_key")).map((x) => x.dedupe_key);
    expect(left).toEqual(['p:fresh', 'p:pending']);
  });
});
