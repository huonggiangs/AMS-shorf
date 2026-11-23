// Chuong trinh phat song noi bo (migrations/0020) tren runtime that (API + gateway cung CSDL): tao -> xuat ban -> thiet bi thang may nhan trong manifest;
// kiem tra quyen (schedule:*), tep chua duyet / da gan chien dich, thu tu tep, dung phat, audit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { createGateway, type Gateway } from '@ams/edge-gateway';
import { generateEd25519KeyPair, seedAdFixture, signRequest } from '@ams/edge-gateway/testing';
import { MANIFEST_EPOCH_KEY } from '@ams/shared';
import { createApp } from '../src/app.js';
import { login, NOW, type Env, type Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let rt: TestRuntime;
let env: Env;
let gw: Gateway;
let admin: Session;
let content: Session;
let finance: Session;
let customerId: string;

async function elevator(region = 'HN'): Promise<{ id: string; manifest: () => Promise<any> }> {
  const keys = await generateEd25519KeyPair();
  const nowS = () => Math.floor(rt.clock.now().getTime() / 1000);
  const body = JSON.stringify({ pubkey: keys.publicKey, kind: 'elevator', model: 'RK3568', os: 'android-11', app_version: '1.0.3', region, px_w: 1080, px_h: 1920, orientation: 'portrait' });
  const s = await signRequest(keys.privateKey, { method: 'POST', path: '/v1/register', body, ts: nowS() });
  const res = await gw.app.request('/v1/register', { method: 'POST', body, headers: s.headers });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as any).device_id as string;
  return {
    id,
    manifest: async () => {
      await rt.kv.incr(MANIFEST_EPOCH_KEY).catch(() => undefined);
      await gw.manifests.invalidate();
      const sig = await signRequest(keys.privateKey, { method: 'GET', path: '/v1/manifest', deviceId: id, ts: nowS() });
      const r = await gw.app.request('/v1/manifest', { method: 'GET', headers: sig.headers });
      expect(r.status).toBe(200);
      return r.json();
    },
  };
}

async function libraryMedia(o: { w?: number; h?: number; review?: string; campaignId?: string | null } = {}): Promise<string> {
  const id = rt.id();
  const key = `test/${customerId}/${id}.mp4`;
  const bytes = new TextEncoder().encode(`media-${id}`);
  await rt.objects.put(key, bytes, 'video/mp4');
  await rt.db.run(
    `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, storage_key, mime, size_bytes, duration_s, scan_state, review_state, state, created_at)
     VALUES (?, ?, ?, ?, 'elevator', ?, ?, 'portrait', 'video', 'upload', ?, 'video/mp4', ?, 15, 'clean', ?, 'ready', ?)`,
    [id, o.campaignId ?? null, customerId, `kho-${id}.mp4`, o.w ?? 1080, o.h ?? 1920, key, bytes.length, o.review ?? 'approved', NOW],
  );
  return id;
}

const audit = async (action: string) => rt.db.query<{ action: string }>('SELECT action FROM audit_log WHERE action = ?', [action]);

