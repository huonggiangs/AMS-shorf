import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestRuntime } from '@ams/runtime';
import { code, mkAdmin } from './stepup.js';
import { actorHdr, mkApp, mkCustomer, mkRt, sign, wallet, webhookBody } from './helpers.js';

const KEY = 'AMS-key-SuperSecret-9876';
const HMAC = 'hmac-secret-ABCDEF-5432';

for (const dialect of ['postgres', 'sqlite'] as const) {
  describe(`SePay ket noi [${dialect}]`, () => {
    let rt: TestRuntime;
    let app: ReturnType<typeof mkApp>['app'];
    const f = actorHdr({ id: 'F1', role: 'finance' });
    const url = '/admin/v1/settings/sepay';
    const put = async (b: Record<string, unknown>, h = f, who = 'F1', withTotp = true) => app.request(url, { method: 'PUT', headers: h, body: JSON.stringify(withTotp ? { ...b, totp: await code(rt, who) } : b) });
    const hook = (body: string, headers: Record<string, string>) => app.request('/webhooks/payments/sepay', { method: 'POST', body, headers });

    beforeAll(async () => {
      // khong dat bi mat qua env: moi thu di qua DB (ma hoa)
      rt = await mkRt(dialect, { SEPAY_API_KEY: '', SEPAY_WEBHOOK_SECRET: '' });
      ({ app } = mkApp(rt));
      await mkAdmin(rt, 'F1'); await mkAdmin(rt, 'F2');
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
      expect((await rt.db.query('SELECT 1 FROM ad_wallets WHERE customer_id = ? AND balance_vnd > 0', [cid])).length).toBe(0);
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
      await put({ prefix: 'ams' }); // khong gui api_key -> khong doi
      const g = (await (await app.request(url, { headers: f })).json()) as Record<string, any>;
      expect(g.apikey_hint).toBe('••••9876');
    });

    it('/test: bao apikey_ok, khong tra bi mat; doi khoa -> khoa cu bi tu choi; xoa khoa', async () => {
      const pr = await put({ bank: 'MBBank', account_number: '9704123456', account_holder: 'cong ty abc' });
      const pid = ((await pr.json()) as { pending_change_id: string }).pending_change_id;
      await app.request(`${url}/changes/${pid}/approve`, { method: 'POST', headers: actorHdr({ id: 'F2', role: 'finance' }), body: JSON.stringify({ totp: await code(rt, 'F2') }) });
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
    await mkAdmin(rt, 'F1');
    const { app } = mkApp(rt);
    const f = actorHdr({ id: 'F1', role: 'finance' });
    await app.request('/admin/v1/settings/sepay', { method: 'PUT', headers: f, body: JSON.stringify({ api_key: 'db-key-12345678', totp: await code(rt, 'F1') }) });
    const g = (await (await app.request('/admin/v1/settings/sepay', { headers: f })).json()) as Record<string, any>;
    expect(g).toMatchObject({ apikey_source: 'env', apikey_hint: '••••5678' });
    const body = webhookBody({ id: 1, amount: 1, content: 'AMS Q' });
    expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: { authorization: 'Apikey env-key-12345678' } })).status).toBe(200);
    expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: { authorization: 'Apikey db-key-12345678' } })).status).toBe(401);
    await rt.close();
  });
});

