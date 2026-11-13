// Gia dinh cua client TV (Java AmsClient/AmsAdScheduler/AmsImpressionTracker trong integrations/brainrot-tv) doi chieu voi gateway THAT.
// Kiem tinh: quet ma Java lay ra duong dan, tieu de, khoa JSON ma app doc/ghi, roi xac nhan tung cai ton tai trong phan hoi that.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueCommand } from '@ams/edge-gateway';
import { ERROR_CODES, HEADER } from '@ams/edge-gateway/protocol';
import { Dev, createWorld, impression, settleMoney, snapshot, type World } from '../src/world.js';
// lược đồ TV (nguồn sự thật phía app) + ví dụ VinFast: dùng nguyên tệp trong integrations
import { overlaySchema } from '../../../integrations/brainrot-tv/schema/overlay.ts';
import { readFileSync as rf } from 'node:fs';

const JAVA_DIR = join(import.meta.dirname, '../../../integrations/brainrot-tv/android/app/src/main/java/vn/brainrot/parental/tv');
const javaFiles = readdirSync(JAVA_DIR).filter((f) => f.endsWith('.java'));
const java = Object.fromEntries(javaFiles.map((f) => [f, readFileSync(join(JAVA_DIR, f), 'utf8')])) as Record<string, string>;
const all = Object.values(java).join('\n');
const client = java['AmsClient.java']!;

let w: World;
beforeAll(async () => {
  w = await createWorld({ campaigns: 1, creativesPerCampaign: 1 });
});
afterAll(async () => w.close());

const keysRead = (type: string, src = all): Set<string> => new Set([...src.matchAll(new RegExp(`${type}\\("([a-z_0-9]+)"`, 'g'))].map((m) => m[1]!));

