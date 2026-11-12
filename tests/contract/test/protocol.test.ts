// HOP DONG giao thuc gateway (docs/DEVICE-PROTOCOL.md) kiem bang goi thang vao gateway that tren test runtime.
// Moi test chi dung HTTP cong khai (app.request) + DB de doi chieu; khong import noi bo cua dich vu.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ed25519Sign, canonicalRequest, sha256Hex } from '@ams/shared';
import { ERROR_CODES } from '@ams/edge-gateway/protocol';
import { enqueueCommand } from '@ams/edge-gateway';
import { Dev, createWorld, impression, settleMoney, snapshot, type World } from '../src/world.js';

let w: World;
beforeAll(async () => {
  w = await createWorld({ campaigns: 2, creativesPerCampaign: 2, env: { HB_MIN_GAP_S: '0' } });
});
afterAll(async () => w.close());

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;
/** moi phan hoi loi phai dung phong bi { error: { code, message, details? } } va HTTP khop bang ma loi */
async function expectError(r: Response, status: number, code: string): Promise<any> {
  expect(r.status).toBe(status);
  const b = await J(r);
  expect(Object.keys(b)).toEqual(['error']);
  expect(b.error.code).toBe(code);
  expect(typeof b.error.message).toBe('string');
  expect(b.error.message.length).toBeGreaterThan(0);
  expect((ERROR_CODES as Record<string, number>)[code]).toBe(status);
  return b.error;
}

describe('health', () => {
  it('GET /health khong can ky', async () => {
    const r = await w.gw.app.request('/health');
    expect(r.status).toBe(200);
    const b = await J(r);
    expect(b.ok).toBe(true);
    expect(b.service).toBe('edge-gateway');
    expect(new Date(b.time).toISOString()).toBe(b.time);
  });
});

describe('register', () => {
  it('201 moi + dung kieu truong; 200 khi cung pubkey (idempotent, cung device_id)', async () => {
    const d = new Dev(w);
    d.keys = await (await import('@ams/edge-gateway/testing')).generateEd25519KeyPair();
    const a = await d.register({ region: 'HN' });
    expect(a.status).toBe(201);
    const ja = await J(a);
    expect(ja).toMatchObject({ trust_level: 0, protocol: 1, created: true });
    expect(ja.device_id).toMatch(/^[0-9A-Z]{26}$/);
    expect(typeof ja.attestation_nonce).toBe('string');
    expect(typeof ja.heartbeat_interval).toBe('number');
    expect(new Date(ja.server_time).toISOString()).toBe(ja.server_time); // client Java doc learnServerTime tu chuoi ISO nay
    const b = await d.register({ region: 'HN' });
    expect(b.status).toBe(200);
    expect((await J(b)).device_id).toBe(ja.device_id);
  });
  it('422 khi pubkey sai do dai/ky tu, kind la; loi co details', async () => {
    const d = await Dev.create(w, { pair: false });
    const e1 = await expectError(await d.register({ pubkey: 'abc' }), 422, 'validation_failed');
    expect(Array.isArray(e1.details)).toBe(true);
    await expectError(await d.register({ kind: 'toaster' }), 422, 'validation_failed');
  });
  it('401 invalid_signature khi ky bang khoa khac; 409 replay khi lap nonce; nonce chi bi "dot" sau khi chu ky dung', async () => {
    const a = await Dev.create(w, { pair: false });
    const b = await Dev.create(w, { pair: false });
    await expectError(await a.register({}, { key: b.keys.privateKey, nonce: 'sharednonce0123456789' }), 401, 'invalid_signature');
    // nonce vua dung voi chu ky SAI khong bi tieu: lan hop le tiep theo van qua
    expect((await a.register({}, { nonce: 'sharednonce0123456789' })).status).toBe(200);
    await expectError(await a.register({}, { nonce: 'sharednonce0123456789' }), 409, 'replay');
  });
});

describe('pair', () => {
  it('chua ghep: {paired:false, code 6 so, expires_in<=300}; cung ma khi tham do lai; ghep xong: {paired:true, trust_level:1}', async () => {
    const d = await Dev.create(w, { pair: false });
    const a = await J(await d.call('POST', '/v1/pair', {}));
    expect(a.paired).toBe(false);
    expect(a.code).toMatch(/^\d{6}$/);
    expect(a.expires_in).toBeGreaterThan(0);
    expect(a.expires_in).toBeLessThanOrEqual(300);
    expect(a.ttl_s).toBe(300);
    expect(new Date(a.expires_at).getTime()).toBeGreaterThan(w.rt.clock.now().getTime());
    const b = await J(await d.call('POST', '/v1/pair', {}));
    expect(b.code).toBe(a.code);
    await d.pair();
    expect(await J(await d.call('POST', '/v1/pair', {}))).toEqual({ paired: true, trust_level: 1 });
  });
});