describe('R1-02: step-up TOTP + hai nguoi cho doi tai khoan nhan tien', () => {
  it('thieu/sai/dung lai TOTP bi tu choi; doi tai khoan can nguoi khac duyet; audit + email + khong ap dung truoc khi duyet', async () => {
    const rt = await mkRt('sqlite', { SEPAY_API_KEY: '', SEPAY_WEBHOOK_SECRET: '' });
    const { app } = mkApp(rt);
    await mkAdmin(rt, 'F1'); await mkAdmin(rt, 'F2'); await mkAdmin(rt, 'F3', 'finance', { totp: false });
    const url = '/admin/v1/settings/sepay';
    const h1 = actorHdr({ id: 'F1', role: 'finance' });
    const h2 = actorHdr({ id: 'F2', role: 'finance' });
    const call = (h: Record<string, string>, path: string, method: string, b: unknown) => app.request(path, { method, headers: h, body: JSON.stringify(b) });
    const sent: string[] = [];
    (rt.mail as { send: (m: { to: string; subject: string; html: string }) => Promise<void> }).send = async (m) => { sent.push(m.to + '|' + m.subject + '|' + m.html); };

    // thieu TOTP
    const miss = await call(h1, url, 'PUT', { api_key: 'abcdefgh-12345' });
    expect(miss.status).toBe(403);
    expect(((await miss.json()) as any).error.code).toBe('step_up_required');
    // sai TOTP
    expect(((await (await call(h1, url, 'PUT', { api_key: 'abcdefgh-12345', totp: '000000' })).json()) as any).error.code).toBe('step_up_invalid');
    // nguoi chua bat TOTP
    expect(((await (await call(actorHdr({ id: 'F3', role: 'finance' }), url, 'PUT', { api_key: 'abcdefgh-12345', totp: '123456' })).json()) as any).error.code).toBe('mfa_not_enrolled');
    expect((await (await app.request(url, { headers: h1 })).json() as any).apikey_set).toBe(false);

    // dung lai cung mot ma -> tu choi
    const c1 = await code(rt, 'F1');
    expect((await call(h1, url, 'PUT', { api_key: 'abcdefgh-12345', totp: c1 })).status).toBe(200);
    const re = await call(h1, url, 'PUT', { api_key: 'zzzzzzzz-99999', totp: await code(rt, 'F1', { reuse: true }) });
    expect(((await re.json()) as any).error.code).toBe('step_up_invalid');
    expect(sent.some((x) => x.includes('Khóa webhook SePay đã thay đổi'))).toBe(true);
    expect(sent.join()).not.toContain('abcdefgh-12345');

    // doi tai khoan: chua ap dung
    const before = (await (await app.request(url, { headers: h1 })).json()) as any;
    const pr = await call(h1, url, 'PUT', { account_number: '9704999888', bank: 'Vietcombank', totp: await code(rt, 'F1') });
    expect(pr.status).toBe(202);
    const id = ((await pr.json()) as any).pending_change_id as string;
    expect(((await (await app.request(url, { headers: h1 })).json()) as any).account_number).toBe(before.account_number);
    const list = (await (await app.request(`${url}/changes`, { headers: h1 })).json()) as any;
    expect(list.items[0]).toMatchObject({ id, status: 'pending', requested_by: 'F1' });
    expect(JSON.stringify(list)).not.toContain('9704999888');
    expect(sent.some((x) => x.includes('Đề xuất đổi tài khoản nhận tiền'))).toBe(true);
    // chinh nguoi de xuat khong tu duyet duoc (du TOTP dung)
    const self = await call(h1, `${url}/changes/${id}/approve`, 'POST', { totp: await code(rt, 'F1') });
    expect(self.status).toBe(403);
    expect(((await self.json()) as any).error.code).toBe('same_person');
    // nguoi khac thieu TOTP -> tu choi; quyen khong du -> 403
    expect((await call(h2, `${url}/changes/${id}/approve`, 'POST', {})).status).toBe(403);
    expect((await call(actorHdr({ id: 'CM', role: 'content_manager' }), `${url}/changes/${id}/approve`, 'POST', { totp: '123456' })).status).toBe(403);
    // duyet boi nguoi thu hai
    const ok = await call(h2, `${url}/changes/${id}/approve`, 'POST', { totp: await code(rt, 'F2') });
    expect(ok.status).toBe(200);
    expect(((await (await app.request(url, { headers: h1 })).json()) as any)).toMatchObject({ account_number: '9704999888', bank: 'Vietcombank' });
    expect((await call(h2, `${url}/changes/${id}/approve`, 'POST', { totp: await code(rt, 'F2') })).status).toBe(404); // da xu ly (khoa doi ten)
    // audit
    const acts = (await rt.db.query<{ action: string; diff: string | null }>("SELECT action, diff FROM audit_log WHERE action LIKE 'finance.sepay.%'")).map((r) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['finance.sepay.update', 'finance.sepay.change_requested', 'finance.sepay.change_approved']));
    const diffs = (await rt.db.query<{ diff: string | null }>("SELECT diff FROM audit_log WHERE action LIKE 'finance.sepay.%'")).map((r) => r.diff).join();
    expect(diffs).not.toContain('9704999888');
    expect(diffs).not.toContain('abcdefgh');

    // tu choi + het han
    const p2 = ((await (await call(h1, url, 'PUT', { account_holder: 'KE XAU', totp: await code(rt, 'F1') })).json()) as any).pending_change_id as string;
    expect((await call(h2, `${url}/changes/${p2}/reject`, 'POST', {})).status).toBe(200);
    expect((await call(h2, `${url}/changes/${p2}/approve`, 'POST', { totp: await code(rt, 'F2') })).status).toBe(404);
    const p3 = ((await (await call(h1, url, 'PUT', { account_holder: 'KE XAU 2', totp: await code(rt, 'F1') })).json()) as any).pending_change_id as string;
    rt.clock.set?.(new Date(rt.clock.now().getTime() + 25 * 3600_000));
    const exp = await call(h2, `${url}/changes/${p3}/approve`, 'POST', { totp: await code(rt, 'F2') });
    expect([409, 403]).toContain(exp.status);
    expect(((await (await app.request(url, { headers: h1 })).json()) as any).account_holder).not.toBe('KE XAU 2');
    await rt.close();
  });
});

describe('production chi co khoa trong DB (khong co env)', () => {
  it('khoi dong duoc va webhook Apikey tu DB duoc chap nhan; khong co khoa thi 401', async () => {
    const base = await mkRt('sqlite', { SEPAY_API_KEY: '', SEPAY_WEBHOOK_SECRET: '' });
    const { saveSepayConfig } = await import('../src/index.js');
    await saveSepayConfig(base, base.db, { api_key: 'db-only-key-0001' }, 'test');
    const prod = { ...base, config: { runtime: 'docker', env: { ...base.config.env, SEPAY_MODE: 'production' } } } as typeof base;
    const { app } = mkApp(prod);
    const cid = await mkCustomer(base, 'PRD');
    const body = webhookBody({ id: 990100, amount: 6_000_000, content: 'AMS PRD' });
    expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body, headers: { authorization: 'Apikey db-only-key-0001' } })).status).toBe(200);
    expect((await wallet(base, cid)).balance).toBe(6_000_000);
    expect((await app.request('/webhooks/payments/sepay', { method: 'POST', body: webhookBody({ id: 990101, amount: 1, content: 'AMS PRD' }), headers: { authorization: 'Apikey nope-nope-nope' } })).status).toBe(401);
    await base.close();
  });
});
