// Playwright: buoc 2 voi vung danh sach phat (playlist) o 1440 / 1024. usage: (vite preview --port 4173 &) CHROME=/path node scripts/pl-ui-step2-screenshots.cjs
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = path.resolve(__dirname, '../../../docs/screenshots/pl-ui');
const me = { user: { id: 'u1', email: 's@ams.test', name: 'Quản trị', role: 'super_admin' }, permissions: Object.fromEntries(['overview', 'schedule', 'media', 'devices'].map((m) => [m, ['view', 'write', 'approve', 'delete']])) };
const SVG = (c, t) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540"><rect width="100%" height="100%" fill="${c}"/><text x="50%" y="50%" fill="#fff" font-size="48" text-anchor="middle" font-family="sans-serif">${t}</text></svg>`)}`;
const M = [{ id: 'm1', name: 'TVC Tết 15s.mp4', kind: 'video', status: 'approved', mime: 'video/mp4', duration_sec: 15 }, { id: 'm2', name: 'Poster khuyến mãi.jpg', kind: 'image', status: 'approved', mime: 'image/jpeg', preview_url: SVG('#059669', 'Poster') }];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [name, w, h] of [['1440', 1440, 900], ['1024', 1024, 768]]) {
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
    await pg.getByRole("button", { name: "+ Video", exact: true }).click();
    for (const [t, media] of [['Video', 'm1'], ['Ảnh', 'm2'], ['Text', null]]) {
      await pg.getByRole('button', { name: `Thêm mục ${t}` }).click();
      if (media) await pg.getByRole('combobox', { name: 'Chọn tệp' }).selectOption(media);
      await pg.getByRole('button', { name: 'Xong' }).click();
    }
    await pg.getByRole('button', { name: 'Sửa Text 1' }).click();
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: `${OUT}/step2-playlist-${name}.png` });
    if (name === '1440') {
      await pg.getByRole('button', { name: 'Xong' }).click();
      await pg.getByRole('button', { name: /Xem trước/ }).click();
      await pg.waitForTimeout(1200);
      await pg.screenshot({ path: `${OUT}/step2-playlist-preview-${name}.png` });
    }
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
