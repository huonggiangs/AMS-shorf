// p2-rest: __Host- cookie, tieu de bao mat, xoay khoa truong (key id + ma hoa lai), gioi han toc do MFA/enroll.
import { beforeAll, describe, expect, it } from 'vitest';
import { decryptField, fieldKeyRingFromEnv, fieldTokenKeyId, generateFieldKey, totp } from '@ams/shared';
import { TEST_FIELD_ENC_KEY } from '@ams/runtime';
import { reencryptFields } from '../src/lib/reencrypt.js';
import { login, setup } from './helpers.js';
import type { Env } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const post = (env: Env, path: string, body: unknown, headers: Record<string, string> = {}) =>
  env.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const jar = (r: Response) => r.headers.getSetCookie();

async function fullLogin(env: Env, email: string): Promise<{ r1: Response; r2: Response; cookie: string; csrf: string }> {
  const { password, totpSecret } = env.cred(email);
  env.rt.clock.advance(31_000);
  const r1 = await post(env, '/auth/login', { email, password });
  const { mfa_token } = (await r1.clone().json()) as { mfa_token: string };
  const r2 = await post(env, '/auth/mfa/verify', { mfa_token, code: await totp(totpSecret, env.rt.clock.now().getTime()) });
  const cookie = jar(r2).filter((c) => !/=;/.test(c) && !/Max-Age=0/i.test(c)).map((c) => c.split(';')[0]).join('; ');
  return { r1, r2, cookie, csrf: ((await r2.json()) as { csrf_token: string }).csrf_token };
}

