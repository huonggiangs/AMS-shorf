import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { assertSepaySafe, bootstrap, resolveAmsEnv, seedDemo, SeedRefusedError } from '@ams/db';
import { TEST_ENV, createTestRuntime } from '@ams/runtime';
import { decryptField, generateTotpSecret, verifyPassword } from '@ams/shared';
import { createApp } from '../src/app.js';

const N = (r: { n: number }[]) => Number(r[0]!.n);
const P = { N: 1024 };
const PROD = { AMS_ENV: 'production', SEPAY_MODE: 'sandbox', FIELD_ENC_KEY: Buffer.alloc(32, 7).toString('base64') };
const STRONG = 'Sup3r-Secret-Pass-9';

for (const dialect of ['postgres', 'sqlite'] as const) {
  describe(`bootstrap production toi thieu [${dialect}]`, () => {
    it('chi tao tenant + Super admin + cai dat; khong co du lieu demo; ep doi mat khau + dang ky TOTP', async () => {
      const rt = await createTestRuntime({ dialect, env: { ...PROD } });
      const r = await bootstrap(rt, { passwordParams: P, adminEmail: 'Owner@congty.vn', adminPassword: STRONG });
      expect(r.skipped).toBe(false);
      expect(r.generatedPassword).toBeNull(); // mat khau do nguoi van hanh cung cap, khong tra lai
      for (const t of ['customers', 'campaigns', 'devices', 'contracts', 'ad_wallets', 'wallet_entries', 'topups', 'creatives', 'venues', 'screens', 'end_users', 'payouts', 'partners', 'invoices', 'rate_cards', 'campaign_prices', 'contract_line_prices'])
        expect(N(await rt.db.query(`SELECT COUNT(*) AS n FROM ${t}`)), t).toBe(0);
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM tenants'))).toBe(1);
      const admins = await rt.db.query<{ email: string; role: string; password_hash: string; totp_secret_enc: string | null; mfa_required: number; status: string }>('SELECT * FROM admins');
      expect(admins).toHaveLength(1);
      expect(admins[0]).toMatchObject({ email: 'owner@congty.vn', role: 'super_admin', totp_secret_enc: null, mfa_required: 1, status: 'active' });
      expect(await verifyPassword(STRONG, admins[0]!.password_hash)).toBe(true);
      const flag = await rt.db.query('SELECT 1 FROM settings WHERE key = ?', [`force_password_change:${r.adminId}`]);
      expect(flag).toHaveLength(1);
      const sepay = JSON.parse((await rt.db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'sepay'"))[0]!.value);
      expect(sepay).toMatchObject({ enabled: 0, auto_activate: 0, env: 'sandbox', bank: '' });
      expect(JSON.stringify(sepay)).not.toMatch(/0123456789/);
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM contract_templates'))).toBe(1);
      // chay lai: bo qua, khong tao them
      expect((await bootstrap(rt, { passwordParams: P, adminEmail: 'owner@congty.vn', adminPassword: STRONG })).skipped).toBe(true);
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM admins'))).toBe(1);
      await rt.close();
    }, 60000);

    it('local: tu sinh mat khau (tra ve cho CLI, khong log) va dang nhap -> bat buoc dang ky TOTP', async () => {
      const rt = await createTestRuntime({ dialect, now: '2026-11-12T03:00:00.000Z', env: { SCRYPT_N: '1024' } });
      const logs: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => void logs.push(a.join(' '));
      let r;
      try { r = await bootstrap(rt, { passwordParams: P }); } finally { console.log = orig; }
      expect(r.adminEmail).toBe('admin@ams.local');
      expect(r.generatedPassword).toMatch(/.{16,}/);
      expect(logs.join('\n')).not.toContain(r.generatedPassword!);
      const app = createApp(rt);
      const res = await app.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: r.adminEmail, password: r.generatedPassword }) });
      const body = (await res.json()) as { mfa_required?: boolean; mfa_enroll_required?: boolean };
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ mfa_required: true, mfa_enroll_required: true });
      await rt.close();
    }, 60000);
  });

  describe(`seed demo [${dialect}]`, () => {
    it('local: nap duoc du lieu demo, khong in mat khau ra log', async () => {
      const rt = await createTestRuntime({ dialect });
      const logs: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => void logs.push(a.join(' '));
      let r;
      try { r = await seedDemo(rt, { passwordParams: P, deviceCount: 5, adminPassword: STRONG, adminTotpSecret: generateTotpSecret() }); } finally { console.log = orig; }
      expect(r.skipped).toBe(false);
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM customers'))).toBe(12);
      expect(logs.join('\n')).not.toContain(STRONG);
      for (const c of r.credentials) if (c.password) expect(logs.join('\n')).not.toContain(c.password);
      await rt.close();
    }, 60000);

    it.each([['production'], ['staging']])('AMS_ENV=%s: tu choi seed demo, CSDL khong bi ghi', async (amsEnv) => {
      const rt = await createTestRuntime({ dialect, env: { ...PROD, AMS_ENV: amsEnv } });
      await expect(seedDemo(rt, { log: false, passwordParams: P })).rejects.toMatchObject({ name: 'SeedRefusedError', code: 'demo_seed_refused' });
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM tenants'))).toBe(0);
      await rt.close();
    });

    it('AMS_ALLOW_DEMO_SEED=1 cho phep o staging nhung khong in mat khau', async () => {
      const rt = await createTestRuntime({ dialect, env: { ...PROD, AMS_ENV: 'staging', AMS_ALLOW_DEMO_SEED: '1' } });
      const logs: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => void logs.push(a.join(' '));
      let r;
      try { r = await seedDemo(rt, { passwordParams: P, deviceCount: 3, adminPassword: STRONG }); } finally { console.log = orig; }
      expect(r.skipped).toBe(false);
      expect(logs.join('\n')).not.toContain(STRONG);
      expect(await decryptField(PROD.FIELD_ENC_KEY, (await rt.db.query<{ tax_code_enc: string }>('SELECT tax_code_enc FROM customers LIMIT 1'))[0]!.tax_code_enc, 'customers.tax_code')).toMatch(/^\d+$/);
      await rt.close();
    }, 60000);
  });
}

