// Playwright screenshots with the API mocked at the network layer (no backend needed).
// usage: node scripts/screenshots.cjs   (expects `vite preview` on :4173)
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4173';

const me = { user: { id: 'u1', email: 'super@ams.test', name: 'Quản trị thử nghiệm', role: 'super_admin' },
  permissions: Object.fromEntries(['overview','devices','tv_experience','campaigns','customers','approvals','media','screens','schedule','finance','partners','admin'].map((m) => [m, ['view','write','approve','delete']])) };
const campaigns = Array.from({ length: 8 }, (_, i) => ({ id: `C${201 + i}`, name: `Chiến dịch thử ${i + 1}`, brand: ['Nhãn A', 'Nhãn B'][i % 2], status: ['active', 'pending', 'scheduled', 'awaiting_funds', 'paused', 'draft'][i % 6], budget_vnd: 40_000_000 + i * 5_000_000, impressions: 1000 * i, pacing_pct: 20 + i * 9, duration_sec: 15, start_date: '2026-11-20', source: 'Direct Booking' }));

async function mockApi(page, authed) {
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api/, '');
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/auth/me') return authed ? json(me) : json({ error: { code: 'unauthorized', message: 'Chưa đăng nhập' } }, 401);
    if (/\/campaigns$/.test(p) || p.endsWith('/approvals')) {
      const f = u.searchParams.get('filter') || '';
      const rows = f.startsWith('status:') ? campaigns.filter((c) => c.status === f.slice(7)) : campaigns;
      const ps = +(u.searchParams.get('page_size') || 8);
      return json({ items: rows.slice(0, ps), total: rows.length, page: 1, page_size: ps });
    }
    return json({ items: [], total: 0 });
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: scheme });
    // force theme through the app's own storage so we exercise the dark-mode toggle state
    await ctx.addInitScript((s) => { try { localStorage.setItem('ams-ui', JSON.stringify({ lang: 'vi', dark: s === 'dark', col: false })); } catch (e) {} }, scheme);
    const login = await ctx.newPage();
    await mockApi(login, false);
    await login.goto(`${BASE}/login`);
    await login.waitForSelector('text=Đăng nhập');
    await login.screenshot({ path: `screenshots/login-${scheme}.png` });
    const pg = await ctx.newPage();
    await mockApi(pg, true);
    await pg.goto(`${BASE}/ads`);
    await pg.waitForSelector('text=Chiến dịch thử 1');
    await pg.screenshot({ path: `screenshots/campaigns-${scheme}.png` });
    await ctx.close();
  }
  await browser.close();
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
