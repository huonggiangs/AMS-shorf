import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestRuntime } from '@ams/runtime';
import { decryptField } from '@ams/shared';
import { mkApp, mkCustomer, mkRt, sign, webhookBody } from './helpers.js';
import { REJECTED_PER_IP_PER_MIN, pruneRejectedWebhooks } from '../src/webhook.js';

// R1-16: gioi han ghi webhook bi tu choi + so tai khoan khong luu dang ro
for (const dialect of ['postgres', 'sqlite'] as const) {
  describe(`R1-16 webhook storage [${dialect}]`, () => {
    let rt: TestRuntime;
    let app: ReturnType<typeof mkApp>['app'];
    const hook = (body: string, headers: Record<string, string>) => app.request('/webhooks/payments/sepay', { method: 'POST', body, headers });
    beforeAll(async () => {
      rt = await mkRt(dialect, { SEPAY_WEBHOOK_SECRET: 'test-sepay-secret' });
      ({ app } = mkApp(rt));
    });
    afterAll(async () => rt.close());

    it('rejected requests are rate limited before DB write and truncated', async () => {
      const big = JSON.stringify({ pad: 'x'.repeat(50_000), accountNumber: '0123456789' });
      for (let i = 0; i < REJECTED_PER_IP_PER_MIN + 15; i++) {
        const r = await hook(big, { 'x-forwarded-for': '203.0.113.9' });
        expect(r.status).toBe(401);
      }
      const rows = await rt.db.query<{ payload: string }>("SELECT payload FROM payment_webhooks WHERE event_id LIKE 'rejected:%'");
      expect(rows.length).toBe(REJECTED_PER_IP_PER_MIN);
      for (const r of rows) {
        expect(r.payload.length).toBeLessThan(2_300);
        expect(r.payload).not.toContain('0123456789');
      }
    });

    it('accepted payload stores masked account number + encrypted copy', async () => {
      await mkCustomer(rt, 'ACMEP2');
      const body = webhookBody({ id: 770001, amount: 6_000_000, content: 'AMS ACMEP2' });
      const r = await hook(body, await sign(rt, body));
      expect(r.status).toBe(200);
      const row = (await rt.db.query<{ payload: string }>("SELECT payload FROM payment_webhooks WHERE event_id = '770001'"))[0]!;
      expect(row.payload).not.toContain('0123456789');
      const p = JSON.parse(row.payload) as Record<string, string>;
      expect(p['accountNumber']).toBe('******6789');
      expect(await decryptField(rt.config.env['FIELD_ENC_KEY']!, p['accountNumber_enc']!, 'payment_webhooks.accountNumber')).toBe('0123456789');
      // manual queue / matching still work off the parsed payload
      const t = (await rt.db.query<{ status: string }>("SELECT status FROM topups WHERE provider_txn_id = '770001'"))[0];
      expect(t?.status).toBe('credited');
    });

    it('prune deletes only old rejected rows', async () => {
      await rt.db.run("INSERT INTO payment_webhooks (id, provider, event_id, payload, signature_ok, result, received_at, retry_count) VALUES ('old1','sepay','rejected:old1','{}',0,'rejected:x','2020-01-01T00:00:00.000Z',0)");
      expect(await pruneRejectedWebhooks(rt)).toBeGreaterThanOrEqual(1);
      expect((await rt.db.query("SELECT 1 FROM payment_webhooks WHERE id='old1'")).length).toBe(0);
      expect((await rt.db.query("SELECT 1 FROM payment_webhooks WHERE event_id = '770001'")).length).toBe(1);
    });
  });
}
