// Playwright e2e UI cho web-admin tren stack that. Chay: `pnpm e2e:ui` (headless, khong can Docker). Thoat 0 neu moi luong PASS.
// Anh chup: tests/e2e-ui/screenshots/*.png. Bien: E2E_UI_SKIP_BUILD=1 (dung .dist co san), E2E_UI_HEADED=1, E2E_VERBOSE=1.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { totp } from '@ams/shared';
import { VirtualDevice, Recorder, httpTransport } from '@ams/sim';
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP, HERE, startStack } from './stack.js';

// playwright duoc cai toan cuc (/opt/npm-tools); nap qua require de khong phu thuoc ESM resolution.
const req = createRequire(import.meta.url);
const pw = (() => {
  try {
    return req('playwright');
  } catch {
    return req('/opt/npm-tools/node_modules/playwright');
  }
})() as typeof import('playwright');
type Page = import('playwright').Page;
type Browser = import('playwright').Browser;
type BrowserContext = import('playwright').BrowserContext;

const SHOTS = join(HERE, 'screenshots');
const results: { name: string; ok: boolean; detail: string; ms: number }[] = [];
const bugs: string[] = [];
const log = (m: string) => console.log(`[e2e-ui] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function must(c: unknown, what: string): asserts c {
  if (!c) throw new Error(what);
}

// TOTP chong replay: mot cua so 30 giay chi dung duoc mot lan cho moi bi mat. Moi lan can ma thi lay cua so chua dung (hien tai, truoc, sau).
const usedSteps = new Map<string, Set<number>>();
async function* freshCodes(secret: string): AsyncGenerator<string> {
  const used = usedSteps.get(secret) ?? usedSteps.set(secret, new Set()).get(secret)!;
  const cur = Math.floor(Date.now() / 30_000);
  for (const d of [0, -1, 1, -2]) {
    const step = cur + d;
    if (used.has(step)) continue;
    used.add(step);
    yield await totp(secret, step * 30_000 + 1000);
  }
  throw new Error('het cua so TOTP chua dung');
}
/** gui ma len cho den khi duoc chap nhan */
async function withTotp<T>(secret: string, attempt: (code: string) => Promise<T | null>): Promise<T> {
  for await (const code of freshCodes(secret)) {
    const r = await attempt(code);
    if (r !== null) return r;
  }
  throw new Error('khong co ma TOTP nao duoc chap nhan');
}

// ------------------------------------------------------------ client API (chi de chuan bi du lieu; kiem tra that lam qua UI)
class Http {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(private base: string) {}
  async call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const h: Record<string, string> = {};
    if (this.cookies.size) h['cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) h['content-type'] = 'application/json';
    if (method !== 'GET' && this.csrf) h['x-csrf-token'] = this.csrf;
    const res = await fetch(this.base + path, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(';');
      const i = kv!.indexOf('=');
      const k = kv!.slice(0, i);
      const v = kv!.slice(i + 1);
      if (v === '' || /max-age=0/i.test(sc)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json as T };
  }
  async ok<T = any>(status: number, method: string, path: string, body?: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await this.call<T>(method, path, body);
    if (r.status !== status) throw new Error(`${method} ${path} -> ${r.status} (muon ${status}): ${JSON.stringify(r.body).slice(0, 240)}`);
    return r.body;
  }
}

async function verifyTotp(h: Http, mfaToken: string, secret: string): Promise<{ csrf_token: string }> {
  const r = await withTotp(secret, async (code) => {
    const x = await h.call<{ csrf_token: string }>('POST', '/auth/mfa/verify', { mfa_token: mfaToken, code });
    if (x.status === 401) return null;
    if (x.status !== 200) throw new Error(`mfa/verify -> ${x.status}`);
    return x.body;
  });
  h.csrf = r.csrf_token;
  return r;
}

async function main(): Promise<void> {
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  const stack = await startStack(log);
  let browser: Browser | undefined;
  try {
    browser = await pw.chromium.launch({ headless: !process.env['E2E_UI_HEADED'], args: ['--no-sandbox'] });
    const b = browser;
    const newCtx = (): Promise<BrowserContext> => b.newContext({ baseURL: stack.webUrl, viewport: { width: 1440, height: 900 }, locale: 'vi-VN' });
    const shot = (p: Page, name: string) => p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
    const pageErrors: string[] = [];
    const watch = (p: Page, who: string) => {
      p.on('pageerror', (e) => pageErrors.push(`${who}: ${e.message}`));
      p.on('console', (m) => {
        if (m.type() === 'error' && !/qr\.sepay\.vn|ERR_(NAME|INTERNET|CONNECTION|TUNNEL)|Failed to load resource/i.test(m.text())) pageErrors.push(`${who} console: ${m.text().slice(0, 200)}`);
      });
    };
    async function flow(name: string, fn: () => Promise<string | void>, page?: () => Page | undefined): Promise<boolean> {
      const t0 = Date.now();
      try {
        const d = (await fn()) ?? '';
        results.push({ name, ok: true, detail: d, ms: Date.now() - t0 });
        log(`PASS ${name} ${d}`);
        return true;
      } catch (e) {
        const msg = (e as Error).message.split('\n')[0]!.slice(0, 300);
        results.push({ name, ok: false, detail: msg, ms: Date.now() - t0 });
        log(`FAIL ${name}: ${msg}`);
        if (process.env['E2E_VERBOSE']) console.error(e);
        const p = page?.();
        if (p) await shot(p, `FAIL-${name.replace(/\W+/g, '-').slice(0, 40)}`).catch(() => undefined);
        return false;
      }
    }
    /** dang nhap qua UI: email + mat khau + ma TOTP tai thoi diem atMs */
    async function uiSubmitCode(p: Page, secret: string): Promise<void> {
      await withTotp(secret, async (code) => {
        await p.locator('#lg-code').fill(code);
        await p.getByRole('button', { name: 'Xác nhận' }).click();
        const r = await Promise.race([
          p.locator('#lg-code').waitFor({ state: 'detached', timeout: 10_000 }).then(() => true),
          p.getByRole('alert').waitFor({ timeout: 10_000 }).then(() => false),
        ]);
        return r ? true : null;
      });
    }
    async function uiLogin(p: Page, email: string, password: string, secret: string): Promise<void> {
      await p.goto('/login');
      await p.locator('#lg-email').fill(email);
      await p.locator('#lg-pw').fill(password);
      await p.getByRole('button', { name: 'Đăng nhập' }).click();
      await p.locator('#lg-code').waitFor();
      await uiSubmitCode(p, secret);
    }
    /** mo tab "Vi quang cao"; thu lai neu trang con dang khoi tao lai (tab state mat khi remount) */
    const walletTab = async (p: Page) => {
      await p.waitForLoadState('networkidle').catch(() => undefined);
      for (let i = 0; i < 5; i++) {
        await p.locator('.tabs button', { hasText: 'Ví quảng cáo' }).first().click();
        if (await p.getByRole('heading', { name: /Ví quảng cáo/ }).waitFor({ timeout: 2500 }).then(() => true, () => false)) return;
      }
      throw new Error('khong mo duoc tab Ví quảng cáo');
    };
    const nav = (p: Page) => p.locator('nav, aside').first();
    const rowOf = (p: Page, text: string | RegExp) => p.locator('tbody tr', { hasText: text }).first();

    // ------------------------------------------------ ctx admin
    const adminCtx = await newCtx();
    const admin = await adminCtx.newPage();
    watch(admin, 'admin');

    // F1. dang nhap + TOTP
    const f1 = await flow('F1 dang nhap + TOTP (sai mat khau, sai ma, dung)', async () => {
      await admin.goto('/');
      await admin.waitForURL(/\/login/);
      await shot(admin, '01-login');
      // sai mat khau
      await admin.locator('#lg-email').fill(ADMIN_EMAIL);
      await admin.locator('#lg-pw').fill('sai-mat-khau-xyz');
      await admin.getByRole('button', { name: 'Đăng nhập' }).click();
      await admin.getByRole('alert').waitFor();
      await shot(admin, '02-login-wrong-password');
      // dung mat khau, sai ma
      await admin.locator('#lg-pw').fill(ADMIN_PASSWORD);
      await admin.getByRole('button', { name: 'Đăng nhập' }).click();
      await admin.locator('#lg-code').waitFor();
      await admin.locator('#lg-code').fill('000000');
      await admin.getByRole('button', { name: 'Xác nhận' }).click();
      await admin.getByRole('alert').waitFor();
      await shot(admin, '03-login-wrong-totp');
      // dung ma (cua so hien tai; phan chuan bi API dung cua so truoc de khong bi replay)
      await uiSubmitCode(admin, ADMIN_TOTP);
      await admin.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10_000 });
      await admin.getByText('Super admin', { exact: false }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await shot(admin, '04-admin-overview');
      const me = await admin.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).json());
      must(JSON.stringify(me).includes('super_admin'), 'auth/me khong tra super_admin');
      return `url ${new URL(admin.url()).pathname}`;
    }, () => admin);
    // chuan bi du lieu bang API: dung ma TOTP o cua so TRUOC (UI da dung cua so hien tai)
    const api = new Http(stack.apiUrl);
    const emailA = `khach-ui-${randomBytes(3).toString('hex')}@example.com`;
    const CUST_PW = 'Khach-UI-Passw0rd!2026';
    const custSecret = { v: '' };
    const lim = { email: `ops-ui-${randomBytes(3).toString('hex')}@example.com`, pw: 'Ops-UI-Passw0rd!2026', secret: '' };
    let custA = { id: '', code: '', name: 'Cong ty UI A' };
    let mediaId = '';
    const prep = await flow('SETUP (API): khach A + hop dong + media da duyet', async () => {
      const r1 = await api.ok<{ mfa_required: boolean; mfa_token?: string }>(200, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      const r2 = await verifyTotp(api, r1.mfa_token!, ADMIN_TOTP);
      api.csrf = r2.csrf_token;
      const a = await api.ok<{ id: string; code: string }>(201, 'POST', '/admin/v1/customers', { legal_name: custA.name, short_name: 'UI A', tax_code: String(Math.floor(1e9 + Math.random() * 9e9)), email: emailA, representative: 'Nguyen Van A', phone: '0900000001' });
      custA = { ...custA, id: a.id, code: a.code };
      await api.ok(201, 'POST', '/admin/v1/contracts', { customer_id: a.id, value_vnd: 50_000_000, advance_pct: 10, months: 6 });
      // media: upload qua S3 gia, xac nhan, duyet
      const bytes = randomBytes(4096);
      const up = await api.ok<{ id: string; url: string; headers: Record<string, string> }>(201, 'POST', '/admin/v1/media/upload-url', { name: 'ui-quang-cao-a.mp4', content_type: 'video/mp4', size_bytes: bytes.length, width: 1920, height: 1080, duration_sec: 15, customer_id: a.id, format: 'fullscreen' });
      const put = await fetch(up.url, { method: 'PUT', headers: up.headers, body: bytes });
      must(put.status === 200, `PUT S3 ${put.status}`);
      await api.ok(200, 'POST', `/admin/v1/media/${up.id}/confirm`, { width: 1920, height: 1080, duration_sec: 15 });
      // dich vu quet ma doc (m1-media-worker) khong chay trong suite nay: dat scan_state='clean' nhu worker se lam
      await stack.q("UPDATE creatives SET scan_state = 'clean' WHERE id = $1", [up.id]);
      await api.ok(200, 'POST', `/admin/v1/media/${up.id}/approve`);
      mediaId = up.id;
      return `khach ${a.code}, media ${up.id.slice(-6)}`;
    });

    // F2. admin nap tien qua /dev/sepay/simulate (UI: Thanh toan -> Nap tien -> Mo phong da nhan tien)
    const f2 = await flow('F2 nap vi: admin UI "Mo phong da nhan tien" (/dev/sepay/simulate) -> vi 20.000.000', async () => {
      must(f1 && prep, 'phu thuoc F1/SETUP');
      await admin.goto('/finance');
      await walletTab(admin);
      await admin.getByRole('heading', { name: /Ví quảng cáo/ }).waitFor();
      await admin.getByRole('button', { name: 'Nạp tiền' }).first().click();
      const dlg = admin.getByRole('dialog', { name: 'Nạp tiền vào ví quảng cáo' });
      await dlg.waitFor();
      await dlg.locator('#tp-c').selectOption({ label: new RegExp(custA.code) as unknown as string }).catch(async () => {
        const opt = await dlg.locator('#tp-c option', { hasText: custA.code }).first().getAttribute('value');
        await dlg.locator('#tp-c').selectOption(opt!);
      });
      await dlg.locator('#tp-a').fill('20000000');
      const content = await dlg.getByTestId('topup-content').innerText();
      must(content.includes(custA.code), `noi dung CK khong co ma khach: ${content}`);
      await shot(admin, '10-topup-dialog');
      await dlg.getByRole('button', { name: 'Mô phỏng đã nhận tiền' }).click();
      await admin.getByText('Đã mô phỏng giao dịch đến.').waitFor({ timeout: 10_000 });
      // vi trong DB + tren trang
      for (let i = 0; i < 40; i++) {
        const w = (await stack.q('SELECT balance_vnd FROM ad_wallets WHERE customer_id = $1', [custA.id]))[0];
        if (w && Number(w.balance_vnd) === 20_000_000) break;
        if (i === 39) throw new Error(`so du vi ${w?.balance_vnd}`);
        await sleep(150);
      }
      // so du tren UI duoc kiem o phia khach (F3); o day chi chup man hinh quan tri
      await shot(admin, '11-wallet-credited');
      return 'balance 20.000.000';
    }, () => admin);

    // thu moi khach chi duoc gui khi khach duoc kich hoat (nap tien dau tien) -> chuan bi tai khoan sau F2
    const prep2 = await flow('SETUP 2 (API): thu moi -> tai khoan khach (TOTP) + tai khoan device_ops (TOTP)', async () => {
      must(f2, 'phu thuoc F2');
      // tai khoan khach: nhan thu moi (SMTP gia) -> accept -> bat TOTP (UI chua co trang /invite, xem requests.md)
      const mm = await (async () => {
        for (let i = 0; i < 80; i++) {
          const m = stack.smtp.mails.filter((x) => x.to.includes(emailA)).map((x) => x.raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)))).map((q) => /(?:invite|activate)\?token=([A-Za-z0-9_-]+)/.exec(q)?.[1]).find(Boolean);
          if (m) return m;
          await sleep(150);
        }
        throw new Error('khong co thu moi khach; khach=' + JSON.stringify((await stack.q('SELECT state FROM customers WHERE id=$1',[custA.id]))[0]) + ' mails=' + stack.smtp.mails.map((x) => x.to).join('|'));
      })();
      const token = mm;
      must(token, 'khong thay token moi');
      const c = new Http(stack.apiUrl);
      const acc = await c.ok<{ mfa_token: string }>(200, 'POST', '/auth/invite/accept', { token, password: CUST_PW });
      const en = await c.ok<{ secret: string; mfa_token: string }>(200, 'POST', '/auth/mfa/enroll', { mfa_token: acc.mfa_token });
      await verifyTotp(c, en.mfa_token, en.secret);
      custSecret.v = en.secret;
      // tai khoan device_ops (noi bo, quyen han che)
      const u = await api.ok<{ id: string; invite_sent: boolean }>(201, 'POST', '/admin/v1/users', { name: 'Ops UI', email: lim.email, role: 'device_ops' });
      void u;
      const m2 = await (async () => {
        for (let i = 0; i < 80; i++) {
          const m = stack.smtp.mails.filter((x) => x.to.includes(lim.email)).map((x) => x.raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)))).map((q) => /(?:invite|activate)\?token=([A-Za-z0-9_-]+)/.exec(q)?.[1]).find(Boolean);
          if (m) return m;
          await sleep(150);
        }
        throw new Error('khong co thu moi device_ops');
      })();
      const t2 = m2;
      must(t2, 'khong thay token moi device_ops');
      const o = new Http(stack.apiUrl);
      const acc2 = await o.ok<{ mfa_token: string; mfa_enroll_required?: boolean }>(200, 'POST', '/auth/invite/accept', { token: t2, password: lim.pw });
      const en2 = await o.ok<{ secret: string; mfa_token: string }>(200, 'POST', '/auth/mfa/enroll', { mfa_token: acc2.mfa_token });
      await verifyTotp(o, en2.mfa_token, en2.secret);
      lim.secret = en2.secret;
      return 'khach + device_ops da kich hoat';
    });

    // customer ctx
    const custCtx = await newCtx();
    const cust = await custCtx.newPage();
    watch(cust, 'khach');

    // F3. cong khach: dang nhap TOTP, vi, tao chien dich, gui duyet
    let campName = `UI chien dich ${randomBytes(2).toString('hex')}`;
    const f3 = await flow('F3 cong khach: dang nhap TOTP -> vi -> tao chien dich -> Gui duyet', async () => {
      must(f2 && prep2, 'phu thuoc F2/SETUP 2');
      await uiLogin(cust, emailA, CUST_PW, custSecret.v);
      await shot(cust, '20-portal-home');
      // menu khach chi co Quang cao / Media / Thanh toan
      const txt = await cust.locator('body').innerText();
      must(!/Thiết bị|Người dùng & Phân quyền|Nhật ký hoạt động/.test(txt), 'menu khach lo trang noi bo');
      await cust.goto('/finance');
      await cust.getByRole('heading', { name: 'Ví quảng cáo' }).waitFor();
      await cust.getByText(/20/).first().waitFor();
      // khach tu tao yeu cau nap tien (QR)
      await cust.getByRole('button', { name: 'Nạp tiền' }).first().click();
      const dlg = cust.getByRole('dialog', { name: 'Nạp tiền vào ví quảng cáo' });
      await dlg.waitFor();
      must((await dlg.getByTestId('topup-content').innerText()).includes(custA.code), 'noi dung CK khach');
      await shot(cust, '21-portal-topup-dialog');
      must(!(await dlg.getByRole('button', { name: 'Mô phỏng đã nhận tiền' }).count()), 'khach thay nut mo phong (dev) - khong duoc');
      await dlg.getByRole('button', { name: 'Hủy' }).click();
      await shot(cust, '22-portal-wallet');
      // tao chien dich
      await cust.goto('/ads');
      await cust.getByRole('button', { name: 'Tạo chiến dịch mới' }).click();
      const form = cust.getByRole('dialog', { name: 'Tạo chiến dịch' });
      await form.waitFor();
      await form.locator('input').first().fill(campName);
      await form.locator('select').nth(1).selectOption(mediaId);
      await shot(cust, '23-portal-campaign-form');
      // BUG da biet (requests.md #1): o ngan sach co step=100000 min=1 nen gia tri mac dinh 5.000.000 bi trinh duyet tu choi khi "Gui duyet".
      const stepBad = await form.locator('input[type=number]').first().evaluate((el) => (el as unknown as { validity: { stepMismatch: boolean } }).validity.stepMismatch);
      if (stepBad) {
        bugs.push('BUG-1 form tao chien dich: ngan sach 5.000.000 vi pham step=100000/min=1 -> nut "Gui duyet" bi chan boi trinh duyet');
        await form.getByRole('button', { name: 'Lưu nháp' }).click();
        await cust.getByText(/Đã lưu bản nháp/).first().waitFor({ timeout: 10_000 });
        await rowOf(cust, campName).click();
        await cust.getByRole('button', { name: 'Gửi duyệt' }).click();
        await cust.getByText(/Đã gửi duyệt/).first().waitFor({ timeout: 10_000 });
        await cust.keyboard.press('Escape');
      } else {
        await form.getByRole('button', { name: 'Gửi duyệt' }).click();
        await cust.getByText(/Đã gửi duyệt/).first().waitFor({ timeout: 10_000 });
      }
      await cust.goto('/ads');
      await rowOf(cust, campName).waitFor({ timeout: 10_000 });
      await rowOf(cust, campName).getByText(/Chờ duyệt/).waitFor();
      await shot(cust, '24-portal-campaign-pending');
      const row = (await stack.q('SELECT state FROM campaigns WHERE name = $1', [campName]))[0];
      must(row?.state === 'pending_review' || row?.state === 'pending', `DB state ${row?.state}`);
      return `chien dich "${campName}" pending`;
    }, () => cust);

    // F4. admin duyet
    const f4 = await flow('F4 admin duyet: Phe duyet -> Duyet -> giu 5.000.000 tu vi, chien dich active', async () => {
      must(f3, 'phu thuoc F3');
      await admin.goto('/approvals');
      await admin.getByRole('heading', { name: 'Phê duyệt quảng cáo' }).waitFor();
      const row = rowOf(admin, campName);
      await row.waitFor({ timeout: 10_000 });
      await shot(admin, '30-approvals-queue');
      await row.getByRole('button', { name: 'Duyệt' }).click();
      await admin.getByText(/Đã duyệt/).first().waitFor({ timeout: 10_000 });
      await shot(admin, '31-approved');
      for (let i = 0; i < 60; i++) {
        const c = (await stack.q('SELECT state, reserved_vnd FROM campaigns WHERE name = $1', [campName]))[0];
        if (c?.state === 'active') {
          must(Number(c.reserved_vnd) === 5_000_000, `reserved ${c.reserved_vnd}`);
          break;
        }
        if (i === 59) throw new Error(`state ${c?.state}`);
        await sleep(200);
      }
      const w = (await stack.q('SELECT balance_vnd, reserved_vnd FROM ad_wallets WHERE customer_id = $1', [custA.id]))[0]!;
      must(Number(w.reserved_vnd) === 5_000_000 && Number(w.balance_vnd) === 20_000_000, `vi ${JSON.stringify(w)}`);
      return 'reserved 5.000.000 / balance 20.000.000';
    }, () => admin);

    await flow('F5 khach thay chien dich da chay (Dang phat) sau duyet', async () => {
      must(f4, 'phu thuoc F4');
      await cust.goto('/ads');
      await rowOf(cust, campName).getByText(/Đang phát/).waitFor({ timeout: 10_000 });
      await shot(cust, '40-portal-campaign-active');
    }, () => cust);

    // F6. ghep doi thiet bi -> trang Thiet bi
    await flow('F6 thiet bi ghep doi (gateway register+pair) hien o trang Thiet bi', async () => {
      must(f1, 'phu thuoc F1');
      const owner = 'Chu TV UI ' + randomBytes(2).toString('hex');
      const device = new VirtualDevice({
        transport: httpTransport(stack.gwUrl),
        rec: new Recorder(),
        kind: 'tv',
        region: 'HN',
        confirmPairing: async (code) => (await api.call('POST', '/admin/v1/devices/pair', { code, owner_name: owner })).status === 200,
      });
      must(await device.register(), 'register: ' + device.report.errors.join('; '));
      must(await device.pair(), 'pair: ' + device.report.errors.join('; '));
      must(await device.heartbeat(1), 'heartbeat: ' + device.report.errors.join('; '));
      await admin.goto('/devices');
      await admin.getByRole('heading', { name: 'Quản lý thiết bị' }).waitFor();
      await admin.getByPlaceholder('Tìm…').fill(owner);
      const row = rowOf(admin, owner);
      await row.waitFor({ timeout: 10_000 });
      await shot(admin, '50-devices-paired');
      await row.click();
      await admin.locator('aside, [role=dialog], .drw').getByText(device.id).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await shot(admin, '51-device-drawer');
      return `device ${device.id.slice(-8)} chu ${owner}`;
    }, () => admin);

    // F7. RBAC
    const opsCtx = await newCtx();
    const ops = await opsCtx.newPage();
    watch(ops, 'device_ops');
    await flow('F7a RBAC device_ops: menu chi co Thiet bi; /finance /customers bi tu choi tren UI va API 403', async () => {
      must(prep2, 'phu thuoc SETUP 2');
      await uiLogin(ops, lim.email, lim.pw, lim.secret);
      await ops.goto('/devices');
      await ops.getByRole('heading', { name: 'Quản lý thiết bị' }).waitFor();
      const body = await ops.locator('body').innerText();
      must(!/Thanh toán & thuế|Người dùng & Phân quyền|Nhật ký hoạt động|Khách hàng & Hợp đồng/.test(body), 'menu lo muc khong co quyen');
      await shot(ops, '60-rbac-device-ops-devices');
      for (const p of ['/finance', '/customers', '/access', '/audit']) {
        await ops.goto(p);
        await ops.getByRole('alert').getByText('Không có quyền truy cập').waitFor({ timeout: 8000 });
      }
      await shot(ops, '61-rbac-denied-page');
      const codes = await ops.evaluate(async () => {
        const out: Record<string, number> = {};
        for (const p of ['/api/admin/v1/wallets', '/api/admin/v1/customers', '/api/admin/v1/users', '/api/admin/v1/audit-log', '/api/admin/v1/approvals']) out[p] = (await fetch(p, { credentials: 'include' })).status;
        return out;
      });
      for (const [p, s] of Object.entries(codes)) must(s === 403, `${p} -> ${s} (muon 403)`);
      return '4 trang UI + 5 API 403';
    }, () => ops);

    await flow('F7b RBAC khach: /devices /access bi tu choi tren UI; API /admin/v1/* 403; khong thay nut Duyet', async () => {
      must(f3, 'phu thuoc F3');
      for (const p of ['/devices', '/customers', '/approvals', '/access']) {
        await cust.goto(p);
        await cust.getByRole('alert').getByText('Không có quyền truy cập').waitFor({ timeout: 8000 });
      }
      await shot(cust, '62-rbac-customer-denied');
      const codes = await cust.evaluate(async () => {
        const out: Record<string, number> = {};
        for (const p of ['/api/admin/v1/devices', '/api/admin/v1/customers', '/api/admin/v1/wallets', '/api/admin/v1/users']) out[p] = (await fetch(p, { credentials: 'include' })).status;
        return out;
      });
      for (const [p, s] of Object.entries(codes)) must(s === 403, `${p} -> ${s} (muon 403)`);
      return '4 trang UI + 4 API 403';
    }, () => cust);

    await flow('F8 dang xuat + phien het hieu luc quay ve /login', async () => {
      must(f1, 'phu thuoc F1');
      await admin.goto('/overview');
      await admin.getByRole('button', { name: /Thông báo/ }).first().click();
      await admin.getByRole('button', { name: 'Đăng xuất' }).click();
      await admin.waitForURL(/\/login/, { timeout: 10_000 });
      await admin.goto('/finance');
      await admin.waitForURL(/\/login/, { timeout: 10_000 });
      await shot(admin, '70-logged-out');
    }, () => admin);

    if (pageErrors.length) {
      log(`canh bao: ${pageErrors.length} loi JS/console trong trinh duyet:`);
      for (const e of [...new Set(pageErrors)].slice(0, 10)) log('  ' + e);
    }
    await adminCtx.close();
    await custCtx.close();
    await opsCtx.close();
  } finally {
    await browser?.close().catch(() => undefined);
    await stack.close();
  }

  const w = Math.max(...results.map((r) => r.name.length));
  console.log('\n=== e2e UI (Playwright / Chromium headless) ===');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${(r.ms / 1000).toFixed(1)}s  ${r.detail}`);
  for (const b2 of bugs) console.log('BUG PHAT HIEN: ' + b2);
  const nFail = results.filter((r) => !r.ok).length;
  console.log(`${results.length - nFail}/${results.length} PASS; anh: ${readdirSync(SHOTS).length} tep trong tests/e2e-ui/screenshots`);
  if (nFail) process.exit(1);
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