describe('AmsClient.java <-> gateway', () => {
  it('duong dan ma app goi deu la route co that cua gateway; tieu de ky khop HEADER', async () => {
    const paths = [...client.matchAll(/"(\/v1\/[a-z/]+)"/g)].map((m) => m[1]!);
    expect(new Set(paths)).toEqual(new Set(['/v1/register', '/v1/pair', '/v1/heartbeat', '/v1/manifest', '/v1/events']));
    const hdrs = [...client.matchAll(/setRequestProperty\("([A-Za-z-]+)"/g)].map((m) => m[1]!.toLowerCase());
    for (const h of ['x-timestamp', 'x-nonce', 'x-signature', 'x-device-id']) expect(hdrs).toContain(h);
    expect(new Set(Object.values(HEADER))).toEqual(new Set(['x-device-id', 'x-timestamp', 'x-nonce', 'x-signature']));
    // route khong ton tai -> 404 (kiem tra bang chung rang test ben duoi khong "pass nham")
    const d = await Dev.create(w);
    expect((await d.call('GET', '/v1/khong-co')).status).toBe(404);
  });

  it('ma loi app so sanh chuoi (stale_timestamp, replay) deu nam trong bang ma loi cua gateway voi dung HTTP ma app doan', async () => {
    const m = [...client.matchAll(/"([a-z_]+)"\.equals\(\w+\.errorCode\)/g)].map((x) => x[1]!);
    expect(m.sort()).toEqual(['replay', 'stale_timestamp']);
    expect((ERROR_CODES as Record<string, number>)['stale_timestamp']).toBe(401);
    expect((ERROR_CODES as Record<string, number>)['replay']).toBe(409);
    expect(client).toMatch(/last\.status == 429 \|\| last\.status == 503/);
    expect((ERROR_CODES as Record<string, number>)['rate_limited']).toBe(429);
    expect((ERROR_CODES as Record<string, number>)['overloaded']).toBe(503);
  });

  it('app kiem tra truong phan hoi register/pair/heartbeat/manifest: moi khoa app doc deu co mat dung kieu', async () => {
    const d = new Dev(w);
    d.keys = await (await import('@ams/edge-gateway/testing')).generateEd25519KeyPair();
    const reg = await (await d.register({ region: 'HN' })).json();
    d.id = reg.device_id;
    expect(typeof reg.device_id).toBe('string');
    expect(typeof reg.server_time).toBe('string'); // optString("server_time")
    expect(typeof reg.trust_level).toBe('number'); // optInt
    const pair = await (await d.call('POST', '/v1/pair', {})).json();
    expect(typeof pair.paired).toBe('boolean');
    expect(typeof pair.code).toBe('string'); // optString("code")
    expect(typeof pair.expires_in).toBe('number'); // optLong("expires_in")
    await d.pair();
    const paired = await (await d.call('POST', '/v1/pair', {})).json();
    expect(paired.paired).toBe(true);
    expect(typeof paired.trust_level).toBe('number');
    const hb = await (await d.call('POST', '/v1/heartbeat', { state: 1 })).json();
    expect(typeof hb.next_interval).toBe('number'); // optLong
    expect(typeof hb.manifest_etag).toBe('string'); // optString
    expect(Array.isArray(hb.commands)).toBe(true); // optJSONArray
    expect(typeof hb.server_time).toBe('string');
    const { res, json: man } = await d.manifest();
    expect(res.headers.get('etag')).toBe(`"${man!.etag}"`); // unquote(ETag) -> body.etag
    for (const k of ['version', 'ttl_s']) expect(typeof (man as any)[k]).toBe('number');
    for (const k of ['group', 'tz', 'etag', 'generated_at']) expect(typeof (man as any)[k]).toBe('string');
    const c = man!.creatives[0]! as any;
    for (const k of ['id', 'url', 'sha256', 'media_type', 'campaign_id', 'format']) expect(typeof c[k]).toBe('string');
    for (const k of ['px_w', 'px_h', 'size_bytes', 'duration_s']) expect(typeof c[k]).toBe('number');
    const s = man!.schedule[0]! as any;
    for (const k of ['slot_id', 'campaign_id']) expect(typeof s[k]).toBe('string');
    for (const k of ['start_min', 'end_min', 'priority', 'reward_points']) expect(typeof s[k]).toBe('number');
    expect(Array.isArray(s.creative_ids)).toBe(true);
    // loi: error.code (optString) va error.details.server_time (optLong) la SO
    const bad = await d.call('POST', '/v1/heartbeat', { state: 1 }, { ts: d.nowS() - 1000 });
    const e = (await bad.json()).error;
    expect(typeof e.code).toBe('string');
    expect(typeof e.details.server_time).toBe('number');
    // moi khoa JSON ma code Java doc o cap manifest/slot/creative phai nam trong tap da kiem o tren hoac la overlay (kiem rieng)
    const known = new Set([
      'id', 'schedule', 'creatives', 'px_w', 'px_h', 'url', 'tz', 'sha256', 'etag', 'creative_ids', 'ttl_s', 'server_time', 'media_type', 'group', 'code', 'overlay', 'details', 'error',
      'version', 'trust_level', 'paired', 'type', 'ts', 'slot_id', 'manifest_etag', 'generated_at', 'format', 'campaign_id', 'size_bytes', 'next_interval', 'expires_in', 'duration_s', 'start_min', 'end_min',
      'reward_points', 'priority', 'creatives_added', 'creatives_removed', 'commands', 'device_id', 'region', 'enabled', 'v',
      // overlay (kiem rieng): scte_id, safe_area, qr, hotline, background, contexts, badges, kid_safe, number
      'scte_id', 'safe_area', 'qr', 'hotline', 'background', 'contexts', 'badges', 'kid_safe', 'number',
    ]);
    const used = new Set([...keysRead('opt(?:String|Int|Long|Boolean|JSONObject|JSONArray|Double)'), ...keysRead('has')]);
    const unknown = [...used].filter((k) => !known.has(k));
    expect(unknown).toEqual([]);
  });

  it('lenh: app doc commands[].id/type/args va ack qua POST /v1/commands/ack hoac cmd_ack cua heartbeat (hai duong deu duoc gateway nhan)', async () => {
    const d = await Dev.create(w);
    const id1 = await enqueueCommand(w.rt, d.id, { type: 'set_monitor', args: { on: true } });
    const hb = await (await d.call('POST', '/v1/heartbeat', { state: 1 })).json();
    expect(hb.commands[0]).toMatchObject({ id: id1, type: 'set_monitor', args: { on: true } });
    w.rt.clock.advance(121_000);
    // ack cu qua heartbeat (cmd_ack): lenh khong bi giao lai nua ke ca sau khi qua han giao lai
    const hb2 = await (await d.call('POST', '/v1/heartbeat', { state: 3, cmd_ack: [id1] })).json();
    expect(hb2.commands).toEqual([]);
    w.rt.clock.advance(121_000);
    expect((await (await d.call('POST', '/v1/heartbeat', { state: 3 })).json()).commands).toEqual([]);
  });
});

describe('AmsImpressionTracker.java <-> gateway (su kien)', () => {
  it('app gui type/event_id UUIDv7/ts ISO .SSSZ/campaign_id/creative_id/slot_id/vcr_pct=100/played_ms: gateway chap nhan hop le; khoa ma app ghi la tap con cua hop dong', async () => {
    const written = keysRead('put', java['AmsImpressionTracker.java']);
    for (const k of ['event_id', 'ts', 'campaign_id', 'creative_id', 'slot_id', 'vcr_pct', 'played_ms', 'type']) expect(written.has(k) || java['AmsImpressionTracker.java']!.includes(`"${k}"`)).toBe(true);
    const w2 = await createWorld();
    try {
      const d = await Dev.create(w2);
      const ev = impression(w2, { played: 15000, vcr: 100 });
      expect(String(ev['ts'])).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/); // dung dinh dang isoUtc cua Java
      const r = await (await d.events([ev])).json();
      expect(r).toMatchObject({ accepted: 1, valid: 1, flagged: 0 });
      // app luu ben truoc khi gui va gui lai sau loi mang: lan hai khong tao them
      await d.events([ev]);
      await settleMoney(w2);
      expect((await snapshot(w2)).impressionRows.length).toBe(1);
    } finally {
      await w2.close();
    }
  });
});

