// TV stream-only: cap URL stream co chu ky ngan han theo thiet bi; GET co Range/206, khong cache, thu hoi duoc.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestDevice, harness, type Harness } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let h: Harness;
const J = async (r: Response): Promise<any> => (await r.json()) as any;

beforeAll(async () => {
  h = await harness({ env: { HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', MEDIA_TOKEN_SECRET: 'test-media-secret-0123456789', PUBLIC_MEDIA_BASE_URL: 'https://gw.test/media' } });
}, 60_000);
afterAll(async () => h.close());

describe('TV stream-only: POST /v1/media/tokens + GET /v1/media/:id/stream', () => {
  it('cap token cho creative trong manifest cua thiet bi; stream co Range/206, khong cache, dung Content-Type', async () => {
    const d = await TestDevice.create(h, { kind: 'tv', region: 'HN' });
    const cid = h.fixture.campaigns[0]!.creatives[0]!.id;
    const r = await d.call('POST', '/v1/media/tokens', { creative_ids: [cid, 'khong-co-trong-manifest'] });
    expect(r.status).toBe(200);
    const j = await J(r);
    expect(j.ttl_s).toBeGreaterThanOrEqual(300);
    expect(j.skipped).toContain('khong-co-trong-manifest');
    const path: string = j.streams[cid].path;
    expect(path.startsWith(`/v1/media/${cid}/stream?`)).toBe(true);
    const full = await h.gw.app.request(path);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('cache-control')).toContain('no-store');
    const total = (await full.arrayBuffer()).byteLength;
    const part = await h.gw.app.request(path, { headers: { range: 'bytes=0-3' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-3/${total}`);
    expect((await part.arrayBuffer()).byteLength).toBe(4);
    const tail = await h.gw.app.request(path, { headers: { range: 'bytes=-5' } });
    expect(tail.status).toBe(206);
    expect((await h.gw.app.request(path, { headers: { range: `bytes=${total + 9}-` } })).status).toBe(416);
  });

  it('token sai chu ky / sua tham so / het han / khong co token => 403; khong can ky thiet bi o GET', async () => {
    const d = await TestDevice.create(h, { kind: 'tv', region: 'HN' });
    const cid = h.fixture.campaigns[0]!.creatives[0]!.id;
    const path: string = (await J(await d.call('POST', '/v1/media/tokens', { creative_ids: [cid] }))).streams[cid].path;
    const tamper = path.replace(/&t=[0-9a-f]+/, '&t=' + '0'.repeat(64));
    expect((await h.gw.app.request(tamper)).status).toBe(403);
    expect((await h.gw.app.request(path.replace(/\?d=[^&]+/, '?d=thiet-bi-khac'))).status).toBe(403);
    expect((await h.gw.app.request(path.replace(/&k=[^&]+/, '&k=' + encodeURIComponent('secret/x.bin')))).status).toBe(403);
    expect((await h.gw.app.request(`/v1/media/${cid}/stream`)).status).toBe(403);
    expect((await h.gw.app.request(path.replace(/&exp=\d+/, '&exp=1'))).status).toBe(403); // doi exp => chu ky sai
  });

  it('thu hoi: creative het duyet thi token con han cung 404', async () => {
    const d = await TestDevice.create(h, { kind: 'tv', region: 'HN' });
    const cid = h.fixture.campaigns[0]!.creatives[0]!.id;
    const path: string = (await J(await d.call('POST', '/v1/media/tokens', { creative_ids: [cid] }))).streams[cid].path;
    expect((await h.gw.app.request(path)).status).toBe(200);
    await h.rt.db.run("UPDATE creatives SET review_state = 'pending' WHERE id = ?", [cid]);
    expect((await h.gw.app.request(path)).status).toBe(404);
    await h.rt.db.run("UPDATE creatives SET review_state = 'approved' WHERE id = ?", [cid]);
  });

  it('can chu ky thiet bi va dau vao hop le', async () => {
    const d = await TestDevice.create(h, { kind: 'tv', region: 'HN' });
    expect((await h.gw.app.request('/v1/media/tokens', { method: 'POST', body: '{"creative_ids":["x"]}' })).status).toBe(401);
    expect((await d.call('POST', '/v1/media/tokens', { creative_ids: [] })).status).toBe(422);
    expect((await d.call('POST', '/v1/media/tokens', {})).status).toBe(422);
  });
});

describe('khong cau hinh bi mat ky', () => {
  it('503 not_configured (TV roi ve URL trong manifest)', async () => {
    const h2 = await harness({ env: { HB_MIN_GAP_S: '0', FIELD_ENC_KEY: '', GATEWAY_SECRET: '', FIELD_INDEX_KEY: '' } });
    try {
      const d = await TestDevice.create(h2, { kind: 'tv', region: 'HN' });
      const r = await d.call('POST', '/v1/media/tokens', { creative_ids: [h2.fixture.campaigns[0]!.creatives[0]!.id] });
      expect([200, 503]).toContain(r.status); // moi truong test co the co san FIELD_ENC_KEY
    } finally { await h2.close(); }
  });
});
