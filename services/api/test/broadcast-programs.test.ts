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
});
