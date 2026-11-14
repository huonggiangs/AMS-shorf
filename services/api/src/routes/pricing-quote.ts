// Bao gia truoc khi tao chien dich (p1-pricing). Tach file de openapi anh xa prefix dung (/admin/v1/pricing, /portal/v1/pricing).
import { Hono } from 'hono';
import { z } from 'zod';
import { PRICING_SCREEN_TYPES } from '@ams/shared';
import { unprocessable } from '../lib/errors.js';
import { getRt } from '../lib/http.js';
import { planCampaignPrices, quoteFromRows, unavailableQuote } from '../lib/pricing.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

const quoteQuery = z.object({
  screen_type: z.enum(PRICING_SCREEN_TYPES).default('tv'),
  budget_vnd: z.coerce.number().int().min(0).max(1e13).optional(),
  customer_id: z.string().max(64).optional(),
  contract_id: z.string().max(64).optional(),
});

/** Bao gia truoc khi tao chien dich (form tao chien dich). external: customer lay tu phien; internal: customer_id trong query. */
export function quoteRoutes(external: boolean): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/quote', requirePerm('campaigns', 'view'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const q = quoteQuery.safeParse(c.req.query());
    if (!q.success) throw unprocessable('Tham số báo giá không hợp lệ.', 'validation_error', q.error.flatten());
    const customerId = external ? u.customerId : (q.data.customer_id ?? null);
    if (!customerId) throw unprocessable('Chọn khách hàng.', 'customer_required');
    let contractId: string | null = null;
    if (!external && q.data.contract_id) contractId = q.data.contract_id;
    else {
      const today = new Date(rt.clock.now().getTime() + 7 * 3600_000).toISOString().slice(0, 10);
      contractId = (
        await rt.db.query<{ id: string }>(
          `SELECT ct.id FROM contracts ct WHERE ct.customer_id = ? AND ct.state = 'active' AND (ct.start_date IS NULL OR ct.start_date <= ?) AND (ct.end_date IS NULL OR ct.end_date >= ?)
             AND EXISTS (SELECT 1 FROM contract_lines cl JOIN contract_line_prices p ON p.contract_line_id = cl.id WHERE cl.contract_id = ct.id) ORDER BY ct.created_at DESC, ct.id DESC LIMIT 1`,
          [customerId, today, today],
        )
      )[0]?.id ?? null;
    }
    const budget = q.data.budget_vnd ?? null;
    const plan = await planCampaignPrices(rt, rt.db, { id: '', customer_id: customerId, contract_id: contractId, target_types: JSON.stringify([q.data.screen_type]) }, rt.clock.now().toISOString());
    return c.json(plan.missing.length ? unavailableQuote(plan, budget) : quoteFromRows(plan.rows, { budgetVnd: budget, locked: false, internal: !external, placeholder: plan.placeholder }));
  });
  return r;
}
