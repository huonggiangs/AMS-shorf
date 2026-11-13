// OBJECT_STORE=fs: tai len qua URL ky do API phuc vu (khong S3), voi cung cac kiem tra cua buoc confirm.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsObjectStore } from '../../../packages/runtime/src/fs.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const png = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

let env: Env;
let admin: Session;
let dir: string;
let custId = '';
const cust = () => custId;
// nginx/Caddy cat tien to /api truoc khi vao API
const path = (u: string) => { const x = new URL(u, 'http://x'); return (x.pathname + x.search).replace(/^\/api/, ''); };

beforeAll(async () => {
  env = await setup();
  dir = await mkdtemp(join(tmpdir(), 'ams-api-fs-'));
  (env.rt as any).objects = new FsObjectStore({ dir, signingSecret: 'api-test', clock: env.rt.clock });
  admin = await login(env, env.byRole('super_admin'));
  custId = (await env.rt.db.query<{ id: string }>('SELECT id FROM customers LIMIT 1'))[0]!.id;
}, 120_000);
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const start = (size = 33, name = 'tv.png', extra: Record<string, unknown> = {}) =>
  admin.json('POST', '/admin/v1/media/upload-url', { name, content_type: 'image/png', size_bytes: size, width: 1920, height: 1080, customer_id: cust(), ...extra });
const put = (u: string, body: Uint8Array, ct = 'image/png', extra: Record<string, string> = {}) =>
  env.app.request(path(u), { method: 'PUT', headers: { 'content-type': ct, ...extra }, body });

describe('storage fs: upload-url -> PUT -> confirm -> preview', () => {
  it('luong day du khong can cookie o buoc PUT/GET (chu ky la xac thuc)', async () => {
    const m = await start();
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    expect(m.body.url).toMatch(/^\/api\/storage\/upload\/media\//);
    const r = await put(m.body.url, png(1920, 1080));
    expect(r.status).toBe(200);
    expect((await env.rt.objects.head(m.body.key))?.size).toBe(33);
    const c = await admin.json('POST', `/admin/v1/media/${m.body.id}/confirm`, {});
    expect(c.status).toBe(200);
    const g = await admin.json('GET', `/admin/v1/media/${m.body.id}`);
    expect(g.body.preview_url).toMatch(/^\/api\/storage\/object\//);
    const dl = await env.app.request(path(g.body.preview_url));
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('image/png');
    expect(dl.headers.get('content-security-policy')).toContain('sandbox');
    expect(new Uint8Array(await dl.arrayBuffer()).length).toBe(33);
  });

  const strip = path;
  const putS = put;

  it('PUT dung duong dan da cat /api', async () => {
    const m = await start();
    { const r = await putS(m.body.url, png(1920, 1080)); expect(r.status, await r.clone().text()).toBe(200); }
  });
  it('tu choi: sai loai noi dung, qua kich thuoc khai bao, chu ky bi sua, khoa ngoai media/, het han', async () => {
    const m = await start(33);
    expect((await putS(m.body.url, png(1920, 1080), 'video/mp4')).status).toBe(422);
    expect((await putS(m.body.url, new Uint8Array(34).fill(1))).status).toBe(413);
    expect((await putS(m.body.url, png(1920, 1080), 'image/png', { 'content-length': '999999' })).status).toBe(413);
    const bad = strip(m.body.url).replace(/sig=[0-9a-f]{4}/, 'sig=0000');
    expect((await env.app.request(bad, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png(1920, 1080) })).status).toBe(403);
    const other = strip(m.body.url).replace(m.body.id, 'KHAC');
    expect((await env.app.request(other, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png(1920, 1080) })).status).toBe(403);
    const store = env.rt.objects as unknown as FsObjectStore;
    const evil = new URL((await store.putSigned('renditions/c/x.png', 'image/png', 60)).url, 'http://x');
    { const rr = await env.app.request(path(evil.pathname + evil.search), { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png(1, 1) }); expect(rr.status).toBe(403); }
    expect(await env.rt.objects.head('renditions/c/x.png')).toBeNull();
    env.rt.clock.advance(901_000);
    expect((await putS(m.body.url, png(1920, 1080))).status).toBe(403);
    admin = await login(env, env.byRole('super_admin'));
  });
  it('GET khong ky hoac khoa traversal bi tu choi', async () => {
    expect((await env.app.request('/storage/object/media/x/y.png')).status).toBe(403);
    expect((await env.app.request('/storage/object/..%2F..%2Fetc%2Fpasswd?exp=1&sig=a')).status).toBeGreaterThanOrEqual(400);
  });
  it('anh sai kich thuoc bi tu choi o confirm nhu cu (same checks)', async () => {
    const m = await start(33, 'bad.png');
    await putS(m.body.url, png(100, 100));
    const c = await admin.json('POST', `/admin/v1/media/${m.body.id}/confirm`, {});
    expect(c.status).toBe(422);
  });
});
