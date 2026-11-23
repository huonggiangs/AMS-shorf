// vol-fix: duong di DAY DU cua lenh am luong cho MOI loai thiet bi (tv, phone, elevator, led_p5):
// bam thanh truot -> POST /admin/v1/devices/:id/commands -> heartbeat tra set_volume -> ack kem ket qua -> web thay trang thai that.
// Mo phong thiet bi ky Ed25519 that (khong mock gateway). Kiem tra ca huy hieu nang luc (caps), ETA heartbeat va ca truong hop app KHONG ho tro.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { createGateway, redeemPairingCode, type Gateway } from '@ams/edge-gateway';
import { generateEd25519KeyPair, signRequest } from '@ams/edge-gateway/testing';
import { createApp } from '../src/app.js';
import { login, NOW, type Env, type Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let rt: TestRuntime;
let env: Env;
let gw: Gateway;
let admin: Session;

class Dev {
  id = '';
  keys!: { publicKey: string; privateKey: string };
  /** am luong "he thong" cua may mo phong (AudioManager STREAM_MUSIC quy ve %) */
  sysVolume = 20;
  constructor(public kind: string, private caps?: string[]) {}
  nowS = () => Math.floor(rt.clock.now().getTime() / 1000);
  async init(): Promise<this> {
    this.keys = await generateEd25519KeyPair();
    const px = this.kind === 'elevator' || this.kind === 'led_p5' ? { px_w: 1080, px_h: 1920, orientation: 'portrait' } : {};
    const body = JSON.stringify({ pubkey: this.keys.publicKey, kind: this.kind, model: 'Sim', os: 'android-11', app_version: '1.0.0', region: 'HN', ...px, ...(this.caps ? { caps: this.caps } : {}) });
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
  /** mot nhip: gui heartbeat (kem volume + caps neu co), nhan lenh, thuc thi set_volume, ack kem ket qua that */
  async tick(opts: { supportsVolume: boolean; caps?: string[] } = { supportsVolume: true }): Promise<{ commands: any[] }> {
    const hb = await this.call('/v1/heartbeat', { state: 1, app_ver: '1.0.0', volume: this.sysVolume, ...(opts.caps ? { caps: opts.caps } : {}) });
    expect(hb.status, JSON.stringify(hb.body)).toBe(200);
    const acks: any[] = [];
    for (const c of hb.body.commands as any[]) {
      if (c.type === 'set_volume' && opts.supportsVolume) {
        this.sysVolume = Math.round(c.args.percent);
        acks.push({ id: c.id, status: 'ok', result: JSON.stringify({ applied_percent: this.sysVolume, mode: 'system' }) });
      } else acks.push({ id: c.id, status: 'ok' }); // app cu: lenh la bi bo qua nhung van ack (DEVICE-PROTOCOL 6)
    }
    if (acks.length) expect((await this.call('/v1/commands/ack', { acks })).status).toBe(200);
    return { commands: hb.body.commands };
  }
}
const list = async () => (await admin.json('GET', '/admin/v1/device-groups/devices?page_size=200')).body.items as any[];
const row = async (d: Dev) => (await list()).find((x) => x.id === d.id);
// thang may/LED: "Cap quyen" tren web; TV/dien thoai: ghep ma 6 so hien tren man hinh (khong co nut cap quyen)
const approve = async (d: Dev) => {
  if (d.kind === 'elevator' || d.kind === 'led_p5') return expect((await admin.json('POST', `/admin/v1/devices/${d.id}/approve`, {})).status).toBe(200);
  const r = await d.call('/v1/pair', {});
  const uid = rt.id();
  await rt.db.run('INSERT INTO end_users (id, created_at) VALUES (?, ?)', [uid, rt.clock.now().toISOString()]);
  expect((await redeemPairingCode(rt, r.body.code, uid)).ok).toBe(true);
  await gw.devices.invalidate(d.id);
};
const slider = (d: Dev, percent: number) => admin.json('POST', `/admin/v1/devices/${d.id}/commands`, { type: 'set_volume', args: { percent } });

beforeAll(async () => {
  rt = await createTestRuntime({ now: NOW, dialect: 'sqlite', env: { SCRYPT_N: '1024', HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000' } });
  const s = await seed(rt, { log: false, passwordParams: { N: 1024 }, deviceCount: 1 });
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
}, 120_000);
afterAll(async () => rt.close());

describe('am luong: thanh truot -> thiet bi that -> bao cao, MOI loai thiet bi', () => {
  for (const kind of ['tv', 'phone', 'elevator', 'led_p5']) {
    it(`${kind}: heartbeat tra set_volume, ack kem applied_percent, web hien "dang ap dung" + huy hieu ho tro`, async () => {
      const d = await new Dev(kind, ['set_volume', 'reboot']).init();
      await approve(d);
      let r = await row(d);
      expect(r).toMatchObject({ controllable: true, can_set_volume: true, caps: ['reboot', 'set_volume'] }); // app khai caps luc dang ky
      const c = await slider(d, 55);
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      expect((await row(d)).volume_cmd).toMatchObject({ state: 'pending', percent: 55 });
      const t = await d.tick({ supportsVolume: true });
      expect(t.commands.map((x) => `${x.type}:${x.args?.percent}`)).toEqual(['set_volume:55']);
      await gw.flush();
      r = await row(d);
      expect(r.volume_cmd).toMatchObject({ state: 'acked', percent: 55, applied_percent: 55, mode: 'system', deliveries: 1 });
      expect(r.volume).toBe(55);
      // ETA that cua nhip ke tiep (gateway ghi sau moi heartbeat)
      expect(Date.parse(r.next_heartbeat_at)).toBeGreaterThan(Date.parse(r.last_heartbeat_at));
    });
  }

  it('app khai caps o HEARTBEAT (khong phai luc dang ky): huy hieu cap nhat; app khai khong co set_volume -> can_set_volume=false', async () => {
    const d = await new Dev('tv').init();
    await approve(d);
    expect((await row(d)).can_set_volume).toBeNull(); // chua ro: van cho gui
    await d.tick({ supportsVolume: true, caps: ['set_volume'] });
    expect((await row(d)).can_set_volume).toBe(true);
    const old = await new Dev('tv', ['reboot']).init();
    expect((await row(old)).can_set_volume).toBe(false);
    expect((await d.call('/v1/heartbeat', { state: 1, caps: ['Set Volume'] })).status).toBe(422); // ten tinh nang sai dinh dang
  });

  it('app CU khong ho tro: lenh duoc giao, app ack "ok" khong kem ket qua -> web KHONG duoc coi la da ap dung; huy hieu van "chua ro"', async () => {
    const d = await new Dev('tv').init();
    await approve(d);
    const c = await slider(d, 70);
    expect(c.status).toBe(201);
    await d.tick({ supportsVolume: false });
    await gw.flush();
    const r = await row(d);
    expect(r.volume_cmd).toMatchObject({ state: 'acked', percent: 70, applied_percent: null });
    expect(r.can_set_volume).toBeNull();
    expect(r.volume).toBe(20); // am luong that khong doi: thiet bi van bao 20
  });

  it('thiet bi ngoai tuyen: lenh o trang thai pending, deliveries 0 (web hien "chua nhan lenh"); chua cap quyen -> 409', async () => {
    const off = await new Dev('led_p5', ['set_volume']).init();
    expect((await slider(off, 30)).body.error.code).toBe('device_not_approved');
    await approve(off);
    expect((await slider(off, 30)).status).toBe(201);
    const r = await row(off);
    expect(r.volume_cmd).toMatchObject({ state: 'pending', deliveries: 0 });
    expect(r.next_heartbeat_at).toBeNull(); // chua tung heartbeat
    rt.clock.advance(2 * 3600_000); // qua TTL 1 gio
    expect((await row(off)).volume_cmd.state).toBe('expired');
  });

  it('long-poll /v1/commands/wait cung giao set_volume (kenh nhanh cho app moi)', async () => {
    const d = await new Dev('tv', ['set_volume']).init();
    await approve(d);
    await slider(d, 15);
    const s = await signRequest(d.keys.privateKey, { method: 'GET', path: '/v1/commands/wait?timeout=1', deviceId: d.id, ts: d.nowS() });
    const res = await gw.app.request('/v1/commands/wait?timeout=1', { method: 'GET', headers: s.headers });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).commands.map((x: any) => x.type)).toEqual(['set_volume']);
  });
});
