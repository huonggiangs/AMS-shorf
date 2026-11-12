import { Hono } from 'hono';
import { getRt } from '../lib/http.js';
import { campaignRoutes } from './campaigns.js';
import { mediaRoutes } from './media.js';
import { meBody } from '../auth/routes.js';
import type { AppEnv } from '../types.js';

/** Cong khach hang/doi tac: tai su dung cac route cung ban external=true (loc theo customer_id/campaign_grants trong SQL). */
export function portalRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.route('/campaigns', campaignRoutes(true));
  r.route('/media', mediaRoutes(true));
  r.get('/me', async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const cu = u.customerId ? (await rt.db.query<{ payment_code: string | null; short_name: string | null }>('SELECT payment_code, short_name FROM customers WHERE id = ?', [u.customerId]))[0] : null;
    return c.json(meBody(rt, u, cu ? { code: cu.payment_code, name: cu.short_name } : null));
  });
  return r;
}