describe('rao chan moi truong / SePay / bootstrap', () => {
  it('resolveAmsEnv: mac dinh local; cloudflare/k8s khong dat AMS_ENV => production; gia tri sai bi tu choi; NODE_ENV bi bo qua', () => {
    expect(resolveAmsEnv({})).toBe('local');
    expect(resolveAmsEnv({ NODE_ENV: 'production', RUNTIME: 'docker' })).toBe('local');
    expect(resolveAmsEnv({ RUNTIME: 'cloudflare' })).toBe('production');
    expect(resolveAmsEnv({ RUNTIME: 'k8s' })).toBe('production');
    expect(resolveAmsEnv({ AMS_ENV: 'PROD' })).toBe('production');
    expect(() => resolveAmsEnv({ AMS_ENV: 'prd' })).toThrow(SeedRefusedError);
  });

  it('SEPAY_MODE mac dinh mock o local; production khong duoc mock; che do production tu choi bi mat mock/yeu', () => {
    expect(assertSepaySafe({})).toBe('mock');
    expect(() => assertSepaySafe({ AMS_ENV: 'production' })).toThrow(/mock/);
    expect(() => assertSepaySafe({ AMS_ENV: 'production', SEPAY_MODE: 'production', SEPAY_WEBHOOK_SECRET: 'test-sepay-secret' })).toThrow(/SEPAY_WEBHOOK_SECRET/);
    expect(() => assertSepaySafe({ AMS_ENV: 'production', SEPAY_MODE: 'production', SEPAY_WEBHOOK_SECRET: 'CHANGE_ME_AUTO' })).toThrow(SeedRefusedError);
    expect(() => assertSepaySafe({ AMS_ENV: 'production', SEPAY_MODE: 'production', SEPAY_WEBHOOK_SECRET: 'a'.repeat(64), SEPAY_API_KEY: 'test-sepay-apikey' })).toThrow(/API_KEY/);
    expect(assertSepaySafe({ AMS_ENV: 'production', SEPAY_MODE: 'production', SEPAY_WEBHOOK_SECRET: 'f3'.repeat(32) })).toBe('production');
    expect(assertSepaySafe({ AMS_ENV: 'staging', SEPAY_MODE: 'mock' })).toBe('mock');
  });

  it('bootstrap production: tu choi SEPAY mock, khoa test, thieu/yeu mat khau, email mau', async () => {
    const mk = (env: Record<string, string>) => createTestRuntime({ env });
    const good = { adminEmail: 'owner@congty.vn', adminPassword: STRONG, passwordParams: P };
    let rt = await mk({ ...PROD, SEPAY_MODE: 'mock' });
    await expect(bootstrap(rt, good)).rejects.toMatchObject({ code: 'sepay_mock_in_production' });
    rt = await mk({ ...PROD, SEPAY_MODE: 'production', SEPAY_WEBHOOK_SECRET: TEST_ENV['SEPAY_WEBHOOK_SECRET']! });
    await expect(bootstrap(rt, good)).rejects.toMatchObject({ code: 'sepay_secret_weak' });
    rt = await mk({ ...PROD, FIELD_ENC_KEY: TEST_ENV['FIELD_ENC_KEY']! });
    await expect(bootstrap(rt, good)).rejects.toMatchObject({ code: 'enc_key_test' });
    rt = await mk({ ...PROD });
    await expect(bootstrap(rt, { adminEmail: 'owner@congty.vn', passwordParams: P })).rejects.toMatchObject({ code: 'admin_password_missing' });
    await expect(bootstrap(rt, { ...good, adminPassword: 'short' })).rejects.toMatchObject({ code: 'admin_password_weak' });
    await expect(bootstrap(rt, { ...good, adminPassword: 'CHANGE_ME_AUTO_Aa1xx' })).rejects.toMatchObject({ code: 'admin_password_weak' });
    await expect(bootstrap(rt, { ...good, adminEmail: 'admin@ams.local' })).rejects.toMatchObject({ code: 'admin_email_placeholder' });
    await expect(bootstrap(rt, { adminPassword: STRONG, passwordParams: P })).rejects.toMatchObject({ code: 'admin_email_missing' });
    expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM tenants'))).toBe(0);
  }, 60000);

  it('scripts/setup.mjs seed-mode: local mac dinh demo; production bootstrap; demo bi tu choi (ma 3) tru khi co co', () => {
    const run = (env: Record<string, string>, ...args: string[]) => {
      const r = spawnSync(process.execPath, ['../../scripts/setup.mjs', 'seed-mode', ...args], { cwd: process.cwd(), env: { PATH: process.env['PATH'] ?? '', ...env }, encoding: 'utf8' });
      return { code: r.status, out: r.stdout.trim() };
    };
    expect(run({}).out).toBe('demo');
    expect(run({ AMS_ENV: 'production' })).toMatchObject({ code: 0, out: 'bootstrap' });
    expect(run({ AMS_ENV: 'production' }, 'demo').code).toBe(3);
    expect(run({ AMS_ENV: 'staging', SEED_MODE: 'demo' }).code).toBe(3);
    expect(run({ AMS_ENV: 'staging', AMS_ALLOW_DEMO_SEED: '1' }, 'demo')).toMatchObject({ code: 0, out: 'demo' });
  });
});
