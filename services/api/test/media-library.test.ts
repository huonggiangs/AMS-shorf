// Kho chung: nguoi noi bo tai len KHONG can chon khach hang, nhan moi dinh dang/codec video va anh pho bien (xem localhost:6670), khong rang buoc loai man/thoi luong.
import { beforeAll, describe, expect, it } from 'vitest';
import { SHARED_POOL_ID } from '../src/routes/media.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let lan: Session;
const rows = (sql: string, p: unknown[] = []) => env.rt.db.query<any>(sql, p);
const store = () => env.rt.objects as any;

const up = (s: Session, prefix: string, o: Record<string, unknown>) => s.json('POST', `${prefix}/media/upload-url`, { name: 'v.avi', content_type: '', size_bytes: 800 * 1048576, ...o });

beforeAll(async () => {
  env = await setup({});
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
}, 120_000);

describe('Kho chung: tai len noi bo khong can khach hang', () => {
  it('AVI khong khai Content-Type, 800 MB, khong width/height: 201, vao Kho chung, mime theo duoi tep, khong ep loai man', async () => {
    const r = await up(admin, '/admin/v1', {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const m = (await rows('SELECT customer_id, mime, target_type, kind, uploader_kind, state, px_w FROM creatives WHERE id = ?', [r.body.id]))[0];
    expect(m).toMatchObject({ customer_id: SHARED_POOL_ID, mime: 'video/x-msvideo', target_type: null, kind: 'video', uploader_kind: 'internal', state: 'uploading', px_w: null });
    const cu = (await rows('SELECT short_name, state FROM customers WHERE id = ?', [SHARED_POOL_ID]))[0];
    expect(cu).toMatchObject({ short_name: 'Kho chung', state: 'active' });
  });
  it.each([
    ['a.flv', 'video/x-flv'], ['a.rmvb', 'video/vnd.rn-realvideo'], ['a.mkv', 'video/x-matroska'], ['a.mov', 'video/quicktime'], ['a.webm', 'video/webm'], ['a.wmv', 'video/x-ms-wmv'],
    ['a.gif', 'image/gif'], ['a.webp', 'image/webp'], ['a.bmp', 'image/bmp'], ['a.heic', 'image/heic'],
  ])('nhan %s -> %s', async (name, mime) => {
    const isImg = mime.startsWith('image/');
    const r = await up(admin, '/admin/v1', { name, size_bytes: isImg ? 2 * 1048576 : 50 * 1048576 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await rows('SELECT mime FROM creatives WHERE id = ?', [r.body.id]))[0].mime).toBe(mime);
  });
  it('video toi 1.600 MB, anh toi 25 MB: vuot thi 422 file_too_large; SVG/HTML/tep khong phai anh-video bi tu choi', async () => {
    expect((await up(admin, '/admin/v1', { size_bytes: 1600 * 1048576 })).status).toBe(201);
    const big = await up(admin, '/admin/v1', { size_bytes: 1600 * 1048576 + 1 });
    expect(big.status).toBe(422);
    expect(big.body.code ?? big.body.error?.code).toBe('file_too_large');
    expect((await up(admin, '/admin/v1', { name: 'a.png', size_bytes: 26 * 1048576 })).status).toBe(422);
    for (const name of ['a.svg', 'a.html', 'a.exe', 'a.pdf']) {
      const r = await up(admin, '/admin/v1', { name, content_type: name === 'a.svg' ? 'image/svg+xml' : 'application/octet-stream', size_bytes: 1000 });
      expect(r.status, name).toBe(422);
    }
  });
  it('van cho chon khach hang (tuy chon): gan khach cu the thi giu chuan nghiem ngat; khach hang (portal) KHONG duoc nhan dinh dang la', async () => {
    const K001 = env.seed.customers['K001']!;
    const r = await up(admin, '/admin/v1', { customer_id: K001, name: 'x.mkv', size_bytes: 1000000 });
    expect(r.status).toBe(422); // chon khach hang cu the => giu chuan nghiem ngat (MKV khong nhan)
    const p = await up(lan, '/portal/v1', { name: 'x.avi', content_type: 'video/x-msvideo', size_bytes: 1000000 });
    expect(p.status).toBe(422);
  });
  it('xac nhan AVI khong doc duoc kich thuoc: vao cho duyet voi px NULL va canh bao se chuyen ma (khong bi tu choi)', async () => {
    const r = await up(admin, '/admin/v1', { size_bytes: 64 });
    expect(r.status).toBe(201);
    const m = (await rows('SELECT storage_key FROM creatives WHERE id = ?', [r.body.id]))[0];
    await store().put(m.storage_key, new Uint8Array(64).fill(7), 'video/x-msvideo');
    const c = await admin.json('POST', `/admin/v1/media/${r.body.id}/confirm`, {});
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const after = (await rows('SELECT state, scan_state, px_w, px_h, target_type FROM creatives WHERE id = ?', [r.body.id]))[0];
    expect(after).toMatchObject({ state: 'pending_review', scan_state: 'pending', px_w: null, px_h: null, target_type: null });
    expect(JSON.stringify(c.body.warnings ?? [])).toContain('H.264');
  });
  it('kho chung khong lam lo khach hang he thong trong danh sach khach', async () => {
    const list = await admin.json('GET', '/admin/v1/customers?page_size=200');
    expect(JSON.stringify(list.body)).not.toContain(SHARED_POOL_ID);
  });
});
