// Tai tep qua Worker khi kho khong ky duoc URL (Cloudflare thieu khoa S3): PUT /media/:id/content.
import { beforeAll, describe, expect, it } from 'vitest';
import { PROXY_UPLOAD_MAX_BYTES } from '../src/lib/creative.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let content: Session;
let finance: Session;
let lan: Session;
let dang: Session;
let K001: string;
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, body: number[] = []) => [...be32(body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0];
const png = (w: number, h: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(w), ...be32(h), 8, 2, 0, 0, 0]), ...chunk('IDAT', [1, 2, 3]), ...chunk('IEND')]);
const store = () => env.rt.objects as any;
const rows = (sql: string, p: unknown[] = []) => env.rt.db.query<any>(sql, p);

const create = (s: Session, prefix: string, bytes: Uint8Array, o: Record<string, unknown> = {}) =>
  s.json('POST', `${prefix}/media/upload-url`, { name: 'p.png', content_type: 'image/png', size_bytes: bytes.length, width: 1080, height: 1920, ...(prefix === '/admin/v1' ? { customer_id: K001 } : {}), ...o });
const put = (s: Session, url: string, body: Uint8Array | ReadableStream, headers: Record<string, string> = {}) =>
  env.app.request(url.replace(/^\/api/, ''), { method: 'PUT', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': 'image/png', ...headers }, body: body as any, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as any);
const withLen = (b: Uint8Array) => ({ 'content-length': String(b.length) });

beforeAll(async () => {
  env = await setup({});
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  content = await login(env, env.byRole('content_manager'));
  finance = await login(env, env.byRole('finance'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
  store().signedPut = false; // mo phong Cloudflare thieu khoa S3
}, 120_000);

describe('upload-url khi kho khong ky duoc: URL cung origin toi API', () => {
  it('tra via=proxy + url /api/{admin|portal}/v1/media/:id/content, KHONG ky URL kho; che do truc tiep van nhu cu', async () => {
    const b = png(1080, 1920);
    const before = store().signed.length;
    const r = await create(admin, '/admin/v1', b);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ via: 'proxy', method: 'PUT', url: `/api/admin/v1/media/${r.body.id}/content`, headers: { 'Content-Type': 'image/png' } });
    expect(store().signed.length).toBe(before);
    const p = await create(lan, '/portal/v1', b);
    expect(p.body.url).toBe(`/api/portal/v1/media/${p.body.id}/content`);
    store().signedPut = true;
    const d = await create(admin, '/admin/v1', b);
    expect(d.body.via).toBe('direct');
    expect(d.body.url).toContain('objects.test');
    store().signedPut = false;
  });
  it('tep > 95 MB bi tu choi som voi thong bao tieng Viet ro rang', async () => {
    const r = await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'v.mp4', content_type: 'video/mp4', size_bytes: PROXY_UPLOAD_MAX_BYTES + 1, width: 1920, height: 1080, duration_sec: 30 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('file_too_large');
    expect(r.body.error.message).toMatch(/vượt 95 MB: nén lại \(H\.264\) rồi tải lại/);
    expect((await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'v.mp4', content_type: 'video/mp4', size_bytes: 90 * 1048576, width: 1920, height: 1080, duration_sec: 30 })).status).toBe(201);
  });
});

