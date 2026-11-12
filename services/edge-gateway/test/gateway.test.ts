import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@ams/shared';
import { enqueueCommand } from '../src/gateway.js';
import { TestDevice, harness, impression, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await harness({ env: { HB_MIN_GAP_S: '0' } });
});
afterAll(async () => h.close());

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;

describe('register', () => {
  it('cap device_id, luu pubkey, idempotent theo pubkey, nonce attestation', async () => {
    const d = await TestDevice.create(h);
    expect(d.id).toMatch(/^[0-9A-Z]{26}$/);
    const row = (await h.rt.db.query<{ pubkey_ed25519: string; trust_level: number; shard: number }>('SELECT pubkey_ed25519, trust_level, shard FROM devices WHERE id = ?', [d.id]))[0]!;
    expect(row.pubkey_ed25519).toBe(d.keys.publicKey);
    expect(Number(row.trust_level)).toBe(0);
    const att = await h.rt.db.query('SELECT nonce FROM device_attestations WHERE device_id = ?', [d.id]);
    expect(att.length).toBe(1);
    const again = await d.registerRaw();
    expect(again.status).toBe(200);
    expect((await J(again)).device_id).toBe(d.id);
  });

  it('chu ky dang ky bang khoa khac bi tu choi (khong chung minh so huu khoa)', async () => {
    const d = await TestDevice.create(h);
    const other = await TestDevice.create(h);
    const r = await d.registerRaw({ pubkey: d.keys.publicKey }, {}, { key: other.keys.privateKey });
    expect(r.status).toBe(401);
    expect((await J(r)).error.code).toBe('invalid_signature');
  });

  it('phat lai yeu cau dang ky bi chan (nonce)', async () => {
    const d = await TestDevice.create(h);
    const nonce = 'abcdefghijklmnop0123456789';
    const a = await d.registerRaw({}, {}, { nonce });
    expect(a.status).toBe(200);
    const b = await d.registerRaw({}, {}, { nonce });
    expect(b.status).toBe(409);
    expect((await J(b)).error.code).toBe('replay');
  });

  it('gioi han toc do theo IP + Retry-After', async () => {
    const h2 = await harness({ env: { REGISTER_LIMIT_PER_HOUR: '3' } });
    try {
      const out: number[] = [];
      let last: Response | undefined;
      for (let i = 0; i < 5; i++) {
        const d = new TestDevice(h2, await (await import('../src/testing.js')).generateEd25519KeyPair());
        last = await d.registerRaw({}, { 'x-forwarded-for': '203.0.113.9' });
        out.push(last.status);
      }
      expect(out).toEqual([201, 201, 201, 429, 429]);
      expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await J(last!)).error.code).toBe('rate_limited');
    } finally {
      await h2.close();
    }
  });
});

