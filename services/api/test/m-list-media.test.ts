// m-list: sua metadata / xoa mem / tham chieu / IDOR / reset duyet / don R2 cua trang Noi dung & Media.
import { beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let lan: Session; // K001
let dang: Session; // K008
let K001: string;

const png = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
/** Tai that mot anh PNG qua portal (upload-url -> PUT -> confirm) cho khach s. */
async function newImage(s: Session, name: string): Promise<{ id: string; key: string }> {
  const u = await s.json('POST', '/portal/v1/media/upload-url', { name, content_type: 'image/png', size_bytes: 33, width: 1920, height: 1080 });
  expect(u.status).toBe(201);
  await env.rt.objects.put(u.body.key, png(1920, 1080), 'image/png');
  expect((await s.json('POST', `/portal/v1/media/${u.body.id}/confirm`, {})).status).toBe(200);
  const key = (await env.rt.db.query<{ storage_key: string }>('SELECT storage_key FROM creatives WHERE id = ?', [u.body.id]))[0]!.storage_key; // confirm doi sang khoa dong bang
  return { id: u.body.id, key };
}
const approve = async (id: string) => {
  await env.rt.db.run("UPDATE creatives SET scan_state = 'clean' WHERE id = ?", [id]);
  expect((await admin.json('POST', `/admin/v1/media/${id}/approve`, {})).status).toBe(200);
};
const audits = (id: string, action: string) => env.rt.db.query<{ id: string }>('SELECT id FROM audit_log WHERE object_id = ? AND action = ?', [id, action]);

beforeAll(async () => {
  env = await setup();
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
}, 120_000);

describe('danh sach media', () => {
  it('tra ve tags/mo ta, tim kiem, phan trang', async () => {
    const a = await newImage(lan, 'list-a.png');
    const r = await admin.json('GET', `/admin/v1/media?q=list-a&page_size=5`);
    expect(r.status).toBe(200);
    const it = r.body.items.find((m: any) => m.id === a.id);
    expect(it).toHaveProperty('tags');
    expect(r.body.total).toBeGreaterThanOrEqual(1);
  });
});

describe('PATCH /media/:id', () => {
  it('sua ten, mo ta, the, thoi luong anh; ghi audit; khong dong cham duyet', async () => {
    const a = await newImage(lan, 'edit-me.png');
    await approve(a.id);
    const r = await admin.json('PATCH', `/admin/v1/media/${a.id}`, { name: 'Ten moi', description: 'Mo ta', tags: ['tet', 'tet', 'sua'], duration_sec: 12 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Ten moi', description: 'Mo ta', tags: ['tet', 'sua'], duration_sec: 12, status: 'approved' });
    expect((await audits(a.id, 'media.update')).length).toBe(1);
  });

  it('chu so huu (khach) sua duoc; khach khac -> 404; vai tro khong co quyen -> 403', async () => {
    const a = await newImage(lan, 'own.png');
    expect((await lan.json('PATCH', `/portal/v1/media/${a.id}`, { name: 'Cua toi' })).body.name).toBe('Cua toi');
    expect((await dang.req('PATCH', `/portal/v1/media/${a.id}`, { name: 'danh cap' })).status).toBe(404);
    expect((await env.rt.db.query<{ name: string }>('SELECT name FROM creatives WHERE id = ?', [a.id]))[0]!.name).toBe('Cua toi');
    const fin = await login(env, env.byRole('finance'));
    expect((await fin.req('PATCH', `/admin/v1/media/${a.id}`, { name: 'x' })).status).toBe(403);
  });

  it('khach khong doi khach hang so huu; truong la / rong bi tu choi; thoi luong chi cho anh', async () => {
    const a = await newImage(lan, 'cust.png');
    expect((await lan.req('PATCH', `/portal/v1/media/${a.id}`, { customer_id: env.seed.customers['K008'] })).status).toBe(403);
    expect((await admin.req('PATCH', `/admin/v1/media/${a.id}`, { review_state: 'approved' })).status).toBe(422);
    expect((await admin.req('PATCH', `/admin/v1/media/${a.id}`, {})).status).toBe(422);
    expect((await admin.req('PATCH', `/admin/v1/media/${a.id}`, { name: '' })).status).toBe(422);
    const ch = await admin.json('PATCH', `/admin/v1/media/${a.id}`, { customer_id: env.seed.customers['K008'] });
    expect(ch.status).toBe(200);
    expect(ch.body.customer_id).toBe(env.seed.customers['K008']);
    await env.rt.db.run("UPDATE creatives SET kind = 'video', mime = 'video/mp4' WHERE id = ?", [a.id]);
    expect((await admin.json('PATCH', `/admin/v1/media/${a.id}`, { duration_sec: 9 })).body.error.code).toBe('duration_fixed');
  });

  it('doi URL cua tep lien ket: quay lai cho duyet + tang content_version; URL xau bi tu choi', async () => {
    const imp = await lan.json('POST', '/portal/v1/media/import', { source: 'drive', url: 'https://drive.google.com/file/d/1cfoXZesra4gI_XZNDOFXMpYXo2BgFIvF/view?usp=sharing' });
    expect(imp.status).toBe(201);
    const id = imp.body.id;
    await env.rt.db.run("UPDATE creatives SET review_state = 'approved', state = 'ready', scan_state = 'clean' WHERE id = ?", [id]);
    const v0 = (await admin.json('GET', `/admin/v1/media/${id}`)).body.content_version;
    expect((await admin.json('PATCH', `/admin/v1/media/${id}`, { source_url: 'http://localhost/evil' })).status).toBe(422);
    const r = await admin.json('PATCH', `/admin/v1/media/${id}`, { source_url: 'https://drive.google.com/file/d/1zzz999zzz999zzz999zzz999/view?usp=sharing' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('pending');
    expect(r.body.content_version).toBe(v0 + 1);
    expect(r.body.source_url).toContain('zzz999');
    // tep tai len khong co URL de sua
    const a = await newImage(lan, 'nolink.png');
    expect((await admin.json('PATCH', `/admin/v1/media/${a.id}`, { source_url: 'https://example.com/x.mp4' })).body.error.code).toBe('not_a_link');
  });
});

describe('tham chieu + xoa (dung co che co san)', () => {
  it('references liet ke chien dich; xoa bi chan 409 khi dang dung; chien dich nhap thi xoa duoc', async () => {
    const a = await newImage(lan, 'ref.png');
    await approve(a.id);
    const camp = await lan.json('POST', '/portal/v1/campaigns', { name: 'Chien dich dung tep', budget_vnd: 5_000_000, screen_type: 'tv', media_id: a.id, start_date: '2026-11-01', end_date: '2026-12-31' });
    expect(camp.status).toBe(201);
    const campId = camp.body.id;
    const target = (await env.rt.db.query<{ id: string }>('SELECT id FROM creatives WHERE customer_id = ? AND campaign_id = ?', [K001, campId]))[0]!.id;
    await env.rt.db.run("UPDATE campaigns SET state = 'active' WHERE id = ?", [campId]);
    const refs = await admin.json('GET', `/admin/v1/media/${target}/references`);
    expect(refs.body.can_delete).toBe(false);
    expect(refs.body.references[0]).toMatchObject({ id: campId, state: 'active', blocking: true });
    expect((await admin.json('DELETE', `/admin/v1/media/${target}`)).status).toBe(409);
    expect((await dang.req('GET', `/portal/v1/media/${target}/references`)).status).toBe(404); // IDOR
    await env.rt.db.run("UPDATE campaigns SET state = 'draft' WHERE id = ?", [campId]);
    expect((await admin.json('GET', `/admin/v1/media/${target}/references`)).body.can_delete).toBe(true);
    expect((await admin.json('DELETE', `/admin/v1/media/${target}`)).status).toBe(200);
  });
});
