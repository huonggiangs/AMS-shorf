// w-dev: TV Brain-rot <-> AMS end-to-end tren runtime that (gateway + API cung mot CSDL): dang ky -> cho ghep -> nhap ma -> trust 1 ->
// lenh (idempotent, ACL, huy, ACK) -> kid_safe/lock co xac nhan nguoi duyet gan phien ban noi dung -> manifest -> impression hop le.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { createGateway, type Gateway } from '@ams/edge-gateway';
import { generateEd25519KeyPair, seedAdFixture, signRequest, type AdFixture } from '@ams/edge-gateway/testing';
import type { Manifest } from '@ams/edge-gateway/protocol';
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
let lan: Session;

/** Nhap ma qua API quan tri, roi xoa bo nho dem thiet bi cua gateway (production: <=30 giay) de test khong cho. */
async function pairVia(s: Session, tv: { id: string; code: () => Promise<string> }, owner?: string): Promise<void> {
  const r = await s.json('POST', '/admin/v1/devices/pair', { code: await tv.code(), ...(owner ? { owner_name: owner } : {}) });
  expect(r.status).toBe(200);
  await gw.devices.invalidate(tv.id);
}

class Tv {
  id = '';
  keys!: { publicKey: string; privateKey: string };
  constructor(private region = 'HN') {}
  nowS = () => Math.floor(rt.clock.now().getTime() / 1000);
  async init(): Promise<this> {
    this.keys = await generateEd25519KeyPair();
    const body = JSON.stringify({ pubkey: this.keys.publicKey, kind: 'tv', model: 'BRAVIA 4K', os: 'android-tv-12', app_version: '1.0.102', region: this.region });
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
  heartbeat = (extra: Record<string, unknown> = {}) => this.call('POST', '/v1/heartbeat', { state: 0, app_ver: '1.0.102', ...extra });
  code = async (): Promise<string> => (await this.call('POST', '/v1/pair', {})).body.code;
  manifest = async (): Promise<Manifest> => {
    await rt.kv.incr(MANIFEST_EPOCH_KEY).catch(() => undefined); // nhu bumpManifest cua API
    await gw.manifests.invalidate();
    return (await this.call('GET', '/v1/manifest')).body as Manifest;
  };
}

beforeAll(async () => {
  rt = await createTestRuntime({
    now: NOW,
    dialect: 'sqlite',
    env: { SCRYPT_N: '1024', MEDIA_PUBLIC_URL: 'https://media.test', HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000', IMPRESSION_MAX_PER_DEVICE_HOUR: '1000000', IMPRESSION_PRICE_MICRO_VND: '20500000', HB_PAIRED_S: '60' },
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
  fx = await seedAdFixture(rt, { campaigns: 1, creativesPerCampaign: 1 });
  admin = await login(env, env.byRole('super_admin'));
  devops = await login(env, env.byRole('device_ops'));
  finance = await login(env, env.byRole('finance'));
  lan = await login(env, 'lan@vinamilk.example');
}, 120_000);
afterAll(async () => rt.close());

const audit = async (prefix: string) => (await rt.db.query<{ action: string; diff: string | null }>('SELECT action, diff FROM audit_log WHERE action LIKE ?', [`${prefix}%`]));

describe('ghep ma tren web (Devices)', () => {
  let tv: Tv;
  let code: string;
  it('TV dang ky -> hien o admin la "cho ghep" (pending, trust 0), co model/phien ban/khu vuc', async () => {
    tv = await new Tv().init();
    code = await tv.code();
    expect(code).toMatch(/^\d{6}$/);
    await tv.heartbeat();
    await gw.flush(); // gateway ghi last_seen theo lo (khong moi heartbeat mot lan ghi)
    const r = await devops.json('GET', '/admin/v1/devices?filter=status:unpaired&page_size=50');
    expect(r.status).toBe(200);
    const d = r.body.items.find((x: any) => x.id === tv.id);
    expect(d).toMatchObject({ pairing_state: 'pending', trust_level: 0, model: 'BRAVIA 4K', app_version: '1.0.102', paired_at: null });
    expect(d.last_seen_at).toBeTruthy();
  });
  it('ma sai -> 404 pair_code_not_found (+ audit pair_failed, khong ghi ma); dinh dang sai -> 422; finance/khach khong ghep duoc', async () => {
    const wrong = code === '000000' ? '000001' : '000000';
    const r = await devops.json('POST', '/admin/v1/devices/pair', { code: wrong });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('pair_code_not_found');
    expect((await devops.json('POST', '/admin/v1/devices/pair', { code: '12ab' })).status).toBe(422);
    expect((await finance.json('POST', '/admin/v1/devices/pair', { code })).status).toBe(403);
    expect((await lan.json('POST', '/admin/v1/devices/pair', { code })).status).toBe(403);
    const a = await audit('device.pair_failed');
    expect(a.length).toBe(1);
    expect(JSON.stringify(a)).not.toContain(wrong);
    expect((await devops.json('GET', `/admin/v1/devices/${tv.id}`)).body.trust_level).toBe(0); // chua bi doi
  });
  it('nhap sai qua 10 lan/10 phut -> 429 pair_locked', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await admin.json('POST', '/admin/v1/devices/pair', { code: '999999' })).status;
    expect(last).toBe(429);
    const r = await admin.json('POST', '/admin/v1/devices/pair', { code: '999999' });
    expect(r.body.error.code).toBe('pair_locked');
    rt.clock.advance(11 * 60_000); // sang cua so moi (ma cu cung het han)
    code = await tv.code();
  });
  it('ma dung + ten chu -> trust 1 (KHONG phai 2), co chu so huu; dung lai ma -> 409; gan lai chu', async () => {
    const r = await devops.json('POST', '/admin/v1/devices/pair', { code, owner_name: 'Khách sạn Hoa Sen' });
    expect(r.status).toBe(200);
    await gw.devices.invalidate(tv.id);
    expect(r.body).toMatchObject({ device_id: tv.id, paired: true, trust_level: 1 });
    const d = (await devops.json('GET', `/admin/v1/devices/${tv.id}`)).body;
    expect(d).toMatchObject({ pairing_state: 'paired', trust_level: 1, owner_name: 'Khách sạn Hoa Sen' });
    expect(d.paired_at).toBeTruthy();
    expect((await devops.json('POST', '/admin/v1/devices/pair', { code })).body.error.code).toBe('pair_code_used');
    expect((await devops.json('PUT', `/admin/v1/devices/${tv.id}/owner`, { owner_name: 'Nhà trọ Mai' })).status).toBe(200);
    expect((await devops.json('GET', `/admin/v1/devices/${tv.id}`)).body.owner_name).toBe('Nhà trọ Mai');
    expect((await audit('device.pair')).some((x) => x.action === 'device.pair')).toBe(true);
    expect((await audit('device.owner_assign')).length).toBe(1);
  });
  it('ma het han -> 422 pair_code_expired; thiet bi bi chan -> 409; chua ghep thi khong gan chu', async () => {
    const t2 = await new Tv().init();
    const c2 = await t2.code();
    expect((await devops.json('PUT', `/admin/v1/devices/${t2.id}/owner`, { owner_name: 'X' })).status).toBe(409);
    rt.clock.advance(6 * 60_000);
    expect((await devops.json('POST', '/admin/v1/devices/pair', { code: c2 })).body.error.code).toBe('pair_code_expired');
    const c3 = await t2.code();
    await rt.db.run('UPDATE devices SET blocked = 1 WHERE id = ?', [t2.id]);
    const r = await devops.json('POST', '/admin/v1/devices/pair', { code: c3 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('device_blocked');
  });
});

describe('lenh thiet bi (admin -> heartbeat -> ACK)', () => {
  let tv: Tv;
  let other: Tv;
  beforeAll(async () => {
    tv = await new Tv().init();
    other = await new Tv().init();
    for (const t of [tv, other]) await pairVia(devops, t);
  });
  const url = (id: string, more = '') => `/admin/v1/devices/${id}/commands${more}`;

  it('thiet bi chua ghep -> 409 device_not_paired; loai la / tham so sai -> 422', async () => {
    const fresh = await new Tv().init();
    expect((await devops.json('POST', url(fresh.id), { type: 'lock' })).body.error.code).toBe('device_not_paired');
    expect((await devops.json('POST', url(tv.id), { type: 'format-disk' })).body.error.code).toBe('command_type_unsupported');
    expect((await devops.json('POST', url(tv.id), { type: 'message', args: { text: '' } })).body.error.code).toBe('command_args_invalid');
    expect((await devops.json('POST', url(tv.id), { type: 'message', args: { text: 'x', extra: 1 } })).status).toBe(422);
    expect((await devops.json('POST', url(tv.id), { type: 'lock', ttl_s: 5 })).status).toBe(422);
    expect((await devops.json('POST', url('khong-co'), { type: 'lock' })).status).toBe(404);
  });
  it('quyen: finance/khach khong tao/xem lenh; idempotency: gui lai cung khoa tra lenh cu, khac loai -> 409', async () => {
    expect((await finance.json('POST', url(tv.id), { type: 'lock' })).status).toBe(403);
    expect((await lan.json('GET', url(tv.id))).status).toBe(403);
    const k = 'khoa-chong-trung-001';
    const a = await devops.json('POST', url(tv.id), { type: 'message', args: { text: 'Đến giờ nghỉ mắt', seconds: 20 }, ttl_s: 600, idempotency_key: k });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ type: 'message', state: 'pending', replayed: false, args: { text: 'Đến giờ nghỉ mắt', seconds: 20 } });
    const b = await devops.json('POST', url(tv.id), { type: 'message', args: { seconds: 20, text: 'Đến giờ nghỉ mắt' }, idempotency_key: k });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ id: a.body.id, replayed: true });
    expect((await devops.json('POST', url(tv.id), { type: 'lock', idempotency_key: k })).body.error.code).toBe('idempotency_conflict');
    expect((await audit('device.command.enqueue')).length).toBe(1); // replay khong ghi audit them
  });
  it('heartbeat giao lenh (delivered) -> ACK qua /v1/commands/ack -> acked; dong thoi gian day du; heartbeat rut ngan cho thiet bi da ghep', async () => {
    const list0 = (await devops.json('GET', url(tv.id))).body;
    expect(list0.delivery).toMatchObject({ mode: 'heartbeat_polling', realtime: false, paired_cap_s: 60 });
    expect(list0.delivery.note).toMatch(/KHÔNG/);
    const lockR = await devops.json('POST', url(tv.id), { type: 'lock', args: { reason: 'Hết giờ xem' } });
    expect(lockR.status).toBe(201);
    const hb = await tv.heartbeat();
    expect(hb.status).toBe(200);
    expect(hb.body.next_interval).toBeLessThanOrEqual(72); // 60 giay +20% jitter (rut ngan nho HB_PAIRED_S)
    const got = hb.body.commands.map((c: any) => c.type).sort();
    expect(got).toEqual(['lock', 'message']);
    expect((await devops.json('GET', url(tv.id, `/${lockR.body.id}`))).body.state).toBe('delivered');
    rt.clock.advance(30_000);
    const ack = await tv.call('POST', '/v1/commands/ack', { acks: [{ id: lockR.body.id, status: 'ok', result: 'locked' }, { id: list0.items[0]?.id ?? lockR.body.id, status: 'ok' }] });
    expect(ack.status).toBe(200);
    const one = (await devops.json('GET', url(tv.id, `/${lockR.body.id}`))).body;
    expect(one).toMatchObject({ state: 'acked', result: 'locked' });
    expect(one.timeline.map((e: any) => e.event)).toEqual(['created', 'delivered', 'acked']);
    expect(one.created_by).toBeTruthy();
  });
  it('ACK that bai -> failed; huy lenh cho: khong bao gio duoc giao; huy lenh da acked -> 409; ACL theo thiet bi (IDOR): lenh cua may A khong huy/doc qua duong may B', async () => {
    const f = (await devops.json('POST', url(tv.id), { type: 'reboot' })).body;
    await tv.heartbeat();
    await tv.call('POST', '/v1/commands/ack', { acks: [{ id: f.id, status: 'failed', result: 'khong ho tro' }] });
    expect((await devops.json('GET', url(tv.id, `/${f.id}`))).body).toMatchObject({ state: 'failed', result: 'khong ho tro' });
    const c = (await devops.json('POST', url(tv.id), { type: 'unlock' })).body;
    // IDOR: dung id lenh cua tv qua duong dan thiet bi khac
    expect((await devops.json('POST', url(other.id, `/${c.id}/cancel`))).status).toBe(404);
    expect((await devops.json('GET', url(other.id, `/${c.id}`))).status).toBe(404);
    const cancelled = await devops.json('POST', url(tv.id, `/${c.id}/cancel`));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.state).toBe('cancelled');
    expect((await tv.heartbeat()).body.commands).toEqual([]); // huy => khong giao
    expect((await devops.json('POST', url(tv.id, `/${c.id}/cancel`))).body.error.code).toBe('command_not_cancellable');
    expect((await devops.json('POST', url(tv.id, `/${f.id}/cancel`))).status).toBe(409);
    expect((await audit('device.command.cancel')).length).toBe(1);
    const list = (await devops.json('GET', url(tv.id))).body.items;
    expect(list.map((x: any) => x.state)).toContain('cancelled');
    expect(list.every((x: any) => x.device_id === tv.id)).toBe(true);
  });
  it('lenh het han (TTL) khong con duoc giao va hien expired; han muc 20 lenh/10 phut/thiet bi -> 429', async () => {
    const e = (await devops.json('POST', url(other.id), { type: 'refresh_manifest', ttl_s: 60 })).body;
    rt.clock.advance(61_000);
    expect((await other.heartbeat()).body.commands).toEqual([]);
    expect((await devops.json('GET', url(other.id, `/${e.id}`))).body.state).toBe('expired');
    let last = 201;
    for (let i = 0; i < 25 && last === 201; i++) last = (await devops.json('POST', url(other.id), { type: 'set_monitor', args: { on: true } })).status;
    expect(last).toBe(429);
  });
});

