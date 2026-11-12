import { beforeAll, describe, expect, it } from 'vitest';
import { totp } from '@ams/shared';
import { login, setup } from './helpers.js';
import type { Env } from './helpers.js';

let env: Env;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  env.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

beforeAll(async () => {
  env = await setup();
}, 120_000);

describe('dang nhap + TOTP', () => {
  it('health khong can dang nhap', async () => {
    const r = await env.app.request('/health');
    expect(r.status).toBe(200);
  });

  it('chua dang nhap -> 401 theo dinh dang loi chung', async () => {
    const r = await env.app.request('/admin/v1/campaigns');
    expect(r.status).toBe(401);
    const b = (await r.json()) as { error: { code: string; message: string } };
    expect(b.error.code).toBeTruthy();
    expect(b.error.message).toBeTruthy();
  });

  it('dung mat khau -> yeu cau TOTP, khong cap phien truoc khi xac thuc', async () => {
    const email = env.byRole('super_admin');
    const { password } = env.cred(email);
    const r = await post('/auth/login', { email, password });
    expect(r.status).toBe(200);
    const b = (await r.json()) as { mfa_required: boolean; mfa_token: string };
    expect(b.mfa_required).toBe(true);
    expect(r.headers.getSetCookie().some((c) => c.startsWith('ams_session=') && !/=;/.test(c))).toBe(false);
    const me = await env.app.request('/auth/me');
    expect(me.status).toBe(401);
  });

  it('TOTP dung -> cookie HttpOnly + csrf; /auth/me tra csrf_token', async () => {
    const email = env.byRole('super_admin');
    const { password, totpSecret } = env.cred(email);
    env.rt.clock.advance(31_000);
    const r1 = await post('/auth/login', { email, password });
    const { mfa_token } = (await r1.json()) as { mfa_token: string };
    const r2 = await post('/auth/mfa/verify', { mfa_token, code: await totp(totpSecret, env.rt.clock.now().getTime()) });
    expect(r2.status).toBe(200);
    const cookies = r2.headers.getSetCookie();
    const sess = cookies.find((c) => c.startsWith('ams_session='))!;
    expect(sess).toMatch(/HttpOnly/i);
    expect(sess).toMatch(/SameSite=(Lax|Strict)/i);
    expect(cookies.some((c) => c.startsWith('ams_csrf='))).toBe(true);
    const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    const me = await env.app.request('/auth/me', { headers: { cookie } });
    const mb = (await me.json()) as { user: { email: string }; csrf_token: string; permissions: Record<string, string[]> };
    expect(me.status).toBe(200);
    expect(mb.user.email).toBe(email);
    expect(mb.csrf_token).toBeTruthy();
    expect(mb.permissions['admin']).toBeTruthy();
  });

  it('ma TOTP sai bi tu choi; ma da dung khong dung lai (replay)', async () => {
    const email = env.byRole('finance');
    const { password, totpSecret } = env.cred(email);
    env.rt.clock.advance(31_000);
    const r1 = await post('/auth/login', { email, password });
    const { mfa_token } = (await r1.json()) as { mfa_token: string };
    const bad = await post('/auth/mfa/verify', { mfa_token, code: '000000' });
    expect(bad.status).toBe(401);
    const code = await totp(totpSecret, env.rt.clock.now().getTime());
    const ok = await post('/auth/mfa/verify', { mfa_token, code });
    expect(ok.status).toBe(200);
    // dang nhap lai ngay trong cung cua so 30 giay, dung lai ma cu
    const r3 = await post('/auth/login', { email, password });
    const t3 = ((await r3.json()) as { mfa_token: string }).mfa_token;
    const replay = await post('/auth/mfa/verify', { mfa_token: t3, code });
    expect(replay.status).toBe(401);
  });

  it('sai mat khau nhieu lan -> khoa tam thoi (429) va ghi audit', async () => {
    const email = env.byRole('device_ops');
    const { password } = env.cred(email);
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await post('/auth/login', { email, password: 'sai-mat-khau-1' })).status;
    expect([401, 429]).toContain(last);
    const locked = await post('/auth/login', { email, password });
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBeTruthy();
    const n = await env.rt.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('auth.login_failed','auth.account_locked')");
    expect(Number(n[0]!.n)).toBeGreaterThanOrEqual(5);
    // het thoi gian khoa -> dang nhap lai duoc
    env.rt.clock.advance(60 * 60_000);
    const again = await post('/auth/login', { email, password });
    expect(again.status).toBe(200);
  });

  it('khong lo ton tai tai khoan: email la va sai mat khau cung thong diep', async () => {
    const a = await post('/auth/login', { email: 'khong.co@nowhere.vn', password: 'x-x-x-x-x-x' });
    const b = await post('/auth/login', { email: env.byRole('customer'), password: 'x-x-x-x-x-x' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(((await a.json()) as { error: { message: string } }).error.message).toBe(((await b.json()) as { error: { message: string } }).error.message);
  });

  it('gioi han toc do theo IP', async () => {
    let tooMany = false;
    for (let i = 0; i < 60 && !tooMany; i++) {
      const r = await post('/auth/login', { email: `rl${i}@x.vn`, password: 'x-x-x-x-x-x' }, { 'x-forwarded-for': '203.0.113.9' });
      if (r.status === 429) tooMany = true;
    }
    expect(tooMany).toBe(true);
  });

  it('dang xuat thu hoi phien', async () => {
    const s = await login(env, env.byRole('super_admin'));
    expect((await s.req('GET', '/auth/me')).status).toBe(200);
    expect((await s.req('POST', '/auth/logout')).status).toBe(200);
    expect((await s.req('GET', '/admin/v1/campaigns')).status).toBe(401);
  });
});

describe('CSRF', () => {
  it('ghi khong kem X-CSRF-Token -> 403; sai token -> 403; dung -> chay', async () => {
    const s = await login(env, env.byRole('super_admin'));
    const body = { name: 'Chien dich CSRF', customer_id: env.seed.customers['K001'], budget_vnd: 1_000_000 };
    const none = await s.req('POST', '/admin/v1/campaigns', body, { csrf: null });
    expect(none.status).toBe(403);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe('csrf_invalid');
    expect((await s.req('POST', '/admin/v1/campaigns', body, { csrf: 'sai-token' })).status).toBe(403);
    expect((await s.req('POST', '/admin/v1/campaigns', body)).status).toBe(201);
    // GET khong can CSRF
    expect((await s.req('GET', '/admin/v1/campaigns')).status).toBe(200);
  });

  it('cung ap dung cho cong khach hang', async () => {
    const s = await login(env, env.byRole('customer'));
    const body = { name: 'Chien dich cong khach', budget_vnd: 1_000_000 };
    expect((await s.req('POST', '/portal/v1/campaigns', body, { csrf: null })).status).toBe(403);
    expect((await s.req('POST', '/portal/v1/campaigns', body)).status).toBe(201);
  });
});

describe('loi moi va kich hoat', () => {
  it('moi -> mail 72 gio -> dat mat khau -> bat TOTP -> dang nhap', async () => {
    const admin = await login(env, env.byRole('super_admin'));
    const before = env.rt.mail.outbox.length;
    const created = await admin.json<{ id: string; status: string }>('POST', '/admin/v1/users', { name: 'Nhan Vien Moi', email: 'moi@ams.vn', role: 'content_manager' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('invited');
    expect(env.rt.mail.outbox.length).toBe(before + 1);
    const mail = env.rt.mail.outbox[before]!;
    expect(mail.to).toBe('moi@ams.vn');
    const token = decodeURIComponent((mail.text ?? mail.html).match(/token=([^\s"&<]+)/)![1]!);
    // mat khau yeu bi tu choi
    expect((await post('/auth/invite/accept', { token, password: '123' })).status).toBe(422);
    const acc = await post('/auth/invite/accept', { token, password: 'MatKhau-Manh-2026' });
    expect(acc.status).toBe(200);
    const { mfa_token } = (await acc.json()) as { mfa_token: string };
    const en = await post('/auth/mfa/enroll', { mfa_token });
    const { secret } = (await en.json()) as { secret: string };
    env.rt.clock.advance(31_000);
    const v = await post('/auth/mfa/verify', { mfa_token, code: await totp(secret, env.rt.clock.now().getTime()) });
    expect(v.status).toBe(200);
    // token chi dung mot lan
    expect((await post('/auth/invite/accept', { token, password: 'MatKhau-Manh-2026' })).status).toBe(422);
    // het han sau 72 gio
    const c2 = await admin.json<{ id: string }>('POST', '/admin/v1/users', { name: 'Het Han', email: 'hethan@ams.vn', role: 'finance' });
    expect(c2.status).toBe(201);
    const m2 = env.rt.mail.outbox[env.rt.mail.outbox.length - 1]!;
    const t2 = decodeURIComponent((m2.text ?? m2.html).match(/token=([^\s"&<]+)/)![1]!);
    env.rt.clock.advance(73 * 3600_000);
    expect((await post('/auth/invite/accept', { token: t2, password: 'MatKhau-Manh-2026' })).status).toBe(422);
  });
});