describe('creative.overlay: lược đồ TV (zod, strict) và ví dụ VinFast', () => {
  const example = JSON.parse(rf(join(import.meta.dirname, '../../../integrations/brainrot-tv/schema/overlay.example.vf9.json'), 'utf8'));
  it('ví dụ mẫu hợp lệ theo lược đồ TV', () => {
    expect(() => overlaySchema.parse(example.overlay ?? example)).not.toThrow();
  });
  it('phần giao nhau với parseOverlay phía máy chủ: gateway phát đúng trường chung; lược đồ TV strict nhận chính overlay đó', async () => {
    const w2 = await createWorld();
    try {
      const cr = w2.fixture.campaigns[0]!.creatives[0]!.id;
      const common = { sponsor_tag: 'TAI TRO', brand_label: 'VINFAST', headline: 'VF9', badges: ['4K'], hotline: { label: 'Hotline', number: '1900 23 23 89' }, qr: { url: 'https://r.ams.vn/abc', label: 'Quet' }, scte_id: 'ADS-1' };
      await w2.rt.db.run('UPDATE creatives SET overlay = ? WHERE id = ?', [JSON.stringify(common), cr]);
      const d = await Dev.create(w2);
      const o = ((await d.manifest()).json!.creatives[0] as any).overlay;
      expect(o).toMatchObject(common);
      expect(() => overlaySchema.parse(o)).not.toThrow();
    } finally {
      await w2.close();
    }
  });
  // Da sua (x3): manifest giu cac truong overlay da duyet; contexts lock chi khi kid_safe.
  it('manifest giu kid_safe/contexts/duration_s/safe_area (ung dung can de hien tren man khoa)', async () => {
    const w2 = await createWorld();
    try {
      const cr = w2.fixture.campaigns[0]!.creatives[0]!.id;
      await w2.rt.db.run('UPDATE creatives SET overlay = ? WHERE id = ?', [JSON.stringify({ headline: 'X', kid_safe: true, contexts: ['lock'], duration_s: 20, safe_area: { top: 5, right: 5, bottom: 5, left: 5 } }), cr]);
      const d = await Dev.create(w2);
      const o = ((await d.manifest()).json!.creatives[0] as any).overlay;
      expect(o).toMatchObject({ kid_safe: true, contexts: ['lock'], duration_s: 20 });
    } finally {
      await w2.close();
    }
  });
});