describe('xac thuc chu ky', () => {
  it('chu ky sai / khac khoa -> 401; thieu header -> 401; sua body sau khi ky -> 401', async () => {
    const d = await TestDevice.create(h);
    const wrongKey = await TestDevice.create(h);
    const r1 = await d.call('POST', '/v1/heartbeat', { state: 1 }, { key: wrongKey.keys.privateKey });
    expect(r1.status).toBe(401);
    expect((await J(r1)).error.code).toBe('invalid_signature');
    const r2 = await h.gw.app.request('/v1/heartbeat', { method: 'POST', body: '{}', headers: { 'x-device-id': d.id } });
    expect(r2.status).toBe(401);
    // ky body A nhung gui body B
    const { signRequest } = await import('../src/testing.js');
    const s = await signRequest(d.keys.privateKey, { method: 'POST', path: '/v1/heartbeat', body: '{"state":1}', deviceId: d.id, ts: d.now() });
    const r3 = await h.gw.app.request('/v1/heartbeat', { method: 'POST', body: '{"state":0}', headers: s.headers });
    expect(r3.status).toBe(401);
  });

  it('nonce phat lai bi tu choi (409) du chu ky dung', async () => {
    const d = await TestDevice.create(h);
    const nonce = 'replaynonce0123456789ab';
    const ts = d.now();
    expect((await d.call('POST', '/v1/heartbeat', { state: 1 }, { nonce, ts })).status).toBe(200);
    const again = await d.call('POST', '/v1/heartbeat', { state: 1 }, { nonce, ts });
    expect(again.status).toBe(409);
    expect((await J(again)).error.code).toBe('replay');
    // nonce moi van vao duoc
    expect((await d.call('POST', '/v1/heartbeat', { state: 1 })).status).toBe(200);
  });

  it('timestamp qua han / tuong lai xa -> 401 stale_timestamp', async () => {
    const d = await TestDevice.create(h);
    for (const off of [-301, 301]) {
      const r = await d.call('POST', '/v1/heartbeat', {}, { ts: d.now() + off });
      expect(r.status).toBe(401);
      expect((await J(r)).error.code).toBe('stale_timestamp');
    }
    expect((await d.call('POST', '/v1/heartbeat', {}, { ts: d.now() - 290 })).status).toBe(200);
  });

  it('thiet bi la -> 401 unknown_device; thiet bi bi khoa -> 403', async () => {
    const d = await TestDevice.create(h);
    expect((await d.call('POST', '/v1/heartbeat', {}, { deviceId: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' })).status).toBe(401);
    await h.rt.db.run('UPDATE devices SET blocked = 1 WHERE id = ?', [d.id]);
    await h.gw.devices.invalidate(d.id);
    const r = await d.call('POST', '/v1/heartbeat', {});
    expect(r.status).toBe(403);
    expect((await J(r)).error.code).toBe('device_blocked');
  });
});

describe('pair', () => {
  it('ma 6 so, tra lai cung ma khi hoi lai, het han 5 phut, dung mot lan, nang trust', async () => {
    const h2 = await harness({ env: { HB_MIN_GAP_S: '0' } });
    try {
      h2.rt.clock.set(Date.now());
      const d = await TestDevice.create(h2);
      const a = await J(await d.call('POST', '/v1/pair', {}));
      expect(a.paired).toBe(false);
      expect(a.code).toMatch(/^\d{6}$/);
      expect(a.expires_in).toBe(300);
      const b = await J(await d.call('POST', '/v1/pair', {}));
      expect(b.code).toBe(a.code);
      // het han
      h2.rt.clock.advance(301_000);
      const { redeemPairingCode } = await import('../src/gateway.js');
      const uid = h2.rt.id();
      await h2.rt.db.run('INSERT INTO end_users (id, created_at) VALUES (?, ?)', [uid, h2.rt.clock.now().toISOString()]);
      expect(await redeemPairingCode(h2.rt, a.code, uid)).toEqual({ ok: false, reason: 'expired' });
      const c = await J(await d.call('POST', '/v1/pair', {}));
      expect(c.code).toMatch(/^\d{6}$/);
      expect(c.expires_in).toBe(300);
      const ok = await redeemPairingCode(h2.rt, c.code, uid);
      expect(ok).toEqual({ ok: true, deviceId: d.id });
      expect(await redeemPairingCode(h2.rt, c.code, uid)).toEqual({ ok: false, reason: 'used' });
      const st = await J(await d.call('POST', '/v1/pair', {}));
      expect(st).toEqual({ paired: true, trust_level: 1 });
    } finally {
      await h2.close();
    }
  });
});

describe('heartbeat', () => {
  it('tra next_interval, manifest_etag, group, commands; ghi presence TTL 6 phut', async () => {
    const h2 = await harness({ env: { HB_MIN_GAP_S: '0' } });
    try {
      h2.rt.clock.set(Date.now());
      const d = await TestDevice.create(h2);
      const r = await d.call('POST', '/v1/heartbeat', { state: 1, app_ver: '1.0.1', soc_temp: 55 });
      expect(r.status).toBe(200);
      const j = await J(r);
      expect(j.interval_base).toBe(300);
      expect(j.manifest_etag).toMatch(/^[0-9a-f]{16}$/);
      expect(j.manifest_group).toBe('HN.all.tv');
      expect(j.commands).toEqual([]);
      expect(await h2.rt.kv.get(`presence:${d.id}`)).not.toBeNull();
      h2.rt.clock.advance(6 * 60_000 + 1000);
      expect(await h2.rt.kv.get(`presence:${d.id}`)).toBeNull();
    } finally {
      await h2.close();
    }
  });

  it('jitter +-20% quanh chu ky co so (400 mau, co phan tan that)', async () => {
    const d = await TestDevice.create(h);
    const vals: number[] = [];
    for (let i = 0; i < 400; i++) {
      const j = await J(await d.call('POST', '/v1/heartbeat', { state: i % 2 }));
      expect(j.next_interval).toBeGreaterThanOrEqual(Math.ceil(j.interval_base * 0.8));
      expect(j.next_interval).toBeLessThanOrEqual(Math.floor(j.interval_base * 1.2));
      if (i % 2 === 1) vals.push(j.next_interval);
    }
    expect(Math.min(...vals)).toBeLessThan(270); // 300 +-20% = 240..360, co cac gia tri hai phia
    expect(Math.max(...vals)).toBeGreaterThan(330);
    expect(new Set(vals).size).toBeGreaterThan(50);
  });

  it('chu ky theo trang thai: dang phat 300, cho 600, giam sat 15; tai cao keo gian; cong tac override', async () => {
    const hi = await harness({ env: { HB_MIN_GAP_S: '0' }, gw: { rng: () => 0.5, load: () => 0.9 } });
    try {
      const d = await TestDevice.create(hi);
      const play = await J(await d.call('POST', '/v1/heartbeat', { state: 1 }));
      expect(play.interval_base).toBe(Math.round(300 * (1 + 0.2 * 4))); // tai 0,9 => x1,8
      expect(play.next_interval).toBe(play.interval_base); // rng=0,5 => jitter 0
      const idle = await J(await d.call('POST', '/v1/heartbeat', { state: 0 }));
      expect(idle.interval_base).toBe(Math.round(600 * 1.8));
      await hi.rt.kv.set('ctl:gateway', JSON.stringify({ monitored: [d.id] }));
    } finally {
      await hi.close();
    }
    const lo = await harness({ env: { HB_MIN_GAP_S: '0' }, gw: { rng: () => 0.5, load: () => 0 } });
    try {
      const d = await TestDevice.create(lo);
      await lo.rt.kv.set('ctl:gateway', JSON.stringify({ monitored: [d.id] }));
      expect((await J(await d.call('POST', '/v1/heartbeat', { state: 1 }))).interval_base).toBe(15);
    } finally {
      await lo.close();
    }
  });

  it('qua tai -> 503 overloaded + Retry-After co jitter, khong ton chu ky; events chi bi chan o tai gap doi', async () => {
    let load = 1.5;
    const hs = await harness({ env: { HB_MIN_GAP_S: '0' }, gw: { load: () => load } });
    try {
      const d = await TestDevice.create(hs);
      const ras = new Set<number>();
      for (let i = 0; i < 50; i++) {
        const r = await d.call('POST', '/v1/heartbeat', {});
        expect(r.status).toBe(503);
        expect((await J(r)).error.code).toBe('overloaded');
        const ra = Number(r.headers.get('retry-after'));
        expect(Number.isInteger(ra) && ra > 0).toBe(true);
        ras.add(ra);
      }
      expect(ras.size).toBeGreaterThan(3);
      // events chua bi chan o 1,5 (nguong 2,0)
      expect((await d.call('POST', '/v1/events', { events: [] })).status).toBe(422);
      load = 2.5;
      expect((await d.call('POST', '/v1/events', { events: [impression(hs)] })).status).toBe(503);
      load = 0;
      expect((await d.call('POST', '/v1/heartbeat', {})).status).toBe(200);
      // cong tac ngat tu may chu
      await hs.rt.kv.set('ctl:gateway', JSON.stringify({ shed: true }));
      // bo nho dem ctl 10 giay: tien dong ho
      hs.rt.clock.advance(11_000);
      expect((await d.call('POST', '/v1/heartbeat', {})).status).toBe(503);
    } finally {
      await hs.close();
    }
  });

  it('heartbeat qua day -> 429 + Retry-After (HB_MIN_GAP_S)', async () => {
    const hg = await harness({ env: { HB_MIN_GAP_S: '5' } });
    try {
      hg.rt.clock.set(Date.now());
      const d = await TestDevice.create(hg);
      expect((await d.call('POST', '/v1/heartbeat', {})).status).toBe(200);
      const r = await d.call('POST', '/v1/heartbeat', {});
      expect(r.status).toBe(429);
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
      hg.rt.clock.advance(6000);
      expect((await d.call('POST', '/v1/heartbeat', {})).status).toBe(200);
    } finally {
      await hg.close();
    }
  });

  it('lenh cho: giao o heartbeat, xoa khi cmd_ack', async () => {
    const d = await TestDevice.create(h);
    const id = await enqueueCommand(h.rt, d.id, { type: 'refresh_manifest' });
    const a = await J(await d.call('POST', '/v1/heartbeat', {}));
    expect(a.commands).toEqual([{ id, type: 'refresh_manifest' }]);
    const b = await J(await d.call('POST', '/v1/heartbeat', { cmd_ack: [id] }));
    expect(b.commands).toEqual([]);
    expect(await h.rt.kv.get(`cmd:${d.id}`)).toBeNull();
  });

  it('telemetry gop lo: khong qua queue, flush ghi ev_heartbeat va last_seen_at', async () => {
    const hq = await harness({ env: { HB_MIN_GAP_S: '0' } });
    try {
      const d = await TestDevice.create(hq);
      for (let i = 0; i < 7; i++) await d.call('POST', '/v1/heartbeat', { state: 1, soc_temp: 50 + i, app_ver: '2.0.0' });
      expect(hq.rt.queue.sent.length).toBe(0); // khong co message queue cho heartbeat
      expect((await hq.rt.db.query('SELECT 1 FROM ev_heartbeat')).length).toBe(0);
      await hq.gw.flush();
      expect((await hq.rt.db.query('SELECT 1 FROM ev_heartbeat WHERE device_id = ?', [d.id])).length).toBe(7);
      const row = (await hq.rt.db.query<{ last_seen_at: string; status: string; app_version: string }>('SELECT last_seen_at, status, app_version FROM devices WHERE id = ?', [d.id]))[0]!;
      expect(row.last_seen_at).toBeTruthy();
      expect(row.status).toBe('active');
      expect(row.app_version).toBe('2.0.0');
    } finally {
      await hq.close();
    }
  });
});

describe('manifest', () => {
  it('xay tu campaign active + schedule + creative da duyet; sha256 khop; 304 khi etag khong doi', async () => {
    const hm = await harness({ fixture: { campaigns: 2, creativesPerCampaign: 2 } });
    try {
      const d = await TestDevice.create(hm);
      const r = await d.call('GET', '/v1/manifest');
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('private, no-cache');
      const m = await J(r);
      expect(m.group).toBe('HN.all.tv');
      expect(m.creatives.length).toBe(4);
      expect(m.schedule.length).toBe(2);
      const fx = hm.fixture.campaigns[0]!.creatives[0]!;
      const c = m.creatives.find((x: any) => x.id === fx.id);
      expect(c.sha256).toBe(fx.sha256);
      expect(c.url.startsWith('https://media.test/test/')).toBe(true);
      expect(c.format).toBe('fullscreen');
      expect(c.duration_s).toBe(15);
      expect(m.schedule[0].creative_ids.length).toBe(2);
      // 304
      const r2 = await d.call('GET', `/v1/manifest?etag=${m.etag}`);
      expect(r2.status).toBe(304);
      expect(await r2.text()).toBe('');
      expect(r2.headers.get('etag')).toBe(`"${m.etag}"`);
      const r3 = await d.call('GET', '/v1/manifest?etag=deadbeefdeadbeef');
      expect(r3.status).toBe(200);
      // If-None-Match
      const r4 = await d.call('GET', '/v1/manifest', undefined, { headers: { 'if-none-match': `"${m.etag}"` } });
      expect(r4.status).toBe(304);
    } finally {
      await hm.close();
    }
  });

  it('khong dua vao manifest: chien dich khong active, creative chua duyet, tep khong xac minh duoc, sai vung', async () => {
    const hm = await harness({ fixture: { campaigns: 3 } });
    try {
      const [a, b, c] = hm.fixture.campaigns;
      await hm.rt.db.run(`UPDATE campaigns SET state = 'paused' WHERE id = ?`, [a!.id]);
      await hm.rt.db.run(`UPDATE creatives SET review_state = 'pending' WHERE campaign_id = ?`, [b!.id]);
      const d = await TestDevice.create(hm);
      const m = await J(await d.call('GET', '/v1/manifest'));
      expect(m.creatives.map((x: any) => x.campaign_id)).toEqual([c!.id]);
      // creative khong co tep trong object store => khong xac minh sha256 => loai
      await hm.rt.db.run(`UPDATE creatives SET storage_key = 'missing/x.mp4' WHERE campaign_id = ?`, [c!.id]);
      await hm.rt.kv.del(`creative:sha256:${c!.creatives[0]!.id}`);
      await hm.gw.manifests.invalidate();
      await hm.rt.kv.del('manifest:HN.all.tv');
      const m2 = await J(await d.call('GET', '/v1/manifest'));
      expect(m2.creatives).toEqual([]);
      // thiet bi o vung khac (DN) khong co lich (slot chi HN,HCM)
      const dn = await TestDevice.create(hm, { region: 'DN' });
      expect((await J(await dn.call('GET', '/v1/manifest'))).schedule).toEqual([]);
    } finally {
      await hm.close();
    }
  });

  it('doi lich -> etag moi; delta chi gui phan doi; duong cong khai co Cache-Control CDN + 304 + khong liet ke nhom la', async () => {
    const hm = await harness({ fixture: { campaigns: 2 } });
    try {
      const d = await TestDevice.create(hm);
      const m1 = await J(await d.call('GET', '/v1/manifest'));
      const hb = await J(await d.call('POST', '/v1/heartbeat', {}));
      expect(hb.manifest_etag).toBe(m1.etag);
      expect(hb.manifest_url).toBe('/v1/manifest/g/HN.all.tv');
      // cong khai
      const pub = await hm.gw.app.request(hb.manifest_url);
      expect(pub.status).toBe(200);
      expect(pub.headers.get('cache-control')).toMatch(/^public, .*s-maxage=900/);
      expect((await J(pub)).etag).toBe(m1.etag);
      expect((await hm.gw.app.request(`${hb.manifest_url}?etag=${m1.etag}`)).status).toBe(304);
      expect((await hm.gw.app.request('/v1/manifest/g/HN.all.led_p5_512x256')).status).toBe(404);
      expect((await hm.gw.app.request('/v1/manifest/g/..%2F..')).status).toBe(404);
      // tam dung 1 chien dich
      await hm.rt.db.run(`UPDATE campaigns SET state = 'paused' WHERE id = ?`, [hm.fixture.campaigns[0]!.id]);
      await hm.gw.manifests.invalidate({ region: 'HN', daypart: 'all', modelClass: 'tv' });
      const m2 = await J(await d.call('GET', '/v1/manifest'));
      expect(m2.etag).not.toBe(m1.etag);
      expect(m2.creatives.length).toBe(1);
      const delta = await d.call('GET', `/v1/manifest?etag=${m1.etag}&delta=1`);
      expect(delta.headers.get('x-manifest-kind')).toBe('delta');
      const dj = await J(delta);
      expect(dj.creatives_removed).toEqual([hm.fixture.campaigns[0]!.creatives[0]!.id]);
      expect(dj.creatives_added).toEqual([]);
      expect(dj.etag).toBe(m2.etag);
      expect(dj.base_etag).toBe(m1.etag);
      // etag la khong con ban luu => ban day du
      const full = await d.call('GET', '/v1/manifest?etag=0123456789abcdef&delta=1');
      expect(full.headers.get('x-manifest-kind')).toBe('full');
    } finally {
      await hm.close();
    }
  });

  it('thang may / LED chi nhan creative dung do phan giai cua man hinh', async () => {
    const hm = await harness({ fixture: { campaigns: 1, targetType: 'led_p5', px: { w: 512, h: 256 } } });
    try {
      const d = await TestDevice.create(hm, { kind: 'led_p5' });
      const vid = hm.rt.id();
      await hm.rt.db.run('INSERT INTO venues (id, name, kind, created_at) VALUES (?, ?, ?, ?)', [vid, 'V', 'parking', hm.rt.clock.now().toISOString()]);
      await hm.rt.db.run(`INSERT INTO screens (id, venue_id, type, px_w, px_h, device_id) VALUES (?, ?, 'led_p5', 512, 256, ?)`, [hm.rt.id(), vid, d.id]);
      await hm.gw.devices.invalidate(d.id);
      const m = await J(await d.call('GET', '/v1/manifest'));
      expect(m.group).toBe('HN.all.led_p5_512x256');
      expect(m.creatives.length).toBe(1);
      const other = await TestDevice.create(hm, { kind: 'led_p5' });
      const sid = hm.rt.id();
      await hm.rt.db.run(`INSERT INTO screens (id, venue_id, type, px_w, px_h, device_id) VALUES (?, ?, 'led_p5', 256, 128, ?)`, [sid, vid, other.id]);
      const m2 = await J(await other.call('GET', '/v1/manifest'));
      expect(m2.group).toBe('HN.all.led_p5_256x128');
      expect(m2.creatives).toEqual([]);
    } finally {
      await hm.close();
    }
  });
});

describe('events', () => {
  async function paired(hh: Harness): Promise<TestDevice> {
    const d = await TestDevice.create(hh);
    await d.pair();
    return d;
  }

  it('lo hop le -> 202, queue -> consumer ghi ev_ad_impression + impression_hourly + goi ham tru chi tieu', async () => {
    const he = await harness();
    try {
      const d = await paired(he);
      const evs = [impression(he), impression(he), impression(he, { camp: 0 })];
      const r = await d.call('POST', '/v1/events', { events: evs });
      expect(r.status).toBe(202);
      expect(await J(r)).toEqual({ accepted: 3, valid: 3, flagged: 0, rejected: [] });
      await he.rt.queue.drain();
      const rows = await he.rt.db.query<{ event_id: string; valid: number; reward_vnd: number; revenue_micro_vnd: number; screen_id: string | null; device_id: string; region_id: string }>('SELECT * FROM ev_ad_impression');
      expect(rows.length).toBe(3);
      expect(rows.every((x) => Number(x.valid) === 1 && x.device_id === d.id && x.region_id === 'HN')).toBe(true);
      expect(rows.every((x) => Number(x.reward_vnd) === 10)).toBe(true); // reward_points 10 x 1
      const hourly = await he.rt.db.query<{ impressions: number; valid: number; revenue_micro_vnd: number }>('SELECT * FROM impression_hourly');
      expect(hourly.length).toBe(1);
      expect(Number(hourly[0]!.impressions)).toBe(3);
      expect(Number(hourly[0]!.revenue_micro_vnd)).toBe(3 * 20_000_000);
      expect(he.spends.length).toBe(1);
      expect(he.spends[0]).toMatchObject({ campaignId: he.fixture.campaigns[0]!.id, customerId: he.fixture.customerId, impressions: 3, amountMicroVnd: 60_000_000 });
    } finally {
      await he.close();
    }
  });

  it('event trung KHONG dem hai lan: cung lo gui lai, lo chong lan, gui song song', async () => {
    const he = await harness();
    try {
      const d = await paired(he);
      const evs = [impression(he), impression(he), impression(he)];
      expect((await d.call('POST', '/v1/events', { events: evs })).status).toBe(202);
      expect((await d.call('POST', '/v1/events', { events: evs })).status).toBe(202); // thiet bi thu lai (nonce moi)
      const extra = impression(he);
      expect((await d.call('POST', '/v1/events', { events: [evs[0], extra, evs[0]] })).status).toBe(202);
      await Promise.all([d.call('POST', '/v1/events', { events: [extra] }), d.call('POST', '/v1/events', { events: [extra] })]);
      await he.rt.queue.drain();
      expect(Number((await he.rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression'))[0]!.n)).toBe(4);
      expect(Number((await he.rt.db.query<{ n: number }>('SELECT SUM(impressions) AS n FROM impression_hourly'))[0]!.n)).toBe(4);
      expect(he.spends.reduce((s, x) => s + x.impressions, 0)).toBe(4);
      expect(he.spends.reduce((s, x) => s + x.amountMicroVnd, 0)).toBe(4 * 20_000_000);
      expect(await he.rt.events.countImpressions(he.fixture.campaigns[0]!.id)).toBe(4);
    } finally {
      await he.close();
    }
  });

  it('thiet bi trust_level=0: ghi nhan nhung valid=0, khong tinh tien, khong hoa hong', async () => {
    const he = await harness();
    try {
      const d = await TestDevice.create(he); // chua ghep doi => trust 0
      const r = await J(await d.call('POST', '/v1/events', { events: [impression(he), impression(he)] }));
      expect(r).toMatchObject({ accepted: 2, valid: 0, flagged: 2 });
      await he.rt.queue.drain();
      const rows = await he.rt.db.query<{ valid: number; reject_reason: string; reward_vnd: number; revenue_micro_vnd: number }>('SELECT * FROM ev_ad_impression');
      expect(rows.length).toBe(2);
      expect(rows.every((x) => Number(x.valid) === 0 && x.reject_reason === 'untrusted_device' && Number(x.reward_vnd) === 0 && Number(x.revenue_micro_vnd) === 0)).toBe(true);
      expect(he.spends.length).toBe(0);
    } finally {
      await he.close();
    }
  });

  it('kiem VCR / hop le: vcr thap, phat qua ngan, creative la, ts ngoai khoang, malformed, tran/gio', async () => {
    const he = await harness({ gw: { policy: { maxPerDeviceHour: 2 } } });
    try {
      const d = await paired(he);
      const unknown = { ...impression(he), creative_id: 'khong-co-trong-manifest' };
      const wrongCampaign = { ...impression(he), campaign_id: 'chien-dich-khac' };
      const evs = [
        impression(he, { vcr: 60 }), // vcr_low
        impression(he, { played: 3000 }), // short_play
        unknown,
        wrongCampaign,
        impression(he, { tsOffsetMs: 10 * 3600_000 }), // tuong lai
        impression(he, { tsOffsetMs: -72 * 3600_000 }), // qua cu
        { type: 'impression', event_id: 'khong-phai-uuid', ts: 'x' },
        impression(he), // hop le 1
        impression(he), // hop le 2
        impression(he), // vuot tran => rate_cap
      ];
      const r = await J(await d.call('POST', '/v1/events', { events: evs }));
      expect(r.valid).toBe(2);
      expect(r.flagged).toBe(3); // vcr_low, short_play, rate_cap
      expect(r.rejected.map((x: any) => x.reason).sort()).toEqual(['campaign_mismatch', 'malformed', 'not_in_manifest', 'ts_out_of_range', 'ts_out_of_range']);
      await he.rt.queue.drain();
      const reasons = (await he.rt.db.query<{ reject_reason: string | null }>('SELECT reject_reason FROM ev_ad_impression')).map((x) => x.reject_reason).sort();
      expect(reasons).toEqual([null, null, 'rate_cap', 'short_play', 'vcr_low']);
      expect(he.spends.reduce((s, x) => s + x.impressions, 0)).toBe(2);
    } finally {
      await he.close();
    }
  });

  it('gioi han lo: 51 su kien -> 422; body khong ky -> 401; body sai chu ky -> 401', async () => {
    const he = await harness();
    try {
      const d = await paired(he);
      const evs = Array.from({ length: 51 }, () => impression(he));
      const r = await d.call('POST', '/v1/events', { events: evs });
      expect(r.status).toBe(422);
      expect((await J(r)).error.code).toBe('validation_failed');
      expect((await d.call('POST', '/v1/events', { events: Array.from({ length: 50 }, () => impression(he)) })).status).toBe(202);
      expect((await h.gw.app.request('/v1/events', { method: 'POST', body: '{"events":[]}' })).status).toBe(401);
      const wrong = await TestDevice.create(he);
      expect((await d.call('POST', '/v1/events', { events: [impression(he)] }, { key: wrong.keys.privateKey })).status).toBe(401);
    } finally {
      await he.close();
    }
  });

  it('proof_of_play (thang may/LED) duoc ghi va khu trung', async () => {
    const he = await harness({ fixture: { targetType: 'elevator', px: { w: 1080, h: 1920 } } });
    try {
      const d = await TestDevice.create(he, { kind: 'elevator' });
      const cr = he.fixture.campaigns[0]!.creatives[0]!.id;
      const t = he.rt.clock.now().getTime() - 1000;
      const ev = { type: 'proof_of_play', event_id: uuidv7(t), ts: new Date(t).toISOString(), creative_id: cr, duration_ms: 15000 };
      await d.call('POST', '/v1/events', { events: [ev] });
      await d.call('POST', '/v1/events', { events: [ev] });
      await he.rt.queue.drain();
      expect((await he.rt.db.query('SELECT * FROM ev_proof_of_play')).length).toBe(1);
    } finally {
      await he.close();
    }
  });
});

describe('khac', () => {
  it('/health, 404 dang loi chuan', async () => {
    expect((await h.gw.app.request('/health')).status).toBe(200);
    const r = await h.gw.app.request('/v1/khong-co');
    expect(r.status).toBe(404);
    expect((await J(r)).error.code).toBe('not_found');
  });
});
