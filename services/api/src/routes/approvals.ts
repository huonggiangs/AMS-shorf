import { Hono } from 'hono';
import { getRt, runList } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import { campaignSpec, presentCampaigns } from './campaigns.js';
import type { CampRow } from './campaigns.js';
import type { AppEnv } from '../types.js';

/** Hang doi duyet: chien dich o trang thai pending_review. Duyet/tra lai dung /campaigns/:id/approve|reject. */
export function approvalRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/', requirePerm('approvals', 'view'), async (c) => {
    const rt = getRt(c);
    const res = await runList<CampRow>(c, campaignSpec(c.get('user'), rt.clock.now().toISOString(), 'pending_review'));
    return c.json({ ...res, items: await presentCampaigns(rt, res.items, false) });
  });
  return r;
}
