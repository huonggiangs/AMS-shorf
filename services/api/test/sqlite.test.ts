import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

// Cung logic tren node:sqlite (proxy cho Cloudflare D1): bao dam SQL dung duoc ca hai phuong ngu.
let env: Env;
let admin: Session;
let lan: Session;
beforeAll(async () => {
  env = await setup({}, 'sqlite');
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
}, 120_000);
afterAll(async () => env?.rt.close());

describe('sqlite dialect', () => {
  it('danh sach, loc, tim kiem, phan trang chay duoc', async () => {
    const r = await admin.json('GET', '/admin/v1/campaigns?page_size=3&sort=budget_vnd:desc&q=a');
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeLessThanOrEqual(3);
    expect((await admin.json('GET', '/admin/v1/devices?page_size=5')).status).toBe(200);
    expect((await admin.json('GET', '/admin/v1/customers?page_size=5')).status).toBe(200);
    expect((await admin.json('GET', '/admin/v1/dashboard/overview')).status).toBe(200);
    expect((await admin.json('GET', '/admin/v1/audit-log')).status).toBe(200);
    expect((await admin.json('GET', '/admin/v1/users')).status).toBe(200);
  });
  it('IDOR van dung', async () => {
    const other = (await admin.json('GET', `/admin/v1/campaigns?filter=customer_id:${env.seed.customers['K008']}&page_size=1`)).body.items[0];
    expect((await lan.req('GET', `/portal/v1/campaigns/${other.id}`)).status).toBe(404);
  });
  it('tao + gui duyet chien dich, hop dong render', async () => {
    const c = await lan.json('POST', '/portal/v1/campaigns', { name: 'Sqlite', budget_vnd: 1_000_000 });
    expect(c.status).toBe(201);
    expect((await lan.json('POST', `/portal/v1/campaigns/${c.body.id}/submit`)).status).toBeLessThan(500);
    const k = await admin.json('POST', '/admin/v1/contracts', { customer_id: env.seed.customers['K001'], value_vnd: 100_000_000 });
    expect(k.status).toBe(201);
    expect((await admin.json('POST', `/admin/v1/contracts/${k.body.id}/render`, {})).body.amount_in_words).toMatch(/triệu/);
  });
});
