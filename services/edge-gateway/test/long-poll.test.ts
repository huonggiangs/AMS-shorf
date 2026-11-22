import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueCommand } from '../src/commands.js';
import { TestDevice, harness, type Harness } from './helpers.js';

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;

describe('GET /v1/commands/wait (long-poll tin khan)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness({ dialect: 'sqlite', env: { HB_MIN_GAP_S: '0', CMD_WAIT_TICK_MS: '50' } });
  });
  afterAll(async () => h.close());

  it('lenh co san => tra ngay; khong co => rong sau timeout', async () => {
    const d = await TestDevice.create(h);
    const id = await enqueueCommand(h.rt, d.id, { type: 'message', args: { text: 'khan', duration_s: 10 } });
    const t0 = Date.now();
    const r = await d.call('GET', '/v1/commands/wait?timeout=5');
    expect(r.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect((await J(r)).commands).toEqual([{ id, type: 'message', args: { text: 'khan', duration_s: 10 } }]);
    const empty = await J(await d.call('GET', '/v1/commands/wait?timeout=1'));
    expect(empty.commands).toEqual([]);
  });

  it('lenh den trong luc dang cho => tra ve trong <2 giay', async () => {
    const d = await TestDevice.create(h);
    const pending = d.call('GET', '/v1/commands/wait?timeout=10');
    await new Promise((r) => setTimeout(r, 200));
    const id = await enqueueCommand(h.rt, d.id, { type: 'message', args: { text: 'den sau' } });
    const t0 = Date.now();
    const body = await J(await pending);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(body.commands.map((c: { id: string }) => c.id)).toEqual([id]);
  });

  it('chua ky => 401', async () => {
    const r = await h.gw.app.request('/v1/commands/wait?timeout=1');
    expect(r.status).toBe(401);
  });

  it('manifest chap nhan etag dang yeu W/"..." (CDN lam yeu) va 304', async () => {
    const d = await TestDevice.create(h);
    const first = await d.call('GET', '/v1/manifest');
    expect(first.status).toBe(200);
    const etag = (first.headers.get('etag') ?? '').replace(/"/g, '');
    const q = encodeURIComponent('W/"' + etag + '"');
    const again = await d.call('GET', '/v1/manifest?etag=' + q);
    expect(again.status).toBe(304);
  });
});
