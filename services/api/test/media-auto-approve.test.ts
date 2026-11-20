// Tu duyet cho nguoi noi bo co quyen media:approve + anh dai dien (thumbnail) do trinh duyet tao.
import { beforeAll, describe, expect, it } from 'vitest';
import { createCfCreativeValidator } from '../src/lib/cf-creative-validate.js';
import { sweepAutoApprove } from '../src/lib/auto-approve.js';
import { sniffThumb, THUMB_MAX_BYTES } from '../src/routes/media.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const cat = (...p: (number[] | Uint8Array)[]) => Uint8Array.from(p.flatMap((x) => [...x]));
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
const chunk = (type: string, body: number[] = []) => [...be32(body.length), ...tag(type), ...body, 0, 0, 0, 0];
const png = (w: number, h: number, tail: number[] = []) => cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', [...be32(w), ...be32(h), 8, 2, 0, 0, 0]), chunk('IDAT', [1, 2, 3]), chunk('IEND'), tail);
const jpegThumb = (n = 2000) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]); b[n - 2] = 0xff; b[n - 1] = 0xd9; return b; };
const webpThumb = () => cat(tag('RIFF'), [20, 0, 0, 0], tag('WEBP'), tag('VP8 '), new Array(20).fill(1));

let env: Env;
let admin: Session;
let lan: Session; // khach hang (portal)
let dang: Session; // khach hang khac
let K001: string;

beforeAll(async () => {
  env = await setup({});
  await env.rt.db.run("DELETE FROM settings WHERE key = 'allow_unscanned_creatives'");
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
  createCfCreativeValidator(env.rt).subscribe();
}, 120_000);

const row = async (id: string) => (await env.rt.db.query<any>('SELECT scan_state, state, review_state, uploader_kind FROM creatives WHERE id = ?', [id]))[0]!;
async function upload(s: Session, prefix: '/admin/v1' | '/portal/v1', name: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
  const r = await s.json('POST', `${prefix}/media/upload-url`, { name, content_type: 'image/png', size_bytes: bytes.length, ...(prefix === '/admin/v1' ? { customer_id: K001 } : {}), ...extra });
  expect(r.status).toBe(201);
  await env.rt.objects.put(r.body.key, bytes, 'image/png');
  const cf = await s.json('POST', `${prefix}/media/${r.body.id}/confirm`, {});
  expect(cf.status).toBe(200);
  await env.rt.queue.drain();
  return r.body.id as string;
}
const auditOf = async (id: string, action: string) => env.rt.db.query<any>('SELECT actor_id, diff FROM audit_log WHERE object_id = ? AND action = ?', [id, action]);

