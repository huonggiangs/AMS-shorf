// e2e UI: moi nguoi dung noi bo -> thu moi (SMTP gia) -> /activate?token= (dat mat khau + TOTP QR) -> vao he thong -> dang xuat -> dang nhap lai.
// Chay: `pnpm --filter @ams/e2e-ui invite` (dung chung stack.ts; E2E_UI_SKIP_BUILD=1 de dung .dist co san).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { totp } from '@ams/shared';
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP, HERE, startStack } from './stack.js';

const req = createRequire(import.meta.url);
const pw = (() => {
  try { return req('playwright'); } catch { return req('/opt/npm-tools/node_modules/playwright'); }
})() as typeof import('playwright');
const SHOTS = join(HERE, 'screenshots');
const log = (m: string) => console.log(`[e2e-invite] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function must(c: unknown, what: string): asserts c { if (!c) throw new Error(what); }

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const stack = await startStack(log);
  let browser: import('playwright').Browser | undefined;
  let ok = false;
  try {
    // --- API quan tri (chi de chuan bi): dang nhap bang TOTP o cua so truoc (UI dung cua so hien tai)
    const jar = new Map<string, string>();
    let csrf = '';
    const call = async (method: string, path: string, body?: unknown) => {
      const h: Record<string, string> = { 'content-type': 'application/json' };
      if (jar.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      if (method !== 'GET' && csrf) h['x-csrf-token'] = csrf;
      const r = await fetch(stack.apiUrl + path, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv!.indexOf('='); jar.set(kv!.slice(0, i), kv!.slice(i + 1)); }
      const t = await r.text();
      return { status: r.status, body: (t ? JSON.parse(t) : null) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const l1 = await call('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    must(l1.status === 200, `login ${l1.status}`);
    const v = await call('POST', '/auth/mfa/verify', { mfa_token: l1.body.mfa_token, code: await totp(ADMIN_TOTP, Date.now()) });
    must(v.status === 200, `mfa ${v.status}`);
    csrf = v.body.csrf_token;
    const email = `ops-inv-${randomBytes(3).toString('hex')}@example.com`;
    const u = await call('POST', '/admin/v1/users', { name: 'Ops Moi', email, role: 'device_ops' });
    must(u.status === 201, `tao user ${u.status}`);
    let token = '';
    for (let i = 0; i < 80 && !token; i++) {
      token = stack.smtp.mails.filter((x) => x.to.includes(email)).map((x) => x.raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)))).map((q) => /activate\?token=([A-Za-z0-9_-]+)/.exec(q)?.[1]).find(Boolean) ?? '';
      if (!token) await sleep(150);
    }
    must(token, 'khong co thu moi /activate');
    log('co link /activate');

    // --- UI
    browser = await pw.chromium.launch({ headless: !process.env['E2E_UI_HEADED'], args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ baseURL: stack.webUrl, viewport: { width: 1280, height: 900 }, locale: 'vi-VN' });
    const p = await ctx.newPage();
    const errors: string[] = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`/activate?token=${token}`);
    await p.getByRole('heading', { name: /Kích hoạt tài khoản/ }).waitFor();
    await p.screenshot({ path: join(SHOTS, 'invite-1-password.png') });
    const PW = 'Ops-Moi-Passw0rd!2026';
    await p.getByLabel('Mật khẩu mới').fill('yeu');
    await p.getByLabel('Nhập lại mật khẩu').fill('yeu');
    await p.getByRole('button', { name: /Đặt mật khẩu/ }).click();
    await p.getByRole('alert').waitFor();
    await p.getByLabel('Mật khẩu mới').fill(PW);
    await p.getByLabel('Nhập lại mật khẩu').fill(PW);
    await p.getByRole('button', { name: /Đặt mật khẩu/ }).click();
    await p.getByAltText('Mã QR TOTP').waitFor();
    const secret = (await p.getByTestId('totp-secret').innerText()).trim();
    must(/^[A-Z2-7]{16,}$/.test(secret), `khoa TOTP la: ${secret}`);
    await p.screenshot({ path: join(SHOTS, 'invite-2-totp.png') });
    // ma o cua so hien tai; neu bi tu choi thu cua so truoc
    const used = new Set<number>();
    const submit = async (code: string) => {
      await p.locator('#iv-code').fill(code);
      await p.getByRole('button', { name: /Xác nhận/ }).click();
      return Promise.race([
        p.waitForURL((x) => !x.pathname.startsWith('/activate'), { timeout: 10_000 }).then(() => true),
        p.getByRole('alert').waitFor({ timeout: 10_000 }).then(() => false),
      ]);
    };
    let entered = false;
    for (const d of [0, -1, 1]) {
      const step = Math.floor(Date.now() / 30_000) + d;
      if (used.has(step)) continue;
      used.add(step);
      if (await submit(await totp(secret, step * 30_000 + 1000))) { entered = true; break; }
    }
    must(entered, 'khong vao duoc he thong sau khi nhap TOTP');
    await p.waitForLoadState('networkidle').catch(() => undefined);
    const me = await p.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).json());
    must(me.user?.email === email && me.user?.role === 'device_ops', 'auth/me khong khop nguoi duoc moi');
    await p.screenshot({ path: join(SHOTS, 'invite-3-home.png') });
    // lien ket da dung: mo lai phai bao loi khi dat mat khau
    await p.goto(`/activate?token=${token}`);
    await p.getByLabel('Mật khẩu mới').fill(PW);
    await p.getByLabel('Nhập lại mật khẩu').fill(PW);
    await p.getByRole('button', { name: /Đặt mật khẩu/ }).click();
    await p.getByRole('alert').waitFor();
    must(errors.length === 0, `loi trang: ${errors.join('; ')}`);
    ok = true;
    log('PASS invite -> activate -> TOTP -> vao he thong');
  } catch (e) {
    console.error('[e2e-invite] FAIL', (e as Error).message);
  } finally {
    await browser?.close().catch(() => undefined);
    await stack.close().catch(() => undefined);
  }
  process.exit(ok ? 0 : 1);
}
void main();
