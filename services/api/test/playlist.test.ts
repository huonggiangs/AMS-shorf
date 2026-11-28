// Danh sach phat trong vung (v1): API (kiem tra, doc lai vung cu, tuong thich nguoc), manifest (playlist + loop + creative_ids/durations), item_impression qua gateway
// (khu trung log_id, tu choi sai dinh dang), bao cao theo muc phat (admin + khach, 404 du lieu nguoi khac, CSV/HTML/PDF), chan doan dong bo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { createGateway, type Gateway } from '@ams/edge-gateway';
import { generateEd25519KeyPair, signRequest } from '@ams/edge-gateway/testing';
import { MANIFEST_EPOCH_KEY, legacyItemId, uuidv7 } from '@ams/shared';
import { createApp } from '../src/app.js';
import { login, NOW, type Env, type Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let rt: TestRuntime;
let env: Env;
let gw: Gateway;
let admin: Session;
let content: Session;
let owner: Session; // khach K008 (chu cua tep media thu)
let other: Session; // khach K001 (khach khac)
let customerId: string;

class Dev {
  id = '';
  keys!: { publicKey: string; privateKey: string };
  nowS = () => Math.floor(rt.clock.now().getTime() / 1000);
  async init(region = 'HN'): Promise<this> {
    this.keys = await generateEd25519KeyPair();
    const body = JSON.stringify({ pubkey: this.keys.publicKey, kind: 'elevator', model: 'RK3568', os: 'android-11', app_version: '1.0.3', region, px_w: 1080, px_h: 1920, orientation: 'portrait' });
    const s = await signRequest(this.keys.privateKey, { method: 'POST', path: '/v1/register', body, ts: this.nowS() });
    const res = await gw.app.request('/v1/register', { method: 'POST', body, headers: s.headers });
    expect(res.status).toBe(201);
    this.id = ((await res.json()) as any).device_id;
    return this;
  }
  async call(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<{ status: number; body: any }> {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const s = await signRequest(this.keys.privateKey, { method, path, ...(body !== undefined ? { body } : {}), deviceId: this.id, ts: this.nowS() });
    const res = await gw.app.request(path, { method, ...(body !== undefined ? { body } : {}), headers: s.headers });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  async manifest(): Promise<any> {
    await rt.kv.incr(MANIFEST_EPOCH_KEY).catch(() => undefined);
    await gw.manifests.invalidate();
    const r = await this.call('GET', '/v1/manifest');
    expect(r.status).toBe(200);
    return r.body;
  }
}

async function media(o: { kind?: 'video' | 'image'; review?: string } = {}): Promise<string> {
  const id = rt.id();
  const kind = o.kind ?? 'video';
  const key = `test/${customerId}/${id}.${kind === 'video' ? 'mp4' : 'jpg'}`;
  const bytes = new TextEncoder().encode(`media-${id}`);
  await rt.objects.put(key, bytes, kind === 'video' ? 'video/mp4' : 'image/jpeg');
  await rt.db.run(
    `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, storage_key, mime, size_bytes, duration_s, scan_state, review_state, state, created_at)
     VALUES (?, NULL, ?, ?, 'elevator', 1080, 1920, 'portrait', ?, 'upload', ?, ?, ?, ?, 'clean', ?, 'ready', ?)`,
    [id, customerId, `kho-${id}`, kind, key, kind === 'video' ? 'video/mp4' : 'image/jpeg', bytes.length, kind === 'video' ? 15 : null, o.review ?? 'approved', NOW],
  );
  await rt.db.run("INSERT INTO creative_attestations (id, creative_id, content_version, version, kid_safe, signed_by, signed_by_name, signed_at, source) VALUES (?,?,1,'legal-v1',1,'test','Người ký thử',?,'approve')", [rt.id(), id, NOW]);
  return id;
}

const item = (o: Record<string, unknown>): Record<string, unknown> => ({ id: uuidv7(), name: 'Muc', ...o });
const layoutOf = (playlist: unknown, extra: Record<string, unknown> = {}) => ({
  orientation: 'portrait',
  zones: [
    { id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 80, ...(playlist === undefined ? {} : { playlist }), ...extra },
    { id: 'bar', type: 'marquee', x: 0, y: 80, w: 100, h: 20, text: 'x' },
  ],
});
const prog = (name: string, layout: unknown, extra: Record<string, unknown> = {}) => content.json('POST', '/admin/v1/broadcast', { name, target_type: 'elevator', regions: ['HN'], layout, ...extra });

beforeAll(async () => {
  rt = await createTestRuntime({ now: NOW, dialect: 'sqlite', env: { SCRYPT_N: '1024', MEDIA_PUBLIC_URL: 'https://media.test', HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000' } });
  const s = await seed(rt, { log: false, passwordParams: { N: 1024 }, deviceCount: 3 });
  const creds = new Map(s.credentials.map((c) => [c.email, c]));
  env = {
    rt,
    app: createApp(rt),
    seed: s,
    cred: (email) => ({ password: creds.get(email)!.password!, totpSecret: creds.get(email)!.totpSecret!, role: creds.get(email)!.role }),
    byRole: (role, nth = 0) => s.credentials.filter((c) => c.role === role && c.status === 'active')[nth]!.email,
  };
  gw = createGateway(rt);
  customerId = s.customers['K008']!;
  admin = await login(env, env.byRole('super_admin'));
  content = await login(env, env.byRole('content_manager'));
  owner = await login(env, 'dang@unilever.example');
  other = await login(env, 'lan@vinamilk.example');
}, 120_000);
afterAll(async () => rt.close());

describe('API: kiem tra va luu playlist', () => {
  it('luu video + anh + van ban + link ngoai: lam sach text, tu mirror creative_ids/durations, loop, tong thoi luong', async () => {
    const v = await media({ kind: 'video' });
    const i = await media({ kind: 'image' });
    const pl = [
      item({ type: 'video', media_id: v }),
      item({ type: 'image', media_id: i, duration: 20 }),
      item({ type: 'text', text_content: 'bo qua', rich: '<p onclick="x()"><b>Khuyen mai</b><script>alert(1)</script></p>', style: { color: '#fff', font_size: 48, align: 'center', bold: true } }),
      item({ type: 'image', url: 'https://cdn.example.vn/a.jpg' }),
    ];
    const r = await prog('Playlist 1', layoutOf(pl, { loop: false }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const z = r.body.layout.zones.find((x: any) => x.id === 'main');
    expect(z.loop).toBe(false);
    expect(z.playlist).toHaveLength(4);
    expect(z.playlist[2]).toMatchObject({ type: 'text', text_content: 'Khuyen mai', rich: '<p><b>Khuyen mai</b></p>', style: { color: '#FFFFFF', font_size: 48, align: 'center', bold: true } });
    expect(z.creative_ids).toEqual([v, i]);
    expect(z.durations).toEqual({ [i]: 20 });
    expect(z.playlist_total_s).toBe(15 + 20 + 8 + 8);
    expect(r.body.items.map((x: any) => x.creative_id).sort()).toEqual([v, i].sort()); // tep trong playlist vao danh sach tep cua chuong trinh
    // doc lai nguyen ven; sua ten khong doi playlist
    const ren = await content.json('PUT', `/admin/v1/broadcast/${r.body.id}`, { name: 'Playlist 1b' });
    expect(ren.body.layout.zones.find((x: any) => x.id === 'main').playlist).toHaveLength(4);
    // bo muc media khoi playlist => tep roi khoi chuong trinh
    const pl2 = pl.filter((x: any) => x.media_id !== i);
    const upd = await content.json('PUT', `/admin/v1/broadcast/${r.body.id}`, { layout: layoutOf(pl2) });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.items.map((x: any) => x.creative_id)).toEqual([v]);
    expect(upd.body.layout.zones.find((x: any) => x.id === 'main').loop).toBe(true);
  });

  it('tu choi: loai khong khop tep, tep khong co, tep bi tra lai, trung id, qua 50 muc, text co media, url http, playlist tren vung marquee bi bo', async () => {
    const v = await media({ kind: 'video' });
    const i = await media({ kind: 'image' });
    const rej = await media({ review: 'rejected' });
    const code = async (pl: unknown): Promise<[number, string | undefined]> => {
      const r = await prog('Sai', layoutOf(pl));
      return [r.status, r.body?.error?.code];
    };
    expect(await code([item({ type: 'image', media_id: v })])).toEqual([422, 'playlist_type_mismatch']);
    expect(await code([item({ type: 'video', media_id: i })])).toEqual([422, 'playlist_type_mismatch']);
    expect(await code([item({ type: 'video', media_id: 'khong-co' })])).toEqual([422, 'media_not_found']);
    expect(await code([item({ type: 'video', media_id: rej })])).toEqual([422, 'media_rejected']);
    const dup = item({ type: 'video', media_id: v });
    expect((await code([dup, dup]))[0]).toBe(422);
    expect((await code(Array.from({ length: 51 }, () => item({ type: 'text', text_content: 'a' }))))[0]).toBe(422);
    expect((await code([item({ type: 'text', text_content: 'a', media_id: v })]))[0]).toBe(422);
    expect((await code([item({ type: 'image', url: 'http://a.vn/x.jpg' })]))[0]).toBe(422);
    expect((await code([item({ type: 'video' })]))[0]).toBe(422);
    expect((await code([item({ type: 'video', media_id: v, duration: 5000 })]))[0]).toBe(422);
    const ok50 = await prog('50 muc', layoutOf(Array.from({ length: 50 }, () => item({ type: 'text', text_content: 'a' }))));
    expect(ok50.status, JSON.stringify(ok50.body)).toBe(201);
    const onBar = await prog('Marquee', { orientation: 'portrait', zones: [{ id: 'bar', type: 'marquee', x: 0, y: 0, w: 100, h: 10, text: 'x', playlist: [item({ type: 'text', text_content: 'a' })] }] });
    expect(onBar.body.layout.zones[0].playlist).toBeUndefined();
  });

  it('vung cu (creative_ids + durations) duoc doc thanh playlist voi id on dinh; PUT lai khong doi id', async () => {
    const a = await media({ kind: 'video' });
    const b = await media({ kind: 'image' });
    const legacy = { orientation: 'portrait', zones: [{ id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 100, durations: { [b]: 12 } }] };
    const r = await prog('Cu', legacy, { creative_ids: [a, b] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const z = r.body.layout.zones[0];
    expect(z.playlist).toEqual([
      { id: legacyItemId('main', a), type: 'video', name: expect.any(String), media_id: a },
      { id: legacyItemId('main', b), type: 'image', name: expect.any(String), media_id: b, duration: 12 },
    ]);
    expect(z.loop).toBe(true);
    expect(z.creative_ids).toEqual([a, b]);
    const again = await content.json('GET', `/admin/v1/broadcast/${r.body.id}`);
    expect(again.body.layout.zones[0].playlist.map((x: any) => x.id)).toEqual(z.playlist.map((x: any) => x.id));
    // client moi gui nguyen playlist da doc ve: luu thanh playlist that, ket qua tuong duong
    const rt2 = await content.json('PUT', `/admin/v1/broadcast/${r.body.id}`, { layout: { orientation: 'portrait', zones: [{ id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 100, playlist: z.playlist, loop: true }] } });
    expect(rt2.status, JSON.stringify(rt2.body)).toBe(200);
    expect(rt2.body.layout.zones[0].playlist.map((x: any) => x.id)).toEqual(z.playlist.map((x: any) => x.id));
    expect(rt2.body.items.map((x: any) => x.creative_id).sort()).toEqual([a, b].sort());
  });
});

describe('manifest: zones[].playlist', () => {
  it('xuat ban: playlist da giai (media + text + link ngoai) + loop + creative_ids/durations cu; vung cu cung co playlist; chi text van len lich', async () => {
    const v = await media({ kind: 'video' });
    const i = await media({ kind: 'image' });
    const pl = [item({ type: 'video', media_id: v }), item({ type: 'image', media_id: i, duration: 20 }), item({ type: 'text', text_content: 'Xin chao', style: { align: 'center' } }), item({ type: 'image', url: 'https://cdn.example.vn/a.jpg', name: 'Ngoai' })];
    const created = await prog('Phat playlist', layoutOf(pl, { loop: false }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const pid = created.body.id as string;
    expect((await content.json('POST', `/admin/v1/broadcast/${pid}/publish`, {})).status).toBe(200);
    const dev = await new Dev().init('HN');
    const m = await dev.manifest();
    const slot = m.schedule.find((x: any) => x.slot_id === `bp_${pid}`);
    const main = slot.layout.zones.find((z: any) => z.id === 'main');
    expect(main.loop).toBe(false);
    expect(main.creative_ids).toEqual([v, i]);
    expect(main.durations).toEqual({ [i]: 20 });
    expect(slot.creative_ids.sort()).toEqual([v, i].sort());
    expect(main.playlist).toHaveLength(4);
    const [pv, pi, pt, pe] = main.playlist;
    expect(pv).toMatchObject({ type: 'video', media_id: v, play_s: null, duration_ms: 15000 });
    expect(pv.url).toContain('https://media.test/');
    expect(pv.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pi).toMatchObject({ type: 'image', media_id: i, duration: 20, play_s: 20 });
    expect(pt).toMatchObject({ type: 'text', text_content: 'Xin chao', play_s: 8, style: { align: 'center' } });
    expect(pe).toMatchObject({ type: 'image', delivery: 'external', url: 'https://cdn.example.vn/a.jpg', play_s: 8 });
    expect(pe.sha256).toBeUndefined();
    // media thuoc manifest van o creatives[]
    expect(m.creatives.map((c: any) => c.id)).toEqual(expect.arrayContaining([v, i]));
    // tep bi go / chua san sang thi muc bi loai khoi manifest (khong lam hong ca danh sach)
    await rt.db.run("UPDATE creatives SET review_state = 'rejected' WHERE id = ?", [i]);
    const m2 = await dev.manifest();
    const main2 = m2.schedule.find((x: any) => x.slot_id === `bp_${pid}`).layout.zones.find((z: any) => z.id === 'main');
    expect(main2.playlist.map((x: any) => x.media_id ?? x.type)).toEqual([v, 'text', 'image']);
    expect(main2.creative_ids).toEqual([v]);

    // chi co van ban: van len lich (khong media nao)
    const t = await prog('Chi chu', layoutOf([item({ type: 'text', text_content: 'Thong bao' })]));
    expect((await content.json('POST', `/admin/v1/broadcast/${t.body.id}/publish`, {})).status).toBe(200);
    const m3 = await dev.manifest();
    const ts = m3.schedule.find((x: any) => x.slot_id === `bp_${t.body.id}`);
    expect(ts.creative_ids).toEqual([]);
    expect(ts.layout.zones.find((z: any) => z.id === 'main').playlist[0]).toMatchObject({ type: 'text', text_content: 'Thong bao' });

    // vung cu cung nhan playlist suy ra (id uuid v5)
    const a = await media({ kind: 'video' });
    const old = await prog('Cu', { orientation: 'portrait', zones: [{ id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 100 }] }, { creative_ids: [a] });
    await content.json('POST', `/admin/v1/broadcast/${old.body.id}/publish`, {});
    const oz = (await dev.manifest()).schedule.find((x: any) => x.slot_id === `bp_${old.body.id}`).layout.zones[0];
    expect(oz.creative_ids).toEqual([a]);
    expect(oz.loop).toBe(true);
    expect(oz.playlist).toHaveLength(1);
    expect(oz.playlist[0]).toMatchObject({ id: legacyItemId('main', a), type: 'video', media_id: a });
  });
});

describe('item_impression + bao cao', () => {
  let dev: Dev;
  let pid: string;
  let v: string;
  let i: string;
  let itemV: string;
  let itemT: string;
  const ev = (o: Record<string, unknown> = {}, offsetMs = -60_000): Record<string, unknown> => {
    const t = rt.clock.now().getTime() + offsetMs;
    return { type: 'item_impression', log_id: uuidv7(t), program_id: `bp_${pid}`, zone_id: 'main', item_id: itemV, media_id: v, item_type: 'video', played_at: new Date(t).toISOString(), ...o };
  };
  const counts = async () => (await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_item_impression'))[0]!.n;

  beforeAll(async () => {
    v = await media({ kind: 'video' });
    i = await media({ kind: 'image' });
    itemV = uuidv7();
    itemT = uuidv7();
    const r = await prog('Bao cao', layoutOf([item({ id: itemV, type: 'video', media_id: v }), item({ type: 'image', media_id: i }), item({ id: itemT, type: 'text', text_content: 'Chao' })]));
    pid = r.body.id;
    await content.json('POST', `/admin/v1/broadcast/${pid}/publish`, {});
    dev = await new Dev().init('HN');
    await rt.db.run('UPDATE devices SET trust_level = 1, last_seen_at = ? WHERE id = ?', [new Date(rt.clock.now().getTime() - 60_000).toISOString(), dev.id]);
  });

  it('nhan lo: ghi moi, gui lai (trung log_id) khong loi va khong dem hai lan, rac bi tu choi; khong dong vao tien/impression/proof_of_play', async () => {
    const a = ev();
    const b = ev({ item_id: itemT, media_id: undefined, item_type: 'text' });
    const bad = [ev({ log_id: 'khong-phai-uuid' }), ev({ played_at: 'hom qua' }), ev({ item_type: 'gif' }), ev({ program_id: 'bp_khong-co' }), ev({ media_id: 'khong-co' }), ev({}, -(49 * 3600_000))];
    const r1 = await dev.call('POST', '/v1/events', { events: [a, b, ...bad] });
    expect(r1.status, JSON.stringify(r1.body)).toBe(202);
    expect(r1.body.item_impressions).toEqual({ accepted: 2, stored: 2, duplicates: 0, rejected: 6 });
    expect(r1.body.rejected.map((x: any) => x.reason).sort()).toEqual(['malformed', 'malformed', 'malformed', 'ts_out_of_range', 'unknown_media', 'unknown_program']);
    expect(await counts()).toBe(2);
    const row = (await rt.db.query<any>('SELECT * FROM ev_item_impression WHERE log_id = ?', [a['log_id']]))[0];
    expect(row).toMatchObject({ device_id: dev.id, program_id: pid, zone_id: 'main', item_id: itemV, item_type: 'video', media_id: v, customer_id: customerId, source: 'device' });
    expect((await rt.db.query<any>('SELECT customer_id, media_id FROM ev_item_impression WHERE log_id = ?', [b['log_id']]))[0]).toMatchObject({ customer_id: null, media_id: null });
    // gui lai nguyen lo (mat phan hoi): khong loi, khong ghi them
    const r2 = await dev.call('POST', '/v1/events', { events: [a, b] });
    expect(r2.status).toBe(202);
    expect(r2.body.item_impressions).toEqual({ accepted: 2, stored: 0, duplicates: 2, rejected: 0 });
    expect(await counts()).toBe(2);
    // lo hon hop voi impression/pop khac van chay; app khong gui `type`: nhan qua log_id + item_id; tên camelCase
    const t = rt.clock.now().getTime() - 30_000;
    const r3 = await dev.call('POST', '/v1/events', { events: [{ logId: uuidv7(t), programId: pid, zoneId: 'main', itemId: itemV, mediaId: v, itemType: 'video', playedAt: new Date(t).toISOString() }] });
    expect(r3.body.item_impressions.stored).toBe(1);
    // 50 muc trong mot lo van nam trong gioi han than 32 KB
    const fifty = Array.from({ length: 50 }, (_, k) => ev({}, -(10_000 + k)));
    const r4 = await dev.call('POST', '/v1/events', { events: fifty });
    expect(r4.status, JSON.stringify(r4.body)).toBe(202);
    expect(r4.body.item_impressions.stored).toBe(50);
    expect((await rt.db.query<any>('SELECT COUNT(*) AS n FROM ev_ad_impression'))[0].n).toBe(0);
    expect((await rt.db.query<any>('SELECT COUNT(*) AS n FROM ev_proof_of_play'))[0].n).toBe(0);
    const ledger = await rt.db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ledger%'");
    for (const t2 of ledger) expect((await rt.db.query<any>(`SELECT COUNT(*) AS n FROM ${t2.name}`))[0].n).toBe(0);
    expect(await counts()).toBe(53);
  });

  it('thiet bi chua cap quyen: luu pending_trust, chua vao bao cao cho toi khi duoc cap quyen', async () => {
    const d2 = await new Dev().init('HN');
    const r = await d2.call('POST', '/v1/events', { events: [{ ...ev({}, -5_000) }] });
    expect(r.status).toBe(202);
    expect((await rt.db.query<any>('SELECT source FROM ev_item_impression WHERE device_id = ?', [d2.id]))[0].source).toBe('pending_trust');
    const before = (await admin.json('GET', `/admin/v1/reports/views/items?group_by=device&device_id=${d2.id}`)).body;
    expect(before.totals.impressions).toBe(0);
    await rt.db.run('UPDATE devices SET trust_level = 1 WHERE id = ?', [d2.id]);
    const after = (await admin.json('GET', `/admin/v1/reports/views/items?group_by=device&device_id=${d2.id}`)).body;
    expect(after.totals.impressions).toBe(1);
  });

  it('bao cao admin: nhom theo tep / doi tac / chuong trinh / vung / thiet bi / ngay + loc', async () => {
    const get = async (qs: string) => {
      const r = await admin.json('GET', `/admin/v1/reports/views/items?${qs}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    };
    const base = await get('group_by=media');
    expect(base.totals.impressions).toBe(54); // 53 cua thiet bi 1 + 1 cua thiet bi 2 da cap quyen
    expect(base.rows.find((x: any) => x.key === v)).toMatchObject({ label: expect.stringContaining('kho-'), impressions: 53 });
    expect(base.rows.find((x: any) => x.key === null).impressions).toBe(1); // muc van ban
    expect(base.by_type.find((x: any) => x.item_type === 'video').impressions).toBe(53);
    const partner = await get('group_by=partner');
    expect(partner.rows.find((x: any) => x.key === customerId).impressions).toBe(53);
    expect(partner.rows.find((x: any) => x.key === null).label).toBe('Chưa rõ đối tác');
    expect((await get(`group_by=program&program_id=${pid}`)).rows).toHaveLength(1);
    const zone = await get('group_by=zone');
    expect(zone.rows[0]).toMatchObject({ program_id: pid, zone_id: 'main', label: 'Bao cao / main' });
    expect((await get('group_by=device')).rows.length).toBeGreaterThanOrEqual(2);
    const day = await get('group_by=day');
    expect(day.rows.reduce((s: number, x: any) => s + x.impressions, 0)).toBe(54);
    expect((await get(`group_by=media&customer_id=${customerId}&item_type=video`)).totals.impressions).toBe(53);
    expect((await get('group_by=media&from=2020-01-01&to=2020-01-31')).totals.impressions).toBe(0);
    expect((await admin.json('GET', '/admin/v1/reports/views/items?group_by=xyz')).status).toBe(422);
    expect((await admin.json('GET', '/admin/v1/reports/views/items?from=2026-12-01&to=2026-11-01')).status).toBe(422);
  });

  it('khach hang chi thay du lieu cua minh: 404 voi id nguoi khac, khong co nhom thiet bi', async () => {
    const mine = await owner.json('GET', '/portal/v1/reports/views/items?group_by=media');
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.totals.impressions).toBe(53 /* muc van ban khong co doi tac: khong vao du lieu cua khach */);
    expect(mine.body.totals.devices).toBeUndefined();
    expect(mine.body.rows.every((x: any) => x.key === v || x.key === i)).toBe(true);
    // khach khac: khong co gi, va loc theo media/chuong trinh cua nguoi khac => 404 (khong phan biet voi "khong co")
    const none = await other.json('GET', '/portal/v1/reports/views/items?group_by=media');
    expect(none.body.totals.impressions).toBe(0);
    expect((await other.json('GET', `/portal/v1/reports/views/items?media_id=${v}`)).status).toBe(404);
    expect((await other.json('GET', `/portal/v1/reports/views/items?program_id=${pid}`)).status).toBe(404);
    expect((await owner.json('GET', `/portal/v1/reports/views/items?media_id=${v}`)).status).toBe(200);
    expect((await owner.json('GET', '/portal/v1/reports/views/items?group_by=device')).status).toBe(422);
    // customer_id / device_id tren portal bi bo qua (khong de khach xem nguoi khac)
    const spoof = await other.json('GET', `/portal/v1/reports/views/items?customer_id=${customerId}&device_id=${dev.id}`);
    expect(spoof.body.totals.impressions).toBe(0);
    expect((await owner.json('GET', '/admin/v1/reports/views/items')).status).toBeGreaterThanOrEqual(401);
  });

  it('xuat CSV / HTML / PDF (admin + khach); khach khong thay cot thiet bi', async () => {
    const csv = await admin.req('GET', '/admin/v1/reports/views/items/export.csv');
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text).toContain('Thiết bị');
    expect(text).toContain('Bao cao');
    const ocsv = await (await owner.req('GET', '/portal/v1/reports/views/items/export.csv')).text();
    expect(ocsv).not.toContain('Thiết bị');
    expect(ocsv).toContain('kho-');
    const html = await owner.req('GET', '/portal/v1/reports/views/items/report.html?group_by=program');
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('Báo cáo lượt hiển thị theo mục phát');
    const pdf = await admin.req('GET', '/admin/v1/reports/views/items/report.pdf?group_by=partner');
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
    expect((await other.req('GET', `/portal/v1/reports/views/items/report.pdf?media_id=${v}`)).status).toBe(404);
  });

  it('chan doan dong bo co so item_impression', async () => {
    const d = await admin.json('GET', '/admin/v1/history/diagnostics');
    expect(d.status).toBe(200);
    const x = d.body.devices.find((r: any) => r.id === dev.id);
    expect(x).toMatchObject({ item_stored_24h: 53, item_duplicates_24h: 2, item_in_db_24h: 53 });
    expect(x.item_rejected_by_reason).toMatchObject({ malformed: 3, unknown_program: 1, unknown_media: 1, ts_out_of_range: 1 });
    expect(x.code).not.toBe('no_events');
  });
});

describe('vung type=playlist (web-admin)', () => {
  it('nhan zone playlist + style.rich/bg_color/text_color, durations null; manifest phat nhu vung media', async () => {
    const v = await media({ kind: 'video' });
    const pl = [item({ type: 'video', media_id: v }), item({ type: 'text', text_content: 'x', style: { rich: '<p><b>Hi</b><script>1</script></p>', bg_color: '#112233', text_color: '#fff', font_size: 30 }, duration: 8 })];
    const layout = { orientation: 'portrait', zones: [{ id: 'main', type: 'playlist', x: 0, y: 0, w: 100, h: 100, playlist: pl, loop: true, creative_ids: [v], durations: null }] };
    const r = await prog('UI playlist', layout, { creative_ids: [v], item_zones: { [v]: 'main' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const z = r.body.layout.zones[0];
    expect(z.type).toBe('playlist');
    expect(z.playlist[1]).toMatchObject({ rich: '<p><b>Hi</b></p>', text_content: 'Hi', style: { bg_color: '#112233', text_color: '#FFFFFF', font_size: 30 } });
    expect(z.playlist[1].style.rich).toBeUndefined();
    expect(z.creative_ids).toEqual([v]);
    await content.json('POST', `/admin/v1/broadcast/${r.body.id}/publish`, {});
    const dev = await new Dev().init('HN');
    const mz = (await dev.manifest()).schedule.find((x: any) => x.slot_id === `bp_${r.body.id}`).layout.zones[0];
    expect(mz.type).toBe('playlist');
    expect(mz.playlist).toHaveLength(2);
    expect(mz.creative_ids).toEqual([v]);
  });
});
