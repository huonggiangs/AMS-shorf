import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestRuntime } from '@ams/runtime';
import { actorHdr, mkApp, mkCustomer, mkRt, sign, wallet, webhookBody } from './helpers.js';

const KEY = 'AMS-key-SuperSecret-9876';
const HMAC = 'hmac-secret-ABCDEF-5432';

for (const dialect of ['postgres', 'sqlite'] as const) {
  describe(`SePay ket noi [${dialect}]`, () => {
    let rt: TestRuntime;
    let app: ReturnType<typeof mkApp>['app'];
    const f = actorHdr({ id: 'F1', role: 'finance' });
    const url = '/admin/v1/settings/sepay';
    const put = (b: unknown, h = f) => app.request(url, { method: 'PUT', headers: h, body: JSON.stringify(b) });
    const hook = (body: string, headers: Record<string, string>) => app.request('/webhooks/payments/sepay', { method: 'POST', body, headers });

    beforeAll(async () => {
      // khong dat bi mat qua env: moi thu di qua DB (ma hoa)
      rt = await mkRt(dialect, { SEPAY_API_KEY: '', SEPAY_WEBHOOK_SECRET: '' });
      ({ app } = mkApp(rt));
    });
    afterAll(async () => rt.close());

    it('truoc khi luu: webhook bi tu choi, test bao thieu khoa', async () => {
      const g = (await (await app.request(url, { headers: f })).json()) as Record<string, any>;
      expect(g).toMatchObject({ apikey_set: false, secret_set: false, has_secret: false });
      const body = webhookBody({ id: 880001, amount: 6_000_000, content: 'AMS X' });
      expect((await hook(body, { authorization: `Apikey ${KEY}` })).status).toBe(401);
      const t = (await (await app.request(`${url}/test`, { method: 'POST', headers: f, body: '{}' })).json()) as Record<string, any>;
      expect(t.ok).toBe(false);
    });

    it('PUT luu API Key + secret ma hoa; GET chi tra goi y da che, khong tra gia tri that', async () => {
      const r = await put({ api_key: KEY, webhook_secret: HMAC, auth_mode: 'apikey' });
      expect(r.status).toBe(200);
      const txt = await r.text();
      const g = await (await app.request(url, { headers: f })).text();
      for (const out of [txt, g]) {
        expect(out).not.toContain(KEY);
        expect(out).not.toContain(HMAC);
        expect(out).not.toContain('SuperSecret');
      }
      expect(JSON.parse(g)).toMatchObject({ apikey_set: true, apikey_hint: '••••9876', apikey_source: 'db', secret_set: true, secret_hint: '••••5432', auth_mode: 'apikey', has_secret: true });
      const stored = (await rt.db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'sepay'"))[0]!.value;
      expect(stored).not.toContain(KEY);
      expect(stored).not.toContain(HMAC);
      expect(stored).toContain('apikey_enc');
    });

    it('audit_log ghi lan doi nhung khong chua bi mat', async () => {
      const rows = await rt.db.query<{ diff: string; actor_id: string }>("SELECT diff, actor_id FROM audit_log WHERE action = 'finance.sepay.update' ORDER BY ts DESC, id DESC");
      expect(rows.length).toBeGreaterThan(0);
      const all = rows.map((x) => x.diff).join('\n');
      expect(all).toContain('••••9876');
      expect(all).not.toContain(KEY);
      expect(all).not.toContain(HMAC);
      expect(rows[0]!.actor_id).toBe('F1');
    });

    it('webhook: Authorization Apikey dung -> cong tien; trung id -> khong cong lan hai', async () => {
      const cid = await mkCustomer(rt, 'KEYA');
      const body = webhookBody({ id: 880100, amount: 6_000_000, content: 'AMS KEYA' });
      expect((await hook(body, { authorization: `Apikey ${KEY}` })).status).toBe(200);
      expect((await hook(body, { authorization: `apikey ${KEY}` })).status).toBe(200); // gui lai
      expect((await wallet(rt, cid)).balance).toBe(6_000_000);
    });

    it('webhook: Apikey sai / thieu / Bearer -> 401 va khong cong tien', async () => {
      const cid = await mkCustomer(rt, 'KEYB');
      const body = webhookBody({ id: 880200, amount: 6_000_000, content: 'AMS KEYB' });
      expect((await hook(body, { authorization: `Apikey ${KEY}x` })).status).toBe(401);
      expect((await hook(body, { authorization: `Apikey ` })).status).toBe(401);
      expect((await hook(body, { authorization: `Bearer ${KEY}` })).status).toBe(401);
      expect((await hook(body, {})).status).toBe(401);
      expect((await wallet(rt, cid)).balance).toBe(0);
    });

    it('webhook: che do HMAC cung chay song song voi API Key', async () => {
      const cid = await mkCustomer(rt, 'HMA');
      const body = webhookBody({ id: 880300, amount: 7_000_000, content: 'AMS HMA' });
      expect((await hook(body, await sign(rt, body, { secret: HMAC }))).status).toBe(200);
      expect((await wallet(rt, cid)).balance).toBe(7_000_000);
      const bad = webhookBody({ id: 880301, amount: 7_000_000, content: 'AMS HMA' });
      expect((await hook(bad, await sign(rt, bad, { secret: 'sai' }))).status).toBe(401);
      expect((await hook(bad, await sign(rt, bad, { secret: HMAC, skewMs: 10 * 60_000 }))).status).toBe(401);
      expect((await wallet(rt, cid)).balance).toBe(7_000_000);
    });

    it('Apikey sai nhung kem chu ky HMAC hop le -> van nhan (HMAC); chu ky sai -> tu choi', async () => {
      const cid = await mkCustomer(rt, 'MIX');
      const body = webhookBody({ id: 880400, amount: 6_000_000, content: 'AMS MIX' });
      expect((await hook(body, { ...(await sign(rt, body, { secret: HMAC })), authorization: 'Apikey wrong-key-123' })).status).toBe(200);
      expect((await wallet(rt, cid)).balance).toBe(6_000_000);
      const b2 = webhookBody({ id: 880401, amount: 6_000_000, content: 'AMS MIX' });
      expect((await hook(b2, { ...(await sign(rt, b2, { secret: 'sai' })), authorization: 'Apikey wrong-key-123' })).status).toBe(401);
    });

    it('khoa API Key khong xuat hien trong ban ghi webhook bi tu choi, thong bao loi hay log', async () => {
      const body = webhookBody({ id: 880500, amount: 1, content: 'AMS Z' });
      const r = await hook(body, { authorization: `Apikey ${KEY}zzz` });
      expect(await r.text()).not.toContain(KEY);
      const rows = await rt.db.query<{ payload: string }>("SELECT payload FROM payment_webhooks WHERE result LIKE 'rejected:%'");
      expect(rows.map((x) => x.payload).join()).not.toContain(KEY);
    });

    it('PUT validate: key qua ngan / co khoang trang -> 400; sai quyen -> 403; bo trong giu nguyen khoa', async () => {
      expect((await put({ api_key: 'short' })).status).toBe(400);
      expect((await put({ api_key: 'has space inside' })).status).toBe(400);
      expect((await put({ api_key: 'x'.repeat(20) }, actorHdr({ id: 'CM', role: 'content_manager' }))).status).toBe(403);
      expect((await put({ api_key: 'x'.repeat(20) }, actorHdr({ id: 'F2', role: 'finance', perms: [] }))).status).not.toBe(500);
      await put({ prefix: 'ams' }); // khong gui api_key -> khong doi
      const g = (await (await app.request(url, { headers: f })).json()) as Record<string, any>;
      expect(g.apikey_hint).toBe('••••9876');
    });

    it('/test: bao apikey_ok, khong tra bi mat; doi khoa -> khoa cu bi tu choi; xoa khoa', async () => {
      await put({ bank: 'MBBank', account_number: '9704123456', account_holder: 'cong ty abc' });
      const t = await (await app.request(`${url}/test`, { method: 'POST', headers: f, body: '{}' })).text();
      expect(t).not.toContain(KEY);
      expect(JSON.parse(t)).toMatchObject({ ok: true, apikey_ok: true, signature_ok: true });
      const NEW = 'NEW-key-0000-ABCD';
      await put({ api_key: NEW });
      const body = webhookBody({ id: 880600, amount: 1, content: 'AMS Q' });
      expect((await hook(body, { authorization: `Apikey ${KEY}` })).status).toBe(401);
      expect((await hook(body, { authorization: `Apikey ${NEW}` })).status).toBe(200);
      await put({ api_key: '' });
      const g = (await (await app.request(url, { headers: f })).json()) as Record<string, any>;
      expect(g.apikey_set).toBe(false);
      expect((await hook(webhookBody({ id: 880601, amount: 1, content: 'AMS Q' }), { authorization: `Apikey ${NEW}` })).status).toBe(401);
    });
  });
}

describe('SePay: bi mat tu bien moi truong uu tien', () => {
  it('apikey_source = env va khong bi UI ghi de de nhan webhook', async () => {
    const rt = await mkRt('sqlite', { SEPAY_API_KEY: 'env-key-12345678' });
    const { app } = mkApp(rt);
    const f = actorHdr({ id: 'F1', role: 'finance' });
    await app.request('/admin/v1/settings/sepay', { method: 'PUT', headers: f, body: JSON.stringify({ api_key: 'db-key-12345678' }) });
    const g = (await (await app.request('/admin/v1/settings/sepay', { headers: f })).json()) as Record<string, any>;
    expect(g).toMatchObject({ apikey_source: 'env', apikey_hint: '••••5678' });
    const body = webhookBody({ id: 1, amount: 1, content: 'AMS Q' });
    expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: { authorization: 'Apikey env-key-12345678' } })).status).toBe(200);
    expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: { authorization: 'Apikey db-key-12345678' } })).status).toBe(401);
    await rt.close();
  });
});