describe('PUT /media/:id/content', () => {
  it('luong day du: PUT dung -> luu dung byte vao kho, audit media.upload_proxy, confirm -> pending_review (dung ca stream)', async () => {
    const b = png(1080, 1920);
    const r = await create(admin, '/admin/v1', b);
    const res = await put(admin, r.body.url, b, withLen(b));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, size_bytes: b.length });
    expect(Array.from((await store().get(r.body.key))!)).toEqual(Array.from(b));
    expect((await rows("SELECT 1 FROM audit_log WHERE action = 'media.upload_proxy' AND object_id = ?", [r.body.id])).length).toBe(1);
    const cf = await admin.json('POST', `/admin/v1/media/${r.body.id}/confirm`, {});
    expect(cf.status, JSON.stringify(cf.body)).toBe(200);
    // stream that
    const b2 = png(1080, 1920);
    const r2 = await create(admin, '/admin/v1', b2);
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(b2.slice(0, 10)); c.enqueue(b2.slice(10)); c.close(); } });
    const res2 = await put(admin, r2.body.url, stream, withLen(b2));
    expect(res2.status, await res2.clone().text()).toBe(200);
    expect(Array.from((await store().get(r2.body.key))!)).toEqual(Array.from(b2));
  });
  it('Content-Length sai / thieu, Content-Type sai, qua 95 MB -> loi, khong luu tep', async () => {
    const b = png(1080, 1920);
    const r = await create(admin, '/admin/v1', b);
    const short = await put(admin, r.body.url, b.slice(0, 20), { 'content-length': '20' });
    expect(short.status).toBe(400);
    expect((await short.json() as any).error.code).toBe('length_mismatch');
    expect((await put(admin, r.body.url, b, {})).status).toBe(400); // thieu Content-Length
    const ct = await put(admin, r.body.url, b, { ...withLen(b), 'content-type': 'video/mp4' });
    expect(ct.status).toBe(422);
    expect((await ct.json() as any).error.code).toBe('content_type_mismatch');
    const huge = await put(admin, r.body.url, b, { 'content-length': String(PROXY_UPLOAD_MAX_BYTES + 1) });
    expect(huge.status).toBe(413);
    expect(await store().head(r.body.key)).toBeNull();
    // noi doi Content-Length (gui nhieu hon khai bao): luong bi cat, tep bi xoa
    const liar = await put(admin, r.body.url, new Uint8Array(b.length + 500), withLen(b));
    expect(liar.status).toBe(400);
    expect(await store().head(r.body.key)).toBeNull();
    expect((await rows('SELECT state FROM creatives WHERE id = ?', [r.body.id]))[0].state).toBe('uploading');
  });
  it('state sai (da confirm) -> 409; kho ky duoc URL -> 409; id la / da xoa -> 404', async () => {
    const b = png(1080, 1920);
    const r = await create(admin, '/admin/v1', b);
    expect((await put(admin, r.body.url, b, withLen(b))).status).toBe(200);
    expect((await admin.json('POST', `/admin/v1/media/${r.body.id}/confirm`, {})).status).toBe(200);
    const again = await put(admin, r.body.url, b, withLen(b));
    expect(again.status).toBe(409);
    expect((await again.json() as any).error.code).toBe('invalid_state');
    const r2 = await create(admin, '/admin/v1', b);
    store().signedPut = true;
    expect((await put(admin, r2.body.url, b, withLen(b))).status).toBe(409);
    store().signedPut = false;
    expect((await put(admin, '/admin/v1/media/khong-co/content', b, withLen(b))).status).toBe(404);
  });
  it('quyen: chi nguoi tao (403 cho nguoi khac cung pham vi), can media:write (finance 403), khach khac 404 (IDOR), khach chu so huu qua portal duoc, chua dang nhap 401, thieu CSRF chan', async () => {
    const b = png(1080, 1920);
    const mine = await create(admin, '/admin/v1', b);
    const other = await put(content, mine.body.url, b, withLen(b));
    expect(other.status).toBe(403);
    expect((await other.json() as any).error.code).toBe('not_uploader');
    expect((await put(finance, mine.body.url, b, withLen(b))).status).toBe(403);
    expect(await store().head(mine.body.key)).toBeNull();
    // portal
    const theirs = await create(lan, '/portal/v1', b);
    expect((await put(dang, theirs.body.url, b, withLen(b))).status).toBe(404); // khach khac: khong lo ton tai
    expect((await env.app.request(theirs.body.url.replace(/^\/api/, ''), { method: 'PUT', headers: { 'content-type': 'image/png', ...withLen(b) }, body: b as any })).status).toBe(401);
    expect((await env.app.request(theirs.body.url.replace(/^\/api/, ''), { method: 'PUT', headers: { cookie: lan.cookie, 'content-type': 'image/png', ...withLen(b) }, body: b as any })).status).toBeGreaterThanOrEqual(400); // thieu CSRF
    expect((await put(lan, theirs.body.url, b, withLen(b))).status).toBe(200);
    expect(Array.from((await store().get(theirs.body.key))!)).toEqual(Array.from(b));
    expect((await put(lan, theirs.body.url.replace('/portal/', '/admin/'), b, withLen(b))).status).toBe(403); // khach khong vao API quan tri
  });
  it('khoa theo thoi gian: phien tai len > 1 gio -> 409 upload_expired', async () => {
    const b = png(1080, 1920);
    const r = await create(admin, '/admin/v1', b);
    await env.rt.db.run('UPDATE creatives SET created_at = ? WHERE id = ?', [new Date(env.rt.clock.now().getTime() - 2 * 3600_000).toISOString(), r.body.id]);
    const x = await put(admin, r.body.url, b, withLen(b));
    expect(x.status).toBe(409);
    expect((await x.json() as any).error.code).toBe('upload_expired');
  });
});
