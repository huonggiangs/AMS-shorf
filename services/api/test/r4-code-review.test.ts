import { beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env } from './helpers.js';

let env: Env;
beforeAll(async () => {
  env = await setup();
}, 120_000);

describe('r4: khoa sort/filter la thuoc tinh co that cua spec (khong phai Object.prototype)', () => {
  it('sort=constructor / __proto__ va filter constructor khong gay 500', async () => {
    const admin = await login(env, env.byRole('super_admin'));
    for (const q of ['sort=constructor:asc', 'sort=__proto__:desc', 'sort=toString:asc', 'constructor=x', 'filter=constructor:x,__proto__:y']) {
      const r = await admin.json<{ items: unknown[] }>('GET', `/admin/v1/devices?${q}`);
      expect(r.status, q).toBe(200);
      expect(Array.isArray(r.body.items)).toBe(true);
    }
  });
  it('doanh thu 12 thang van tra ve sau khi doi sang hour >= ?', async () => {
    const admin = await login(env, env.byRole('super_admin'));
    const r = await admin.json<{ months: unknown[] }>('GET', '/admin/v1/revenue');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.months)).toBe(true);
  });
});
