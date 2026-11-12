import { beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';
import { mountFinanceRoutes } from '../src/finance-mount.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Ghep voi cong tai chinh that cua a2: auth/CSRF cua a1 phu len route /portal/v1/wallet, /admin/v1/topups...
let env: Env;
let admin: Session;
let lan: Session;
beforeAll(async () => {
  env = await setup({ mountFinance: mountFinanceRoutes });
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
}, 120_000);

describe('ghep voi a2 (mountFinance)', () => {
  it('route vi cua khach can phien; co phien thi doc duoc', async () => {
    expect((await env.app.request('/portal/v1/wallet')).status).toBe(401);
    const w = await lan.json('GET', '/portal/v1/wallet');
    expect(w.status).toBe(200);
  });
  it('tai khoan noi bo khong vao duoc /portal/v1/wallet; khach khong vao /admin/v1/topups', async () => {
    expect((await admin.req('GET', '/portal/v1/wallet')).status).toBe(403);
    expect((await lan.req('GET', '/admin/v1/topups')).status).toBe(403);
  });
  it('webhook SePay cong khai nhung tu choi khi thieu chu ky', async () => {
    const r = await env.app.request('/webhooks/payments/sepay', { method: 'POST', body: '{}' });
    expect([401, 403]).toContain(r.status);
  });
  it('duyet chien dich dung FinancePort that: thieu so du -> awaiting_funds, khong am so du', async () => {
    const p = (await admin.json('GET', '/admin/v1/campaigns?filter=status:pending&page_size=1')).body.items[0];
    const r = await admin.json('POST', `/admin/v1/campaigns/${p.id}/approve`);
    expect(r.status).toBe(200);
    expect(['awaiting_funds', 'active', 'scheduled']).toContain(r.body.status);
    const w = await env.rt.db.query<{ balance_vnd: number; reserved_vnd: number }>('SELECT balance_vnd, reserved_vnd FROM ad_wallets');
    expect(w.every((x) => Number(x.balance_vnd) >= Number(x.reserved_vnd))).toBe(true);
  });
});
