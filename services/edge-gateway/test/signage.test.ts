// Signage Player (thang may 9:16 / LED): dang ky + do phan giai -> nhom manifest, heartbeat mo rong, manifest header/footer/hotline/fit/xoay vong,
// proof_of_play hop le/pending_trust, lenh moi (id khong doi khi giao lai), POST /v1/logs. Xem docs/SIGNAGE-PLAYER-AMS.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANIFEST_EPOCH_KEY, SIGNAGE_CONFIG_KEY, uuidv7 } from '@ams/shared';
import { enqueueCommand } from '../src/gateway.js';
import { attestForTest, seedAdFixture } from '../src/testing.js';
import { TestDevice, harness, type Harness } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let h: Harness;
let fx1080: Awaited<ReturnType<typeof seedAdFixture>>;
let fx768: Awaited<ReturnType<typeof seedAdFixture>>;
let fx2160: Awaited<ReturnType<typeof seedAdFixture>>;
const J = async (r: Response): Promise<any> => (await r.json()) as any;
const el = (reg: Record<string, unknown> = {}) => TestDevice.create(h, { kind: 'elevator', model: 'RK3568', os: 'android-11', app_version: '1.0.0', ...reg });
const hb = async (d: TestDevice, extra: Record<string, unknown> = {}) => d.call('POST', '/v1/heartbeat', { state: 1, app_ver: '1.0.0', ...extra });
const bump = async () => {
  await h.rt.kv.incr(MANIFEST_EPOCH_KEY);
  await h.gw.manifests.invalidate();
};
const setConfig = async (cfg: Record<string, unknown>) => {
  await h.rt.db.run('DELETE FROM settings WHERE key = ?', [SIGNAGE_CONFIG_KEY]);
  await h.rt.db.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,NULL,?)', [SIGNAGE_CONFIG_KEY, JSON.stringify(cfg), h.rt.clock.now().toISOString()]);
  await bump();
};

