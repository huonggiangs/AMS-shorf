// Playwright screenshots (1440px) for ui-sub: sidebar sub-menu + rich text editor in broadcast wizard step 2. API mocked at network layer.
// usage: (vite preview --port 4173 &) CHROME=/usr/bin/google-chrome node scripts/ui-sub-screenshots.cjs   -> ../../docs/screenshots/ui-sub/
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = path.resolve(__dirname, '../../../docs/screenshots/ui-sub');
const me = { user: { id: 'u1', email: 'super@ams.test', name: 'Quản trị thử nghiệm', role: 'super_admin' },
  permissions: Object.fromEntries(['overview', 'devices', 'tv_experience', 'campaigns', 'customers', 'approvals', 'media', 'screens', 'schedule', 'finance', 'partners', 'admin'].map((m) => [m, ['view', 'write', 'approve', 'delete']])) };

async function mock(page) {
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/auth/me') return json(me);
    return json({ items: [], total: 0, page: 1, page_size: 20 });
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const mk = async (col) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await ctx.addInitScript((c) => { try { localStorage.setItem('ams-ui', JSON.stringify({ lang: 'vi', dark: false, col: c })); } catch (e) { /* */ } }, col);
    const pg = await ctx.newPage();
    await mock(pg);
    return [ctx, pg];
  };
  let [ctx, pg] = await mk(false);
  await pg.goto(`${BASE}/devices`);
  await pg.waitForSelector('a:has-text("Nhóm thiết bị")');
  await pg.screenshot({ path: `${OUT}/sidebar-thiet-bi-1440.png` });
  await pg.goto(`${BASE}/queue`);
  await pg.waitForSelector('a[aria-current="page"]:has-text("Hàng đợi")');
  await pg.click('button:has-text("Thiết bị")');
  await pg.screenshot({ path: `${OUT}/sidebar-phat-song-1440.png` });
  await ctx.close();

  [ctx, pg] = await mk(true);
  await pg.goto(`${BASE}/broadcast`);
  await pg.waitForSelector('h1');
  await pg.hover('.ng:has(button:has-text("Phát sóng nội bộ"))');
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: `${OUT}/sidebar-thu-gon-flyout-1440.png` });
  await ctx.close();

  [ctx, pg] = await mk(false);
  await pg.goto(`${BASE}/broadcast`);
  await pg.getByRole('button', { name: 'Tạo chương trình' }).first().click();
  await pg.getByLabel('Tên chương trình').fill('Ưu đãi cuối năm');
  await pg.getByRole('tab', { name: /Thiết kế phân vùng/ }).click();
  await pg.getByRole('button', { name: '+ Văn bản' }).click();
  const ed = pg.getByRole('textbox', { name: 'Nội dung hiển thị' });
  await ed.click();
  await pg.keyboard.press('Control+A');
  await pg.keyboard.type('Ưu đãi cuối năm');
  await pg.keyboard.press('Enter');
  await pg.keyboard.type('Giảm đến 50%');
  await pg.keyboard.press('Enter');
  await pg.keyboard.type('Từ 01/12 đến 31/12');
  // dong 1: dam + co 40 + can giua
  await pg.keyboard.press('Control+Home');
  await pg.keyboard.press('Shift+End');
  await pg.getByRole('button', { name: 'In đậm' }).click();
  await pg.getByLabel('Cỡ chữ đoạn chọn').fill('40');
  await pg.getByRole('button', { name: 'Căn giữa' }).click();
  // dong 2: mau do + gach chan + can giua
  await pg.keyboard.press('ArrowDown');
  await pg.keyboard.press('Home');
  await pg.keyboard.press('Shift+End');
  await pg.getByRole('toolbar').getByLabel('Màu chữ').fill('#fde047');
  await pg.getByRole('button', { name: 'Gạch chân' }).click();
  await pg.getByRole('button', { name: 'Căn giữa' }).click();
  // dong 3: nghieng + manh + can phai
  await pg.keyboard.press('ArrowDown');
  await pg.keyboard.press('Home');
  await pg.keyboard.press('Shift+End');
  await pg.getByRole('button', { name: 'In nghiêng' }).click();
  await pg.getByLabel('Độ đậm nhạt').selectOption('300');
  await pg.getByRole('button', { name: 'Căn phải' }).click();
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${OUT}/rich-text-buoc-2-1440.png` });
  console.log(await ed.innerHTML());
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