describe('R1-24 __Host- cookie', () => {
  let https: Env;
  let http: Env;
  beforeAll(async () => {
    https = await setup({}, 'sqlite', { PUBLIC_ADMIN_URL: 'https://ams.anio.vn' });
    http = await setup({}, 'sqlite', { PUBLIC_ADMIN_URL: 'http://localhost:8080' });
  }, 120_000);

  it('HTTPS: cookie phien/CSRF/MFA co tien to __Host-, Secure, Path=/, khong Domain', async () => {
    const email = https.byRole('super_admin');
    const { r1, r2 } = await fullLogin(https, email);
    const mfa = jar(r1).find((c) => c.startsWith('__Host-ams_mfa='))!;
    expect(mfa).toMatch(/Secure/i);
    expect(mfa).toMatch(/SameSite=Strict/i);
    expect(jar(r1).some((c) => /^ams_mfa=[^;]/.test(c))).toBe(false);
    const sess = jar(r2).find((c) => c.startsWith('__Host-ams_session=') && !/Max-Age=0/i.test(c))!;
    const csrf = jar(r2).find((c) => c.startsWith('__Host-ams_csrf=') && !/Max-Age=0/i.test(c))!;
    for (const c of [sess, csrf, mfa]) {
      expect(c).toMatch(/;\s*Secure/i);
      expect(c).toMatch(/Path=\//);
      expect(c).not.toMatch(/Domain=/i);
    }
    expect(sess).toMatch(/HttpOnly/i);
    expect(sess).toMatch(/SameSite=Lax/i);
    expect(csrf).not.toMatch(/HttpOnly/i);
    // ten cu khong tien to bi xoa (khong con cookie song song)
    expect(jar(r2).some((c) => /^ams_session=;/.test(c) && /Max-Age=0/i.test(c))).toBe(true);
    expect(jar(r2).some((c) => /^ams_session=[^;]+/.test(c))).toBe(false);
  });

  it('HTTPS: dung cookie __Host-ams_session goi duoc API (doc + CSRF); ten cu van doc duoc de chuyen doi', async () => {
    const s = await login(https, https.byRole('super_admin'));
    expect(s.cookie).toContain('__Host-ams_session=');
    expect((await s.req('GET', '/auth/me')).status).toBe(200);
    expect((await s.req('POST', '/auth/logout', {})).status).toBe(200);
    const legacy = await fullLogin(https, https.byRole('finance'));
    const token = legacy.cookie.split('; ').find((c) => c.startsWith('__Host-ams_session='))!.split('=')[1]!;
    expect((await https.app.request('/auth/me', { headers: { cookie: `ams_session=${token}` } })).status).toBe(200);
    // tien to uu tien: cookie __Host- sai thang cookie thuong dung
    expect((await https.app.request('/auth/me', { headers: { cookie: `__Host-ams_session=bad; ams_session=${token}` } })).status).toBe(401);
  });

  it('HTTP local (khong the Secure): ten thuong, khong co tien to', async () => {
    const { r2 } = await fullLogin(http, http.byRole('super_admin'));
    expect(jar(r2).some((c) => c.startsWith('ams_session=') && !/Max-Age=0/i.test(c))).toBe(true);
    expect(jar(r2).some((c) => c.startsWith('__Host-'))).toBe(false);
    expect(jar(r2).find((c) => c.startsWith('ams_session='))).not.toMatch(/Secure/i);
  });

  it('logout xoa ca ten co tien to va ten cu', async () => {
    const s = await login(https, https.byRole('device_ops'));
    const r = await s.req('POST', '/auth/logout', {});
    const names = jar(r).filter((c) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)).map((c) => c.split('=')[0]);
    expect(names).toEqual(expect.arrayContaining(['__Host-ams_session', '__Host-ams_csrf', 'ams_session', 'ams_csrf']));
  });

  it('HTTPS: bat 2FA trong Ho so bang phien hien co (cookie __Host- + CSRF): enroll roi verify chi bang cookie', async () => {
    const email = https.byRole('device_ops');
    const { password } = https.cred(email);
    await https.rt.db.run('UPDATE admins SET totp_secret_enc = NULL, mfa_required = 0 WHERE email = ?', [email]);
    const r1 = await post(https, '/auth/login', { email, password });
    expect(((await r1.json()) as any).mfa_required).toBe(false);
    const cookie = jar(r1).filter((c) => !/Max-Age=0/i.test(c)).map((c) => c.split(';')[0]).join('; ');
    expect(cookie).toContain('__Host-ams_session=');
    const csrf = decodeURIComponent(/__Host-ams_csrf=([^;]+)/.exec(cookie)![1]!);
    expect((await post(https, '/auth/mfa/enroll', {}, { cookie })).status).toBe(403); // thieu CSRF
    const en = await post(https, '/auth/mfa/enroll', {}, { cookie, 'x-csrf-token': csrf });
    expect(en.status).toBe(200);
    const { secret } = (await en.json()) as { secret: string };
    const mfaCookie = jar(en).find((c) => c.startsWith('__Host-ams_mfa='))!.split(';')[0]!;
    https.rt.clock.advance(31_000);
    const code = await totp(secret, https.rt.clock.now().getTime());
    const v = await post(https, '/auth/mfa/verify', { code }, { cookie: `${cookie}; ${mfaCookie}` });
    expect(v.status).toBe(200);
    expect(jar(v).some((c) => c.startsWith('__Host-ams_session=') && !/Max-Age=0/i.test(c))).toBe(true);
    expect((await https.rt.db.query<{ t: string | null }>('SELECT totp_secret_enc AS t FROM admins WHERE email = ?', [email]))[0]!.t).toMatch(/^v2:/);
  });

  it('tieu de bao mat API: CSP none, DENY, Permissions-Policy; HSTS chi o HTTPS', async () => {
    const a = await https.app.request('/health');
    expect(a.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(a.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    expect(a.headers.get('x-frame-options')).toBe('DENY');
    expect(a.headers.get('permissions-policy')).toMatch(/camera=\(\)/);
    expect(a.headers.get('referrer-policy')).toBe('no-referrer');
    expect(a.headers.get('x-content-type-options')).toBe('nosniff');
    expect(a.headers.get('strict-transport-security')).toMatch(/max-age=31536000/);
    expect(a.headers.get('cache-control')).toBe('no-store');
    expect((await http.app.request('/health')).headers.get('strict-transport-security')).toBeNull();
  });
});

describe('P1-10 xoay FIELD_ENC_KEY: key id + ma hoa lai', () => {
  let env: Env;
  const NEW = generateFieldKey();
  beforeAll(async () => { env = await setup({}, 'sqlite'); }, 120_000);

  it('truoc xoay: du lieu seed la v1; sau khi nap khoa moi lam khoa ghi, doc van duoc; job ma hoa lai doi het sang khoa moi; go khoa cu van doc duoc', async () => {
    const db = env.rt.db;
    const tax = (await db.query<{ tax_code_enc: string }>('SELECT tax_code_enc FROM customers WHERE tax_code_enc IS NOT NULL LIMIT 1'))[0]!.tax_code_enc;
    expect(tax.startsWith('v1:')).toBe(true);
    const adminEmail = env.byRole('super_admin');
    // payload webhook co so tai khoan ma hoa (ghi bang khoa cu)
    const oldRing = fieldKeyRingFromEnv({ FIELD_ENC_KEY: TEST_FIELD_ENC_KEY });
    const { encryptField } = await import('@ams/shared');
    const acct = await encryptField(oldRing, '0123456789', 'payment_webhooks.accountNumber');
    await db.run("INSERT INTO payment_webhooks (id, provider, event_id, payload, signature_ok, received_at) VALUES ('wh-p2r','sepay','ev-p2r',?,1,?)", [JSON.stringify({ accountNumber: '******6789', accountNumber_enc: acct }), '2026-11-12T03:00:00.000Z']);

    // buoc 1: nap khoa moi, giu khoa cu lam khoa ghi (doc duoc ca hai)
    env.rt.config.env['FIELD_ENC_KEYS'] = `k2:${NEW}`;
    env.rt.config.env['FIELD_ENC_KEY_ID'] = 'k0';
    expect(fieldKeyRingFromEnv(env.rt.config.env).primaryId).toBe('k0');
    // buoc 2: chuyen khoa ghi sang k2
    delete env.rt.config.env['FIELD_ENC_KEY_ID'];
    expect(fieldKeyRingFromEnv(env.rt.config.env).primaryId).toBe('k2');
    // du lieu cu van dang nhap duoc (TOTP giai ma bang khoa cu qua vong khoa)
    const dry = await reencryptFields(env.rt, { dryRun: true });
    expect(dry.updated).toBeGreaterThan(0);
    expect((await db.query<{ tax_code_enc: string }>('SELECT tax_code_enc FROM customers WHERE tax_code_enc = ?', [tax])).length).toBe(1); // dry-run khong ghi

    let rep = await reencryptFields(env.rt, { limit: 5 });
    let guard = 0;
    while (rep.pending > 0 && rep.updated > 0 && guard++ < 200) rep = await reencryptFields(env.rt, { limit: 5 });
    expect(rep.failed).toBe(0);
    expect(rep.pending).toBe(0);
    expect(rep.primaryId).toBe('k2');
    expect((await reencryptFields(env.rt)).updated).toBe(0); // idempotent

    for (const [t, c] of [['customers', 'tax_code_enc'], ['admins', 'totp_secret_enc'], ['end_users', 'email_enc']] as const) {
      const rows = await db.query<Record<string, string | null>>(`SELECT ${c} AS v FROM ${t} WHERE ${c} IS NOT NULL`);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(fieldTokenKeyId(r['v']!)).toBe('k2');
    }
    const sepay = JSON.parse((await db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'sepay'"))[0]!.value) as Record<string, string>;
    expect(fieldTokenKeyId(sepay['account_no_enc']!)).toBe('k2');
    const wh = JSON.parse((await db.query<{ payload: string }>("SELECT payload FROM payment_webhooks WHERE id = 'wh-p2r'"))[0]!.payload) as Record<string, string>;
    expect(fieldTokenKeyId(wh['accountNumber_enc']!)).toBe('k2');
    expect(await decryptField(fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `k2:${NEW}` }), wh['accountNumber_enc']!, 'payment_webhooks.accountNumber')).toBe('0123456789');

    // buoc 3: go khoa cu; dang nhap (TOTP) + doc MST van chay
    delete env.rt.config.env['FIELD_ENC_KEY'];
    env.rt.config.env['FIELD_INDEX_KEY'] = TEST_FIELD_ENC_KEY; // chi muc mu giu nguyen
    const s = await login(env, adminEmail);
    expect((await s.req('GET', '/auth/me')).status).toBe(200);
    const cust = await s.json('GET', '/admin/v1/customers?page_size=5');
    expect(cust.status).toBe(200);
    expect(JSON.stringify(cust.body)).toMatch(/\d{10}/); // MST giai ma duoc
  });

  it('route reencrypt-fields: chi super_admin; ghi audit', async () => {
    env.rt.config.env['FIELD_ENC_KEYS'] = `k3:${generateFieldKey()},k2:${NEW}`;
    const root = await login(env, env.byRole('super_admin'));
    const ops = await login(env, env.byRole('device_ops'));
    expect((await ops.req('POST', '/admin/v1/ops/reencrypt-fields', {})).status).toBe(403);
    const r = await root.json('POST', '/admin/v1/ops/reencrypt-fields', {});
    expect(r.status).toBe(200);
    expect(r.body.primaryId).toBe('k3');
    expect(r.body.updated).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(/v2:/); // khong tra ban ma
    expect((await env.rt.db.query("SELECT 1 FROM audit_log WHERE action = 'ops.reencrypt_fields'")).length).toBe(1);
  });

  it('khoa cu thieu: ban ghi khong giai ma duoc duoc bao la loi (khong go khoa cu)', async () => {
    env.rt.config.env['FIELD_ENC_KEYS'] = `k4:${generateFieldKey()}`; // k3/k2 bi bo qua -> khong doc duoc du lieu k3
    const rep = await reencryptFields(env.rt);
    expect(rep.failed).toBeGreaterThan(0);
    expect(rep.pending).toBeGreaterThan(0);
  });
});

describe('brute-force MFA / enroll', () => {
  let env: Env;
  beforeAll(async () => { env = await setup({}, 'sqlite'); }, 120_000);
  it('nhap sai TOTP 5 lan -> phien MFA bi vo hieu (ngay ca khi lan 6 dung)', async () => {
    const email = env.byRole('super_admin');
    const { password, totpSecret } = env.cred(email);
    env.rt.clock.advance(31_000);
    const { mfa_token } = (await (await post(env, '/auth/login', { email, password })).json()) as { mfa_token: string };
    for (let i = 0; i < 5; i++) expect((await post(env, '/auth/mfa/verify', { mfa_token, code: '000000' })).status).toBe(401);
    const good = await post(env, '/auth/mfa/verify', { mfa_token, code: await totp(totpSecret, env.rt.clock.now().getTime()) });
    expect(good.status).toBe(401);
    expect(((await good.json()) as any).error.code).toBe('mfa_expired');
  });
  it('mfa/enroll bi gioi han theo IP', async () => {
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await post(env, '/auth/mfa/enroll', { mfa_token: 'x' }, { 'x-forwarded-for': '7.7.7.7' })).status;
    expect(last).toBe(429);
  });
});
