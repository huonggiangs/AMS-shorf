// Playwright: buoc 2 voi NHOM vung (cay lop). usage: (vite preview --port 4173 &) CHROME=/path node scripts/grp-ui-screenshots.cjs
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = path.resolve(__dirname, '../../../docs/screenshots/grp');
fs.mkdirSync(OUT, { recursive: true });
const me = { user: { id: 'u1', email: 's@ams.test', name: 'Quản trị', role: 'super_admin' }, permissions: Object.fromEntries(['overview', 'schedule', 'media', 'devices'].map((m) => [m, ['view', 'write', 'approve', 'delete']])) };
const SVG = (c, t) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540"><rect width="100%" height="100%" fill="${c}"/><text x="50%" y="50%" fill="#fff" font-size="48" text-anchor="middle" font-family="sans-serif">${t}</text></svg>`)}`;
const M = [{ id: 'm1', name: 'TVC Tết 15s.mp4', kind: 'video', status: 'approved', mime: 'video/mp4', duration_sec: 15 }, { id: 'm2', name: 'Poster khuyến mãi.jpg', kind: 'image', status: 'approved', mime: 'image/jpeg', preview_url: SVG('#059669', 'Poster') }];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [name, w, h] of [['1440', 1440, 900], ['1024', 1024, 768], ['800', 800, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    pg.on('dialog', (d) => d.accept());
    await pg.route('**/api/**', (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (p === '/auth/me') return json(me);
      if (p === '/admin/v1/media') return json({ items: M, total: 2 });
      const one = M.find((m) => p === `/admin/v1/media/${m.id}`);
      if (one) return json(one);
      return json({ items: [], total: 0 });
    });
    await pg.goto(`${BASE}/broadcast`);
    await pg.getByRole('button', { name: 'Tạo chương trình' }).first().click();
    await pg.getByLabel('Tên chương trình').fill('Ưu đãi cuối năm');
    await pg.getByRole('tab', { name: /Thiết kế phân vùng/ }).click();
    await pg.getByRole('button', { name: '3 vùng + Chữ chạy' }).click();
    await pg.getByRole('button', { name: '+ Danh sách phát' }).click(); // nhom thu 4: "Danh sách phát 4"
    const box = async (xywh) => { for (const [i, l] of ['X (%)', 'Y (%)', 'Rộng (%)', 'Cao (%)'].entries()) await pg.getByLabel(l, { exact: true }).fill(String(xywh[i])); };
    await pg.getByRole('button', { name: '+ Video', exact: true }).click();
    await box([0, 0, 100, 49]);
    await pg.getByRole('button', { name: 'Thêm mục Video' }).click();
    await pg.getByRole('combobox', { name: 'Chọn tệp' }).selectOption('m1');
    await pg.getByRole('button', { name: 'Xong' }).click();
    await pg.getByRole('button', { name: '+ Văn bản', exact: true }).click();
    await box([0, 47, 100, 12]);
    await pg.getByRole('button', { name: '+ Ảnh', exact: true }).click();
    await box([0, 57, 100, 43]);
    await pg.getByRole('button', { name: 'Thêm mục Ảnh' }).click();
    await pg.getByRole('combobox', { name: 'Chọn tệp' }).selectOption('m2');
    await pg.getByRole('button', { name: 'Xong' }).click();
    await pg.locator('[data-testid="layer-tree"] .wz-layer:not(.kid)', { hasText: 'Danh sách phát 4' }).evaluate((e) => e.click());
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: `${OUT}/step2-group-${name}.png` });
    if (name === '1440') {
      await pg.locator('.wz-3 > div:first-child').screenshot({ path: `${OUT}/layer-tree.png` });
      await pg.getByRole('button', { name: /Xem trước/ }).click();
      await pg.waitForTimeout(1200);
      await pg.screenshot({ path: `${OUT}/step2-group-preview-${name}.png` });
      await pg.getByRole('button', { name: /Quay lại chỉnh sửa/ }).click();
    }
    // khong tran ngang o cot phai / trang
    const ov = await pg.evaluate(() => { const c = document.querySelector('.wz-3 > div:last-child'); return { panel: c ? c.scrollWidth - c.clientWidth : -1, page: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    console.log(name, 'overflow', JSON.stringify(ov));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
