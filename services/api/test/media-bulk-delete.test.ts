// Xoa hang loat media: POST /media/bulk-delete. Quyen (media:delete) o may chu, pham vi khach hang, bo qua tep dang dung trong chien dich,
// xoa that thumbnail + tep trong objects, gioi han 200, audit (media.bulk_delete + tung media.delete).
import { beforeAll, describe, expect, it } from 'vitest';
import { BULK_DELETE_MAX } from '../src/routes/media.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let content: Session;
let finance: Session;
let devops: Session;
let lan: Session;
let dang: Session;
let K001: string;
let K008: string;
const jpegThumb = (n = 2000) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]); b[n - 2] = 0xff; b[n - 1] = 0xd9; return b; };

const rows = (sql: string, p: unknown[] = []) => env.rt.db.query<any>(sql, p);
const exists = async (id: string) => (await rows('SELECT 1 FROM creatives WHERE id = ?', [id])).length > 0;
const audit = (action: string) => rows('SELECT action, object_id, diff, actor_id FROM audit_log WHERE action = ? ORDER BY ts, id', [action]);
const bulk = (s: Session, ids: unknown, prefix = '/admin/v1') => s.json('POST', `${prefix}/media/bulk-delete`, { ids });

/** Tao mot tep media (hang creatives + tep trong objects), tuy chon co anh dai dien; tra {id, key, thumbKey}. */
async function mk(customer: string, name: string, opts: { thumb?: boolean; bytes?: number } = {}): Promise<{ id: string; key: string; thumbKey: string | null }> {
  const r = await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: customer, name, content_type: 'image/png', size_bytes: opts.bytes ?? 1000, width: 1080, height: 1920 });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await env.rt.objects.put(r.body.key, new Uint8Array(opts.bytes ?? 1000), 'image/png');
  let thumbKey: string | null = null;
  if (opts.thumb) {
    const t = await env.app.request(`/admin/v1/media/${r.body.id}/thumbnail`, { method: 'PUT', headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': 'image/jpeg' }, body: jpegThumb() });
    expect(t.status).toBe(200);
    thumbKey = (await rows('SELECT thumb_key FROM creative_thumbnails WHERE creative_id = ?', [r.body.id]))[0]!.thumb_key;
    expect(await env.rt.objects.head(thumbKey!)).not.toBeNull();
  }
  return { id: r.body.id, key: r.body.key, thumbKey };
}

beforeAll(async () => {
  env = await setup({});
  K001 = env.seed.customers['K001']!;
  K008 = env.seed.customers['K008']!;
  admin = await login(env, env.byRole('super_admin'));
  content = await login(env, env.byRole('content_manager'));
  finance = await login(env, env.byRole('finance'));
  devops = await login(env, env.byRole('device_ops'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
}, 120_000);

describe('POST /media/bulk-delete: quyen', () => {
  it('chi nguoi co media:delete (super_admin, content_manager) duoc goi; finance, device_ops, khach hang -> 403; chua dang nhap -> 401; thieu CSRF -> chan', async () => {
    const a = await mk(K001, 'q1.png');
    for (const s of [finance, devops]) expect((await bulk(s, [a.id])).status).toBe(403);
    expect((await bulk(lan, [a.id], '/portal/v1')).status).toBe(404); // cong khach hang khong co route xoa (nhu DELETE /:id)
    expect((await bulk(lan, [a.id])).status).toBe(403); // khach khong vao API quan tri
    expect((await env.app.request('/admin/v1/media/bulk-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [a.id] }) })).status).toBe(401);
    expect((await admin.req('POST', '/admin/v1/media/bulk-delete', { ids: [a.id] }, { csrf: null })).status).toBeGreaterThanOrEqual(400);
    expect(await exists(a.id)).toBe(true);
    const ok = await bulk(content, [a.id]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await exists(a.id)).toBe(false);
  });
  it('quyen bi go (admin_permissions) co hieu luc ngay o may chu', async () => {
    const a = await mk(K001, 'q2.png');
    const cm = (await rows('SELECT id FROM admins WHERE email = ?', [env.byRole('content_manager')]))[0]!;
    const before = (await admin.json('GET', `/admin/v1/permissions/${cm.id}`)).body.permissions;
    expect((await admin.json('PUT', `/admin/v1/permissions/${cm.id}`, { permissions: { ...before, media: ['view', 'write', 'approve'] } })).status).toBe(200);
    content = await login(env, env.byRole('content_manager')); // doi quyen thu hoi phien cu: dang nhap lai
    expect((await bulk(content, [a.id])).status).toBe(403);
    expect(await exists(a.id)).toBe(true);
    expect((await admin.json('PUT', `/admin/v1/permissions/${cm.id}`, { permissions: before })).status).toBe(200);
    content = await login(env, env.byRole('content_manager'));
    expect((await bulk(content, [a.id])).status).toBe(200);
  });
});

describe('POST /media/bulk-delete: xoa that + audit', () => {
  it('xoa hang CSDL, creative_thumbnails, khoa tep goc va khoa anh dai dien trong objects; tra dung so luong + dung luong', async () => {
    const a = await mk(K001, 'a.png', { thumb: true, bytes: 1500 });
    const b = await mk(K008, 'b.png', { bytes: 2500 });
    const keep = await mk(K001, 'keep.png', { thumb: true });
    const r = await bulk(admin, [a.id, b.id]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ requested: 2, deleted_count: 2, skipped_count: 0, freed_bytes: 4000, skipped: [] });
    expect(r.body.deleted.map((x: any) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(r.body.objects_deleted).toBeGreaterThanOrEqual(3);
    for (const x of [a, b]) {
      expect(await exists(x.id)).toBe(false);
      expect(await env.rt.objects.head(x.key)).toBeNull();
    }
    expect(await env.rt.objects.head(a.thumbKey!)).toBeNull();
    expect((await rows('SELECT 1 FROM creative_thumbnails WHERE creative_id = ?', [a.id])).length).toBe(0);
    // tep khong nam trong danh sach con nguyen
    expect(await exists(keep.id)).toBe(true);
    expect(await env.rt.objects.head(keep.key)).not.toBeNull();
    expect(await env.rt.objects.head(keep.thumbKey!)).not.toBeNull();
    expect((await admin.json('GET', `/admin/v1/media/${a.id}`)).status).toBe(404);
  });

  it('audit: media.bulk_delete (tom tat) + media.delete cho TUNG tep da xoa, co actor', async () => {
    const before = (await audit('media.delete')).length;
    const x = await mk(K001, 'au1.png');
    const y = await mk(K001, 'au2.png');
    const r = await bulk(content, [x.id, y.id, 'khong-co']);
    expect(r.status).toBe(200);
    const bd = (await audit('media.bulk_delete')).at(-1)!;
    expect(bd.actor_id).toBeTruthy();
    const d = typeof bd.diff === 'string' ? JSON.parse(bd.diff) : bd.diff;
    expect(d).toMatchObject({ requested: 3, deleted_count: 2, skipped_count: 1 });
    expect(d.deleted_ids.sort()).toEqual([x.id, y.id].sort());
    const per = await audit('media.delete');
    expect(per.length - before).toBe(2);
    expect(per.slice(-2).map((p: any) => p.object_id).sort()).toEqual([x.id, y.id].sort());
    expect(per.slice(-2).every((p: any) => p.actor_id)).toBe(true);
  });

  it('id lap duoc gop; id khong ton tai -> bo qua (not_found); so luong 0 hoac > 200 hoac sai kieu -> 422 va khong xoa gi', async () => {
    const a = await mk(K001, 'dup.png');
    const r = await bulk(admin, [a.id, a.id, 'khong-ton-tai']);
    expect(r.body).toMatchObject({ requested: 2, deleted_count: 1, skipped_count: 1 });
    expect(r.body.skipped[0]).toMatchObject({ id: 'khong-ton-tai', code: 'not_found' });
    const keep = await mk(K001, 'lim.png');
    expect((await bulk(admin, [])).status).toBe(422);
    expect((await bulk(admin, 'x')).status).toBe(422);
    expect((await bulk(admin, [5])).status).toBe(422);
    const many = Array.from({ length: BULK_DELETE_MAX + 1 }, (_, i) => `id-${i}`);
    expect((await bulk(admin, [keep.id, ...many.slice(1)])).status).toBe(422);
    expect(await exists(keep.id)).toBe(true);
    // dung 200 id: duoc xu ly (toan bo "khong tim thay")
    const exact = await bulk(admin, many.slice(0, BULK_DELETE_MAX));
    expect(exact.status).toBe(200);
    expect(exact.body).toMatchObject({ requested: BULK_DELETE_MAX, deleted_count: 0, skipped_count: BULK_DELETE_MAX });
    expect((await audit('media.bulk_delete')).length).toBeGreaterThan(0);
  });
});

describe('POST /media/bulk-delete: tep dang dung', () => {
  async function campaignIn(state: string, customer?: string): Promise<{ id: string; name: string }> {
    const q = customer ? 'SELECT id, name FROM campaigns WHERE state = ? AND customer_id = ? LIMIT 1' : 'SELECT id, name FROM campaigns WHERE state = ? LIMIT 1';
    const c = (await rows(q, customer ? [state, customer] : [state]))[0];
    if (c) return c;
    const any = (await rows('SELECT id, name FROM campaigns LIMIT 1'))[0]!; // chua co chien dich o trang thai nay: doi trang thai mot chien dich
    await env.rt.db.run('UPDATE campaigns SET state = ? WHERE id = ?', [state, any.id]);
    return any;
  }
  it('tep thuoc chien dich dang phat / da len lich / cho duyet bi BO QUA kem ly do co ten chien dich, KHONG bi xoa (ca thumbnail + tep goc); tep o chien dich nhap thi xoa', async () => {
    const act = await campaignIn('active');
    const f1 = await mk(K001, 'inuse.png', { thumb: true });
    await env.rt.db.run('UPDATE creatives SET campaign_id = ? WHERE id = ?', [act.id, f1.id]);
    const f2 = await mk(K001, 'sched.png');
    const sch = (await rows("SELECT id, name FROM campaigns WHERE id <> ? LIMIT 1", [act.id]))[0]!;
    const prev = (await rows('SELECT state FROM campaigns WHERE id = ?', [sch.id]))[0].state;
    await env.rt.db.run("UPDATE campaigns SET state = 'scheduled' WHERE id = ?", [sch.id]);
    await env.rt.db.run('UPDATE creatives SET campaign_id = ? WHERE id = ?', [sch.id, f2.id]);
    const f3 = await mk(K001, 'draftuse.png');
    const dr = (await rows("SELECT id FROM campaigns WHERE id NOT IN (?, ?) LIMIT 1", [act.id, sch.id]))[0]!;
    await env.rt.db.run("UPDATE campaigns SET state = 'draft' WHERE id = ?", [dr.id]);
    await env.rt.db.run('UPDATE creatives SET campaign_id = ? WHERE id = ?', [dr.id, f3.id]);
    const free = await mk(K001, 'free.png');

    const r = await bulk(admin, [f1.id, f2.id, f3.id, free.id]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ deleted_count: 2, skipped_count: 2 });
    const sk = Object.fromEntries(r.body.skipped.map((x: any) => [x.id, x]));
    expect(sk[f1.id]).toMatchObject({ code: 'in_use', reason: `Đang dùng trong chiến dịch ${act.name}` });
    expect(sk[f2.id]).toMatchObject({ code: 'in_use', reason: `Đang dùng trong chiến dịch ${sch.name}` });
    // bi bo qua: con nguyen ven (khong xoa ngam)
    for (const f of [f1, f2]) {
      expect(await exists(f.id)).toBe(true);
      expect(await env.rt.objects.head(f.key)).not.toBeNull();
    }
    expect(await env.rt.objects.head(f1.thumbKey!)).not.toBeNull();
    expect((await rows('SELECT 1 FROM creative_thumbnails WHERE creative_id = ?', [f1.id])).length).toBe(1);
    // da xoa: chien dich nhap + tep tu do
    for (const f of [f3, free]) expect(await exists(f.id)).toBe(false);
    // chi tiep tuc audit media.delete cho tep da xoa, khong co cho tep bi bo qua
    const del = (await audit('media.delete')).map((a: any) => a.object_id);
    expect(del).toContain(f3.id);
    expect(del).not.toContain(f1.id);
    await env.rt.db.run('UPDATE campaigns SET state = ? WHERE id = ?', [prev, sch.id]);
  });
});

describe('POST /media/bulk-delete: pham vi khach hang (IDOR)', () => {
  it('tai khoan ngoai khong co route xoa (404) va bi chan o API quan tri (403): khong xoa duoc tep cua minh lan cua khach khac; tep cua khach khac van con', async () => {
    const theirs = await mk(K008, 'theirs.png', { thumb: true });
    const mine = await mk(K001, 'mine.png');
    expect((await bulk(lan, [theirs.id, mine.id], '/portal/v1')).status).toBe(404);
    expect((await bulk(dang, [theirs.id], '/portal/v1')).status).toBe(404);
    expect((await bulk(lan, [theirs.id, mine.id])).status).toBe(403); // API quan tri: khach bi chan
    expect(await exists(theirs.id)).toBe(true);
    expect(await exists(mine.id)).toBe(true);
    expect(await env.rt.objects.head(theirs.key)).not.toBeNull();
  });
  it('nguoi noi bo xoa duoc tep cua moi khach (khong co pham vi khach hang)', async () => {
    const x = await mk(K001, 'int1.png');
    const y = await mk(K008, 'int2.png');
    const r = await bulk(content, [x.id, y.id]);
    expect(r.body).toMatchObject({ deleted_count: 2, skipped_count: 0 });
  });
});
