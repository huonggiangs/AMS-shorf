// Phat song noi bo: ban lam viec (summary), phan phoi thong minh (de xuat theo luat), hang doi lenh, nhat ky + su kien thiet bi.
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


async function approvedElevator(region: string) {
  const d = await elevator(region);
  await rt.db.run('UPDATE devices SET trust_level = 1, last_seen_at = ? WHERE id = ?', [rt.clock.now().toISOString(), d.id]);
  return d;
}

describe('phat song noi bo: tong quan, de xuat, hang doi, nhat ky', () => {
  it('summary: dem chuong trinh theo trang thai, tep cho duyet, thiet bi online theo khu vuc, thong bao gan day, hang doi; can schedule:view', async () => {
    const a = await libraryMedia();
    const pend = await libraryMedia({ review: 'pending' });
    const live = (await content.json('POST', '/admin/v1/broadcast', { name: 'Dang phat', target_type: 'elevator', regions: ['SM'], creative_ids: [a] })).body;
    await content.json('POST', `/admin/v1/broadcast/${live.id}/publish`, {});
    await content.json('POST', '/admin/v1/broadcast', { name: 'Ban nhap', target_type: 'elevator', creative_ids: [pend] });
    const d = await approvedElevator('SM');
    const off = await approvedElevator('SM');
    await rt.db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', off.id]);
    await content.json('POST', '/admin/v1/broadcast/notice', { text: 'Thu tong quan', target: 'elevator', regions: ['SM'] });
    const r = await content.json('GET', '/admin/v1/broadcast-insights/summary');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.programs.published).toBeGreaterThanOrEqual(1);
    expect(r.body.programs.draft).toBeGreaterThanOrEqual(1);
    expect(r.body.media.pending_review).toBeGreaterThanOrEqual(1);
    const sm = r.body.devices.regions.find((g: any) => g.region === 'SM');
    expect(sm).toEqual({ region: 'SM', online: 1, offline: 1 });
    expect(r.body.notices[0]).toMatchObject({ text: 'Thu tong quan', queued: 2 });
    expect(r.body.queue.pending).toBeGreaterThanOrEqual(2);
    expect(d.id).toBeTruthy();
    expect((await finance.json('GET', '/admin/v1/broadcast-insights/summary')).status).toBe(403);
  });

  it('recommend: xep hang theo luat (khung gio, loai man, tre em), co ly do tieng Viet, ghi audit va lich su; tre em phat tep chua an toan bi tru diem', async () => {
    const a = await libraryMedia();
    const b = await libraryMedia();
    await approvedElevator('RC');
    const good = (await content.json('POST', '/admin/v1/broadcast', { name: 'Thang may sang', target_type: 'elevator', regions: ['RC'], start_min: 360, end_min: 720, creative_ids: [a] })).body;
    await content.json('POST', `/admin/v1/broadcast/${good.id}/publish`, {});
    const night = (await content.json('POST', '/admin/v1/broadcast', { name: 'Ban dem', target_type: 'elevator', regions: ['RC'], start_min: 1200, end_min: 1380, creative_ids: [b] })).body;
    await content.json('POST', `/admin/v1/broadcast/${night.id}/publish`, {});
    const bad = await content.json('POST', '/admin/v1/broadcast-insights/recommend', { place: 'nope' });
    expect(bad.status).toBe(422);
    const r = await content.json('POST', '/admin/v1/broadcast-insights/recommend', { place: 'building', hour: 9, audience: 'adult', density: 'high', weather: 'any', note: 'sang' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.engine).toBe('rules');
    const ids = r.body.items.map((x: any) => x.program_id);
    expect(ids.indexOf(good.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(good.id)).toBeLessThan(ids.indexOf(night.id));
    const top = r.body.items.find((x: any) => x.program_id === good.id);
    expect(top.reasons.join(' ')).toMatch(/Khung giờ/);
    expect(top.groups).toEqual([{ region: 'RC', online: 1, total: 1 }]);
    const kids = await content.json('POST', '/admin/v1/broadcast-insights/recommend', { place: 'building', hour: 9, audience: 'child' });
    const kg = kids.body.items.find((x: any) => x.program_id === good.id);
    expect(kg.warnings.join(' ')).toMatch(/an toàn cho trẻ em/);
    expect(kg.score).toBeLessThan(top.score);
    expect((await audit('broadcast.recommend')).length).toBeGreaterThanOrEqual(2);
    const hist = await content.json('GET', '/admin/v1/broadcast-insights/recommend');
    expect(hist.body.items[0].context).toMatchObject({ audience: 'child' });
  });

  it('queue: loc theo trang thai/loai/thiet bi, dem theo trang thai, lenh qua han = expired; logs: chi broadcast.* co tim kiem; events: nhat ky thiet bi + heartbeat', async () => {
    const d = await approvedElevator('QL');
    await content.json('POST', '/admin/v1/broadcast/notice', { text: 'Hang doi thu', target: 'elevator', regions: ['QL'] });
    await rt.db.run("UPDATE device_commands SET status = 'acked', acked_at = ? WHERE device_id = ?", [rt.clock.now().toISOString(), d.id]);
    await rt.db.run('INSERT INTO device_commands (id, device_id, type, args, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [rt.id(), d.id, 'reboot', null, 'pending', '2020-01-01T00:00:00.000Z', '2019-12-31T00:00:00.000Z']);
    const all = await content.json('GET', `/admin/v1/broadcast-insights/queue?device_id=${d.id}`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.counts.expired).toBeGreaterThanOrEqual(1);
    expect(all.body.items.find((x: any) => x.type === 'reboot')).toMatchObject({ state: 'expired', cancellable: false });
    expect(all.body.items.find((x: any) => x.type === 'message')).toMatchObject({ state: 'acked', args: { text: 'Hang doi thu' } });
    const only = await content.json('GET', `/admin/v1/broadcast-insights/queue?device_id=${d.id}&type=message`);
    expect(only.body.items).toHaveLength(1);
    expect(all.body.types).toContain('message');

    const logs = await content.json('GET', '/admin/v1/broadcast-insights/logs?q=notice');
    expect(logs.body.items.length).toBeGreaterThanOrEqual(1);
    expect(logs.body.items.every((x: any) => x.action.startsWith('broadcast.'))).toBe(true);

    await rt.db.run("INSERT INTO device_logs (id, device_id, ts, received_at, level, tag, message) VALUES (?, ?, ?, ?, 'warn', 'player', 'mat ket noi')", [rt.id(), d.id, rt.clock.now().toISOString(), rt.clock.now().toISOString()]);
    await rt.db.run('INSERT INTO ev_heartbeat (ts, device_id, region, app_ver, soc_temp, state) VALUES (?, ?, ?, ?, ?, ?)', [rt.clock.now().toISOString(), d.id, 'QL', '1.0.1', 48, 1]);
    const ev = await content.json('GET', `/admin/v1/broadcast-insights/events/logs?device_id=${d.id}`);
    expect(ev.body.items[0]).toMatchObject({ level: 'warn', message: 'mat ket noi' });
    const hb = await content.json('GET', `/admin/v1/broadcast-insights/events/heartbeat?device_id=${d.id}`);
    expect(hb.body.items[0]).toMatchObject({ device_id: d.id, app_ver: '1.0.1', soc_temp: 48 });
    expect((await finance.json('GET', '/admin/v1/broadcast-insights/queue')).status).toBe(403);
  });
});