describe('tu duyet cho nguoi noi bo co quyen media:approve', () => {
  it('Super admin tai anh hop le: duyet ngay (approved/ready/clean), co audit media.auto_approve, UI khong con chan', async () => {
    const id = await upload(admin, '/admin/v1', 'a.png', png(1920, 1080));
    expect(await row(id)).toMatchObject({ review_state: 'approved', state: 'ready', scan_state: 'clean' });
    const a = await auditOf(id, 'media.auto_approve');
    expect(a.length).toBe(1);
    expect(JSON.parse(a[0].diff).reason).toBe('tải lên bởi người có quyền duyệt');
    const g = await admin.json('GET', `/admin/v1/media/${id}`);
    expect(g.body.status).toBe('approved');
    expect(g.body.blocker).toBeNull();
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`)).status).toBe(200); // duyet lai: idempotent
  });

  it('needs_manual_review (du lieu thua) van tu duyet: creative_validation.engine = auto-privileged', async () => {
    const id = await upload(admin, '/admin/v1', 'poly.png', png(1920, 1080, [0x50, 0x4b, 3, 4]));
    expect(await row(id)).toMatchObject({ review_state: 'approved', state: 'ready', scan_state: 'clean' });
    const v = (await env.rt.db.query<any>('SELECT engine, verdict FROM creative_validation WHERE creative_id = ?', [id]))[0];
    expect(v).toMatchObject({ engine: 'auto-privileged', verdict: 'clean' });
    expect((await auditOf(id, 'media.auto_approve')).length).toBe(1);
  });

  it('tep sai spec van bi tu choi (khong tu duyet): do phan giai khong khop loai man', async () => {
    const r = await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'x.mp4', content_type: 'video/mp4', size_bytes: 1000, width: 3840, height: 2160 });
    expect(r.status).toBe(422);
    const r2 = await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'y.png', content_type: 'image/png', size_bytes: 1000, width: 1234, height: 777 });
    expect(r2.status).toBe(422);
  });

  it('khach hang (portal) tai len: van cho duyet, khong tu duyet', async () => {
    const id = await upload(lan, '/portal/v1', 'c.png', png(1920, 1080));
    expect(await row(id)).toMatchObject({ review_state: 'pending', state: 'pending_review', uploader_kind: 'customer' });
    expect((await auditOf(id, 'media.auto_approve')).length).toBe(0);
    await sweepAutoApprove(env.rt); // co the duyet tep noi bo cu trong seed, nhung khong bao gio tep cua khach
    expect((await row(id)).review_state).toBe('pending');
  });

  it('noi bo nhung bi go quyen media:approve: van cho duyet', async () => {
    const cm = await env.rt.db.query<any>("SELECT id, email FROM admins WHERE role = 'content_manager' AND status = 'active' LIMIT 1");
    const put = await admin.json('PUT', `/admin/v1/permissions/${cm[0].id}`, { permissions: { media: ['view', 'write'] } });
    expect(put.status).toBe(200);
    const s = await login(env, cm[0].email);
    const id = await upload(s, '/admin/v1', 'cm.png', png(1920, 1080));
    expect(await row(id)).toMatchObject({ review_state: 'pending', state: 'pending_review', uploader_kind: 'internal' });
    expect((await auditOf(id, 'media.auto_approve')).length).toBe(0);
    expect(await sweepAutoApprove(env.rt)).toBe(0);
  });

  it('bi nhiem (infected) thi KHONG tu duyet; sau khi quet sach (duong VPS) sweep moi tu duyet', async () => {
    const r = await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'v.png', content_type: 'image/png', size_bytes: 40, width: 1920, height: 1080 });
    await env.rt.objects.put(r.body.key, png(1920, 1080), 'image/png');
    const id = r.body.id as string;
    // media-worker VPS ghi ket qua quet dong bo qua DB: gia lap bang cach dat scan_state truoc khi validator chay
    await env.rt.db.run("UPDATE creatives SET size_bytes = ? WHERE id = ?", [png(1920, 1080).length, id]);
    expect((await admin.json('POST', `/admin/v1/media/${id}/confirm`, {})).status).toBe(200);
    await env.rt.db.run("UPDATE creatives SET scan_state = 'infected' WHERE id = ?", [id]);
    await env.rt.queue.drain();
    expect(await sweepAutoApprove(env.rt)).toBe(0);
    expect(await row(id)).toMatchObject({ scan_state: 'infected', review_state: 'pending', state: 'pending_review' });
    expect((await auditOf(id, 'media.auto_approve')).length).toBe(0);
    // quet that xong sau do (clean): sweep duyet
    await env.rt.db.run("UPDATE creatives SET scan_state = 'clean' WHERE id = ?", [id]);
    expect(await sweepAutoApprove(env.rt)).toBe(1);
    expect(await row(id)).toMatchObject({ scan_state: 'clean', review_state: 'approved', state: 'ready' });
  });

  it('cong tac settings.auto_approve_privileged_uploads = 0 tat tinh nang', async () => {
    await env.rt.db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('auto_approve_privileged_uploads', '0', NULL, ?)", [env.rt.clock.now().toISOString()]);
    const id = await upload(admin, '/admin/v1', 'off.png', png(1920, 1080));
    expect(await row(id)).toMatchObject({ review_state: 'pending', state: 'pending_review' });
    await env.rt.db.run("DELETE FROM settings WHERE key = 'auto_approve_privileged_uploads'");
    expect(await sweepAutoApprove(env.rt)).toBeGreaterThanOrEqual(1);
    expect((await row(id)).review_state).toBe('approved');
  });
});

describe('anh dai dien (thumbnail)', () => {
  const putThumb = (s: Session, prefix: string, id: string, body: Uint8Array | string, type = 'image/jpeg') =>
    env.app.request(`${prefix}/media/${id}/thumbnail`, { method: 'PUT', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': type }, body });
  const getThumb = (s: Session | null, prefix: string, id: string) => env.app.request(`${prefix}/media/${id}/thumbnail`, { headers: s ? { cookie: s.cookie } : {} });
  let mine: string;
  let theirs: string;
  beforeAll(async () => {
    mine = await upload(admin, '/admin/v1', 't1.png', png(1920, 1080));
    theirs = await upload(lan, '/portal/v1', 't2.png', png(1920, 1080));
  });

  it('chua co anh: thumb_url null, GET 404', async () => {
    expect((await admin.json('GET', `/admin/v1/media/${mine}`)).body.thumb_url).toBeNull();
    expect((await getThumb(admin, '/admin/v1', mine)).status).toBe(404);
  });

  it('PUT JPEG: luu o media/{khach}/{id}/thumb.jpg, thumb_url co mat trong danh sach + chi tiet, GET tra byte, Cache-Control private', async () => {
    const jpg = jpegThumb(3000);
    const r = await putThumb(admin, '/admin/v1', mine, jpg);
    expect(r.status).toBe(200);
    expect((await r.json() as any).thumb_url).toMatch(new RegExp(`^/api/admin/v1/media/${mine}/thumbnail\\?v=`));
    expect(await env.rt.objects.head(`media/${K001}/${mine}/thumb.jpg`)).toMatchObject({ size: 3000 });
    const g = await admin.json('GET', `/admin/v1/media/${mine}`);
    expect(g.body.thumb_url).toContain(`/media/${mine}/thumbnail`);
    const list = await admin.json('GET', '/admin/v1/media?page_size=100');
    expect(list.body.items.find((x: any) => x.id === mine).thumb_url).toBe(g.body.thumb_url);
    const res = await getThumb(admin, '/admin/v1', mine);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toContain('private');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpg);
    expect((await auditOf(mine, 'media.thumbnail')).length).toBe(1);
  });

  it('WebP duoc nhan; thay anh moi ghi de', async () => {
    expect((await putThumb(admin, '/admin/v1', mine, webpThumb(), 'image/webp')).status).toBe(200);
    expect((await getThumb(admin, '/admin/v1', mine)).headers.get('content-type')).toBe('image/webp');
  });

  it('gioi han: > 150 KB -> 413; khong phai JPEG/WebP (PNG, HTML) -> 422; rong -> 422', async () => {
    expect((await putThumb(admin, '/admin/v1', mine, jpegThumb(THUMB_MAX_BYTES + 1))).status).toBe(413);
    expect((await putThumb(admin, '/admin/v1', mine, jpegThumb(THUMB_MAX_BYTES))).status).toBe(200);
    expect((await putThumb(admin, '/admin/v1', mine, png(10, 10))).status).toBe(422);
    expect((await putThumb(admin, '/admin/v1', mine, '<html><script>alert(1)</script></html>', 'image/jpeg')).status).toBe(422);
    expect((await putThumb(admin, '/admin/v1', mine, new Uint8Array(0))).status).toBe(422);
    expect(sniffThumb(jpegThumb(100))).toBe('image/jpeg');
    expect(sniffThumb(png(1, 1))).toBeNull();
  });

  it('quyen: chua dang nhap 401; thieu CSRF bi chan; khach khac 404 ca PUT lan GET; khach tu tao cho tep cua minh qua portal', async () => {
    expect((await getThumb(null, '/admin/v1', mine)).status).toBe(401);
    const noCsrf = await env.app.request(`/admin/v1/media/${mine}/thumbnail`, { method: 'PUT', headers: { cookie: admin.cookie, 'content-type': 'image/jpeg' }, body: jpegThumb() });
    expect(noCsrf.status).toBeGreaterThanOrEqual(400);
    expect((await putThumb(dang, '/portal/v1', theirs, jpegThumb())).status).toBe(404);
    expect((await getThumb(dang, '/portal/v1', mine)).status).toBe(404);
    expect((await putThumb(lan, '/portal/v1', theirs, jpegThumb())).status).toBe(200);
    expect((await getThumb(lan, '/portal/v1', theirs)).status).toBe(200);
    expect((await getThumb(dang, '/portal/v1', theirs)).status).toBe(404);
    expect((await lan.json('GET', `/portal/v1/media/${theirs}`)).body.thumb_url).toContain('/api/portal/v1/media/');
    expect((await putThumb(lan, '/admin/v1', theirs, jpegThumb())).status).toBe(403); // khach khong vao API quan tri
  });

  it('xoa media xoa luon anh dai dien', async () => {
    const key = `media/${K001}/${mine}/thumb.jpg`;
    expect(await env.rt.objects.head(key)).not.toBeNull();
    expect((await admin.json('DELETE', `/admin/v1/media/${mine}`)).status).toBe(200);
    expect(await env.rt.objects.head(key)).toBeNull();
    expect((await env.rt.db.query('SELECT 1 FROM creative_thumbnails WHERE creative_id = ?', [mine])).length).toBe(0);
  });
});
