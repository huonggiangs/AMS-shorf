// Playwright: buoc 2 "Thiet ke phan vung" o 1440 / 1024 / 1366x768. usage: (vite preview --port 4173 &) CHROME=/usr/bin/google-chrome node scripts/ui-sub-step2-screenshots.cjs
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = path.resolve(__dirname, '../../../docs/screenshots/ui-sub');
const me = { user: { id: 'u1', email: 's@ams.test', name: 'Quản trị', role: 'super_admin' }, permissions: Object.fromEntries(['overview', 'schedule', 'media', 'devices'].map((m) => [m, ['view', 'write', 'approve', 'delete']])) };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [name, w, h] of [['1440', 1440, 900], ['1024', 1024, 768], ['1366', 1366, 768]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const pg = await ctx.newPage();
    pg.on('dialog', (d) => d.accept());
    await pg.route('**/api/**', (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (p === '/auth/me') return json(me);
      if (p === '/admin/v1/media') return json({ items: [{ id: 'm1', name: 'TVC Tết 15s.mp4', kind: 'video', status: 'approved', mime: 'video/mp4' }, { id: 'm2', name: 'Poster khuyến mãi.jpg', kind: 'image', status: 'approved', mime: 'image/jpeg' }], total: 2 });
      return json({ items: [], total: 0 });
    });
    await pg.goto(`${BASE}/broadcast`);
    await pg.getByRole('button', { name: 'Tạo chương trình' }).first().click();
    await pg.getByLabel('Tên chương trình').fill('Ưu đãi cuối năm');
    await pg.getByRole('tab', { name: /Thiết kế phân vùng/ }).click();
    await pg.getByRole('button', { name: '3 vùng + Chữ chạy' }).click();
    await pg.locator('[data-zone]').first().click();
    await pg.getByRole('combobox', { name: /Thêm tư liệu/ }).selectOption('m1');
    await pg.getByRole('combobox', { name: /Thêm tư liệu/ }).selectOption('m2');
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: `${OUT}/step2-${name}.png` });
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