beforeAll(async () => {
  h = await harness({ env: { HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000' }, fixture: { campaigns: 0 } });
  // hai chien dich thang may, MOI chien dich mot do phan giai (1080x1920 va 768x1366); tep xac minh duoc sha256 (withObjects)
  fx1080 = await seedAdFixture(h.rt, { campaigns: 1, targetType: 'elevator', px: { w: 1080, h: 1920 }, regions: null });
  fx768 = await seedAdFixture(h.rt, { campaigns: 1, targetType: 'elevator', px: { w: 768, h: 1366 }, regions: null });
  fx2160 = await seedAdFixture(h.rt, { campaigns: 1, targetType: 'elevator', px: { w: 2160, h: 3840 }, regions: null }); // 4K: KHONG bao gio day cho man thap hon
}, 60_000);
afterAll(async () => h.close());

describe('dang ky + do phan giai (muc 4)', () => {
  it('dang ky lai cung khoa cong khai LUON nhan cung device_id (200, khong tao thiet bi thu hai); cap nhat thong tin app', async () => {
    const d = await el({ px_w: 1080, px_h: 1920, orientation: 'portrait' });
    const again = await d.registerRaw({ kind: 'elevator', app_version: '1.0.7', px_w: 1080, px_h: 1920 });
    expect(again.status).toBe(200);
    const b = await J(again);
    expect(b).toMatchObject({ device_id: d.id, created: false, trust_level: 0 });
    expect(Number((await h.rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM devices WHERE pubkey_ed25519 = ?', [d.keys.publicKey]))[0]!.n)).toBe(1);
    expect((await h.rt.db.query<{ app_version: string }>('SELECT app_version FROM devices WHERE id = ?', [d.id]))[0]!.app_version).toBe('1.0.7');
    const p = (await h.rt.db.query<any>('SELECT px_w, px_h, orientation FROM device_profiles WHERE device_id = ?', [d.id]))[0];
    expect(p).toMatchObject({ px_w: 1080, px_h: 1920, orientation: 'portrait' });
  });

  it('kiem tra gia tri: px ngoai khoang, thieu mot nua, huong la, region co dau cham -> 422', async () => {
    for (const reg of [{ px_w: 63, px_h: 1920 }, { px_w: 1080, px_h: 16385 }, { px_w: 1080 }, { px_h: 1920 }, { px_w: 1080.5, px_h: 1920 }, { px_w: 1080, px_h: 1920, orientation: 'diagonal' }, { region: 'HN.all' }, { region: 'x'.repeat(17) }]) {
      const d = new TestDevice(h, await (await import('../src/testing.js')).generateEd25519KeyPair());
      const r = await d.registerRaw({ kind: 'elevator', ...reg });
      expect(r.status, JSON.stringify(reg)).toBe(422);
      expect((await J(r)).error.code).toBe('validation_failed');
    }
  });

  it('chua gan screen: nhom manifest = elevator_<w>x<h> theo do phan giai thiet bi; manifest CHI chua creative dung do phan giai', async () => {
    const a = await el({ px_w: 1080, px_h: 1920, orientation: 'portrait', region: 'HN' });
    const b = await el({ px_w: 768, px_h: 1366, region: 'HN' });
    const ha = await J(await hb(a));
    const hbb = await J(await hb(b));
    expect(ha.manifest_group).toBe('HN.all.elevator_1080x1920');
    expect(hbb.manifest_group).toBe('HN.all.elevator_768x1366');
    const ma = await J(await a.call('GET', '/v1/manifest'));
    const mb = await J(await b.call('GET', '/v1/manifest'));
    // moi chien dich chi giu creative o bac cao nhat KHONG VUOT do phan giai thiet bi: man 1080 nhan chien dich 1080 va chien dich 768 (thap hon), khong nhan 4K
    expect(ma.creatives.map((c: any) => c.id).sort()).toEqual([fx1080.campaigns[0]!.creatives[0]!.id, fx768.campaigns[0]!.creatives[0]!.id].sort());
    expect(ma.creatives.every((c: any) => c.px_w <= 1080)).toBe(true);
    // man 768: chi chien dich 768 (khong day 1080/4K cho man thap hon)
    expect(mb.creatives.map((c: any) => c.id)).toEqual([fx768.campaigns[0]!.creatives[0]!.id]);
    // chua gui do phan giai (app cu): nhom 'elevator' khong theo do phan giai (khong chon duoc)
    const old = await el();
    expect((await J(await hb(old))).manifest_group).toBe('HN.all.elevator');
    // nhom `elevator` (chua khai px): moi creative thang may HD-4K da duyet (1080, 768 va 4K)
    const mo = await J(await old.call('GET', '/v1/manifest'));
    expect(mo.creatives.map((c: any) => c.id).sort()).toEqual([fx1080, fx768, fx2160].map((f) => f.campaigns[0]!.creatives[0]!.id).sort());
  });

  it('do phan giai khai la cac cong/giay le: nhom = bac chuan gan nhat KHONG VUOT (720, 768, 1080, 1440, 2160); man 4K nhan ca 4K', async () => {
    const group = async (px_w: number, px_h: number) => (await J(await hb(await el({ px_w, px_h, region: 'HN' })))).manifest_group;
    expect(await group(720, 1280)).toBe('HN.all.elevator_720x1280');
    expect(await group(768, 1366)).toBe('HN.all.elevator_768x1366');
    expect(await group(1080, 1794)).toBe('HN.all.elevator_1080x1920'); // thanh dieu huong an bot chieu cao
    expect(await group(1200, 2133)).toBe('HN.all.elevator_1080x1920'); // khong day len 1440
    expect(await group(1440, 2560)).toBe('HN.all.elevator_1440x2560');
    expect(await group(2160, 3840)).toBe('HN.all.elevator_2160x3840');
    expect(await group(3000, 5000)).toBe('HN.all.elevator_2160x3840');
    expect(await group(1920, 1080)).toBe('HN.all.elevator_1080x1920'); // bao xoay ngang: van tinh theo canh ngan
    const d4k = await el({ px_w: 2160, px_h: 3840, region: 'HN' });
    expect((await J(await d4k.call('GET', '/v1/manifest'))).creatives.map((c: any) => c.id)).toContain(fx2160.campaigns[0]!.creatives[0]!.id);
    const d720 = await el({ px_w: 720, px_h: 1280, region: 'HN' });
    expect((await J(await d720.call('GET', '/v1/manifest'))).creatives).toEqual([]); // 720 < 768: khong co creative nao khong vuot
  });

  it('mot chien dich co nhieu ban: man nhan ban cao nhat khong vuot (1080 -> ban 1080, khong lay ban 768 hay 4K)', async () => {
    const camp = fx1080.campaigns[0]!;
    const extra = h.rt.id();
    await h.rt.db.run(
      `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, storage_key, mime, size_bytes, duration_s, scan_state, review_state, state, created_at)
       SELECT ?, campaign_id, customer_id, 'ban 4K', target_type, 2160, 3840, orientation, kind, source, storage_key, mime, size_bytes, duration_s, scan_state, review_state, state, created_at FROM creatives WHERE id = ?`,
      [extra, camp.creatives[0]!.id],
    );
    await attestForTest(h.rt, extra);
    await bump();
    const d = await el({ px_w: 1080, px_h: 1920 });
    const ids = (await J(await d.call('GET', '/v1/manifest'))).creatives.map((c: any) => c.id);
    expect(ids).toContain(camp.creatives[0]!.id);
    expect(ids).not.toContain(extra);
    const d4 = await el({ px_w: 2160, px_h: 3840 });
    const ids4 = (await J(await d4.call('GET', '/v1/manifest'))).creatives.map((c: any) => c.id);
    expect(ids4).toContain(extra);
    expect(ids4).not.toContain(camp.creatives[0]!.id); // cung chien dich: chi ban cao nhat khong vuot
    await h.rt.db.run('DELETE FROM creatives WHERE id = ?', [extra]);
    await bump();
  });

  it('heartbeat doi do phan giai/huong/vung -> doi nhom NGAY, luu device_profiles; kiem tra gia tri o heartbeat', async () => {
    const d = await el({ px_w: 1080, px_h: 1920, region: 'HN' });
    expect((await J(await hb(d))).manifest_group).toBe('HN.all.elevator_1080x1920');
    const r2 = await J(await hb(d, { px_w: 768, px_h: 1366, orientation: 'portrait', region: 'HCM' }));
    expect(r2.manifest_group).toBe('HCM.all.elevator_768x1366');
    expect((await h.rt.db.query<any>('SELECT px_w, px_h, orientation FROM device_profiles WHERE device_id = ?', [d.id]))[0]).toMatchObject({ px_w: 768, px_h: 1366, orientation: 'portrait' });
    expect((await h.rt.db.query<any>('SELECT region_id FROM devices WHERE id = ?', [d.id]))[0].region_id).toBe('HCM');
    for (const bad of [{ px_w: 10, px_h: 10 }, { px_w: 1080 }, { orientation: 'x' }, { source: 'ftp' }, { region: 'a b' }, { cache_mb: -1 }]) {
      const r = await hb(d, bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
  });

  it('man hinh da gan (admin) uu tien do phan giai + vung cua screen; tu khai cua thiet bi bi bo qua', async () => {
    const d = await el({ px_w: 1080, px_h: 1920, region: 'HN' });
    const venue = h.rt.id();
    await h.rt.db.run("INSERT INTO venues (id, code, name, kind, region_id, address, created_at) VALUES (?,?,?,?,?,?,?)", [venue, 'V-T', 'Chung cu T', 'apartment', 'DN', 'x', h.rt.clock.now().toISOString()]);
    await h.rt.db.run("INSERT INTO screens (id, venue_id, type, px_w, px_h, orientation, state, device_id) VALUES (?,?,?,?,?,?,?,?)", [h.rt.id(), venue, 'elevator', 768, 1366, 'portrait', 'active', d.id]);
    await h.rt.db.run('UPDATE devices SET region_id = ? WHERE id = ?', ['DN', d.id]);
    await h.gw.devices.invalidate(d.id);
    const r = await J(await hb(d, { px_w: 1080, px_h: 1920, region: 'HN' })); // thiet bi van bao 1080x1920/HN
    expect(r.manifest_group).toBe('DN.all.elevator_768x1366');
    expect((await h.rt.db.query<any>('SELECT region_id FROM devices WHERE id = ?', [d.id]))[0].region_id).toBe('DN');
  });
});

describe('heartbeat mo rong (muc 6, 10, 12)', () => {
  it('source/app_version/cache_mb luu vao device_profiles + devices sau flush; than <= 2 KB (lon hon -> 413); TV van chay nhu cu', async () => {
    const d = await el({ px_w: 1080, px_h: 1920 });
    const r = await hb(d, { app_version: '1.3.0', app_ver: undefined, source: 'usb', cache_mb: 812 });
    expect(r.status).toBe(200);
    await h.gw.flush();
    expect((await h.rt.db.query<any>('SELECT source, cache_mb FROM device_profiles WHERE device_id = ?', [d.id]))[0]).toMatchObject({ source: 'usb', cache_mb: 812 });
    expect((await h.rt.db.query<any>('SELECT app_version FROM devices WHERE id = ?', [d.id]))[0].app_version).toBe('1.3.0');
    // doi nguon -> ghi lai ngay o lan flush ke tiep
    await hb(d, { app_version: '1.3.0', source: 'ams', cache_mb: 815 });
    await h.gw.flush();
    expect((await h.rt.db.query<any>('SELECT source FROM device_profiles WHERE device_id = ?', [d.id]))[0].source).toBe('ams');
    expect((await hb(d, { pad: 'x'.repeat(2100) })).status).toBe(413);
    const tv = await TestDevice.create(h);
    const t = await J(await hb(tv));
    expect(t.hotline).toBeUndefined();
    expect(t.app_update_url).toBeUndefined();
  });

  it('hotline + cap nhat app tu xa (min_app_version/app_update_url/app_update_sha256) theo loai man, chi thang may/LED nhan', async () => {
    const sha = 'a'.repeat(64);
    await setConfig({ elevator: { hotline: '0900 123 456 · Zalo', min_app_version: '1.2.0', app_update_url: 'https://cdn.anio.vn/signage-1.2.0.apk', app_update_sha256: sha }, led_p5: { hotline: '0911 000 000' } });
    const d = await el({ px_w: 1080, px_h: 1920 });
    const r = await J(await hb(d));
    expect(r).toMatchObject({ hotline: '0900 123 456 · Zalo', min_app_version: '1.2.0', app_update_url: 'https://cdn.anio.vn/signage-1.2.0.apk', app_update_sha256: sha });
    const led = await TestDevice.create(h, { kind: 'led_p5', px_w: 640, px_h: 320 });
    const rl = await J(await hb(led));
    expect(rl.hotline).toBe('0911 000 000');
    expect(rl.app_update_url).toBeUndefined();
    const tv = await TestDevice.create(h);
    const rt = await J(await hb(tv));
    expect(rt.hotline).toBeUndefined();
    expect(rt.app_update_sha256).toBeUndefined();
    await setConfig({});
  });
});

describe('manifest thang may/LED (muc 5, 6, 7, 8)', () => {
  it('header/footer/hotline cap manifest, fit mac dinh = vua khung, rotation sequential; slot ghi de header/footer; TV KHONG co cac truong nay', async () => {
    await setConfig({ elevator: { header: 'ANIO · Chung cư xanh', footer: 'Hotline 0900', hotline: '0900 000 000', fit: 'cover' } });
    await h.rt.db.run('INSERT INTO schedule_slot_text (slot_id, header, footer, updated_at) VALUES (?,?,?,?)', [fx1080.campaigns[0]!.slotId, 'Tiêu đề riêng', '', h.rt.clock.now().toISOString()]);
    await bump();
    const d = await el({ px_w: 1080, px_h: 1920 });
    const m = await J(await d.call('GET', '/v1/manifest'));
    expect(m).toMatchObject({ header: 'ANIO · Chung cư xanh', footer: 'Hotline 0900', hotline: '0900 000 000', rotation: { mode: 'sequential' } });
    expect(m.creatives[0].fit).toBe('cover'); // chon thu cong 'cover' theo loai man van duoc
    expect(m.schedule[0]).toMatchObject({ header: 'Tiêu đề riêng', footer: '' }); // chuoi rong = an
    // slot khong ghi de: khong co header/footer o cap slot
    const m2 = await J(await (await el({ px_w: 768, px_h: 1366 })).call('GET', '/v1/manifest'));
    expect(m2.schedule[0].header).toBeUndefined();
    const tv = await TestDevice.create(h);
    const mt = await J(await tv.call('GET', '/v1/manifest'));
    for (const k of ['header', 'footer', 'hotline', 'rotation']) expect(mt[k], k).toBeUndefined();
    for (const c of mt.creatives) expect(c.fit).toBeUndefined();
    // mac dinh khi chua cau hinh: fit (vua khung), header/footer/hotline rong
    await setConfig({});
    await h.rt.db.run('DELETE FROM schedule_slot_text');
    await bump();
    const m3 = await J(await d.call('GET', '/v1/manifest'));
    expect(m3).toMatchObject({ header: '', footer: '', hotline: '', rotation: { mode: 'sequential' } });
    expect(m3.creatives[0].fit).toBe('fit');
  });

  it('anh tinh: duration_s LUON co (mac dinh 10 giay, hoac theo cau hinh); video giu thoi luong that', async () => {
    // doi creative video cua fixture 1080x1920 thanh anh tinh chua khai bao thoi luong (rang buoc UNIQUE campaign+loai+do phan giai: khong them creative thu hai)
    const id = fx1080.campaigns[0]!.creatives[0]!.id;
    await h.rt.db.run("UPDATE creatives SET kind = 'image', duration_s = NULL WHERE id = ?", [id]);
    await bump();
    const d = await el({ px_w: 1080, px_h: 1920 });
    let m = await J(await d.call('GET', '/v1/manifest'));
    expect(m.creatives.find((c: any) => c.id === id)).toMatchObject({ media_type: 'image', duration_s: 10, fit: 'fit' });
    // video thang may giu thoi luong that (15 giay); (TV: duration_s cua anh chua khai bao van la null, khong doi hop dong TV: manifest.ts chi them mac dinh khi co `signage`)
    const m768 = await J(await (await el({ px_w: 768, px_h: 1366 })).call('GET', '/v1/manifest'));
    expect(m768.creatives[0]).toMatchObject({ media_type: 'video', duration_s: 15 });
    await setConfig({ elevator: { image_duration_s: 25 } });
    m = await J(await d.call('GET', '/v1/manifest'));
    expect(m.creatives.find((c: any) => c.id === id).duration_s).toBe(25);
    await h.rt.db.run("UPDATE creatives SET kind = 'video', duration_s = 15 WHERE id = ?", [id]);
    await setConfig({});
  });

  it('delta: creative doi noi dung (fit) cung id duoc gui lai (added + removed) de client thay the', async () => {
    await setConfig({ elevator: { fit: 'cover' } });
    const d = await el({ px_w: 1080, px_h: 1920 });
    const m0 = await J(await d.call('GET', '/v1/manifest'));
    await setConfig({}); // mac dinh 'fit'
    const r = await d.call('GET', `/v1/manifest?etag=${m0.etag}&delta=1`);
    expect(r.headers.get('x-manifest-kind')).toBe('delta');
    const dl = await J(r);
    const id = fx1080.campaigns[0]!.creatives[0]!.id;
    expect(dl.creatives_added.map((c: any) => c.id)).toContain(id);
    expect(dl.creatives_removed).toContain(id);
    expect(dl.creatives_added.find((c: any) => c.id === id).fit).toBe('fit');
    expect(dl).toMatchObject({ rotation: { mode: 'sequential' } });
    await setConfig({});
  });
});

describe('proof_of_play hop le (muc 3)', () => {
  const pop = (creative: string, offset = -1000) => {
    const t = h.rt.clock.now().getTime() + offset;
    return { type: 'proof_of_play', event_id: uuidv7(t), ts: new Date(t).toISOString(), creative_id: creative, duration_ms: 15000 };
  };
  it('chua cap quyen (trust 0): VAN LUU voi source=pending_trust (khong bi loai), bao flagged; khong tao doanh thu/thuong', async () => {
    const d = await el({ px_w: 1080, px_h: 1920 });
    const cr = fx1080.campaigns[0]!.creatives[0]!.id;
    const r = await J(await d.call('POST', '/v1/events', { events: [pop(cr), pop(cr, -2000)] }));
    expect(r).toMatchObject({ accepted: 2, valid: 0, flagged: 2, rejected: [] });
    await h.rt.queue.drain();
    const rows = await h.rt.db.query<any>('SELECT source, screen_id FROM ev_proof_of_play WHERE screen_id = ?', [d.id]);
    expect(rows.length).toBe(2);
    expect(rows.every((x: any) => x.source === 'pending_trust')).toBe(true);
    expect(Number((await h.rt.db.query<any>('SELECT COUNT(*) AS n FROM ev_ad_impression WHERE device_id = ?', [d.id]))[0].n)).toBe(0); // khong sinh impression/doanh thu
  });
  it('da cap quyen (trust >= 1): source=device, valid; khu trung theo event_id; creative ngoai manifest van bi tu choi', async () => {
    const d = await el({ px_w: 1080, px_h: 1920 });
    await h.rt.db.run('UPDATE devices SET trust_level = 1 WHERE id = ?', [d.id]);
    await h.gw.devices.invalidate(d.id);
    const cr = fx1080.campaigns[0]!.creatives[0]!.id;
    const ev = pop(cr);
    const r1 = await J(await d.call('POST', '/v1/events', { events: [ev, pop(fx2160.campaigns[0]!.creatives[0]!.id)] }));
    expect(r1).toMatchObject({ accepted: 1, valid: 1, flagged: 0 });
    expect(r1.rejected).toEqual([{ event_id: expect.any(String), reason: 'not_in_manifest' }]);
    await d.call('POST', '/v1/events', { events: [ev] }); // gui lai: khong dem hai lan
    await h.rt.queue.drain();
    const rows = await h.rt.db.query<any>('SELECT source FROM ev_proof_of_play WHERE screen_id = ?', [d.id]);
    expect(rows.map((x: any) => x.source)).toEqual(['device']);
  });
});

describe('lenh cho thang may/LED (muc 2, 9): id lenh khong doi khi giao lai', () => {
  it('reset_pin/set_volume/set_orientation/message giao qua heartbeat; chua ack -> giao lai CUNG id; lenh la van ack duoc', async () => {
    const d = await el({ px_w: 1080, px_h: 1920 });
    await h.rt.db.run('UPDATE devices SET trust_level = 1 WHERE id = ?', [d.id]);
    await h.gw.devices.invalidate(d.id);
    const id = await enqueueCommand(h.rt, d.id, { type: 'reset_pin' }, { ttlS: 900, idempotencyKey: 'reset-pin-0001' });
    await enqueueCommand(h.rt, d.id, { type: 'set_volume', args: { percent: 30 } });
    await enqueueCommand(h.rt, d.id, { type: 'cmd_tuong_lai_chua_biet', args: { x: 1 } });
    const a = await J(await hb(d));
    expect(a.commands.map((c: any) => c.type).sort()).toEqual(['cmd_tuong_lai_chua_biet', 'reset_pin', 'set_volume']);
    expect(a.commands.find((c: any) => c.type === 'set_volume').args).toEqual({ percent: 30 });
    h.rt.clock.advance(125_000); // qua CMD_REDELIVER_S (120 giay) ma chua ack
    const b = await J(await hb(d));
    expect(b.commands.find((c: any) => c.type === 'reset_pin').id).toBe(id); // CUNG id khi giao lai
    expect(b.commands.map((c: any) => c.id).sort()).toEqual(a.commands.map((c: any) => c.id).sort());
    const unknown = a.commands.find((c: any) => c.type === 'cmd_tuong_lai_chua_biet').id;
    const ack = await J(await d.call('POST', '/v1/commands/ack', { acks: [{ id, status: 'ok' }, { id: unknown, status: 'ok' }, { id: 'khong-co-id' }] }));
    expect(ack).toMatchObject({ ok: true, acked: 2, unknown: ['khong-co-id'] });
    h.rt.clock.advance(125_000);
    expect((await J(await hb(d))).commands.map((c: any) => c.type)).toEqual(['set_volume']);
  });
});

describe('POST /v1/logs (muc 11)', () => {
  const entry = (msg: string, extra: Record<string, unknown> = {}) => ({ ts: new Date(h.rt.clock.now().getTime() - 1000).toISOString(), level: 'warn', tag: 'play_error', msg, ...extra });
  it('luu nhat ky (ky nhu /v1/*), kiem tra dinh dang, chan khong ky; clamp ts', async () => {
    const d = await el();
    const r = await d.call('POST', '/v1/logs', { entries: [entry('khong phat duoc creative 1'), entry('rut USB', { tag: 'usb_removed', level: 'info' })] });
    expect(r.status).toBe(200);
    expect(await J(r)).toEqual({ ok: true, stored: 2 });
    const rows = await h.rt.db.query<any>('SELECT level, tag, message FROM device_logs WHERE device_id = ? ORDER BY message', [d.id]);
    expect(rows.map((x: any) => x.tag)).toEqual(['play_error', 'usb_removed']);
    // ts qua cu bi dua ve moc 7 ngay; ts tuong lai bi kep +5 phut
    const old = new Date(h.rt.clock.now().getTime() - 30 * 86400_000).toISOString();
    const fut = new Date(h.rt.clock.now().getTime() + 86400_000).toISOString();
    await d.call('POST', '/v1/logs', { entries: [entry('cu', { ts: old }), entry('tuong lai', { ts: fut })] });
    const ts = await h.rt.db.query<any>("SELECT message, ts FROM device_logs WHERE device_id = ? AND message IN ('cu','tuong lai')", [d.id]);
    const byMsg = Object.fromEntries(ts.map((x: any) => [x.message, Date.parse(x.ts)]));
    expect(byMsg['cu']).toBeGreaterThanOrEqual(h.rt.clock.now().getTime() - 7 * 86400_000 - 1000);
    expect(byMsg['tuong lai']).toBeLessThanOrEqual(h.rt.clock.now().getTime() + 5 * 60_000 + 1000);
    // khong chu ky / sai chu ky
    expect((await h.gw.app.request('/v1/logs', { method: 'POST', body: JSON.stringify({ entries: [entry('x')] }) })).status).toBe(401);
    const other = await el();
    expect((await d.call('POST', '/v1/logs', { entries: [entry('x')] }, { key: other.keys.privateKey })).status).toBe(401);
    // dinh dang
    for (const bad of [{ entries: [] }, { entries: [{ ts: 'hom qua', msg: 'x' }] }, { entries: [{ ts: entry('x').ts, msg: '' }] }, { entries: [{ ts: entry('x').ts, msg: 'x', level: 'fatal' }] }, { entries: Array.from({ length: 101 }, () => entry('x')) }, {}]) {
      const rr = await d.call('POST', '/v1/logs', bad);
      expect([413, 422], JSON.stringify(bad).slice(0, 60)).toContain(rr.status);
    }
  });
  it('gioi han 8 KB (413) va tan suat theo device_id (429 + Retry-After); thiet bi khac khong bi anh huong', async () => {
    const h2 = await harness({ env: { HB_MIN_GAP_S: '0', LOGS_LIMIT_PER_HOUR: '3' }, fixture: { campaigns: 0 } });
    try {
      const d = await TestDevice.create(h2, { kind: 'elevator' });
      const e = (msg: string) => ({ ts: new Date(h2.rt.clock.now().getTime() - 1000).toISOString(), level: 'info', msg });
      const big = await d.call('POST', '/v1/logs', { entries: [e('x'.repeat(500)), ...Array.from({ length: 17 }, () => e('y'.repeat(500)))] });
      expect(big.status).toBe(413);
      expect((await J(big)).error.code).toBe('payload_too_large');
      const codes: number[] = [];
      let last!: Response;
      for (let i = 0; i < 5; i++) {
        last = await d.call('POST', '/v1/logs', { entries: [e('ok ' + i)] });
        codes.push(last.status);
      }
      expect(codes).toEqual([200, 200, 200, 429, 429]); // han muc 3 lan/gio
      expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
      const other = await TestDevice.create(h2, { kind: 'elevator' });
      expect((await other.call('POST', '/v1/logs', { entries: [e('khac')] })).status).toBe(200);
    } finally {
      await h2.close();
    }
  });
  it('han muc dong moi ngay theo thiet bi (LOGS_ROWS_PER_DAY)', async () => {
    const h2 = await harness({ env: { HB_MIN_GAP_S: '0', LOGS_ROWS_PER_DAY: '5' }, fixture: { campaigns: 0 } });
    try {
      const d = await TestDevice.create(h2, { kind: 'elevator' });
      const e = (msg: string) => ({ ts: new Date(h2.rt.clock.now().getTime() - 1000).toISOString(), level: 'info', msg });
      expect((await d.call('POST', '/v1/logs', { entries: [e('1'), e('2'), e('3')] })).status).toBe(200);
      expect((await d.call('POST', '/v1/logs', { entries: [e('4'), e('5'), e('6')] })).status).toBe(429);
    } finally {
      await h2.close();
    }
  });
  it('don dep: sweep() xoa nhat ky cu hon 7 ngay (theo received_at), giu dong con han', async () => {
    const d = await el();
    const now = h.rt.clock.now();
    const mk = (ageDays: number, msg: string) => h.rt.db.run('INSERT INTO device_logs (id, device_id, ts, received_at, level, tag, message) VALUES (?,?,?,?,?,?,?)', [h.rt.id(), d.id, new Date(now.getTime() - ageDays * 86400_000).toISOString(), new Date(now.getTime() - ageDays * 86400_000).toISOString(), 'info', null, msg]);
    await mk(8, 'qua han');
    await mk(6, 'con han');
    h.rt.clock.advance(11 * 60_000); // qua cua so don dep 10 phut cua cac test truoc
    const r = await h.gw.sweep();
    expect(r.logs_deleted).toBeGreaterThanOrEqual(1);
    const left = (await h.rt.db.query<any>("SELECT message FROM device_logs WHERE device_id = ? AND message IN ('qua han','con han')", [d.id])).map((x: any) => x.message);
    expect(left).toEqual(['con han']);
  });
});
