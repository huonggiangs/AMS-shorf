import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestRuntime } from '@ams/runtime';
import { Hono } from 'hono';
import { createFinancePort, mountFinance, type FinanceActor } from '../src/index.js';
import { actorHdr, mkCustomer, mkRt, sign, wallet, webhookBody } from './helpers.js';
import { code, mkAdmin } from './stepup.js';

describe('route doi soat + hang cho thu cong (s1 noi w4)', () => {
  let rt: TestRuntime;
  let app: Hono;
  let pages = 0;
  const F1 = actorHdr({ id: 'F1', role: 'finance' });
  const call = (h: Record<string, string>, path: string, method = 'GET', b?: unknown) => app.request(path, { method, headers: h, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });

  beforeAll(async () => {
    rt = await mkRt('sqlite');
    app = new Hono();
    mountFinance(app, rt, {
      resolveActor: async (c) => { const h = c.req.header('x-test-actor'); return h ? (JSON.parse(h) as FinanceActor) : null; },
      fetchPage: async () => { pages++; return []; },
    });
    await mkAdmin(rt, 'F1');
  });
  afterAll(async () => rt.close());

  it('webhook trung khoan da xac nhan tay -> result manual:possible_double_credit, ke toan thay trong hang cho, khong cong lan hai', async () => {
    const cid = await mkCustomer(rt, 'DBL');
    const tid = rt.id();
    await rt.db.run("INSERT INTO topups (id, code, customer_id, amount_vnd, method, status, requested_at) VALUES (?,?,?,?, 'qr', 'pending', ?)", [tid, 'NAP-' + tid.slice(-8), cid, 6_000_000, rt.clock.now().toISOString()]);
    expect((await call(F1, `/admin/v1/topups/${tid}/confirm`, 'POST', {})).status).toBe(200);
    expect((await wallet(rt, cid)).balance).toBe(6_000_000);
    const body = webhookBody({ id: 995001, amount: 6_000_000, content: 'AMS DBL' });
    const r = await app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: await sign(rt, body) });
    expect(r.status).toBe(200);
    expect((await wallet(rt, cid)).balance).toBe(6_000_000);
    const row = (await rt.db.query<{ result: string }>("SELECT result FROM payment_webhooks WHERE event_id = '995001'"))[0]!;
    expect(row.result).toBe('manual:possible_double_credit');
    // gui lai cung giao dich: van khong cong
    await app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: await sign(rt, body) });
    expect((await wallet(rt, cid)).balance).toBe(6_000_000);
    const q = (await (await call(F1, '/admin/v1/payments/manual-queue')).json()) as { items: { reason: string }[] };
    expect(q.items.some((i) => i.reason === 'possible_double_credit')).toBe(true);
  });

  it('RBAC: xem doi soat can finance:view; chay/sua can finance:approve; khach va content_manager bi 403', async () => {
    const cm = actorHdr({ id: 'CM', role: 'content_manager' });
    expect((await call(cm, '/admin/v1/reconcile/revenue')).status).toBe(403);
    expect((await call(cm, '/admin/v1/reconcile/revenue/run', 'POST', {})).status).toBe(403);
    expect((await call(cm, '/admin/v1/reconcile/repair', 'POST', {})).status).toBe(403);
    expect((await call(cm, '/admin/v1/reconcile/sepay', 'POST', {})).status).toBe(403);
    expect((await call(F1, '/admin/v1/reconcile/revenue')).status).toBe(200);
    expect((await call({ 'content-type': 'application/json' }, '/admin/v1/reconcile/revenue')).status).toBe(401);
  });

  it('chay doi soat doanh thu ghi audit; repair mac dinh chay thu (khong can TOTP), that su can TOTP + audit', async () => {
    const run = await call(F1, '/admin/v1/reconcile/revenue/run', 'POST', {});
    expect(run.status).toBe(200);
    const dry = (await (await call(F1, '/admin/v1/reconcile/repair', 'POST', {})).json()) as { dry_run: boolean };
    expect(dry.dry_run).toBe(true);
    const noTotp = await call(F1, '/admin/v1/reconcile/repair', 'POST', { dryRun: false });
    expect(noTotp.status).toBe(403);
    expect(((await noTotp.json()) as any).error.code).toBe('step_up_required');
    const ok = await call(F1, '/admin/v1/reconcile/repair', 'POST', { dryRun: false, totp: await code(rt, 'F1') });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).dry_run).toBe(false);
    const acts = (await rt.db.query<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'finance.reconcile.%'")).map((r) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['finance.reconcile.revenue_run', 'finance.reconcile.repair']));
  });

  it('resolve chenh lech: can TOTP, ghi audit, lan hai 404', async () => {
    const id = rt.id();
    const now = rt.clock.now().toISOString();
    await rt.db.run("INSERT INTO revenue_discrepancies (id, kind, campaign_id, day, status, first_seen_at, last_seen_at) VALUES (?, 'claim_vs_impression', 'C1', '2026-11-10', 'open', ?, ?)", [id, now, now]);
    const list = (await (await call(F1, '/admin/v1/reconcile/revenue?status=open')).json()) as { items: { id: string }[] };
    expect(list.items.some((i) => i.id === id)).toBe(true);
    expect((await call(F1, `/admin/v1/reconcile/revenue/${id}/resolve`, 'POST', { status: 'resolved', note: 'da kiem tra' })).status).toBe(403);
    expect((await call(F1, `/admin/v1/reconcile/revenue/${id}/resolve`, 'POST', { status: 'resolved', note: 'ok' , totp: await code(rt, 'F1') })).status).toBe(400); // note qua ngan
    expect((await call(F1, `/admin/v1/reconcile/revenue/${id}/resolve`, 'POST', { status: 'resolved', note: 'da kiem tra', totp: await code(rt, 'F1') })).status).toBe(200);
    expect((await call(F1, `/admin/v1/reconcile/revenue/${id}/resolve`, 'POST', { status: 'resolved', note: 'da kiem tra', totp: await code(rt, 'F1') })).status).toBe(404);
    const a = await rt.db.query<{ actor_id: string }>("SELECT actor_id FROM audit_log WHERE action = 'finance.reconcile.revenue_discrepancy_resolved'");
    expect(a[0]?.actor_id).toBe('F1');
  });

  it('reconcile sepay: thieu SEPAY_API_TOKEN -> 409; mock -> 409; co token + production -> chay ham lay trang (inject)', async () => {
    expect((await call(F1, '/admin/v1/reconcile/sepay', 'POST', {})).status).toBe(409);
    const rt2 = await mkRt('sqlite', { SEPAY_API_TOKEN: 'tok-123456', SEPAY_MODE: 'mock' });
    const a2 = new Hono();
    mountFinance(a2, rt2, { resolveActor: async (c) => JSON.parse(c.req.header('x-test-actor')!) as FinanceActor, fetchPage: async () => { pages++; return []; } });
    expect((await a2.request('/admin/v1/reconcile/sepay', { method: 'POST', headers: F1, body: '{}' })).status).toBe(409);
    await rt2.close();
    const rt3 = await mkRt('sqlite', { SEPAY_API_TOKEN: 'tok-123456', SEPAY_MODE: 'production', SEPAY_API_KEY: 'k-12345678' });
    const a3 = new Hono();
    mountFinance(a3, rt3, { resolveActor: async (c) => JSON.parse(c.req.header('x-test-actor')!) as FinanceActor, fetchPage: async () => { pages++; return []; } });
    const before = pages;
    const r = await a3.request('/admin/v1/reconcile/sepay', { method: 'POST', headers: F1, body: '{}' });
    expect(r.status).toBe(200);
    expect(pages).toBeGreaterThan(before);
    await rt3.close();
  });

  it('scheduled */10 chay duoc (repair + doi soat SePay khi co token, production)', async () => {
    const rt4 = await mkRt('sqlite', { SEPAY_API_TOKEN: 'tok-123456', SEPAY_MODE: 'production', SEPAY_API_KEY: 'k-12345678' });
    const core = createFinancePort();
    const orig = globalThis.fetch;
    let hits = 0;
    globalThis.fetch = (async () => { hits++; return new Response(JSON.stringify({ transactions: [] }), { status: 200 }); }) as typeof fetch;
    try {
      await core.scheduled!(rt4, '*/10 * * * *');
    } finally {
      globalThis.fetch = orig;
    }
    expect(hits).toBeGreaterThan(0);
    await rt4.close();
  });
});
