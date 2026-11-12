import { it } from 'vitest';
import { setup, login } from './helpers.js';
it('probe', async () => {
  const t0 = Date.now();
  const env = await setup();
  console.log('setup ms', Date.now() - t0);
  console.log(JSON.stringify(env.seed.credentials.map((c) => [c.email, c.role, c.status])));
  const s = await login(env, env.byRole('super_admin'));
  const r = await s.json('GET', '/admin/v1/campaigns?page_size=2');
  console.log(r.status, JSON.stringify(r.body).slice(0, 600));
  const cu = await login(env, env.byRole('customer'));
  const r2 = await cu.json('GET', '/portal/v1/campaigns?page_size=2');
  console.log(r2.status, JSON.stringify(r2.body).slice(0, 400));
  console.log(JSON.stringify((await cu.json('GET', '/auth/me')).body));
}, 120000);
