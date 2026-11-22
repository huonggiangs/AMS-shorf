// d-tree: cay nhom thiet bi, dia diem, gan hang loat, am luong tu xa (set_volume qua heartbeat polling), heartbeat.volume, quyen + IDOR + audit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { createGateway, type Gateway } from '@ams/edge-gateway';
import { generateEd25519KeyPair, signRequest } from '@ams/edge-gateway/testing';
import { createApp } from '../src/app.js';
import { login, NOW, type Env, type Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let rt: TestRuntime;
let env: Env;
let gw: Gateway;
let admin: Session;
let devops: Session;
let finance: Session;
let lan: Session;

class Dev {
  id = '';
  keys!: { publicKey: string; privateKey: string };
  constructor(private kind = 'elevator') {}
  nowS = () => Math.floor(rt.clock.now().getTime() / 1000);
  async init(): Promise<this> {
    this.keys = await generateEd25519KeyPair();
    const body = JSON.stringify({ pubkey: this.keys.publicKey, kind: this.kind, model: 'RK3568', os: 'android-11', app_version: '1.0.3', region: 'HN', px_w: 1080, px_h: 1920, orientation: 'portrait' });
    const s = await signRequest(this.keys.privateKey, { method: 'POST', path: '/v1/register', body, ts: this.nowS() });
    const res = await gw.app.request('/v1/register', { method: 'POST', body, headers: s.headers });
    expect(res.status).toBe(201);
    this.id = ((await res.json()) as any).device_id;
    return this;
  }
  async call(path: string, payload: unknown): Promise<any> {
    const body = JSON.stringify(payload);
    const s = await signRequest(this.keys.privateKey, { method: 'POST', path, body, deviceId: this.id, ts: this.nowS() });
    const res = await gw.app.request(path, { method: 'POST', body, headers: s.headers });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  heartbeat = (extra: Record<string, unknown> = {}) => this.call('/v1/heartbeat', { state: 1, app_ver: '1.0.3', ...extra });
}
const approve = async (d: Dev) => expect((await admin.json('POST', `/admin/v1/devices/${d.id}/approve`, {})).status).toBe(200);
const audit = async (action: string) => rt.db.query<{ diff: string | null }>('SELECT diff FROM audit_log WHERE action = ? ORDER BY ts, id', [action]);

beforeAll(async () => {
  rt = await createTestRuntime({ now: NOW, dialect: 'sqlite', env: { SCRYPT_N: '1024', HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000' } });
  const s = await seed(rt, { log: false, passwordParams: { N: 1024 }, deviceCount: 5 });
  const creds = new Map(s.credentials.map((c) => [c.email, c]));
  env = {
    rt,
    app: createApp(rt),
    seed: s,
    cred: (email) => { const c = creds.get(email)!; return { password: c.password!, totpSecret: c.totpSecret!, role: c.role }; },
    byRole: (role, nth = 0) => s.credentials.filter((c) => c.role === role && c.status === 'active')[nth]!.email,
  };
  gw = createGateway(rt);
  admin = await login(env, env.byRole('super_admin'));
  devops = await login(env, env.byRole('device_ops'));
  finance = await login(env, env.byRole('finance'));
  lan = await login(env, 'lan@vinamilk.example');
}, 120_000);
afterAll(async () => rt.close());

let north = '', hanoi = '', south = '';
describe('1. cay nhom', () => {
  it('tao nhom long nhau, cung ten cung cha 409, qua sau 422, cha khong ton tai 404; audit', async () => {
    const a = await devops.json('POST', '/admin/v1/device-groups', { name: 'Miền Bắc' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    north = a.body.id;
    hanoi = (await devops.json('POST', '/admin/v1/device-groups', { name: 'Hà Nội', parent_id: north })).body.id;
    south = (await devops.json('POST', '/admin/v1/device-groups', { name: 'Miền Nam' })).body.id;
    expect((await devops.json('POST', '/admin/v1/device-groups', { name: 'miền bắc' })).body.error.code).toBe('group_name_taken');
    expect((await devops.json('POST', '/admin/v1/device-groups', { name: 'X', parent_id: 'khong-co' })).status).toBe(404);
    expect((await devops.json('POST', '/admin/v1/device-groups', { name: '   ' })).status).toBe(422);
    let p = hanoi;
    let last = 200;
    for (let i = 0; i < 6; i++) { const r = await devops.json('POST', '/admin/v1/device-groups', { name: `c${i}`, parent_id: p }); last = r.status; if (r.status === 201) p = r.body.id; }
    expect(last).toBe(422); // vuot MAX_GROUP_DEPTH
    expect((await audit('device_group.create')).length).toBeGreaterThanOrEqual(3);
  });

  it('gan thiet bi hang loat, dem cong don len cha, "chua xep nhom"', async () => {
    const ds = await new Dev().init(), d2 = await new Dev().init(), d3 = await new Dev().init();
    await ds.heartbeat();
    await gw.flush();
    expect((await devops.json('PUT', '/admin/v1/device-groups/assign', { device_ids: [ds.id, d2.id], group_id: hanoi })).body.updated).toBe(2);
    expect((await devops.json('PUT', '/admin/v1/device-groups/assign', { device_ids: [d3.id], group_id: north })).status).toBe(200);
    const t = (await devops.json('GET', '/admin/v1/device-groups')).body;
    const g = (id: string) => t.items.find((x: any) => x.id === id);
    expect(g(hanoi)).toMatchObject({ direct_count: 2, device_count: 2, path: 'Miền Bắc › Hà Nội' });
    expect(g(north)).toMatchObject({ direct_count: 1, device_count: 3 }); // cong don
    expect(g(south).device_count).toBe(0);
    expect(t.unassigned).toBe(t.total - 3);
    // loc theo nhom cha gom ca nhom con; include_children=0 chi nhom do
    expect((await devops.json('GET', `/admin/v1/device-groups/devices?group_id=${north}&page_size=50`)).body.total).toBe(3);
    expect((await devops.json('GET', `/admin/v1/device-groups/devices?group_id=${north}&include_children=0`)).body.total).toBe(1);
    expect((await devops.json('GET', '/admin/v1/device-groups/devices?group_id=none&page_size=200')).body.total).toBe(t.unassigned);
    // tim theo ten/id, loc online/offline
    expect((await devops.json('GET', `/admin/v1/device-groups/devices?q=${ds.id}`)).body.items.map((i: any) => i.id)).toEqual([ds.id]);
    const off = (await devops.json('GET', `/admin/v1/device-groups/devices?group_id=${north}&filter=status:offline`)).body;
    const on = (await devops.json('GET', `/admin/v1/device-groups/devices?group_id=${north}&filter=status:online`)).body;
    expect(off.total + on.total).toBe(3);
    expect((await devops.json('PUT', '/admin/v1/device-groups/assign', { device_ids: [ds.id, 'khong-co'], group_id: hanoi })).body.error.code).toBe('device_not_found');
    expect((await devops.json('PUT', '/admin/v1/device-groups/assign', { device_ids: [ds.id], group_id: 'khong-co' })).status).toBe(404);
    expect((await devops.json('PUT', '/admin/v1/device-groups/assign', { device_ids: [], group_id: hanoi })).status).toBe(422);
  });

  it('doi ten / chuyen nhom: chan chu trinh, trung ten; xoa nhom don con + thiet bi len cha', async () => {
    expect((await devops.json('PATCH', `/admin/v1/device-groups/${north}`, { parent_id: hanoi })).body.error.code).toBe('group_cycle');
    expect((await devops.json('PATCH', `/admin/v1/device-groups/${north}`, { parent_id: north })).body.error.code).toBe('group_cycle');
    expect((await devops.json('PATCH', `/admin/v1/device-groups/${south}`, { name: 'Miền Bắc' })).body.error.code).toBe('group_name_taken');
    expect((await devops.json('PATCH', `/admin/v1/device-groups/${south}`, { name: 'Miền Nam 2' })).status).toBe(200);
    const mv = await devops.json('PATCH', `/admin/v1/device-groups/${hanoi}`, { parent_id: south });
    expect(mv.status).toBe(200);
    expect((await devops.json('GET', '/admin/v1/device-groups')).body.items.find((x: any) => x.id === hanoi).path).toBe('Miền Nam 2 › Hà Nội');
    const del = await devops.json('DELETE', `/admin/v1/device-groups/${south}`);
    expect(del.body).toMatchObject({ deleted: true, moved_to: null, children_moved: 1, devices_moved: 0 });
    const t = (await devops.json('GET', '/admin/v1/device-groups')).body;
    expect(t.items.some((x: any) => x.id === south)).toBe(false);
    expect(t.items.find((x: any) => x.id === hanoi)).toMatchObject({ parent_id: null, device_count: 2 }); // con len goc, thiet bi giu nguyen
    const del2 = await devops.json('DELETE', `/admin/v1/device-groups/${hanoi}`);
    expect(del2.body).toMatchObject({ devices_moved: 2, moved_to: null });
    expect((await devops.json('GET', '/admin/v1/device-groups/devices?group_id=none&page_size=200')).body.items.length).toBeGreaterThanOrEqual(2);
    expect((await devops.json('DELETE', `/admin/v1/device-groups/${hanoi}`)).status).toBe(404);
    expect((await audit('device_group.delete')).length).toBe(2);
  });

  it('quyen: finance/khach/chua dang nhap/thieu CSRF bi tu choi', async () => {
    expect((await finance.json('GET', '/admin/v1/device-groups')).status).toBe(403);
    expect((await finance.json('POST', '/admin/v1/device-groups', { name: 'Z' })).status).toBe(403);
    expect((await lan.json('GET', '/admin/v1/device-groups')).status).toBe(403);
    expect((await lan.json('GET', '/admin/v1/locations')).status).toBe(403);
    expect((await admin.req('POST', '/admin/v1/device-groups', { name: 'Z' }, { csrf: null })).status).toBe(403);
    expect((await env.app.request('/admin/v1/device-groups')).status).toBe(401);
  });
});

describe('2. dia diem', () => {
  let loc = '', loc2 = '';
  it('them/sua dia diem, kiem tra toa do, loai dia diem, SDT; danh sach loc + tim', async () => {
    const a = await devops.json('POST', '/admin/v1/locations', { name: 'Siêu thị Co.opmart Q1', address: '1 Nguyễn Huệ', province: 'TP.HCM', district: 'Quận 1', lat: 10.77, lng: 106.7, venue_type: 'supermarket', contact_name: 'Anh Nam', contact_phone: '0901 234 567' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    loc = a.body.id;
    loc2 = (await devops.json('POST', '/admin/v1/locations', { name: 'Sân bay Nội Bài', province: 'Hà Nội', venue_type: 'airport' })).body.id;
    expect((await devops.json('POST', '/admin/v1/locations', { name: 'X', lat: 100, lng: 0 })).status).toBe(422);
    expect((await devops.json('POST', '/admin/v1/locations', { name: 'X', lat: 10 })).status).toBe(422); // thieu lng
    expect((await devops.json('POST', '/admin/v1/locations', { name: 'X', venue_type: 'moon' })).status).toBe(422);
    expect((await devops.json('POST', '/admin/v1/locations', { name: 'X', contact_phone: '<script>' })).status).toBe(422);
    const p = await devops.json('PATCH', `/admin/v1/locations/${loc}`, { notes: 'Tầng hầm B1', venue_type: 'fnb' });
    expect(p.body).toMatchObject({ notes: 'Tầng hầm B1', venue_type: 'fnb', name: 'Siêu thị Co.opmart Q1', lat: 10.77 });
    expect((await devops.json('PATCH', `/admin/v1/locations/${loc}`, { id: 'x' })).status).toBe(422);
    expect((await devops.json('PATCH', '/admin/v1/locations/khong-co', { notes: 'a' })).status).toBe(404);
    const l = (await devops.json('GET', '/admin/v1/locations?q=nội bài')).body;
    expect(l.items.map((i: any) => i.id)).toEqual([loc2]);
    expect((await devops.json('GET', '/admin/v1/locations?filter=venue_type:fnb')).body.items.map((i: any) => i.id)).toEqual([loc]);
    expect((await audit('location.create')).length).toBe(2);
    expect((await audit('location.update')).length).toBe(1);
  });

  it('gan thiet bi vao dia diem, sua MAC/serial (chuan hoa, trung 409), xoa bi chan neu con thiet bi', async () => {
    const d = await new Dev().init(), e = await new Dev().init();
    expect((await devops.json('PUT', '/admin/v1/locations/assign', { device_ids: [d.id, e.id], location_id: loc })).body.updated).toBe(2);
    expect((await devops.json('GET', '/admin/v1/locations/' + loc)).body.device_count).toBe(2);
    const row = (await devops.json('GET', `/admin/v1/device-groups/devices?location_id=${loc}`)).body;
    expect(row.total).toBe(2);
    expect(row.items[0]).toMatchObject({ location_name: 'Siêu thị Co.opmart Q1', location_address: '1 Nguyễn Huệ' });
    const m = await devops.json('PATCH', `/admin/v1/device-groups/devices/${d.id}`, { mac: 'aa-bb-cc-dd-ee-01', serial: 'SN-001', name: 'Màn hình sảnh' });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect(m.body).toMatchObject({ mac: 'AA:BB:CC:DD:EE:01', serial: 'SN-001', name: 'Màn hình sảnh' });
    expect((await devops.json('PATCH', `/admin/v1/device-groups/devices/${e.id}`, { mac: 'AA:BB:CC:DD:EE:01' })).body.error.code).toBe('mac_taken');
    expect((await devops.json('PATCH', `/admin/v1/device-groups/devices/${e.id}`, { mac: 'xyz' })).body.error.code).toBe('mac_invalid');
    expect((await devops.json('PATCH', '/admin/v1/device-groups/devices/khong-co', { serial: 'a' })).status).toBe(404);
    expect((await devops.json('PATCH', `/admin/v1/device-groups/devices/${e.id}`, { location_id: 'khong-co' })).status).toBe(404);
    expect((await devops.json('GET', '/admin/v1/device-groups/devices?q=AA:BB:CC:DD:EE:01')).body.items.map((i: any) => i.id)).toEqual([d.id]);
    // xoa: bi chan
    const blocked = await devops.json('DELETE', `/admin/v1/locations/${loc}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('location_has_devices');
    expect((await devops.json('DELETE', `/admin/v1/locations/${loc}?move_to=${loc}`)).status).toBe(422);
    const ok = await devops.json('DELETE', `/admin/v1/locations/${loc}?move_to=${loc2}`);
    expect(ok.body).toMatchObject({ deleted: true, devices_moved: 2, moved_to: loc2 });
    expect((await devops.json('GET', '/admin/v1/locations/' + loc2)).body.device_count).toBe(2);
    expect((await devops.json('GET', '/admin/v1/locations/' + loc)).status).toBe(404);
    expect((await devops.json('DELETE', `/admin/v1/locations/${loc2}?move_to=none`)).body.devices_moved).toBe(2);
    expect((await devops.json('GET', `/admin/v1/device-groups/devices?location_id=none&page_size=200`)).body.items.some((i: any) => i.id === d.id)).toBe(true);
    expect((await audit('location.delete')).length).toBe(2);
    expect((await audit('device.placement')).length).toBeGreaterThanOrEqual(1);
  });
});

describe('3. am luong tu xa', () => {
  it('set_volume cho moi loai man (TV + thang may), kiem tra tham so; heartbeat bao volume -> UI thay am luong thuc; ack -> acked', async () => {
    const d = await new Dev().init();
    await approve(d);
    const url = `/admin/v1/devices/${d.id}/commands`;
    for (const bad of [{ percent: 101 }, { percent: -1 }, { percent: 1.5 }, {}]) expect((await admin.json('POST', url, { type: 'set_volume', args: bad })).body.error.code).toBe('command_args_invalid');
    const g = (await devops.json('POST', '/admin/v1/device-groups', { name: 'Vol' })).body.id;
    await devops.json('PUT', '/admin/v1/device-groups/assign', { device_ids: [d.id], group_id: g });
    const cmd = await devops.json('POST', url, { type: 'set_volume', args: { percent: 35 } });
    expect(cmd.status, JSON.stringify(cmd.body)).toBe(201);
    let row = (await devops.json('GET', `/admin/v1/device-groups/devices?group_id=${g}`)).body.items[0];
    expect(row.volume_cmd).toMatchObject({ state: 'pending', percent: 35 });
    expect(row.volume).toBeNull(); // chua bao cao
    const hb = await d.heartbeat({ volume: 20 });
    expect(hb.status, JSON.stringify(hb.body)).toBe(200);
    expect(hb.body.commands.find((c: any) => c.type === 'set_volume').args).toEqual({ percent: 35 });
    row = (await devops.json('GET', `/admin/v1/device-groups/devices?group_id=${g}`)).body.items[0];
    expect(row.volume_cmd.state).toBe('delivered');
    await gw.flush();
    expect((await devops.json('GET', `/admin/v1/device-groups/devices?group_id=${g}`)).body.items[0].volume).toBe(20); // am luong THUC thiet bi bao
    const ack = await d.call('/v1/commands/ack', { acks: [{ id: cmd.body.id, status: 'ok' }] });
    expect(ack.status).toBe(200);
    await d.heartbeat({ volume: 35 });
    await gw.flush();
    row = (await devops.json('GET', `/admin/v1/device-groups/devices?group_id=${g}`)).body.items[0];
    expect(row).toMatchObject({ volume: 35, controllable: true });
    expect(row.volume_cmd.state).toBe('acked');
    // heartbeat cu (khong co volume) van hop le; volume ngoai 0-100 bi tu choi
    expect((await d.heartbeat()).status).toBe(200);
    expect((await d.heartbeat({ volume: 101 })).status).toBe(422);
    expect((await d.heartbeat({ volume: 12.5 })).status).toBe(422);
  });

  it('dat am luong hang loat cho nhom (kem nhom con): thiet bi chua cap quyen bi bo qua va liet ke; audit nhom + tung lenh', async () => {
    const g = (await devops.json('POST', '/admin/v1/device-groups', { name: 'Bulk' })).body.id;
    const sub = (await devops.json('POST', '/admin/v1/device-groups', { name: 'Con', parent_id: g })).body.id;
    const a = await new Dev().init(), b = await new Dev().init(), c = await new Dev().init();
    await approve(a); await approve(b); // c chua cap quyen
    await devops.json('PUT', '/admin/v1/device-groups/assign', { device_ids: [a.id], group_id: g });
    await devops.json('PUT', '/admin/v1/device-groups/assign', { device_ids: [b.id, c.id], group_id: sub });
    expect((await devops.json('POST', `/admin/v1/device-groups/${g}/volume`, { percent: 150 })).status).toBe(422);
    const r = await devops.json('POST', `/admin/v1/device-groups/${g}/volume`, { percent: 60 });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body.queued).toBe(2);
    expect(r.body.skipped).toEqual([{ device_id: c.id, reason: 'device_not_approved' }]);
    expect(r.body.delivery.realtime).toBe(false);
    const ha = await a.heartbeat();
    expect(ha.body.commands.map((x: any) => `${x.type}:${x.args.percent}`)).toEqual(['set_volume:60']);
    const only = await devops.json('POST', `/admin/v1/device-groups/${g}/volume`, { percent: 10, include_children: false });
    expect(only.body.queued).toBe(1);
    expect((await audit('device_group.set_volume')).length).toBe(2);
    const empty = (await devops.json('POST', '/admin/v1/device-groups', { name: 'Rong' })).body.id;
    expect((await devops.json('POST', `/admin/v1/device-groups/${empty}/volume`, { percent: 10 })).body.error.code).toBe('group_empty');
    expect((await finance.json('POST', `/admin/v1/device-groups/${g}/volume`, { percent: 10 })).status).toBe(403);
    expect((await devops.json('POST', '/admin/v1/device-groups/khong-co/volume', { percent: 10 })).status).toBe(404);
  });
});