beforeAll(async () => {
  rt = await createTestRuntime({ now: NOW, dialect: 'sqlite', env: { SCRYPT_N: '1024', MEDIA_PUBLIC_URL: 'https://media.test', HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000' } });
  const s = await seed(rt, { log: false, passwordParams: { N: 1024 }, deviceCount: 3 });
  const creds = new Map(s.credentials.map((c) => [c.email, c]));
  env = {
    rt,
    app: createApp(rt),
    seed: s,
    cred: (email) => {
      const c = creds.get(email)!;
      return { password: c.password!, totpSecret: c.totpSecret!, role: c.role };
    },
    byRole: (role, nth = 0) => s.credentials.filter((c) => c.role === role && c.status === 'active')[nth]!.email,
  };
  gw = createGateway(rt);
  customerId = s.customers['K008']!;
  admin = await login(env, env.byRole('super_admin'));
  content = await login(env, env.byRole('content_manager'));
  finance = await login(env, env.byRole('finance'));
}, 120_000);
afterAll(async () => rt.close());

describe('chuong trinh phat song noi bo qua API', () => {
  it('tao ban nhap -> xuat ban: thiet bi thang may nhan dung thu tu tep + header/footer; dung phat thi het; audit', async () => {
    const a = await libraryMedia();
    const b = await libraryMedia();
    const created = await content.json('POST', '/admin/v1/broadcast', { name: 'Gioi thieu toa nha', target_type: 'elevator', regions: ['HN'], start_min: 360, end_min: 1380, header: 'Xin chào', footer: 'Hotline 0365361688', creative_ids: [b, a] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ status: 'draft', item_count: 2, target_type: 'elevator' });
    expect(created.body.items.map((i: any) => i.creative_id)).toEqual([b, a]);
    const pid = created.body.id as string;
    const dev = await elevator('HN');
    expect((await dev.manifest()).schedule.some((x: any) => x.slot_id === `bp_${pid}`)).toBe(false); // ban nhap chua phat

    const pub = await content.json('POST', `/admin/v1/broadcast/${pid}/publish`, {});
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(pub.body.status).toBe('published');
    const m = await dev.manifest();
    expect(m.schedule.find((x: any) => x.slot_id === `bp_${pid}`)).toMatchObject({ creative_ids: [b, a], start_min: 360, end_min: 1380, header: 'Xin chào', footer: 'Hotline 0365361688' });
    // khu vuc khac khong nhan
    expect((await (await elevator('HCM')).manifest()).schedule.some((x: any) => x.slot_id === `bp_${pid}`)).toBe(false);

    const off = await content.json('POST', `/admin/v1/broadcast/${pid}/unpublish`, {});
    expect(off.body.status).toBe('draft');
    expect((await dev.manifest()).schedule.some((x: any) => x.slot_id === `bp_${pid}`)).toBe(false);
    expect((await audit('broadcast.publish')).length).toBe(1);
    expect((await audit('broadcast.unpublish')).length).toBe(1);
  });

  it('kiem tra dau vao: tep chua duyet khong xuat ban duoc; tep da gan chien dich / sai ti le bi tu choi; header chi cho thang may/LED', async () => {
    const pending = await libraryMedia({ review: 'pending' });
    const ok = await content.json('POST', '/admin/v1/broadcast', { name: 'Cho duyet', target_type: 'elevator', creative_ids: [pending] });
    expect(ok.status).toBe(201);
    const pub = await content.json('POST', `/admin/v1/broadcast/${ok.body.id}/publish`, {});
    expect(pub.status).toBe(422);
    expect(pub.body.error.code).toBe('media_not_ready');

    const camp = (await seedAdFixture(rt, { campaigns: 1, targetType: 'elevator', px: { w: 1080, h: 1920 }, regions: null })).campaigns[0]!;
    const inCamp = await libraryMedia({ campaignId: camp.id, w: 768, h: 1366 });
    const r1 = await content.json('POST', '/admin/v1/broadcast', { name: 'Da gan chien dich', target_type: 'elevator', creative_ids: [inCamp] });
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('media_in_campaign');

    const wide = await libraryMedia({ w: 1920, h: 1080 });
    const r2 = await content.json('POST', '/admin/v1/broadcast', { name: 'Sai ti le', target_type: 'elevator', creative_ids: [wide] });
    expect(r2.status).toBe(422);
    expect(r2.body.error.code).toBe('creative_size_mismatch');

    const r3 = await content.json('POST', '/admin/v1/broadcast', { name: 'TV co header', target_type: 'tv', header: 'khong duoc' });
    expect(r3.status).toBe(422);
    expect(r3.body.error.code).toBe('slot_not_signage');

    const empty = await content.json('POST', '/admin/v1/broadcast', { name: 'Rong', target_type: 'elevator' });
    expect((await content.json('POST', `/admin/v1/broadcast/${empty.body.id}/publish`, {})).body.error.code).toBe('no_items');
    expect((await content.json('POST', '/admin/v1/broadcast', { name: 'x', target_type: 'elevator', start_min: 600, end_min: 600 })).status).toBe(422);
  });

  it('phan quyen: tai chinh khong co schedule:write; sua doi tep khi dang phat lam manifest doi; xoa', async () => {
    const a = await libraryMedia();
    const c = await libraryMedia();
    expect((await finance.json('POST', '/admin/v1/broadcast', { name: 'Khong duoc', target_type: 'elevator' })).status).toBe(403);
    const p = (await content.json('POST', '/admin/v1/broadcast', { name: 'Doi tep', target_type: 'elevator', creative_ids: [a] })).body;
    await content.json('POST', `/admin/v1/broadcast/${p.id}/publish`, {});
    const dev = await elevator('DN');
    expect((await dev.manifest()).schedule.find((x: any) => x.slot_id === `bp_${p.id}`).creative_ids).toEqual([a]);
    const up = await content.json('PUT', `/admin/v1/broadcast/${p.id}`, { creative_ids: [c, a] });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.version).toBeGreaterThan(p.version);
    expect((await dev.manifest()).schedule.find((x: any) => x.slot_id === `bp_${p.id}`).creative_ids).toEqual([c, a]);
    const list = await content.json('GET', '/admin/v1/broadcast?status=published');
    expect(list.body.items.some((i: any) => i.id === p.id)).toBe(true);
    const del = await admin.json('DELETE', `/admin/v1/broadcast/${p.id}`);
    expect(del.status).toBe(200);
    expect((await dev.manifest()).schedule.some((x: any) => x.slot_id === `bp_${p.id}`)).toBe(false);
    expect((await content.json('GET', `/admin/v1/broadcast/${p.id}`)).status).toBe(404);
  });
});

describe('thong bao khan + goi USB', () => {
  it('thong bao khan: chi thiet bi da duyet khop khu vuc nhan lenh message (duration_s), quyen schedule:write, audit + lich su', async () => {
    const ok = await elevator('ZZ');
    const pending = await elevator('ZZ');
    const other = await elevator('YY');
    await rt.db.run('UPDATE devices SET trust_level = 1 WHERE id IN (?, ?)', [ok.id, other.id]);
    expect((await finance.json('POST', '/admin/v1/broadcast/notice', { text: 'x' })).status).toBe(403);
    expect((await content.json('POST', '/admin/v1/broadcast/notice', { text: '' })).status).toBe(422);
    expect((await content.json('POST', '/admin/v1/broadcast/notice', { text: 'x', duration_s: 500 })).status).toBe(422);
    const r = await content.json('POST', '/admin/v1/broadcast/notice', { text: 'Bảo trì thang máy 14h', duration_s: 45, target: 'elevator', regions: ['ZZ'] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ matched: 1, queued: 1, skipped: 0 });
    expect(typeof r.body.batch_id).toBe('string');
    const stt = await content.json('GET', `/admin/v1/broadcast/notice/${r.body.batch_id}/status`);
    expect(stt.status).toBe(200);
    expect(stt.body).toMatchObject({ total: 1, pending: 1, acked: 0 });
    const cmds = await rt.db.query<{ device_id: string; type: string; args: string }>("SELECT device_id, type, args FROM device_commands WHERE type = 'message'");
    expect(cmds.filter((x) => x.device_id === ok.id).map((x) => JSON.parse(x.args))).toEqual([{ text: 'Bảo trì thang máy 14h', duration_s: 45 }]);
    expect(cmds.some((x) => x.device_id === pending.id || x.device_id === other.id)).toBe(false);
    const none = await content.json('POST', '/admin/v1/broadcast/notice', { text: 'x', target: 'led_p5', regions: ['ZZ'] });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('no_devices');
    const hist = await content.json('GET', '/admin/v1/broadcast/notice');
    expect(hist.body.items[0]).toMatchObject({ text: 'Bảo trì thang máy 14h', queued: 1, target: 'elevator' });
    expect((await audit('broadcast.notice')).length).toBe(1);
  });

  it('goi USB: playlist.json dung dinh dang app (items[].file/url/duration/checksum) + tep ky; chua san sang thi 422', async () => {
    const a = await libraryMedia();
    const b = await libraryMedia();
    const p = (await content.json('POST', '/admin/v1/broadcast', { name: 'USB thu', target_type: 'elevator', header: 'Chào', footer: 'Hotline', creative_ids: [b, a] })).body;
    const r = await content.json('GET', `/admin/v1/broadcast/${p.id}/usb-package`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.folder).toBe('ANIO');
    expect(r.body.playlist).toMatchObject({ header: 'Chào', footer: 'Hotline' });
    expect(r.body.playlist.items.map((i: any) => i.id)).toEqual([b, a]);
    expect(r.body.playlist.items[0]).toMatchObject({ type: 'video', duration: 15, file: r.body.files[0].name, url: r.body.files[0].name });
    expect(r.body.files).toHaveLength(2);
    expect(r.body.files[0].url).toMatch(/^https?:/);
    expect(r.body.files[0].name).toMatch(/^001-.*\.mp4$/);
    const pend = await libraryMedia({ review: 'pending' });
    const q = (await content.json('POST', '/admin/v1/broadcast', { name: 'USB cho', target_type: 'elevator', creative_ids: [pend] })).body;
    const bad = await content.json('GET', `/admin/v1/broadcast/${q.id}/usb-package`);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('media_not_ready');
    const empty = (await content.json('POST', '/admin/v1/broadcast', { name: 'USB rong', target_type: 'elevator' })).body;
    expect((await content.json('GET', `/admin/v1/broadcast/${empty.id}/usb-package`)).body.error.code).toBe('no_items');
  });

  it('vung QR (anh/URL/VietQR) va thoi tiet (GPS/co dinh) duoc luu day du; du lieu sai bi tu choi', async () => {
    const zones = [
      { id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 60 },
      { id: 'q1', type: 'qr', x: 0, y: 60, w: 30, h: 30, qr: { mode: 'vietqr', vietqr: { bin: '970436', account: '0123456789', name: 'ANIO', amount: 50000, memo: 'Thanh toan' } } },
      { id: 'q2', type: 'qr', x: 30, y: 60, w: 30, h: 30, qr: { mode: 'url', value: 'https://anio.vn' } },
      { id: 'q3', type: 'qr', x: 60, y: 60, w: 20, h: 20, qr: { mode: 'image', value: 'data:image/png;base64,iVBORw0KGgo=' } },
      { id: 'w', type: 'weather', x: 80, y: 60, w: 20, h: 20, weather: { mode: 'gps', lat: 21.0285, lon: 105.8542, label: 'Ha Noi' } },
    ];
    const ok = await content.json('POST', '/admin/v1/layout-templates', { name: 'QR + thoi tiet', orientation: 'portrait', zones });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.zones.find((z: any) => z.id === 'q1').qr.vietqr.bin).toBe('970436');
    expect(ok.body.zones.find((z: any) => z.id === 'w').weather).toMatchObject({ mode: 'gps', lat: 21.0285 });
    const bad = (qr: unknown, extra: Record<string, unknown> = {}) => content.json('POST', '/admin/v1/layout-templates', { name: 'Hong', zones: [{ id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 50 }, { id: 'q', type: 'qr', x: 0, y: 50, w: 20, h: 20, qr, ...extra }] });
    expect((await bad({ mode: 'vietqr', vietqr: { bin: '12', account: '0123456789' } })).status).toBe(422);
    expect((await bad({ mode: 'vietqr' })).status).toBe(422);
    expect((await bad({ mode: 'image', value: 'https://x/qr.png' })).status).toBe(422);
    expect((await bad({ mode: 'url' })).status).toBe(422);
    expect((await content.json('POST', '/admin/v1/layout-templates', { name: 'Hong', zones: [{ id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 50 }, { id: 'w', type: 'weather', x: 0, y: 50, w: 20, h: 20, weather: { mode: 'fixed', lat: 123, lon: 5 } }] })).status).toBe(422);
  });

  it('van ban dinh dang (rich): may chu lam sach HTML, tu dat lai text thuan, chu chay mot dong; vung khac khong giu rich', async () => {
    const dirty = '<p style="text-align:center;position:fixed" onclick="x()"><b>Giam gia</b> <span style="color:#f00;font-size:40px;font-family:Comic Sans">50%</span><script>alert(1)</script></p><div>Dong hai &amp; ba</div>';
    const zones = [
      { id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 60 },
      { id: 't', type: 'text', x: 0, y: 60, w: 100, h: 25, text: 'cu', rich: dirty },
      { id: 'bar', type: 'marquee', x: 0, y: 85, w: 100, h: 15, rich: '<p><b>A</b></p><p>B</p>' },
      { id: 'img', type: 'image', x: 0, y: 0, w: 10, h: 10, rich: '<p>khong</p>' },
    ];
    const ok = await content.json('POST', '/admin/v1/layout-templates', { name: 'Rich', zones });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const t = ok.body.zones.find((z: any) => z.id === 't');
    expect(t.rich).toBe('<p style="text-align:center"><b>Giam gia</b> <span style="color:#FF0000;font-size:40px">50%</span></p><p>Dong hai &amp; ba</p>');
    expect(t.text).toBe('Giam gia 50%\nDong hai & ba');
    const bar = ok.body.zones.find((z: any) => z.id === 'bar');
    expect(bar.rich).toBe('<p><b>A</b> B</p>');
    expect(bar.text).toBe('A B');
    expect(ok.body.zones.find((z: any) => z.id === 'img').rich).toBeUndefined();
    const long = await content.json('POST', '/admin/v1/layout-templates', { name: 'Dai', zones: [zones[0], { id: 'bar', type: 'marquee', x: 0, y: 85, w: 100, h: 15, rich: `<p>${'x'.repeat(201)}</p>` }] });
    expect(long.status).toBe(422);
    const old = await content.json('POST', '/admin/v1/layout-templates', { name: 'Cu', zones: [zones[0], { id: 'old', type: 'text', x: 0, y: 60, w: 50, h: 20, text: 'Chi co text' }] });
    expect(old.body.zones.find((z: any) => z.id === 'old')).toMatchObject({ text: 'Chi co text' });
    expect(old.body.zones.find((z: any) => z.id === 'old').rich).toBeUndefined();
  });

  it('mau bo cuc: CRUD + kiem tra vung (vuot khung, trung ma, qua 8 vung); quyen xem/ghi', async () => {
    const zones = [
      { id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 80, z: 0, transition: 'fade' },
      { id: 'bar', type: 'marquee', x: 0, y: 80, w: 100, h: 20, z: 1, text: 'Khuyen mai', bg_color: '#DC2626', text_color: '#FFFFFF', font_size: 20, scroll_speed: 60 },
    ];
    const c = await content.json('POST', '/admin/v1/layout-templates', { name: 'Chinh + chu chay', orientation: 'portrait', zones });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body).toMatchObject({ name: 'Chinh + chu chay', orientation: 'portrait' });
    expect(c.body.zones).toHaveLength(2);
    const bad = await content.json('POST', '/admin/v1/layout-templates', { name: 'Hong', zones: [{ id: 'a', type: 'video', x: 60, y: 0, w: 60, h: 50 }] });
    expect(bad.status).toBe(422);
    const dup = await content.json('POST', '/admin/v1/layout-templates', { name: 'Trung', zones: [zones[0], zones[0]] });
    expect(dup.status).toBe(422);
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `z${i}`, type: 'image', x: 0, y: 0, w: 10, h: 10 }));
    expect((await content.json('POST', '/admin/v1/layout-templates', { name: 'Nhieu', zones: many })).status).toBe(422);
    const sys = await content.json('GET', '/admin/v1/layout-templates?page_size=50');
    const names = sys.body.items.filter((t: any) => t.system).map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(['Chia đôi Dọc (TVC 50% + Poster 50%)', 'Bán lẻ 3 vùng', 'Sảnh Tòa nhà Ngang', 'Sân bay Quốc tế', 'Menu Quầy Gọi món F&B', 'Kiosk Y tế & Bệnh viện']));
    expect(sys.body.items.find((t: any) => t.name === 'Sân bay Quốc tế').zones).toHaveLength(4);
    expect((await admin.json('PUT', '/admin/v1/layout-templates/sys_retail3', { name: 'x' })).body.error.code).toBe('system_template');
    expect((await admin.json('DELETE', '/admin/v1/layout-templates/sys_retail3')).status).toBe(422);
    const list = await content.json('GET', '/admin/v1/layout-templates');
    expect(list.body.items.map((t: any) => t.id)).toContain(c.body.id);
    const up = await content.json('PUT', `/admin/v1/layout-templates/${c.body.id}`, { name: 'Doi ten' });
    expect(up.body.name).toBe('Doi ten');
    expect(up.body.zones).toHaveLength(2);
    expect((await finance.json('POST', '/admin/v1/layout-templates', { name: 'x', zones })).status).toBe(403);
    expect((await admin.json('DELETE', `/admin/v1/layout-templates/${c.body.id}`)).status).toBe(200);
    expect((await content.json('GET', `/admin/v1/layout-templates/${c.body.id}`)).status).toBe(404);
  });

  it('chuong trinh co bo cuc: luu vung + gan tep vao vung, manifest co layout; gan sai vung bi tu choi; bo bo cuc thi het layout', async () => {
    const a = await libraryMedia();
    const b = await libraryMedia();
    const layout = { orientation: 'portrait', zones: [
      { id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 75, z: 0, transition: 'fade' },
      { id: 'side', type: 'image', x: 0, y: 75, w: 60, h: 25, z: 1 },
      { id: 'bar', type: 'marquee', x: 60, y: 75, w: 40, h: 25, z: 2, text: 'Xin chao' },
    ] };
    const bad = await content.json('POST', '/admin/v1/broadcast', { name: 'Sai vung', target_type: 'elevator', creative_ids: [a], layout, item_zones: { [a]: 'bar' } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('bad_item_zone');
    const nolay = await content.json('POST', '/admin/v1/broadcast', { name: 'Khong bo cuc', target_type: 'elevator', creative_ids: [a], item_zones: { [a]: 'main' } });
    expect(nolay.body.error.code).toBe('no_layout');
    const created = await content.json('POST', '/admin/v1/broadcast', { name: 'Da vung', target_type: 'elevator', regions: ['HN'], creative_ids: [a, b], layout, item_zones: { [b]: 'side' } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.layout.zones).toHaveLength(3);
    expect(created.body.items.find((i: any) => i.creative_id === b).zone_id).toBe('side');
    expect(created.body.items.find((i: any) => i.creative_id === a).zone_id).toBeNull();
    const pid = created.body.id as string;
    await content.json('POST', `/admin/v1/broadcast/${pid}/publish`, {});
    const dev = await elevator('HN');
    const slot = (await dev.manifest()).schedule.find((x: any) => x.slot_id === `bp_${pid}`);
    expect(slot.layout.orientation).toBe('portrait');
    expect(slot.layout.zones.find((z: any) => z.id === 'main').creative_ids).toEqual([a]);
    expect(slot.layout.zones.find((z: any) => z.id === 'side').creative_ids).toEqual([b]);
    // sua ten khong lam mat bo cuc; doi danh sach tep giu gan vung cua tep con lai
    const ren = await content.json('PUT', `/admin/v1/broadcast/${pid}`, { name: 'Da vung 2' });
    expect(ren.body.layout.zones).toHaveLength(3);
    expect(ren.body.items.find((i: any) => i.creative_id === b).zone_id).toBe('side');
    const only = await content.json('PUT', `/admin/v1/broadcast/${pid}`, { creative_ids: [b] });
    expect(only.body.items).toHaveLength(1);
    expect(only.body.items[0].zone_id).toBe('side');
    const off = await content.json('PUT', `/admin/v1/broadcast/${pid}`, { layout: null });
    expect(off.body.layout).toBeNull();
    expect(off.body.items[0].zone_id).toBeNull();
    expect((await dev.manifest()).schedule.find((x: any) => x.slot_id === `bp_${pid}`).layout).toBeUndefined();
    expect((await admin.json('DELETE', `/admin/v1/broadcast/${pid}`)).status).toBe(200);
    expect((await rt.db.query('SELECT 1 FROM broadcast_item_zones WHERE program_id = ?', [pid])).length).toBe(0);
  });
});

describe('chuong trinh gan theo tung thiet bi + day refresh_manifest', () => {
  it('chon thiet bi: chi thiet bi do nhan; xuat ban/go/doi day lenh refresh_manifest; liet ke + tinh trang giao', async () => {
    const chosen = await elevator('DV');
    const sameRegion = await elevator('DV');
    const unapproved = await elevator('DV');
    await rt.db.run('UPDATE devices SET trust_level = 1 WHERE id IN (?, ?)', [chosen.id, sameRegion.id]);
    const m = await libraryMedia();
    const pick = await content.json('GET', '/admin/v1/broadcast/devices-pick?target=elevator&regions=DV');
    expect(pick.status).toBe(200);
    expect(pick.body.items.map((d: any) => d.id).sort()).toEqual([chosen.id, sameRegion.id].sort());
    expect(pick.body.items[0]).toMatchObject({ region: 'DV' });
    expect((await finance.json('GET', '/admin/v1/broadcast/devices-pick')).status).toBe(403);

    const bad = await content.json('POST', '/admin/v1/broadcast', { name: 'x', target_type: 'elevator', creative_ids: [m], device_ids: [unapproved.id] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('device_not_approved');
    expect((await content.json('POST', '/admin/v1/broadcast', { name: 'x', target_type: 'tv', creative_ids: [], device_ids: [chosen.id] })).body.error.code).toBe('device_kind_mismatch');

    const created = await content.json('POST', '/admin/v1/broadcast', { name: 'Rieng thiet bi', target_type: 'elevator', regions: [], creative_ids: [m], device_ids: [chosen.id] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ device_count: 1, device_ids: [chosen.id] });
    expect(created.body.devices[0]).toMatchObject({ id: chosen.id, region: 'DV', online: false });
    const pid = created.body.id as string;

    const pub = await content.json('POST', `/admin/v1/broadcast/${pid}/publish`, {});
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(pub.body.push).toMatchObject({ matched: 1, pushed: 1, skipped: 0 });
    const cmds = await rt.db.query<{ device_id: string; type: string }>("SELECT device_id, type FROM device_commands WHERE type = 'refresh_manifest'");
    expect(cmds.filter((x) => x.device_id === chosen.id)).toHaveLength(1);
    expect(cmds.some((x) => x.device_id === sameRegion.id)).toBe(false);

    expect((await chosen.manifest()).schedule.some((x: any) => x.slot_id === `bp_${pid}`)).toBe(true);
    expect((await sameRegion.manifest()).schedule.some((x: any) => x.slot_id === `bp_${pid}`)).toBe(false);

    const del = await content.json('GET', `/admin/v1/broadcast/${pid}/delivery`);
    expect(del.status).toBe(200);
    expect(del.body.items).toHaveLength(1);
    expect(del.body.items[0]).toMatchObject({ id: chosen.id, command: { status: 'pending' } });

    // doi sang thiet bi khac khi dang phat: thiet bi cu bi go va cung duoc bao lam moi
    const swap = await content.json('PUT', `/admin/v1/broadcast/${pid}`, { device_ids: [sameRegion.id] });
    expect(swap.status, JSON.stringify(swap.body)).toBe(200);
    expect(swap.body.push).toMatchObject({ matched: 2, pushed: 2 });
    expect((await chosen.manifest()).schedule.some((x: any) => x.slot_id === `bp_${pid}`)).toBe(false);
    expect((await sameRegion.manifest()).schedule.some((x: any) => x.slot_id === `bp_${pid}`)).toBe(true);

    const off = await content.json('POST', `/admin/v1/broadcast/${pid}/unpublish`, {});
    expect(off.body.push).toMatchObject({ pushed: 1 });
    expect((await sameRegion.manifest()).schedule.some((x: any) => x.slot_id === `bp_${pid}`)).toBe(false);
    expect((await admin.json('DELETE', `/admin/v1/broadcast/${pid}`)).status).toBe(200);
    expect((await rt.db.query('SELECT 1 FROM broadcast_program_devices WHERE program_id = ?', [pid])).length).toBe(0);
  });

  it('khong chon thiet bi: day refresh_manifest theo loai man + khu vuc cua cac thiet bi da duyet', async () => {
    const a = await elevator('RG');
    const b = await elevator('RG');
    const other = await elevator('RH');
    await rt.db.run('UPDATE devices SET trust_level = 1 WHERE id IN (?, ?, ?)', [a.id, b.id, other.id]);
    const m = await libraryMedia();
    const created = await content.json('POST', '/admin/v1/broadcast', { name: 'Theo khu vuc', target_type: 'elevator', regions: ['RG'], creative_ids: [m] });
    const pub = await content.json('POST', `/admin/v1/broadcast/${created.body.id}/publish`, {});
    expect(pub.body.push).toMatchObject({ matched: 2, pushed: 2 });
    const cmds = await rt.db.query<{ device_id: string }>("SELECT device_id FROM device_commands WHERE type = 'refresh_manifest' AND device_id IN (?, ?, ?)", [a.id, b.id, other.id]);
    expect(cmds.map((x) => x.device_id).sort()).toEqual([a.id, b.id].sort());
    // go chuong trinh: lenh moi (khoa idempotency theo phien ban) toi cung 2 thiet bi
    const off = await content.json('POST', `/admin/v1/broadcast/${created.body.id}/unpublish`, {});
    expect(off.body.push).toMatchObject({ pushed: 2 });
  });
});