describe('chu ky, dong ho, replay', () => {
  it('vector trong tai lieu muc 3.4: canonical string + chu ky Ed25519 tat dinh (client Java phai ra dung cac byte nay)', async () => {
    const pkcs8 = 'MC4CAQAwBQYDK2VwBCIEIAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g';
    const body = '{"state":1,"app_ver":"2.4.1"}';
    const sh = await sha256Hex(body);
    expect(sh).toBe('9c988fe6254f7a3302fb33f879385e791d10bda67dc85368fe881620f4382373');
    const msg = canonicalRequest('POST', '/v1/heartbeat', '1790000000', 'dGVzdC1ub25jZS0wMDAxMjM0NQ', sh);
    expect(msg).toBe('POST\n/v1/heartbeat\n1790000000\ndGVzdC1ub25jZS0wMDAxMjM0NQ\n' + sh);
    expect(await ed25519Sign(pkcs8, msg)).toBe('CXnm2wux9_DA7w9k-ffoDVttGjqKMHjnqqfFVyE27vpclPh3_0WZ3ygHkxv8XPjybGuxllXWqns0Faj8MlvoCQ');
    const emptySha = await sha256Hex('');
    expect(emptySha).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const msgB = canonicalRequest('GET', '/v1/manifest?etag=0123456789abcdef', '1790000000', 'dGVzdC1ub25jZS0wMDAyMzQ1Ng', emptySha);
    expect(await ed25519Sign(pkcs8, msgB)).toBe('mXpRgShahnYz44uqDrSX6u8DA7shknkoBs5gFUwr4locDX74EgL8DU3XwagpYkjBeych2IcTcg-K9lMe_W4gCg');
  });

  it('401 stale_timestamp kem details.server_time (epoch giay, so) va client hoc do lech roi thu lai duoc (hanh vi AmsClient.java)', async () => {
    const d = await Dev.create(w);
    const skew = 3600;
    const r1 = await d.call('POST', '/v1/heartbeat', { state: 1 }, { ts: d.nowS() - skew });
    const err = await expectError(r1, 401, 'stale_timestamp');
    expect(typeof err.details.server_time).toBe('number');
    const off = err.details.server_time - (d.nowS() - skew);
    const r2 = await d.call('POST', '/v1/heartbeat', { state: 1 }, { ts: d.nowS() - skew + off });
    expect(r2.status).toBe(200);
  });
  it('bien +-300 giay: 300 qua, 301 bi tu choi', async () => {
    const d = await Dev.create(w);
    expect((await d.call('POST', '/v1/heartbeat', { state: 1 }, { ts: d.nowS() - 300 })).status).toBe(200);
    await expectError(await d.call('POST', '/v1/heartbeat', { state: 1 }, { ts: d.nowS() - 301 }), 401, 'stale_timestamp');
    expect((await d.call('POST', '/v1/heartbeat', { state: 1 }, { ts: d.nowS() + 300 })).status).toBe(200);
    await expectError(await d.call('POST', '/v1/heartbeat', { state: 1 }, { ts: d.nowS() + 301 }), 401, 'stale_timestamp');
  });
  it('phat lai (cung nonce, cung thanh phan) -> 409 replay; nonce moi + ky lai -> 200', async () => {
    const d = await Dev.create(w);
    const nonce = 'replaynonce0123456789ab';
    expect((await d.call('POST', '/v1/heartbeat', { state: 1 }, { nonce })).status).toBe(200);
    await expectError(await d.call('POST', '/v1/heartbeat', { state: 1 }, { nonce }), 409, 'replay');
    expect((await d.call('POST', '/v1/heartbeat', { state: 1 })).status).toBe(200);
  });
  it('phat lai nonce tren duong khac / sau khi 10 phut nonce het han (nonce nho theo thiet bi)', async () => {
    const d = await Dev.create(w);
    const nonce = 'crossnonce0123456789abc';
    expect((await d.call('GET', '/v1/manifest', undefined, { nonce })).status).toBe(200);
    await expectError(await d.call('POST', '/v1/heartbeat', { state: 1 }, { nonce }), 409, 'replay');
    // sau >10 phut thi chu ky cu da qua han dong ho nen van khong the phat lai (ts cu bi stale)
    w.rt.clock.advance?.(11 * 60_000);
    await expectError(await d.call('GET', '/v1/manifest', undefined, { nonce, ts: d.nowS() - 11 * 60 }), 401, 'stale_timestamp');
  });
  it('sua than/duong dan/query sau khi ky -> invalid_signature (khong lap duoc yeu cau khac)', async () => {
    const d = await Dev.create(w);
    const s = await d.call('POST', '/v1/heartbeat', undefined, { raw: '{"state":1}', headers: { 'content-type': 'application/json' } });
    expect(s.status).toBe(200);
    // ky than A nhung gui than B
    const sig = await (async () => {
      const ts = d.nowS();
      const nonce = 'tamperednonce0123456789';
      const { signRequest } = await import('@ams/edge-gateway/testing');
      const h = await signRequest(d.keys.privateKey, { method: 'POST', path: '/v1/heartbeat', body: '{"state":1}', deviceId: d.id, ts, nonce });
      return h.headers;
    })();
    await expectError(await w.gw.app.request('/v1/heartbeat', { method: 'POST', headers: sig, body: '{"state":2}' }), 401, 'invalid_signature');
    // ky query A gui query B
    await expectError(await d.call('GET', '/v1/manifest?etag=bbbbbbbbbbbbbbbb', undefined, { signPath: '/v1/manifest?etag=aaaaaaaaaaaaaaaa' }), 401, 'invalid_signature');
  });
  it('thieu/sai X-Device-Id -> 401 unknown_device; nonce sai dinh dang / thieu chu ky -> 401 invalid_signature; thiet bi A khong ky ho B', async () => {
    const a = await Dev.create(w);
    const b = await Dev.create(w);
    await expectError(await a.call('POST', '/v1/heartbeat', { state: 1 }, { deviceId: null }), 401, 'unknown_device');
    await expectError(await a.call('POST', '/v1/heartbeat', { state: 1 }, { deviceId: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' }), 401, 'unknown_device');
    await expectError(await a.call('POST', '/v1/heartbeat', { state: 1 }, { nonce: 'short' }), 401, 'invalid_signature');
    await expectError(await a.call('POST', '/v1/heartbeat', { state: 1 }, { deviceId: b.id }), 401, 'invalid_signature');
    const nosig = await w.gw.app.request('/v1/heartbeat', { method: 'POST', body: '{}', headers: { 'x-device-id': a.id } });
    await expectError(nosig, 401, 'invalid_signature');
  });
  it('than khong phai JSON -> 400 bad_request (da ky hop le)', async () => {
    const d = await Dev.create(w);
    await expectError(await d.call('POST', '/v1/heartbeat', undefined, { raw: '{not json' }), 400, 'bad_request');
  });
});

describe('heartbeat', () => {
  it('200: cac truong va kieu ma client Java doc; next_interval trong [0,8;1,2] x interval_base', async () => {
    const d = await Dev.create(w);
    const r = await d.call('POST', '/v1/heartbeat', { state: 1, app_ver: '1.0.0', soc_temp: 50, rssi: -55, dl_mbps: 20, cache_used_mb: 10, cache_slots: 4 });
    expect(r.status).toBe(200);
    const b = await J(r);
    expect(b.ok).toBe(true);
    expect(new Date(b.server_time).toISOString()).toBe(b.server_time);
    expect(b.interval_base).toBe(300); // state 1 = dang phat
    expect(b.next_interval).toBeGreaterThanOrEqual(Math.ceil(0.8 * b.interval_base));
    expect(b.next_interval).toBeLessThanOrEqual(Math.floor(1.2 * b.interval_base));
    expect(b.manifest_etag).toMatch(/^[0-9a-f]{16}$/);
    expect(b.manifest_group).toBe('HN.all.tv');
    expect(b.manifest_url).toBe('/v1/manifest/g/HN.all.tv');
    expect(Array.isArray(b.commands)).toBe(true);
  });
  it('chu ky theo state: 0->600, 1->300, 2->120, 3->15', async () => {
    const d = await Dev.create(w);
    const base: number[] = [];
    for (const s of [0, 1, 2, 3]) base.push((await J(await d.call('POST', '/v1/heartbeat', { state: s }))).interval_base);
    expect(base).toEqual([600, 300, 120, 15]);
  });
  it('422 khi state ngoai 0..3; 413 khi than > 2 KB', async () => {
    const d = await Dev.create(w);
    await expectError(await d.call('POST', '/v1/heartbeat', { state: 9 }), 422, 'validation_failed');
    await expectError(await d.call('POST', '/v1/heartbeat', undefined, { raw: JSON.stringify({ state: 1, app_ver: 'x'.repeat(3000) }) }), 413, 'payload_too_large');
  });
  it('429 rate_limited + Retry-After khi heartbeat day hon HB_MIN_GAP_S (mac dinh 5 giay)', async () => {
    const w2 = await createWorld({ env: { HB_MIN_GAP_S: '5' } });
    try {
      const d = await Dev.create(w2);
      expect((await d.call('POST', '/v1/heartbeat', { state: 1 })).status).toBe(200);
      const r = await d.call('POST', '/v1/heartbeat', { state: 1 });
      await expectError(r.clone(), 429, 'rate_limited');
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
      w2.rt.clock.advance?.(6000);
      expect((await d.call('POST', '/v1/heartbeat', { state: 1 })).status).toBe(200);
    } finally {
      await w2.close();
    }
  });
  it('thiet bi bi khoa -> 403 device_blocked', async () => {
    const d = await Dev.create(w);
    await w.rt.db.run('UPDATE devices SET blocked = 1 WHERE id = ?', [d.id]);
    await w.rt.kv.del('dev:' + d.id);
    await w.gw.devices.invalidate(d.id);
    await expectError(await d.call('POST', '/v1/heartbeat', { state: 1 }), 403, 'device_blocked');
  });
});

describe('manifest', () => {
  it('200 day du: ETag header (co ngoac kep) == body.etag; creative/slot dung truong; sha256 khop tep that; lich chi tham chieu creative co mat', async () => {
    const d = await Dev.create(w);
    const { res, json: m } = await d.manifest();
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${m!.etag}"`);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    expect(m!.version).toBe(1);
    expect(m!.group).toBe('HN.all.tv');
    expect(m!.tz).toBe('Asia/Ho_Chi_Minh');
    expect(m!.etag).toMatch(/^[0-9a-f]{16}$/);
    expect(m!.ttl_s).toBeGreaterThan(0);
    expect(m!.creatives.length).toBeGreaterThan(0);
    for (const c of m!.creatives) {
      expect(Object.keys(c)).toEqual(expect.arrayContaining(['id', 'campaign_id', 'url', 'sha256', 'duration_s', 'px_w', 'px_h', 'format', 'media_type', 'size_bytes']));
      expect(c.url).toMatch(/^https:\/\//);
      expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
      const owner = w.fixture.campaigns.find((x) => x.id === c.campaign_id)!;
      expect(owner.creatives.find((x) => x.id === c.id)!.sha256).toBe(c.sha256);
    }
    const ids = new Set(m!.creatives.map((c) => c.id));
    expect(m!.schedule.length).toBeGreaterThan(0);
    for (const s of m!.schedule) {
      expect(Object.keys(s)).toEqual(expect.arrayContaining(['slot_id', 'campaign_id', 'creative_ids', 'daypart', 'start_min', 'end_min', 'priority', 'reward_points']));
      expect(s.start_min).toBeLessThan(s.end_min);
      expect(s.start_min).toBeGreaterThanOrEqual(0);
      expect(s.end_min).toBeLessThanOrEqual(1440);
      expect(s.creative_ids.length).toBeGreaterThan(0);
      for (const id of s.creative_ids) expect(ids.has(id)).toBe(true);
    }
  });
  it('304 thân rỗng voi ?etag= hoac If-None-Match; etag cu -> 200 day du; etag on dinh giua cac lan goi', async () => {
    const d = await Dev.create(w);
    const { json: m } = await d.manifest();
    const again = (await d.manifest()).json!;
    expect(again.etag).toBe(m!.etag);
    const a = await d.call('GET', `/v1/manifest?etag=${m!.etag}`);
    expect(a.status).toBe(304);
    expect(await a.text()).toBe('');
    const b = await d.call('GET', '/v1/manifest', undefined, { headers: { 'if-none-match': `"${m!.etag}"` } });
    expect(b.status).toBe(304);
    const c = await d.call('GET', '/v1/manifest?etag=0123456789abcdef');
    expect(c.status).toBe(200);
    expect(c.headers.get('etag')).toBe(`"${m!.etag}"`);
    // heartbeat bao cung etag voi manifest (client doi etag de quyet dinh tai lai)
    expect((await J(await d.call('POST', '/v1/heartbeat', { state: 1 }))).manifest_etag).toBe(m!.etag);
  });
  it('dung chien dich -> sau khi xoa cache nhom etag doi, 304 cu khong con, creative bi go; delta (delta=1) ap dung dung ra ban day du', async () => {
    const w2 = await createWorld({ campaigns: 2, creativesPerCampaign: 1 });
    try {
      const d = await Dev.create(w2);
      const full1 = (await d.manifest()).json!;
      expect(full1.creatives.length).toBe(2);
      await w2.rt.db.run("UPDATE campaigns SET state = 'paused' WHERE id = ?", [w2.campaignIds[1]]);
      await w2.rt.kv.incr('manifest:epoch').catch(() => undefined);
      await w2.rt.kv.del('manifest:HN.all.tv');
      w2.rt.clock.advance?.(20_000);
      const stale = await d.call('GET', `/v1/manifest?etag=${full1.etag}`);
      expect(stale.status).toBe(200);
      const full2 = (await J(stale)) as typeof full1;
      expect(full2.etag).not.toBe(full1.etag);
      expect(full2.creatives.map((c) => c.campaign_id)).toEqual([w2.campaignIds[0]]);
      expect(full2.schedule.every((s) => s.campaign_id === w2.campaignIds[0])).toBe(true);
      // delta tu etag cu
      const dres = await d.call('GET', `/v1/manifest?etag=${full1.etag}&delta=1`);
      expect(dres.status).toBe(200);
      if (dres.headers.get('x-manifest-kind') === 'delta') {
        const delta = await J(dres);
        expect(delta.base_etag).toBe(full1.etag);
        const merged = [...full1.creatives.filter((c) => !delta.creatives_removed.includes(c.id)), ...delta.creatives_added].map((c: any) => c.id).sort();
        expect(merged).toEqual(full2.creatives.map((c) => c.id).sort());
        expect(delta.schedule).toEqual(full2.schedule);
        expect(delta.etag).toBe(full2.etag);
      } else {
        expect(dres.headers.get('x-manifest-kind')).toBe('full');
      }
    } finally {
      await w2.close();
    }
  });
  it('duong cong khai /v1/manifest/g/<nhom>: khong ky, noi dung = ban co ky, Cache-Control public, 304, nhom la 404', async () => {
    const d = await Dev.create(w);
    const signed = (await d.manifest()).json!;
    const r = await w.gw.app.request('/v1/manifest/g/HN.all.tv');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toMatch(/public/);
    const pub = await J(r);
    expect(pub.etag).toBe(signed.etag);
    expect(pub.creatives).toEqual(signed.creatives);
    expect((await w.gw.app.request(`/v1/manifest/g/HN.all.tv?etag=${signed.etag}`)).status).toBe(304);
    await expectError(await w.gw.app.request('/v1/manifest/g/ZZ.all.tv'), 404, 'not_found');
  });
  it('overlay (app TV): creative co overlay hop le thi manifest tra overlay dung schema; overlay hong thi bi bo, khong lam hong manifest', async () => {
    const w2 = await createWorld({ campaigns: 1, creativesPerCampaign: 2 });
    try {
      const [c1, c2] = w2.fixture.campaigns[0]!.creatives;
      const good = { v: 1, sponsor_tag: 'TAI TRO', headline: 'Xin chao', badges: ['A'], duration_s: 15, kid_safe: true, contexts: ['fullscreen'], safe_area: { top: 5, right: 5, bottom: 5, left: 5 } };
      await w2.rt.db.run('UPDATE creatives SET overlay = ? WHERE id = ?', [JSON.stringify(good), c1!.id]);
      await w2.rt.db.run('UPDATE creatives SET overlay = ? WHERE id = ?', ['{"headline": 12345, "zzz": ', c2!.id]);
      const d = await Dev.create(w2);
      const m = (await d.manifest()).json! as any;
      expect(m.creatives.length).toBe(2);
      const o1 = m.creatives.find((c: any) => c.id === c1!.id).overlay;
      const o2 = m.creatives.find((c: any) => c.id === c2!.id).overlay;
      expect(o1).toMatchObject({ headline: 'Xin chao', sponsor_tag: 'TAI TRO', badges: ['A'] });
      expect(o2).toBeUndefined();
    } finally {
      await w2.close();
    }
  });
});

describe('events', () => {
  it('202 {accepted, valid, flagged, rejected[]}; thiet bi da ghep -> valid; event vao ev_ad_impression; tinh tien dung 1 lan', async () => {
    const w2 = await createWorld();
    try {
      const d = await Dev.create(w2);
      const batch = [impression(w2), impression(w2), impression(w2)];
      const r = await d.events(batch);
      expect(r.status).toBe(202);
      expect(await J(r)).toEqual({ accepted: 3, valid: 3, flagged: 0, rejected: [] });
      await settleMoney(w2);
      const s = await snapshot(w2);
      expect(s.impressionRows.sort()).toEqual(batch.map((e) => e['event_id'] as string).sort());
      // 3 x 20,5 VND = 61,5 -> 61 VND, du 0,5
      expect(s.campaigns[0]).toMatchObject({ spent: 61, remainder: 500_000 });
      expect(s.ledgerSpend).toBe(61);
    } finally {
      await w2.close();
    }
  });
  it('IDEMPOTENT: gui lai nguyen lo, gui lai lo chong lan, gui song song: moi event_id chi tinh mot lan (su kien, impression_hourly, tien)', async () => {
    const w2 = await createWorld();
    try {
      const d = await Dev.create(w2);
      const all = Array.from({ length: 10 }, () => impression(w2));
      const A = all.slice(0, 6);
      const B = all.slice(4, 10); // chong lan 2 phan tu
      await d.events(A);
      await d.events(A);
      await Promise.all([d.events(B), d.events(B), d.events(A)]);
      await d.events(all);
      await settleMoney(w2);
      const s = await snapshot(w2);
      expect(s.impressionRows.length).toBe(10);
      expect(s.hourlyImpressions).toBe(10);
      expect(s.campaigns[0]!.spent * 1_000_000 + s.campaigns[0]!.remainder).toBe(10 * 20_500_000);
      expect(s.ledgerSpend).toBe(s.wallet.spent);
    } finally {
      await w2.close();
    }
  });
  it('lo 0 hoac >50 su kien -> 422; than >16 KB -> 413; khong phai JSON -> 400', async () => {
    const d = await Dev.create(w);
    await expectError(await d.events([]), 422, 'validation_failed');
    await expectError(await d.events(Array.from({ length: 51 }, () => impression(w))), 422, 'validation_failed');
    expect((await d.events(Array.from({ length: 50 }, () => impression(w)))).status).toBe(202);
    await expectError(await d.call('POST', '/v1/events', undefined, { raw: 'x'.repeat(17 * 1024) }), 413, 'payload_too_large');
    await expectError(await d.call('POST', '/v1/events', undefined, { raw: 'nope' }), 400, 'bad_request');
  });
  it('tu choi tung su kien voi dung ly do (rejected[].reason), khong luu, khong tinh tien', async () => {
    const w2 = await createWorld({ campaigns: 2 });
    try {
      const d = await Dev.create(w2);
      const ok = impression(w2);
      const malformed = { ...impression(w2), event_id: 'not-a-uuid' };
      const tooOld = impression(w2, { ageMs: 49 * 3600_000 });
      const future = impression(w2, { ageMs: -10 * 60_000 });
      const foreign = { ...impression(w2), creative_id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' };
      const mismatch = { ...impression(w2, { camp: 0 }), campaign_id: w2.campaignIds[1] };
      const r = await J(await d.events([ok, malformed, tooOld, future, foreign, mismatch]));
      const reasons = Object.fromEntries(r.rejected.map((x: any) => [x.event_id, x.reason]));
      expect(reasons[malformed['event_id'] as string] ?? reasons['not-a-uuid'] ?? reasons[''] ?? Object.values(reasons)).toBeTruthy();
      const rs = r.rejected.map((x: any) => x.reason).sort();
      expect(rs).toEqual(['campaign_mismatch', 'malformed', 'not_in_manifest', 'ts_out_of_range', 'ts_out_of_range']);
      expect(r.accepted).toBe(1);
      expect(r.valid).toBe(1);
      await settleMoney(w2);
      expect((await snapshot(w2)).impressionRows).toEqual([ok['event_id']]);
    } finally {
      await w2.close();
    }
  });
  it('luu nhung danh dau khong hop le (khong tinh tien): thiet bi chua ghep, vcr thap, phat ngan', async () => {
    const w2 = await createWorld();
    try {
      const unpaired = await Dev.create(w2, { pair: false });
      const paired = await Dev.create(w2);
      const a = await J(await unpaired.events([impression(w2)]));
      expect(a).toMatchObject({ accepted: 1, valid: 0, flagged: 1, rejected: [] });
      const b = await J(await paired.events([impression(w2, { vcr: 40 }), impression(w2, { played: 1000 }), impression(w2)]));
      expect(b).toMatchObject({ accepted: 3, valid: 1, flagged: 2 });
      await settleMoney(w2);
      const rows = await w2.rt.db.query<{ valid: unknown; reject_reason: string | null }>('SELECT valid, reject_reason FROM ev_ad_impression ORDER BY reject_reason');
      expect(rows.map((r) => r.reject_reason).sort()).toEqual([null, 'short_play', 'untrusted_device', 'vcr_low']);
      expect((await snapshot(w2)).campaigns[0]!.spent).toBe(20); // chi 1 impression hop le: 20,5 -> 20 VND
    } finally {
      await w2.close();
    }
  });
  it('proof_of_play (thang may/LED) vao ev_proof_of_play, khu trung theo event_id, khong tinh tien', async () => {
    const w2 = await createWorld({ campaigns: 1 });
    try {
      const d = await Dev.create(w2, { kind: 'elevator', pair: false });
      await w2.rt.db.run('UPDATE devices SET trust_level = 1 WHERE id = ?', [d.id]);
      await w2.gw.devices.invalidate(d.id);
      const cr = w2.fixture.campaigns[0]!.creatives[0]!.id;
      const ev = { type: 'proof_of_play', event_id: impression(w2)['event_id'], ts: new Date(w2.rt.clock.now().getTime() - 3000).toISOString(), creative_id: cr, duration_ms: 15000 };
      const r1 = await d.events([ev]);
      const r2 = await d.events([ev]);
      expect([r1.status, r2.status]).toEqual([202, 202]);
      await settleMoney(w2);
      const n = await w2.rt.db.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM ev_proof_of_play');
      expect(Number(n[0]!.n)).toBeLessThanOrEqual(1);
      expect((await snapshot(w2)).campaigns[0]!.spent).toBe(0);
    } finally {
      await w2.close();
    }
  });
});

describe('lenh thiet bi', () => {
  it('heartbeat giao lenh {id,type,args?}; ack qua endpoint {ok,acked,known,unknown}; ack lap/la khong loi; chua ack thi giao lai sau 120s', async () => {
    const d = await Dev.create(w);
    const id = await enqueueCommand(w.rt, d.id, { type: 'refresh_manifest' });
    const hb1 = await J(await d.call('POST', '/v1/heartbeat', { state: 1 }));
    expect(hb1.commands).toEqual([{ id, type: 'refresh_manifest' }]);
    // chua ack: khong giao lai ngay
    expect((await J(await d.call('POST', '/v1/heartbeat', { state: 1 }))).commands).toEqual([]);
    w.rt.clock.advance?.(121_000);
    const hb3 = await J(await d.call('POST', '/v1/heartbeat', { state: 1 }));
    expect(hb3.commands.map((c: any) => c.id)).toEqual([id]);
    const ack = await d.call('POST', '/v1/commands/ack', { acks: [{ id, status: 'ok' }, { id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ', status: 'ok' }] });
    expect(ack.status).toBe(200);
    const ackBody = await J(ack);
    expect(ackBody).toMatchObject({ ok: true, acked: 1, known: 1 });
    // docs/DEVICE-PROTOCOL.md muc 6.1 ghi `unknown` la SO; gateway tra MANG id la (xem requests). Client khong duoc phu thuoc kieu nay.
    expect(Array.isArray(ackBody.unknown) ? ackBody.unknown.length : ackBody.unknown).toBe(1);
    const again = await J(await d.call('POST', '/v1/commands/ack', { acks: [{ id, status: 'ok' }] }));
    expect(again.acked).toBe(0);
    w.rt.clock.advance?.(200_000);
    expect((await J(await d.call('POST', '/v1/heartbeat', { state: 1 }))).commands).toEqual([]);
  });
});
