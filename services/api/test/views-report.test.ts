// Luong day du tren runtime that (SQLite): thiet bi ky Ed25519 gui su kien DUNG dinh dang Signage Player (proof_of_play) va Mindo (impression)
// -> gateway -> hang doi -> ingest-consumer THAT -> bang ev_* -> /admin/v1/reports/views, /portal/v1/reports/views (khach), diagnostics, CSV/HTML/PDF.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { createGateway, type Gateway } from '@ams/edge-gateway';
import { createIngestConsumer } from '@ams/ingest-consumer';
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
let lan: Session; // khach K001 (chu chien dich thu)
let dang: Session; // khach K008 (khach khac: khong duoc thay)
let K001: string;
let creativeId: string;
let campaignId: string;

class Dev {
  id = '';
  keys!: { publicKey: string; privateKey: string };
  constructor(private kind = 'elevator') {}
  nowS = () => Math.floor(rt.clock.now().getTime() / 1000);
  async init(): Promise<this> {
    this.keys = await generateEd25519KeyPair();
    const body = JSON.stringify({ pubkey: this.keys.publicKey, kind: this.kind, model: 'RK3568-9x16', os: 'android-11', app_version: '1.0.14', region: 'HN', px_w: 1080, px_h: 1920, orientation: 'portrait' });
    const s = await signRequest(this.keys.privateKey, { method: 'POST', path: '/v1/register', body, ts: this.nowS() });
    const res = await gw.app.request('/v1/register', { method: 'POST', body, headers: s.headers });
    expect(res.status).toBe(201);
    this.id = ((await res.json()) as any).device_id;
    return this;
  }
  async call(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<any> {
    const body = payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload);
    const s = await signRequest(this.keys.privateKey, { method, path, ...(body !== undefined ? { body } : {}), deviceId: this.id, ts: this.nowS() });
    const res = await gw.app.request(path, { method, ...(body !== undefined ? { body } : {}), headers: s.headers });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}

/** DUNG cac khoa JSON ma Signage Player (Sync.kt recordPlay) gui: type, event_id (UUIDv7), ts (ISO UTC mili giay), creative_id, duration_ms. */
const signagePop = (creative: string, ms: number, offsetMs: number): Record<string, unknown> => {
  const t = rt.clock.now().getTime() + offsetMs;
  return { type: 'proof_of_play', event_id: uuidv7(t), ts: new Date(t).toISOString(), creative_id: creative, duration_ms: ms };
};

beforeAll(async () => {
  rt = await createTestRuntime({ now: NOW, dialect: 'sqlite', env: { SCRYPT_N: '1024', MEDIA_PUBLIC_URL: 'https://media.test', HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000' } });
  const s = await seed(rt, { log: false, passwordParams: { N: 1024 }, deviceCount: 3 });
  await rt.db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('allow_unscanned_creatives', '1', NULL, ?)", [NOW]);
  const creds = new Map(s.credentials.map((c) => [c.email, c]));
  env = {
    rt,
    app: createApp(rt),
    seed: s,
    cred: (email) => ({ password: creds.get(email)!.password!, totpSecret: creds.get(email)!.totpSecret!, role: creds.get(email)!.role }),
    byRole: (role, nth = 0) => s.credentials.filter((c) => c.role === role && c.status === 'active')[nth]!.email,
  };
  gw = createGateway(rt);
  createIngestConsumer(rt).subscribe(); // consumer THAT (khong gia lap)
  fx = await seedAdFixture(rt, { campaigns: 1, creativesPerCampaign: 1, targetType: 'elevator', px: { w: 1080, h: 1920 }, regions: null, durationS: 15 });
  K001 = s.customers['K001']!;
  campaignId = fx.campaigns[0]!.id;
  creativeId = fx.campaigns[0]!.creatives[0]!.id;
  // chien dich thu thuoc khach K001 (khach K008 la "khach khac")
  await rt.db.run('UPDATE campaigns SET customer_id = ? WHERE id = ?', [K001, campaignId]);
  await rt.db.run('UPDATE creatives SET customer_id = ? WHERE id = ?', [K001, creativeId]);
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
}, 120_000);
afterAll(async () => rt.close());

describe('luot xem tu thiet bi -> /history, dashboard khach, chan doan', () => {
  let d: Dev;
  const drain = async () => {
    await gw.flush();
    await rt.queue.drain();
  };

  it('thiet bi CHUA cap quyen: luot phat van luu nhung bao cao 0; chan doan noi ro "cho cap quyen"', async () => {
    d = await new Dev().init();
    await rt.kv.incr(MANIFEST_EPOCH_KEY).catch(() => undefined);
    await gw.manifests.invalidate();
    expect((await d.call('POST', '/v1/heartbeat', { state: 1, app_ver: '1.0.14' })).status).toBe(200);
    expect((await d.call('GET', '/v1/manifest')).status).toBe(200);
    const r = await d.call('POST', '/v1/events', { events: [signagePop(creativeId, 15000, -2000), signagePop(creativeId, 15000, -3000)] });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ accepted: 2, valid: 0, flagged: 2, rejected: [] });
    await drain();
    expect(Number((await rt.db.query<any>('SELECT COUNT(*) AS n FROM ev_proof_of_play WHERE device_id = ?', [d.id]))[0].n)).toBe(2); // ghi du device_id/campaign_id
    const rep = await admin.json('GET', '/admin/v1/reports/views');
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    expect(rep.body.totals.views).toBe(0);
    const diag = await admin.json('GET', '/admin/v1/history/diagnostics');
    expect(diag.status).toBe(200);
    const x = diag.body.devices.find((v: any) => v.id === d.id);
    expect(x).toMatchObject({ accepted_24h: 2, valid_24h: 0, code: 'pending_trust', online: true });
    expect(x.explain).toMatch(/cấp quyền/);
    expect(x.flagged_by_reason.pending_trust).toBe(2);
  });

  it('cap quyen -> luot phat cu TU TINH LAI; them luot moi, luot qua ngan (< 0,9 x 15 s) khong tinh; gui lai khong dem 2 lan', async () => {
    const ap = await admin.json('POST', `/admin/v1/devices/${d.id}/approve`, { name: 'Thang máy A1' });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    await gw.devices.invalidate(d.id);
    const fresh = [signagePop(creativeId, 14000, -4000), signagePop(creativeId, 15000, -5000), signagePop(creativeId, 5000, -6000)];
    const r = await d.call('POST', '/v1/events', { events: fresh });
    expect(r.body).toMatchObject({ accepted: 3, valid: 2, flagged: 1, rejected: [] });
    await d.call('POST', '/v1/events', { events: [fresh[0]] }); // gui lai (mat phan hoi): bao cao khong dem 2 lan
    await drain();
    const rep = await admin.json('GET', `/admin/v1/reports/views?campaign_id=${campaignId}`);
    expect(rep.body.totals.views).toBe(4); // 2 cu (tinh lai) + 2 moi hop le
    expect(rep.body.totals.watched_s).toBe(15 + 15 + 14 + 15);
    expect(rep.body.windows).toMatchObject({ today: 4, d7: 4, d30: 4 });
    expect(rep.body.by_day.at(-1)).toMatchObject({ day: '2026-11-12', views: 4 });
    expect(rep.body.by_campaign[0]).toMatchObject({ id: campaignId, views: 4 });
    expect(rep.body.by_creative[0]).toMatchObject({ id: creativeId, views: 4 });
    expect(rep.body.by_device[0]).toMatchObject({ id: d.id, views: 4, name: 'Thang máy A1' });
    const diag = (await admin.json('GET', '/admin/v1/history/diagnostics')).body.devices.find((v: any) => v.id === d.id);
    expect(diag.flagged_by_reason.short_play).toBe(1);
    expect(diag.code).toBe('ok');
    expect(diag.stored_24h).toBe(5);
  });

  it('khach K001 thay dung 4 luot cua minh (khong thay thiet bi), khach khac 0, doi campaign_id cua khach khac -> 404 (IDOR)', async () => {
    const mine = await lan.json('GET', '/portal/v1/reports/views');
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.totals.views).toBe(4);
    expect(mine.body.windows.today).toBe(4);
    expect(mine.body).not.toHaveProperty('by_device');
    expect(JSON.stringify(mine.body)).not.toContain(d.id);
    expect(mine.body.scope.customer.id).toBe(K001);
    const other = await dang.json('GET', '/portal/v1/reports/views');
    expect(other.body.totals.views).toBe(0);
    expect(other.body.by_campaign).toEqual([]);
    expect((await dang.json('GET', `/portal/v1/reports/views?campaign_id=${campaignId}`)).status).toBe(404);
    expect((await dang.req('GET', `/portal/v1/reports/views/export.csv?campaign_id=${campaignId}`)).status).toBe(404);
    // tham so customer_id/device_id cua admin bi bo qua o cong khach
    const sneaky = await dang.json('GET', `/portal/v1/reports/views?customer_id=${K001}&device_id=${d.id}`);
    expect(sneaky.body.totals.views).toBe(0);
    // admin khong vao duoc route khach, khach khong vao duoc route admin
    expect((await admin.req('GET', '/portal/v1/reports/views')).status).toBe(403);
    expect((await lan.req('GET', '/admin/v1/reports/views')).status).toBe(403);
    expect((await lan.req('GET', '/admin/v1/history/diagnostics')).status).toBe(403);
  });

  it('loc theo ngay (gio VN): ngay khac -> 0; khoang sai -> 422; xuat CSV / HTML / PDF cua khach', async () => {
    expect((await admin.json('GET', '/admin/v1/reports/views?from=2026-11-01&to=2026-11-10')).body.totals.views).toBe(0);
    expect((await admin.json('GET', '/admin/v1/reports/views?from=2026-11-12&to=2026-11-12')).body.totals.views).toBe(4);
    expect((await admin.json('GET', '/admin/v1/reports/views?from=2026-11-12&to=2026-11-01')).status).toBe(422);
    expect((await admin.json('GET', '/admin/v1/reports/views?from=xx')).status).toBe(422);
    expect((await admin.json('GET', `/admin/v1/reports/views?device_id=${d.id}`)).body.totals.views).toBe(4);
    expect((await admin.json('GET', `/admin/v1/reports/views?customer_id=${K001}`)).body.totals.views).toBe(4);
    expect((await admin.json('GET', '/admin/v1/reports/views?customer_id=khong-co')).body.totals.views).toBe(0);
    const csv = await lan.req('GET', '/portal/v1/reports/views/export.csv');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect([...new Uint8Array(await csv.clone().arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM de Excel doc tieng Viet
    const text = await csv.text();
    expect(text.startsWith('Ngày,Chiến dịch,Creative,Địa điểm,Số lượt xem')).toBe(true);
    expect(text).toContain('2026-11-12');
    expect(text).not.toContain('Thiết bị');
    expect(text.trim().split('\r\n').length).toBe(2);
    const adminCsv = await (await admin.req('GET', '/admin/v1/reports/views/export.csv')).text();
    expect(adminCsv).toContain('Thang máy A1');
    const html = await lan.req('GET', '/portal/v1/reports/views/report.html');
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('Báo cáo lượt xem quảng cáo');
    const pdf = await lan.req('GET', '/portal/v1/reports/views/report.pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5000);
  });

  it('dinh dang cu / ten truong khac van duoc nhan (gateway khoan dung) va duoc dem alias; event_id rac van bi tu choi co ly do', async () => {
    const t = rt.clock.now().getTime();
    const events = [
      // UUID v4 + ts co mui gio +07:00 + played_ms thay duration_ms + type 'pop' (ban app cu)
      { type: 'pop', event_id: '3f2b8f0e-5a1c-4d7e-9b21-0c8a1f3e4d55', ts: new Date(t - 7000).toISOString().replace('Z', '+00:00'), creative_id: creativeId, played_ms: '15000' },
      // epoch mili giay + camelCase + thoi luong tinh giay
      { type: 'proof_of_play', eventId: uuidv7(t - 8000), timestamp: t - 8000, creativeId, duration_s: 15 },
      { type: 'proof_of_play', event_id: 'khong-phai-uuid', ts: new Date(t - 9000).toISOString(), creative_id: creativeId, duration_ms: 15000 },
    ];
    const r = await d.call('POST', '/v1/events', { events });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ accepted: 2, valid: 2, rejected: [{ reason: 'malformed' }] });
    // than dang { items: [...] }
    const r2 = await d.call('POST', '/v1/events', { items: [signagePop(creativeId, 15000, -10000)] });
    expect(r2.body).toMatchObject({ accepted: 1, valid: 1 });
    await drain();
    expect((await admin.json('GET', '/admin/v1/reports/views')).body.totals.views).toBe(7);
    const diag = (await admin.json('GET', '/admin/v1/history/diagnostics')).body.devices.find((v: any) => v.id === d.id);
    expect(diag.rejected_by_reason.malformed).toBe(1);
    expect(Object.keys(diag.aliases)).toEqual(expect.arrayContaining(['played_ms', 'creativeId', 'duration_s', 'body_items']));
  });

  it('creative khong thuoc cua may (khong co trong CSDL): tu choi not_in_manifest va ghi vao thong ke ly do tu choi', async () => {
    const r = await d.call('POST', '/v1/events', { events: [signagePop('khong-ton-tai', 15000, -1000)] });
    expect(r.body.rejected).toEqual([{ event_id: expect.any(String), reason: 'not_in_manifest' }]);
    const diag = (await admin.json('GET', '/admin/v1/history/diagnostics')).body;
    expect(diag.devices.find((v: any) => v.id === d.id).rejected_by_reason.not_in_manifest).toBe(1);
    expect(diag.summary.devices).toBeGreaterThan(0);
  });

  it('thiet bi offline: chan doan noi "offline"; man khong nhan duoc su kien nao 24h: "no_events"', async () => {
    const x = await new Dev().init();
    expect((await x.call('POST', '/v1/heartbeat', { state: 1 })).status).toBe(200);
    await gw.flush();
    await rt.db.run('UPDATE devices SET trust_level = 1, last_seen_at = ? WHERE id = ?', [new Date(rt.clock.now().getTime() - 60_000).toISOString(), x.id]);
    expect((await admin.json('GET', '/admin/v1/history/diagnostics')).body.devices.find((v: any) => v.id === x.id)).toMatchObject({ code: 'no_events', online: true });
    await rt.db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [new Date(rt.clock.now().getTime() - 3 * 3600_000).toISOString(), x.id]);
    const off = (await admin.json('GET', '/admin/v1/history/diagnostics')).body.devices.find((v: any) => v.id === x.id);
    expect(off.code).toBe('offline');
    expect(off.explain).toMatch(/offline/);
  });
});