describe('kid_safe/lock co xac nhan nguoi duyet -> manifest -> impression', () => {
  let tv: Tv;
  let cid: string;
  const put = (body: unknown) => admin.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, body);
  beforeAll(async () => {
    cid = fx.campaigns[0]!.creatives[0]!.id;
    await rt.db.run("UPDATE creatives SET kind = 'image', px_w = 1920, px_h = 1080, size_bytes = 1000000, format = 'fullscreen', overlay = NULL WHERE id = ?", [cid]);
    tv = await new Tv().init();
    await pairVia(devops, tv, 'Phòng 101');
  });
  const reattest = async () => { // cam ket phap ly gan voi content_version: sua noi dung => ky lai
    const v = (await rt.db.query<{ content_version: number }>('SELECT content_version FROM creative_security WHERE creative_id = ?', [cid]))[0]?.content_version ?? 1;
    await rt.db.run("INSERT INTO creative_attestations (id, creative_id, content_version, version, kid_safe, signed_by, signed_by_name, signed_at, source) VALUES (?,?,?,'legal-v1',1,'test','Người ký thử',?,'approve')", [rt.id(), cid, v, NOW]);
  };
  const lockOf = async () => (await tv.manifest()).creatives.find((c) => c.id === cid)?.overlay;

  it('TV chua co kid_safe: manifest co creative, KHONG co lock; dat kid_safe thieu xac nhan -> 422; nguoi khong co quyen duyet -> 403', async () => {
    const o = await lockOf();
    expect(o?.contexts ?? []).not.toContain('lock');
    const noConfirm = await put({ kid_safe: true, contexts: ['lock', 'fullscreen'] });
    expect(noConfirm.status).toBe(422);
    expect(noConfirm.body.error.code === 'reviewer_confirmation_required' || noConfirm.body.error.code === 'lock_ads_disabled').toBe(true);
    expect((await devops.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { kid_safe: true, confirm_reviewed: true, note: 'ok ok' })).status).toBe(403);
  });
  it('man khoa TAT (mac dinh) -> khong the dat lock; bat man khoa (can xac nhan phap ly) roi dat kid_safe co xac nhan + ghi chu -> manifest co lock', async () => {
    expect((await put({ kid_safe: true, contexts: ['lock', 'fullscreen'], confirm_reviewed: true, note: 'da xem' })).body.error.code).toBe('lock_ads_disabled');
    const s = await admin.json('GET', '/admin/v1/tv-experience');
    expect((await admin.json('PUT', '/admin/v1/tv-experience/settings', { ...s.body.settings, lock_ads_enabled: true, confirm_children_policy: true })).status).toBe(200);
    expect((await put({ kid_safe: true, contexts: ['lock', 'fullscreen'], confirm_reviewed: true })).body.error.code).toBe('reviewer_confirmation_required'); // thieu ghi chu
    const ok = await put({ kid_safe: true, contexts: ['lock', 'fullscreen'], confirm_reviewed: true, note: 'Đã xem toàn bộ nội dung, phù hợp trẻ em' });
    expect(ok.status).toBe(200);
    await reattest();
    expect(ok.body).toMatchObject({ kid_safe: true, lock_eligible: true, kid_review: { current: true } });
    expect(await lockOf()).toMatchObject({ kid_safe: true, contexts: ['lock', 'fullscreen'] });
    const a = await audit('tv.kid_safe.approve');
    expect(JSON.stringify(a)).toContain('reviewer_confirmed');
  });
  it('khach doi noi dung (content_version tang) -> xac nhan het hieu luc: manifest bo lock/kid_safe cho toi khi nguoi duyet xac nhan lai', async () => {
    await rt.db.run("INSERT INTO creative_security (creative_id, content_version, updated_at) VALUES (?, 2, ?) ON CONFLICT (creative_id) DO UPDATE SET content_version = creative_security.content_version + 1", [cid, NOW]);
    // (noi dung doi => creative con phai duoc duyet lai media: gia lap duyet lai de chi con thieu xac nhan kid_safe)
    expect(await lockOf()).toBeUndefined(); // chua duyet lai noi dung => ra khoi manifest hoan toan
    await rt.db.run('UPDATE creative_security SET approved_version = content_version WHERE creative_id = ?', [cid]);
    expect(await lockOf()).toBeUndefined(); // duyet lai nhung CHUA ky lai cam ket => van khong phat
    await reattest();
    const o = await lockOf();
    expect(o?.contexts).toEqual(['fullscreen']);
    expect(o?.kid_safe).not.toBe(true);
    const list = (await admin.json('GET', '/admin/v1/tv-experience/creatives?page_size=50')).body.items.find((x: any) => x.id === cid);
    expect(list).toMatchObject({ kid_safe: true, lock_eligible: false, kid_review: { current: false } });
    // sua thoi luong ma khong xac nhan lai van khong khoi phuc lock
    await put({ duration_s: 20 });
    await reattest();
    expect((await lockOf())?.contexts).not.toContain('lock');
    expect((await put({ kid_safe: true, confirm_reviewed: true, note: 'Đã xem lại bản mới' })).status).toBe(200);
    await reattest();
    expect(await lockOf()).toMatchObject({ kid_safe: true, contexts: expect.arrayContaining(['lock']) });
  });
  it('impression hop le tu TV da ghep (trust 1) -> 202 valid=1; TV chua ghep -> flagged', async () => {
    const c = fx.campaigns[0]!;
    const t = rt.clock.now().getTime() - 5000;
    const ev = (id: string) => ({ type: 'impression', event_id: uuidv7(t + Math.floor(Math.random() * 500)), ts: new Date(t).toISOString(), campaign_id: id, creative_id: cid, slot_id: c.slotId, vcr_pct: 100, played_ms: 20000 });
    const ok = await tv.call('POST', '/v1/events', { events: [ev(c.id)] });
    expect(ok.status).toBe(202);
    expect(ok.body).toMatchObject({ accepted: 1, valid: 1, flagged: 0 });
    const un = await new Tv().init();
    const r = await un.call('POST', '/v1/events', { events: [ev(c.id)] });
    expect(r.body).toMatchObject({ accepted: 1, valid: 0, flagged: 1 });
  });
});
