// Signage Player (thang may / LED) tren runtime that (API + gateway cung mot CSDL):
//  cap quyen thiet bi + gan screen/venue, lenh (reset_pin, set_volume, set_orientation, message), cau hinh header/footer/hotline/fit/cap nhat app,
//  chu ghi de theo lich, nhat ky 7 ngay, hieu luc proof_of_play. Kiem quyen ('can' o may chu), IDOR, audit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { createGateway, type Gateway } from '@ams/edge-gateway';
import { generateEd25519KeyPair, seedAdFixture, signRequest, type AdFixture } from '@ams/edge-gateway/testing';
import { MANIFEST_EPOCH_KEY, uuidv7 } from '@ams/shared';
import { createApp } from '../src/app.js';
import { login, NOW, type Env, type Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let rt: TestRuntime;
let env: Env;
let gw: Gateway;
let fx: AdFixture;
let admin: Session;
let devops: Session;
let finance: Session;
let content: Session;
let lan: Session;
let dang: Session;
let K008: string;

class Dev {
  id = '';
  keys!: { publicKey: string; privateKey: string };
  constructor(private kind = 'elevator', private reg: Record<string, unknown> = {}) {}
  nowS = () => Math.floor(rt.clock.now().getTime() / 1000);
  async init(): Promise<this> {
    this.keys = await generateEd25519KeyPair();
    const body = JSON.stringify({ pubkey: this.keys.publicKey, kind: this.kind, model: 'RK3568-9x16', os: 'android-11', app_version: '1.0.3', region: 'HN', px_w: 1080, px_h: 1920, orientation: 'portrait', ...this.reg });
    const s = await signRequest(this.keys.privateKey, { method: 'POST', path: '/v1/register', body, ts: this.nowS() });
    const res = await gw.app.request('/v1/register', { method: 'POST', body, headers: s.headers });
    expect(res.status).toBe(201);
    this.id = ((await res.json()) as any).device_id;
    return this;
  }
  async call(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<any> {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const s = await signRequest(this.keys.privateKey, { method, path, ...(body !== undefined ? { body } : {}), deviceId: this.id, ts: this.nowS() });
    const res = await gw.app.request(path, { method, ...(body !== undefined ? { body } : {}), headers: s.headers });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  heartbeat = (extra: Record<string, unknown> = {}) => this.call('POST', '/v1/heartbeat', { state: 1, app_ver: '1.0.3', ...extra });
  manifest = async (): Promise<any> => {
    await rt.kv.incr(MANIFEST_EPOCH_KEY).catch(() => undefined);
    await gw.manifests.invalidate();
    return (await this.call('GET', '/v1/manifest')).body;
  };
  pop = async (creative: string, offset = -1000) => {
    const t = rt.clock.now().getTime() + offset;
    return this.call('POST', '/v1/events', { events: [{ type: 'proof_of_play', event_id: uuidv7(t), ts: new Date(t).toISOString(), creative_id: creative, duration_ms: 15000 }] });
  };
}

const audit = async (action: string) => rt.db.query<{ action: string; diff: string | null; actor_id: string | null }>('SELECT action, diff, actor_id FROM audit_log WHERE action = ? ORDER BY ts, id', [action]);
const venueCounter = { n: 0 };
/** Tao dia diem + 1 man hinh qua API quan tri that (POST /screens); tra {venue, screen}. */
async function makeScreen(type: 'elevator' | 'led', resolution: string, region = 'Hà Nội'): Promise<{ venue: string; screen: string }> {
  const r = await admin.json('POST', '/admin/v1/screens', { name: `Chung cư thử ${++venueCounter.n}`, type, resolution, screens: 1, region, ...(type === 'led' ? { size: '3.2 x 1.6' } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const d = await admin.json('GET', `/admin/v1/screens/${r.body.id}`);
  return { venue: r.body.id, screen: d.body.items[0].id };
}

beforeAll(async () => {
  rt = await createTestRuntime({
    now: NOW,
    dialect: 'sqlite',
    env: { SCRYPT_N: '1024', MEDIA_PUBLIC_URL: 'https://media.test', HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000' },
  });
  const s = await seed(rt, { log: false, passwordParams: { N: 1024 }, deviceCount: 5 });
  await rt.db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('allow_unscanned_creatives', '1', NULL, ?)", [NOW]);
  const app = createApp(rt);
  const creds = new Map(s.credentials.map((c) => [c.email, c]));
  env = {
    rt,
    app,
    seed: s,
    cred: (email) => {
      const c = creds.get(email)!;
      return { password: c.password!, totpSecret: c.totpSecret!, role: c.role };
    },
    byRole: (role, nth = 0) => s.credentials.filter((c) => c.role === role && c.status === 'active')[nth]!.email,
  };
  gw = createGateway(rt);
  // Thay cho ingest-consumer (api khong phu thuoc goi nay): ghi proof_of_play y nhu consumer.ts ingestPops (giu nguyen `source` cua gateway)
  rt.queue.subscribe('ingest.events', async (m: any) => {
    if (m.pops?.length) await rt.events.append('proof_of_play', m.pops.map((p: any) => ({ event_id: p.event_id, ts: p.ts, screen_id: p.screen_id, creative_id: p.creative_id, duration_ms: p.duration_ms, source: p.source ?? m.device_id })));
  });
  fx = await seedAdFixture(rt, { campaigns: 1, creativesPerCampaign: 1, targetType: 'elevator', px: { w: 1080, h: 1920 }, regions: null });
  K008 = s.customers['K008']!;
  admin = await login(env, env.byRole('super_admin'));
  devops = await login(env, env.byRole('device_ops'));
  finance = await login(env, env.byRole('finance'));
  content = await login(env, env.byRole('content_manager'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
}, 120_000);
afterAll(async () => rt.close());

describe('1. cap quyen thiet bi thang may/LED (khong dung ma 6 so)', () => {
  let d: Dev;
  it('thiet bi tu dang ky hien o danh sach "cho cap quyen": device_id, model, thoi diem dang ky, app_version, nhom manifest', async () => {
    d = await new Dev().init();
    await d.heartbeat({ source: 'ams', cache_mb: 120 });
    await gw.flush();
    const r = await devops.json('GET', '/admin/v1/devices?filter=kind:elevator,status:awaiting_approval&page_size=50');
    expect(r.status).toBe(200);
    const x = r.body.items.find((i: any) => i.id === d.id);
    expect(x).toMatchObject({ kind: 'elevator', model: 'RK3568-9x16', app_version: '1.0.3', trust_level: 0, grant_state: 'awaiting', pairing_state: 'awaiting_approval', model_class: 'elevator_1080x1920', px_w: 1080, px_h: 1920, orientation: 'portrait', play_source: 'ams', cache_mb: 120, screen: null });
    expect(x.paired_at).toBeNull();
    expect(Date.parse(x.reported_at)).toBeGreaterThan(0);
    // TV cho ma KHONG nam trong danh sach cho cap quyen; thang may KHONG nam trong "cho ghep ma"
    const tv = await new Dev('tv', { px_w: undefined, px_h: undefined, orientation: undefined }).init();
    expect((await devops.json('GET', '/admin/v1/devices?filter=status:awaiting_approval&page_size=200')).body.items.some((i: any) => i.id === tv.id)).toBe(false);
    const unpaired = (await devops.json('GET', '/admin/v1/devices?filter=status:unpaired&page_size=200')).body.items.map((i: any) => i.id);
    expect(unpaired).toContain(tv.id);
    expect(unpaired).not.toContain(d.id);
    expect((await devops.json('GET', '/admin/v1/devices?filter=kind:signage&page_size=200')).body.items.some((i: any) => i.id === d.id)).toBe(true);
  });

  it('quyen o may chu: device_ops (khong co devices:approve), finance, content_manager, khach, thieu CSRF -> 403; chua dang nhap -> 401', async () => {
    const url = `/admin/v1/devices/${d.id}/approve`;
    for (const s of [devops, finance, content, lan, dang]) expect((await s.json('POST', url, {})).status).toBe(403);
    expect((await admin.req('POST', url, {}, { csrf: null })).status).toBe(403);
    expect((await env.app.request(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(401);
    expect((await admin.json('GET', `/admin/v1/devices/${d.id}`)).body.trust_level).toBe(0); // chua bi doi
    expect((await audit('device.approve')).length).toBe(0);
  });

  it('khong ap cho TV (409 use_pairing_code), thiet bi khong ton tai (404), body la (422), thiet bi bi chan (409)', async () => {
    const tv = await new Dev('tv').init();
    expect((await admin.json('POST', `/admin/v1/devices/${tv.id}/approve`, {})).body.error.code).toBe('use_pairing_code');
    expect((await admin.json('POST', '/admin/v1/devices/khong-co/approve', {})).status).toBe(404);
    expect((await admin.json('POST', `/admin/v1/devices/${d.id}/approve`, { trust_level: 2 })).status).toBe(422);
    const blk = await new Dev().init();
    await rt.db.run('UPDATE devices SET blocked = 1 WHERE id = ?', [blk.id]);
    expect((await admin.json('POST', `/admin/v1/devices/${blk.id}/approve`, {})).body.error.code).toBe('device_blocked');
  });

  it('chon man hinh: sai loai (LED vs thang may) 422; khong co 404; venue sai 422; da gan thiet bi khac 409; khong doi trust khi loi', async () => {
    const led = await makeScreen('led', '640×320');
    const el = await makeScreen('elevator', '1080×1920');
    const other = await makeScreen('elevator', '1080×1920');
    const url = `/admin/v1/devices/${d.id}/approve`;
    expect((await admin.json('POST', url, { screen_id: led.screen })).body.error.code).toBe('screen_kind_mismatch');
    expect((await admin.json('POST', url, { screen_id: 'khong-co' })).status).toBe(404);
    expect((await admin.json('POST', url, { screen_id: el.screen, venue_id: other.venue })).body.error.code).toBe('screen_venue_mismatch');
    const busy = await new Dev().init();
    await admin.json('POST', `/admin/v1/devices/${busy.id}/approve`, { screen_id: other.screen });
    const taken = await admin.json('POST', url, { screen_id: other.screen });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('screen_taken');
    expect((await admin.json('GET', `/admin/v1/devices/${d.id}`)).body.trust_level).toBe(0);
  });

  it('cap quyen + gan screen/venue: trust 1, vung theo dia diem, audit, nhom manifest theo man hinh; lenh duoc nhan; gateway thay ngay', async () => {
    const sc = await makeScreen('elevator', '768×1366', 'TP.HCM');
    const before = await d.heartbeat();
    expect(before.body.manifest_group).toBe('HN.all.elevator_1080x1920'); // theo do phan giai thiet bi tu khai
    // chua cap quyen: gui lenh bi tu choi
    expect((await admin.json('POST', `/admin/v1/devices/${d.id}/commands`, { type: 'refresh_manifest' })).body.error.code).toBe('device_not_approved');
    const r = await admin.json('POST', `/admin/v1/devices/${d.id}/approve`, { screen_id: sc.screen, venue_id: sc.venue, name: 'Thang máy A1' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ id: d.id, name: 'Thang máy A1', trust_level: 1, grant_state: 'granted', pairing_state: 'approved', model_class: 'elevator_768x1366', region_id: 'HCM' });
    expect(r.body.screen).toMatchObject({ id: sc.screen, venue_id: sc.venue });
    expect(r.body.approved_at).toBeTruthy();
    expect((await rt.db.query<any>('SELECT device_id FROM screens WHERE id = ?', [sc.screen]))[0].device_id).toBe(d.id);
    const a = await audit('device.approve');
    expect(a.length).toBe(2); // 'busy' o test truoc + thiet bi nay
    expect(JSON.parse(a[1]!.diff!)).toMatchObject({ kind: 'elevator', previous_trust: 0, trust_level: 1, screen_id: sc.screen, venue_id: sc.venue });
    const after = await d.heartbeat(); // khong can xoa cache thu cong: API xoa kv dev:<id>
    await gw.devices.invalidate(d.id); // bo nho tung instance (<=30 giay) – test chay mot instance
    const after2 = await d.heartbeat();
    expect(after2.body.manifest_group).toBe('HCM.all.elevator_768x1366');
    expect(after.status).toBe(200);
    expect((await admin.json('POST', `/admin/v1/devices/${d.id}/commands`, { type: 'refresh_manifest' })).status).toBe(201);
    // cap quyen lai (idempotent) khong doi trust, ghi audit them
    expect((await admin.json('POST', `/admin/v1/devices/${d.id}/approve`, { screen_id: sc.screen })).status).toBe(200);
  });

  it('quyen KHONG hard-code vai tro: cap devices:approve cho device_ops qua admin_permissions thi duyet duoc; thu hoi thi mat', async () => {
    const t = await new Dev().init();
    const opsId = (await rt.db.query<{ id: string }>("SELECT id FROM admins WHERE email = ?", [env.byRole('device_ops')]))[0]!.id;
    expect((await devops.json('POST', `/admin/v1/devices/${t.id}/approve`, {})).status).toBe(403);
    await rt.db.run('INSERT INTO admin_permissions (admin_id, module, action, allowed, updated_by, updated_at) VALUES (?,?,?,?,NULL,?)', [opsId, 'devices', 'approve', 1, NOW]);
    expect((await devops.json('POST', `/admin/v1/devices/${t.id}/approve`, {})).status).toBe(200);
    await rt.db.run('UPDATE admin_permissions SET allowed = 0 WHERE admin_id = ? AND module = ? AND action = ?', [opsId, 'devices', 'approve']);
    const t2 = await new Dev().init();
    expect((await devops.json('POST', `/admin/v1/devices/${t2.id}/approve`, {})).status).toBe(403);
    await rt.db.run('DELETE FROM admin_permissions WHERE admin_id = ?', [opsId]);
  });

  it('chan roi bo chan KHONG tu len trust 1 voi thang may/LED (phai cap quyen lai); thu hoi cap quyen: trust 0 + go man hinh + audit', async () => {
    const t = await new Dev().init();
    const sc = await makeScreen('elevator', '1080×1920');
    await admin.json('POST', `/admin/v1/devices/${t.id}/approve`, { screen_id: sc.screen });
    await admin.json('POST', '/admin/v1/devices/bulk', { action: 'block', ids: [t.id] });
    expect((await rt.db.query<any>('SELECT approved_at FROM device_profiles WHERE device_id = ?', [t.id]))[0].approved_at).toBeNull();
    await admin.json('POST', '/admin/v1/devices/bulk', { action: 'unblock', ids: [t.id] });
    expect((await admin.json('GET', `/admin/v1/devices/${t.id}`)).body).toMatchObject({ trust_level: 0, grant_state: 'awaiting' });
    // TV: bo chan van len 1 nhu cu
    const tv = await new Dev('tv').init();
    await admin.json('POST', '/admin/v1/devices/bulk', { action: 'unblock', ids: [tv.id] });
    expect((await admin.json('GET', `/admin/v1/devices/${tv.id}`)).body.trust_level).toBe(1);
    // thu hoi
    await admin.json('POST', `/admin/v1/devices/${t.id}/approve`, { screen_id: sc.screen });
    expect((await devops.json('POST', `/admin/v1/devices/${t.id}/revoke-approval`, {})).status).toBe(403);
    const rv = await admin.json('POST', `/admin/v1/devices/${t.id}/revoke-approval`, {});
    expect(rv.status).toBe(200);
    expect(rv.body).toMatchObject({ trust_level: 0, grant_state: 'awaiting', screen: null });
    expect((await rt.db.query<any>('SELECT device_id FROM screens WHERE id = ?', [sc.screen]))[0].device_id).toBeNull();
    expect((await audit('device.revoke_approval')).length).toBe(1);
    expect((await admin.json('POST', `/admin/v1/devices/${tv.id}/revoke-approval`, {})).body.error.code).toBe('use_pairing_code');
  });
});

describe('2 + 9. lenh reset_pin / set_volume / set_orientation / message', () => {
  let a: Dev;
  let b: Dev;
  let tv: Dev;
  const url = (id: string, more = '') => `/admin/v1/devices/${id}/commands${more}`;
  beforeAll(async () => {
    a = await new Dev().init();
    b = await new Dev().init();
    for (const x of [a, b]) await admin.json('POST', `/admin/v1/devices/${x.id}/approve`, {});
    tv = await new Dev('tv').init();
    await admin.json('POST', '/admin/v1/devices/bulk', { action: 'unblock', ids: [tv.id] });
    for (const x of [a, b, tv]) await gw.devices.invalidate(x.id);
  });

  it('reset_pin: TTL ngan mac dinh 15 phut, toi da 1 gio; id on dinh; audit; idempotency_key tra lai lenh cu', async () => {
    const k = 'reset-pin-khoa-0001';
    const r = await devops.json('POST', url(a.id), { type: 'reset_pin', idempotency_key: k });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ type: 'reset_pin', state: 'pending', replayed: false, args: null });
    expect(Date.parse(r.body.expires_at) - Date.parse(r.body.created_at)).toBe(900_000);
    const again = await devops.json('POST', url(a.id), { type: 'reset_pin', idempotency_key: k });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: r.body.id, replayed: true });
    expect((await audit('device.command.enqueue')).filter((x) => JSON.parse(x.diff!).type === 'reset_pin').length).toBe(1);
    expect((await devops.json('POST', url(b.id), { type: 'reset_pin', ttl_s: 3601 })).body.error.code).toBe('command_ttl_too_long');
    expect((await devops.json('POST', url(b.id), { type: 'reset_pin', ttl_s: 3600 })).status).toBe(201);
    expect((await devops.json('POST', url(b.id), { type: 'reset_pin', args: { pin: '0000' } })).body.error.code).toBe('command_args_invalid'); // khong cho gui PIN
    // heartbeat nhan lenh voi CUNG id, giao lai sau 120 giay van cung id, ack -> acked
    const h1 = await a.heartbeat();
    const c1 = h1.body.commands.find((c: any) => c.type === 'reset_pin');
    expect(c1.id).toBe(r.body.id);
    rt.clock.advance(125_000);
    const h2 = await a.heartbeat();
    expect(h2.body.commands.find((c: any) => c.type === 'reset_pin').id).toBe(r.body.id);
    const ack = await a.call('POST', '/v1/commands/ack', { acks: [{ id: r.body.id, status: 'ok' }] });
    expect(ack.body).toMatchObject({ acked: 1 });
    expect((await devops.json('GET', url(a.id, `/${r.body.id}`))).body.state).toBe('acked');
  });

  it('reset_pin het han sau TTL: khong con duoc giao, sweeper chuyen expired; thiet bi chua cap quyen khong nhan lenh', async () => {
    const c = await new Dev().init();
    expect((await admin.json('POST', url(c.id), { type: 'reset_pin' })).body.error.code).toBe('device_not_approved');
    await admin.json('POST', `/admin/v1/devices/${c.id}/approve`, {});
    await gw.devices.invalidate(c.id);
    const r = await admin.json('POST', url(c.id), { type: 'reset_pin' });
    expect(r.status).toBe(201);
    rt.clock.advance(16 * 60_000); // qua TTL 15 phut
    expect((await c.heartbeat()).body.commands).toEqual([]);
    await gw.sweep();
    expect((await admin.json('GET', url(c.id, `/${r.body.id}`))).body.state).toBe('expired');
  });

  it('set_volume 0-100, set_orientation landscape|portrait, message <= 200 ky tu (+ duration_s tuy chon): kiem tra tham so', async () => {
    const post = (t: string, args: unknown, dev = a) => devops.json('POST', url(dev.id), { type: t, args });
    expect((await post('set_volume', { percent: 0 })).status).toBe(201);
    expect((await post('set_volume', { percent: 100 })).status).toBe(201);
    for (const bad of [{ percent: -1 }, { percent: 101 }, { percent: 50.5 }, { percent: '50' }, {}, { percent: 50, x: 1 }]) expect((await post('set_volume', bad)).body.error.code, JSON.stringify(bad)).toBe('command_args_invalid');
    expect((await post('set_orientation', { orientation: 'portrait' })).status).toBe(201);
    expect((await post('set_orientation', { orientation: 'landscape' })).status).toBe(201);
    for (const bad of [{ orientation: 'diagonal' }, {}, { orientation: 90 }]) expect((await post('set_orientation', bad)).status, JSON.stringify(bad)).toBe(422);
    const ok = await post('message', { text: 'Bảo trì thang máy 14:00', duration_s: 20 });
    expect(ok.status).toBe(201);
    expect(ok.body.args).toEqual({ text: 'Bảo trì thang máy 14:00', duration_s: 20 });
    expect((await post('message', { text: 'x'.repeat(200) })).status).toBe(201);
    expect((await post('message', { text: 'x'.repeat(201) })).status).toBe(422);
    expect((await post('message', { text: '   ' })).status).toBe(422);
    expect((await post('message', { text: 'ok', duration_s: 2 })).status).toBe(422);
    expect((await post('message', { text: 'ok', duration_s: 121 })).status).toBe(422);
    expect((await post('message', { text: 'ok', seconds: 10 })).status).toBe(422); // tham so cua TV khong ap cho thang may
    // heartbeat giao day du args
    const hb = await a.heartbeat();
    expect(hb.body.commands.filter((c: any) => c.type === 'set_volume').map((c: any) => c.args.percent).sort()).toEqual([0, 100]);
  });

  it('loai lenh theo loai thiet bi: TV khong nhan reset_pin/set_volume; thang may khong nhan lock/pause; danh muc theo thiet bi', async () => {
    for (const t of ['reset_pin', 'set_orientation']) expect((await admin.json('POST', url(tv.id), { type: t, args: t === 'set_volume' ? { percent: 5 } : t === 'set_orientation' ? { orientation: 'portrait' } : {} })).body.error.code, t).toBe('command_not_for_kind');
    expect((await admin.json('POST', url(a.id), { type: 'lock' })).body.error.code).toBe('command_not_for_kind');
    const typesA = (await admin.json('GET', url(a.id))).body.types.map((t: any) => t.type);
    const typesTv = (await admin.json('GET', url(tv.id))).body.types.map((t: any) => t.type);
    expect(typesA).toEqual(expect.arrayContaining(['reset_pin', 'set_volume', 'set_orientation', 'message', 'refresh_manifest', 'reboot']));
    expect(typesA).not.toContain('lock');
    expect(typesTv).not.toContain('reset_pin');
    expect(typesTv).toEqual(expect.arrayContaining(['lock', 'message']));
    // TV: lenh message cu (seconds) van chay
    expect((await admin.json('POST', url(tv.id), { type: 'message', args: { text: 'Xin chào', seconds: 20 } })).status).toBe(201);
  });

  it('quyen + IDOR: finance/content/khach khong tao lenh; content_manager xem duoc; lenh cua thiet bi A khong doc/huy duoc qua duong dan thiet bi B', async () => {
    for (const s of [finance, content, lan, dang]) expect((await s.json('POST', url(a.id), { type: 'reset_pin' })).status).toBe(403);
    expect((await lan.json('GET', url(a.id))).status).toBe(403);
    expect((await content.json('GET', url(a.id))).status).toBe(200);
    const r = await admin.json('POST', url(a.id), { type: 'set_volume', args: { percent: 40 } });
    expect((await admin.json('GET', url(b.id, `/${r.body.id}`))).status).toBe(404);
    expect((await admin.json('POST', url(b.id, `/${r.body.id}/cancel`), {})).status).toBe(404);
    expect((await admin.json('POST', url('khong-co'), { type: 'reset_pin' })).status).toBe(404);
    expect((await admin.json('GET', url(a.id, `/${r.body.id}`))).body.state).toBe('pending');
  });
});

describe('5-8, 10. cau hinh header/footer/hotline/fit/thoi luong anh + cap nhat app', () => {
  const put = (s: Session, kind: string, body: unknown) => s.json('PUT', `/admin/v1/screens/signage-config/${kind}`, body);
  const sha = 'b'.repeat(64);
  it('doc mac dinh; ghi (screens:write) + audit; gateway: heartbeat va manifest phan anh', async () => {
    const g = await devops.json('GET', '/admin/v1/screens/signage-config');
    expect(g.status).toBe(200);
    expect(g.body.kinds.elevator).toMatchObject({ header: '', footer: '', hotline: '', fit: 'fit', image_duration_s: 10, app_update_url: '' }); // mac dinh tu 20/11/2026: vua khung
    expect((await finance.json('GET', '/admin/v1/screens/signage-config')).status).toBe(403);
    expect((await lan.json('GET', '/admin/v1/screens/signage-config')).status).toBe(403);
    const r = await devops.json('PUT', '/admin/v1/screens/signage-config/elevator', { header: '  ANIO TV  ', footer: 'Liên hệ 0900 123 456', hotline: '0900 123 456 · Zalo', fit: 'cover', image_duration_s: 12 }); // chon thu cong cover theo loai man
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.config).toMatchObject({ header: 'ANIO TV', fit: 'cover', image_duration_s: 12 });
    const a = await audit('signage.config');
    expect(a.length).toBe(1);
    expect(a[0]!.actor_id).toBeTruthy();
    const d = await new Dev().init();
    await gw.manifests.invalidate();
    const hb = await d.heartbeat();
    expect(hb.body.hotline).toBe('0900 123 456 · Zalo');
    const m = await d.manifest();
    expect(m).toMatchObject({ header: 'ANIO TV', footer: 'Liên hệ 0900 123 456', hotline: '0900 123 456 · Zalo', rotation: { mode: 'sequential' } });
    expect(m.creatives[0].fit).toBe('cover');
    // LED khong bi anh huong (cau hinh rieng theo loai)
    const led = await new Dev('led_p5', { px_w: 640, px_h: 320 }).init();
    expect((await led.heartbeat()).body.hotline).toBeUndefined();
  });

  it('kiem tra gia tri: header/footer/hotline dai, ky tu dieu khien, fit la, thoi luong ngoai 3-120, truong la, kind la', async () => {
    for (const bad of [{ header: 'x'.repeat(121) }, { footer: 'x'.repeat(201) }, { hotline: 'x'.repeat(61) }, { header: 'a\u0007b' }, { fit: 'stretch' }, { image_duration_s: 2 }, { image_duration_s: 121 }, { image_duration_s: 10.5 }, { zzz: 1 }, { header: 5 }]) {
      const r = await put(admin, 'elevator', bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    expect((await put(admin, 'tv', {})).status).toBe(404);
    expect((await put(admin, 'elevator', { header: 'x'.repeat(120), footer: 'y'.repeat(200), hotline: 'z'.repeat(60), image_duration_s: 3 })).status).toBe(200);
    expect((await put(admin, 'elevator', { image_duration_s: 120 })).status).toBe(200);
  });

  it('cap nhat app tu xa: https + sha256 64 hex di cung nhau, cam tai khoan/query; doi truong nay can devices:approve; khong luu bi mat', async () => {
    for (const bad of [
      { app_update_url: 'http://cdn.anio.vn/a.apk', app_update_sha256: sha },
      { app_update_url: 'https://cdn.anio.vn/a.apk?token=abc', app_update_sha256: sha },
      { app_update_url: 'https://user:pw@cdn.anio.vn/a.apk', app_update_sha256: sha },
      { app_update_url: 'https://localhost/a.apk', app_update_sha256: sha },
      { app_update_url: 'ftp://cdn.anio.vn/a.apk', app_update_sha256: sha },
      { app_update_url: 'https://cdn.anio.vn/a.apk' },
      { app_update_sha256: sha },
      { app_update_url: 'https://cdn.anio.vn/a.apk', app_update_sha256: 'g'.repeat(64) },
      { app_update_url: 'https://cdn.anio.vn/a.apk', app_update_sha256: 'a'.repeat(63) },
      { min_app_version: 'moi nhat' },
    ]) {
      const r = await put(admin, 'elevator', bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    const body = { image_duration_s: 10, min_app_version: '1.2.0', app_update_url: 'https://cdn.anio.vn/signage-1.2.0.apk', app_update_sha256: sha.toUpperCase() };
    const denied = await put(devops, 'elevator', body); // device_ops: screens:write nhung KHONG co devices:approve
    expect(denied.status).toBe(403);
    expect(denied.body.error.details).toMatchObject({ module: 'devices', action: 'approve' });
    expect((await put(content, 'elevator', body)).status).toBe(403);
    const ok = await put(admin, 'elevator', body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.config).toMatchObject({ min_app_version: '1.2.0', app_update_sha256: sha }); // chuan hoa chu thuong
    const d = await new Dev().init();
    await gw.manifests.invalidate();
    expect((await d.heartbeat()).body).toMatchObject({ min_app_version: '1.2.0', app_update_url: body.app_update_url, app_update_sha256: sha });
    // device_ops van sua duoc chu hien thi khi KHONG dong den cac truong cap nhat app (giu nguyen gia tri)
    expect((await put(devops, 'elevator', { ...body, app_update_sha256: sha, header: 'Mới' })).status).toBe(200);
    // dung URL (va nhat ky audit) khong chua token/mat khau
    expect(JSON.stringify(await audit('signage.config'))).not.toMatch(/token|pw@/);
    // xoa: dat chuoi rong cung can quyen approve
    expect((await put(devops, 'elevator', { header: 'Mới' })).status).toBe(403);
    expect((await put(admin, 'elevator', {})).status).toBe(200);
  });

  it('lich phat: chu header/footer ghi de theo slot (schedule:write), chi thang may/LED; null bo ghi de; audit; manifest', async () => {
    const slot = fx.campaigns[0]!.slotId;
    const tvFx = await seedAdFixture(rt, { campaigns: 1, targetType: 'tv' });
    const r = await content.json('PUT', `/admin/v1/schedule/${slot}/text`, { header: 'Khuyến mãi tháng 11', footer: '' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ header: 'Khuyến mãi tháng 11', footer: '' });
    const d = await new Dev().init();
    expect((await d.manifest()).schedule.find((s: any) => s.slot_id === slot)).toMatchObject({ header: 'Khuyến mãi tháng 11', footer: '' });
    expect((await audit('schedule.text')).length).toBe(1);
    expect((await content.json('PUT', `/admin/v1/schedule/${tvFx.campaigns[0]!.slotId}/text`, { header: 'x' })).body.error.code).toBe('slot_not_signage');
    for (const s of [devops, finance, lan]) expect((await s.json('PUT', `/admin/v1/schedule/${slot}/text`, { header: 'x' })).status).toBe(403);
    expect((await content.json('PUT', `/admin/v1/schedule/${slot}/text`, { header: 'x'.repeat(121) })).status).toBe(422);
    expect((await content.json('PUT', '/admin/v1/schedule/khong-co/text', { header: 'x' })).status).toBe(404);
    expect((await content.json('PUT', `/admin/v1/schedule/${slot}/text`, { header: null, footer: null })).body).toMatchObject({ header: null, footer: null });
    expect((await d.manifest()).schedule.find((s: any) => s.slot_id === slot).header).toBeUndefined();
  });
});

describe('11. nhat ky thiet bi tren admin (7 ngay, phan trang, devices:view)', () => {
  let d: Dev;
  let other: Dev;
  beforeAll(async () => {
    d = await new Dev().init();
    other = await new Dev().init();
    const now = rt.clock.now().getTime();
    const mk = (dev: string, ageH: number, level: string, tag: string | null, msg: string) =>
      rt.db.run('INSERT INTO device_logs (id, device_id, ts, received_at, level, tag, message) VALUES (?,?,?,?,?,?,?)', [rt.id(), dev, new Date(now - ageH * 3600_000).toISOString(), new Date(now - ageH * 3600_000).toISOString(), level, tag, msg]);
    for (let i = 0; i < 25; i++) await mk(d.id, i + 1, i % 5 === 0 ? 'error' : 'info', i % 5 === 0 ? 'play_error' : 'net', `dong ${i}`);
    await mk(d.id, 24 * 8, 'info', null, 'qua 7 ngay');
    await mk(other.id, 1, 'info', null, 'cua thiet bi khac');
  });
  it('xem nhat ky (moi nhat truoc), phan trang, loc muc/tag, tim chu; khong co dong qua 7 ngay va khong lan sang thiet bi khac', async () => {
    const p1 = await content.json('GET', `/admin/v1/devices/${d.id}/logs?page_size=10`); // content_manager co devices:view
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ total: 25, page: 1, page_size: 10, retention_days: 7 });
    expect(p1.body.items.map((x: any) => x.message)).toEqual(Array.from({ length: 10 }, (_, i) => `dong ${i}`));
    const p3 = await content.json('GET', `/admin/v1/devices/${d.id}/logs?page_size=10&page=3`);
    expect(p3.body.items.length).toBe(5);
    expect(JSON.stringify(p1.body) + JSON.stringify(p3.body)).not.toMatch(/qua 7 ngay|cua thiet bi khac/);
    expect((await admin.json('GET', `/admin/v1/devices/${d.id}/logs?filter=level:error&page_size=50`)).body.total).toBe(5);
    expect((await admin.json('GET', `/admin/v1/devices/${d.id}/logs?q=dong%2012`)).body.items.map((x: any) => x.message)).toEqual(['dong 12']);
  });
  it('quyen/IDOR: khach + chua dang nhap bi chan; thiet bi khong ton tai 404; log cua thiet bi khac chi xem duoc dung duong dan cua no', async () => {
    expect((await lan.json('GET', `/admin/v1/devices/${d.id}/logs`)).status).toBe(403);
    expect((await finance.json('GET', `/admin/v1/devices/${d.id}/logs`)).status).toBe(403);
    expect((await env.app.request(`/admin/v1/devices/${d.id}/logs`)).status).toBe(401);
    expect((await admin.json('GET', '/admin/v1/devices/khong-co/logs')).status).toBe(404);
    expect((await admin.json('GET', `/admin/v1/devices/${other.id}/logs`)).body.items.map((x: any) => x.message)).toEqual(['cua thiet bi khac']);
  });
});

describe('3. hieu luc proof_of_play thang may/LED', () => {
  it('chua cap quyen: luu pending_trust (khong mat), noi bo thay; KHACH khong tinh; cap quyen => hop le (tinh lai); thu hoi => dong da ghi voi source=device van hop le, dong pending quay lai cho', async () => {
    const d = await new Dev().init();
    const cr = fx.campaigns[0]!.creatives[0]!.id;
    expect((await d.pop(cr, -3000)).body).toMatchObject({ accepted: 1, valid: 0, flagged: 1 });
    await rt.queue.drain();
    const mine = async (s: Session, status = '') => (await s.json('GET', `/admin/v1/history/proof-of-play?page_size=200&filter=screen_id:${d.id}${status}`)).body;
    let b = await mine(admin);
    expect(b.items.map((x: any) => [x.source, x.status])).toEqual([['pending_trust', 'pending_trust']]);
    expect((await mine(admin, ',status:valid')).total).toBe(0);
    expect((await mine(admin, ',status:pending_trust')).total).toBe(1);
    // khach hang so huu creative CHI thay dong hop le
    await rt.db.run('UPDATE creatives SET customer_id = ? WHERE id = ?', [K008, cr]);
    const portal = async () => (await dang.json('GET', '/portal/v1/history/proof-of-play?page_size=200')).body;
    expect((await portal()).items.filter((x: any) => x.duration_ms === 15000).length).toBe(0);
    // cap quyen -> dong cu tinh lai thanh hop le (khong can gui lai)
    expect((await admin.json('POST', `/admin/v1/devices/${d.id}/approve`, {})).status).toBe(200);
    await gw.devices.invalidate(d.id);
    b = await mine(admin);
    expect(b.items.map((x: any) => x.status)).toEqual(['valid']);
    expect((await portal()).items.filter((x: any) => x.duration_ms === 15000).length).toBe(1);
    expect((await portal()).items.every((x: any) => x.status === undefined && x.screen_id === undefined)).toBe(true);
    // gui them khi da cap quyen: hop le ngay
    expect((await d.pop(cr, -2000)).body).toMatchObject({ valid: 1, flagged: 0 });
    await rt.queue.drain();
    expect((await mine(admin)).items.map((x: any) => x.status)).toEqual(['valid', 'valid']);
    // thu hoi: dong da luu voi source=device giu nguyen (hop le); dong pending_trust (ca dong cu lan dong moi) tro lai cho cap quyen
    await admin.json('POST', `/admin/v1/devices/${d.id}/revoke-approval`, {});
    await gw.devices.invalidate(d.id);
    expect((await d.pop(cr, -1000)).body).toMatchObject({ valid: 0, flagged: 1 });
    await rt.queue.drain();
    expect((await mine(admin)).items.map((x: any) => x.status).sort()).toEqual(['pending_trust', 'pending_trust', 'valid']);
    await rt.db.run('UPDATE creatives SET customer_id = ? WHERE id = ?', [fx.customerId, cr]);
  });
  it('thiet bi bi chan khong duoc tinh la hop le du dong cu la pending_trust', async () => {
    const d = await new Dev().init();
    const cr = fx.campaigns[0]!.creatives[0]!.id;
    await d.pop(cr, -2500);
    await rt.queue.drain();
    await rt.db.run('UPDATE devices SET trust_level = 1, blocked = 1 WHERE id = ?', [d.id]);
    const r = (await admin.json('GET', `/admin/v1/history/proof-of-play?filter=screen_id:${d.id}`)).body;
    expect(r.items.map((x: any) => x.status)).toEqual(['pending_trust']);
  });
});
