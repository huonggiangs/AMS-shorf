// Tai tep lon TUNG PHAN qua Worker (R2 multipart, khong can khoa S3): khoi tao / PUT phan / complete / abort, quyen, IDOR, het han, don dep.
import { beforeAll, describe, expect, it } from 'vitest';
import { sweepMultipart } from '../src/lib/transfers.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { bigMp4 } from './mp4-fixture.js';
const tag = (st: string) => [...st].map((c) => c.charCodeAt(0));
const cat = (...p: (number[] | Uint8Array)[]) => {
  const out = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

const PART = 131072; // 128 KiB (chi runtime test ghi de duoc MEDIA_PART_SIZE_BYTES)
let env: Env;
let admin: Session;
let content: Session;
let finance: Session;
let lan: Session;
let dang: Session;
let K001: string;
const store = () => env.rt.objects as any;
const rows = (sql: string, p: unknown[] = []) => env.rt.db.query<any>(sql, p);
const bytesOf = (n: number) => bigMp4(1080, 1920, 15, n);

const create = (s: Session, prefix: string, bytes: Uint8Array, o: Record<string, unknown> = {}) =>
  s.json('POST', `${prefix}/media/upload-url`, { name: 'v.mp4', content_type: 'video/mp4', size_bytes: bytes.length, width: 1080, height: 1920, duration_sec: 15, target_type: 'elevator', ...(prefix === '/admin/v1' ? { customer_id: K001 } : {}), ...o });
const init = (s: Session, prefix: string, id: string) => s.json('POST', `${prefix}/media/${id}/multipart`, {});
const putPart = (s: Session, prefix: string, id: string, n: number | string, body: Uint8Array | ReadableStream, headers: Record<string, string> = {}) =>
  env.app.request(`${prefix}/media/${id}/parts/${n}`, { method: 'PUT', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': 'application/octet-stream', ...headers }, body: body as any, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as any);
const len = (b: Uint8Array) => ({ 'content-length': String(b.length) });
const slice = (b: Uint8Array, n: number) => b.slice((n - 1) * PART, Math.min(b.length, n * PART));
async function uploadAll(s: Session, prefix: string, id: string, b: Uint8Array, total: number) {
  const parts: { n: number; etag: string }[] = [];
  for (let n = 1; n <= total; n++) {
    const p = slice(b, n);
    const r = await putPart(s, prefix, id, n, p, len(p));
    expect(r.status, await r.clone().text()).toBe(200);
    parts.push({ n, etag: ((await r.json()) as any).etag });
  }
  return parts;
}

beforeAll(async () => {
  env = await setup({}, 'postgres', { MEDIA_PART_SIZE_BYTES: String(PART) });
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  content = await login(env, env.byRole('content_manager'));
  finance = await login(env, env.byRole('finance'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
  store().signedPut = false; // mo phong Cloudflare thieu khoa S3
}, 120_000);

describe('luong day du: khoi tao -> PUT tung phan -> complete -> confirm', () => {
  it('3 phan (128 KiB): luu dung tung byte, audit moi buoc, confirm -> pending_review, khong con phien mo', async () => {
    const b = bytesOf(300_000);
    expect(Math.ceil(b.length / PART)).toBe(3);
    const r = await create(admin, '/admin/v1', b);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id;
    const i = await init(admin, '/admin/v1', id);
    expect(i.status, JSON.stringify(i.body)).toBe(201);
    expect(i.body).toMatchObject({ part_size: PART, total_parts: 3, size_bytes: b.length, status: 'open', parts: [] });
    expect(typeof i.body.upload_id).toBe('string');
    const parts = await uploadAll(admin, '/admin/v1', id, b, 3);
    expect(await store().head(r.body.key)).toBeNull(); // chua complete: chua co tep
    const done = await admin.json('POST', `/admin/v1/media/${id}/multipart/complete`, { parts });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toEqual({ ok: true, size_bytes: b.length });
    expect(Array.from((await store().get(r.body.key))!)).toEqual(Array.from(b));
    expect((await admin.json('POST', `/admin/v1/media/${id}/multipart/complete`, { parts })).status).toBe(200); // idempotent
    const cf = await admin.json('POST', `/admin/v1/media/${id}/confirm`, {});
    expect(cf.status, JSON.stringify(cf.body)).toBe(200);
    expect(cf.body.size_bytes).toBe(b.length);
    expect(cf.body.status).not.toBe('processing');
    expect(cf.body.transfer).toMatchObject({ kind: 'multipart', status: 'completed', bytes_done: b.length, percent: 100 });
    const act = (await rows("SELECT action FROM audit_log WHERE object_id = ? AND action LIKE 'media.multipart%' ORDER BY ts, action", [id])).map((x) => x.action);
    expect(act.filter((a) => a === 'media.multipart_part').length).toBe(3);
    expect(act).toContain('media.multipart_init');
    expect(act).toContain('media.multipart_complete');
    expect(store().openMultipart()).not.toContain(i.body.upload_id);
  });

  it('tiep tuc phien: khoi tao lai tra cung upload_id va cac phan da co (client chi gui phan con thieu)', async () => {
    const b = bytesOf(300_000);
    const r = await create(admin, '/admin/v1', b);
    const i1 = await init(admin, '/admin/v1', r.body.id);
    const p1 = slice(b, 1);
    expect((await putPart(admin, '/admin/v1', r.body.id, 1, p1, len(p1))).status).toBe(200);
    const i2 = await init(admin, '/admin/v1', r.body.id);
    expect(i2.status).toBe(200);
    expect(i2.body.upload_id).toBe(i1.body.upload_id);
    expect(i2.body.parts).toHaveLength(1);
    expect(i2.body.parts[0]).toMatchObject({ n: 1, size: PART });
    expect(store().openMultipart().filter((u: string) => u === i1.body.upload_id)).toHaveLength(1);
  });

  it('gui lai mot phan (thu lai) ghi de, khong tinh trung; loi tai phan -> 502 part_failed roi thu lai duoc', async () => {
    const b = bytesOf(200_000); // 2 phan
    const r = await create(admin, '/admin/v1', b);
    await init(admin, '/admin/v1', r.body.id);
    const p1 = slice(b, 1);
    store().failPart = { n: 1, times: 1 };
    const bad = await putPart(admin, '/admin/v1', r.body.id, 1, p1, len(p1));
    expect(bad.status).toBe(502);
    expect(((await bad.json()) as any).error.code).toBe('part_failed');
    expect((await putPart(admin, '/admin/v1', r.body.id, 1, p1, len(p1))).status).toBe(200);
    expect((await putPart(admin, '/admin/v1', r.body.id, 1, p1, len(p1))).status).toBe(200);
    const t = (await rows('SELECT parts, bytes_done FROM creative_transfers WHERE creative_id = ?', [r.body.id]))[0];
    expect(JSON.parse(t.parts)).toHaveLength(1);
    expect(Number(t.bytes_done)).toBe(PART);
  });
});

describe('kiem tra phan va complete', () => {
  it('sai Content-Length / thieu Content-Length / sai so phan / noi dung nhieu hon khai bao -> loi ro, khong ghi', async () => {
    const b = bytesOf(300_000);
    const r = await create(admin, '/admin/v1', b);
    const id = r.body.id;
    await init(admin, '/admin/v1', id);
    const p1 = slice(b, 1);
    const short = await putPart(admin, '/admin/v1', id, 1, p1.slice(0, 100), len(p1.slice(0, 100)));
    expect(short.status).toBe(400);
    expect(((await short.json()) as any).error.code).toBe('length_mismatch');
    const lastOk = slice(b, 3);
    const wrongLast = await putPart(admin, '/admin/v1', id, 3, p1, len(p1)); // phan cuoi phai ngan hon
    expect(wrongLast.status).toBe(400);
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(p1); c.close(); } });
    const noLen = await putPart(admin, '/admin/v1', id, 1, stream);
    expect(noLen.status).toBe(400);
    expect(((await noLen.json()) as any).error.code).toBe('length_required');
    // Content-Length noi doi: khai bao dung nhung gui nhieu hon
    const lie = await putPart(admin, '/admin/v1', id, 1, cat(p1, new Uint8Array(10)), len(p1));
    expect([400, 502]).toContain(lie.status);
    for (const n of ['0', '4', '-1', 'abc', '1.5']) {
      const x = await putPart(admin, '/admin/v1', id, n, p1, len(p1));
      expect([404, 422], n).toContain(x.status);
    }
    expect(JSON.parse((await rows('SELECT parts FROM creative_transfers WHERE creative_id = ?', [id]))[0].parts)).toEqual([]);
    expect(lastOk.length).toBeLessThan(PART);
  });

  it('complete: thieu phan -> 422 parts_missing; etag sai -> 422 etag_mismatch; danh sach trung/ngoai khoang -> parts_invalid; tong khac size_bytes -> size_mismatch; chua tao tep', async () => {
    const b = bytesOf(300_000);
    const r = await create(admin, '/admin/v1', b);
    const id = r.body.id;
    await init(admin, '/admin/v1', id);
    const p1 = slice(b, 1);
    const p2 = slice(b, 2);
    const e1 = ((await (await putPart(admin, '/admin/v1', id, 1, p1, len(p1))).json()) as any).etag;
    const e2 = ((await (await putPart(admin, '/admin/v1', id, 2, p2, len(p2))).json()) as any).etag;
    const miss = await admin.json('POST', `/admin/v1/media/${id}/multipart/complete`, { parts: [{ n: 1, etag: e1 }, { n: 2, etag: e2 }] });
    expect(miss.status).toBe(422);
    expect(miss.body.error.code).toBe('parts_missing');
    expect(miss.body.error.details.missing).toEqual([3]);
    const p3 = slice(b, 3);
    const e3 = ((await (await putPart(admin, '/admin/v1', id, 3, p3, len(p3))).json()) as any).etag;
    const bad = await admin.json('POST', `/admin/v1/media/${id}/multipart/complete`, { parts: [{ n: 1, etag: e1 }, { n: 2, etag: '"sai"' }, { n: 3, etag: e3 }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('etag_mismatch');
    expect(bad.body.error.details.part).toBe(2);
    expect((await admin.json('POST', `/admin/v1/media/${id}/multipart/complete`, { parts: [{ n: 1, etag: e1 }, { n: 1, etag: e1 }, { n: 3, etag: e3 }] })).body.error.code).toBe('parts_invalid');
    expect((await admin.json('POST', `/admin/v1/media/${id}/multipart/complete`, { parts: [{ n: 1, etag: e1 }, { n: 2, etag: e2 }, { n: 4, etag: e3 }] })).body.error.code).toBe('parts_invalid');
    expect((await admin.json('POST', `/admin/v1/media/${id}/multipart/complete`, { parts: [] })).status).toBe(422);
    // tong kich thuoc cac phan da ghi khac size_bytes khai bao (gia lap du lieu bi hong)
    const t = (await rows('SELECT parts FROM creative_transfers WHERE creative_id = ?', [id]))[0];
    const tampered = JSON.parse(t.parts).map((p: any) => (p.n === 3 ? { ...p, size: p.size - 1 } : p));
    await env.rt.db.run('UPDATE creative_transfers SET parts = ? WHERE creative_id = ?', [JSON.stringify(tampered), id]);
    const sz = await admin.json('POST', `/admin/v1/media/${id}/multipart/complete`, { parts: [{ n: 1, etag: e1 }, { n: 2, etag: e2 }, { n: 3, etag: e3 }] });
    expect(sz.status).toBe(422);
    expect(sz.body.error.code).toBe('size_mismatch');
    expect(await store().head(r.body.key)).toBeNull();
  });

  it('tran 200 MB cho thang may, TV 100 MB: upload-url tu choi tep lon hon; 200 MB duoc cap phien multipart (7 phan 32 MiB)', async () => {
    const mk = (o: Record<string, unknown>) => admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'v.mp4', content_type: 'video/mp4', width: 1080, height: 1920, duration_sec: 20, ...o });
    const max = await mk({ size_bytes: 200 * 1048576 });
    expect(max.status, JSON.stringify(max.body)).toBe(201);
    expect(max.body.via).toBe('multipart');
    expect(max.body.multipart.total_parts).toBe(Math.ceil((200 * 1048576) / PART)); // test dung phan 128 KiB; san xuat: 7
    expect((await mk({ size_bytes: 200 * 1048576 + 1 })).status).toBe(422);
    const tv = await mk({ width: 1920, height: 1080, size_bytes: 100 * 1048576 + 1 });
    expect(tv.status).toBe(422);
    expect(tv.body.error.message).toMatch(/100 MB/);
  });
});

describe('quyen, IDOR, huy, het han, don dep', () => {
  it('chi nguoi tao tep (403 not_uploader), khach khac 404, chua dang nhap 401, thieu quyen media:write 403, thieu CSRF bi chan', async () => {
    const b = bytesOf(200_000);
    const r = await create(admin, '/admin/v1', b);
    const id = r.body.id;
    expect((await init(content, '/admin/v1', id)).status).toBe(403); // noi bo khac co media:write nhung khong phai nguoi tao
    expect((await init(finance, '/admin/v1', id)).status).toBe(403); // khong co quyen media:write
    expect((await env.app.request(`/admin/v1/media/${id}/multipart`, { method: 'POST' })).status).toBe(401);
    expect((await env.app.request(`/admin/v1/media/${id}/multipart`, { method: 'POST', headers: { cookie: admin.cookie } })).status).toBeGreaterThanOrEqual(400); // thieu CSRF
    const ok = await init(admin, '/admin/v1', id);
    const p1 = slice(b, 1);
    expect((await putPart(content, '/admin/v1', id, 1, p1, len(p1))).status).toBe(403);
    expect((await content.json('POST', `/admin/v1/media/${id}/multipart/abort`, {})).status).toBe(403);
    expect((await content.json('POST', `/admin/v1/media/${id}/multipart/complete`, { parts: [{ n: 1, etag: 'x' }] })).status).toBe(403);
    expect(ok.status).toBe(201);
    // portal: tep cua khach lan; khach dang (khac khach hang) khong thay -> 404 nhu id khong ton tai
    const mine = await create(lan, '/portal/v1', b);
    expect((await init(dang, '/portal/v1', mine.body.id)).status).toBe(404);
    expect((await putPart(dang, '/portal/v1', mine.body.id, 1, p1, len(p1))).status).toBe(404);
    expect((await dang.json('POST', `/portal/v1/media/${mine.body.id}/multipart/abort`, {})).status).toBe(404);
    expect((await dang.json('POST', `/portal/v1/media/${mine.body.id}/multipart/complete`, { parts: [{ n: 1, etag: 'x' }] })).status).toBe(404);
    expect((await init(admin, '/admin/v1', mine.body.id)).status).toBe(403); // admin thay tep khach nhung khong phai nguoi tao
    expect((await init(lan, '/portal/v1', mine.body.id)).status).toBe(201);
    expect((await init(lan, '/admin/v1', mine.body.id)).status).toBe(403); // khach khong vao API quan tri
  });

  it('huy: kho huy phien, tep -> invalid, khong tai tiep duoc; huy lai khong loi', async () => {
    const b = bytesOf(200_000);
    const r = await create(admin, '/admin/v1', b);
    const i = await init(admin, '/admin/v1', r.body.id);
    const p1 = slice(b, 1);
    await putPart(admin, '/admin/v1', r.body.id, 1, p1, len(p1));
    const ab = await admin.json('POST', `/admin/v1/media/${r.body.id}/multipart/abort`, {});
    expect(ab.body).toEqual({ ok: true, aborted: true });
    expect(store().aborted).toContain(i.body.upload_id);
    expect(store().openMultipart()).not.toContain(i.body.upload_id);
    const row = (await rows('SELECT state, review_state FROM creatives WHERE id = ?', [r.body.id]))[0];
    expect(row).toMatchObject({ state: 'invalid', review_state: 'rejected' });
    expect((await rows('SELECT status FROM creative_transfers WHERE creative_id = ?', [r.body.id]))[0].status).toBe('aborted');
    expect((await putPart(admin, '/admin/v1', r.body.id, 2, p1, len(p1))).status).toBe(409);
    expect((await rows("SELECT 1 FROM audit_log WHERE object_id = ? AND action = 'media.multipart_aborted'", [r.body.id])).length).toBe(1);
    expect((await admin.json('POST', `/admin/v1/media/${r.body.id}/multipart/abort`, {})).status).toBe(409); // tep da invalid: khong con o trang thai cho tai
  });

  it('het han 3 gio: PUT phan -> 409 upload_expired; cron sweepMultipart huy phien tren kho, tep -> invalid, co audit', async () => {
    const b = bytesOf(200_000);
    const r = await create(admin, '/admin/v1', b);
    const i = await init(admin, '/admin/v1', r.body.id);
    const old = new Date(env.rt.clock.now().getTime() - 3.5 * 3600_000).toISOString();
    await env.rt.db.run('UPDATE creatives SET created_at = ? WHERE id = ?', [old, r.body.id]);
    const p1 = slice(b, 1);
    const x = await putPart(admin, '/admin/v1', r.body.id, 1, p1, len(p1));
    expect(x.status).toBe(409);
    expect(((await x.json()) as any).error.code).toBe('upload_expired');
    expect(await sweepMultipart(env.rt)).toBeGreaterThanOrEqual(1);
    expect(store().aborted).toContain(i.body.upload_id);
    expect((await rows('SELECT state FROM creatives WHERE id = ?', [r.body.id]))[0].state).toBe('invalid');
    expect((await rows('SELECT status FROM creative_transfers WHERE creative_id = ?', [r.body.id]))[0].status).toBe('expired');
    expect((await rows("SELECT 1 FROM audit_log WHERE object_id = ? AND action = 'media.multipart_expired'", [r.body.id])).length).toBe(1);
    expect(await sweepMultipart(env.rt)).toBe(0); // idempotent
    // trong 3 gio (2 gio): khong bi don
    const r2 = await create(admin, '/admin/v1', b);
    await init(admin, '/admin/v1', r2.body.id);
    await env.rt.db.run('UPDATE creatives SET created_at = ? WHERE id = ?', [new Date(env.rt.clock.now().getTime() - 2 * 3600_000).toISOString(), r2.body.id]);
    await sweepMultipart(env.rt);
    expect((await rows('SELECT status FROM creative_transfers WHERE creative_id = ?', [r2.body.id]))[0].status).toBe('open');
  });

  it('xoa tep dang tai (DELETE / bulk-delete) huy phien multipart tren kho, khong de phan mo coi', async () => {
    const b = bytesOf(200_000);
    const a = await create(admin, '/admin/v1', b);
    const ia = await init(admin, '/admin/v1', a.body.id);
    expect((await admin.json('DELETE', `/admin/v1/media/${a.body.id}`)).status).toBe(200);
    expect(store().aborted).toContain(ia.body.upload_id);
    const c = await create(admin, '/admin/v1', b);
    const ic = await init(admin, '/admin/v1', c.body.id);
    const bulk = await admin.json('POST', '/admin/v1/media/bulk-delete', { ids: [c.body.id] });
    expect(bulk.body.deleted_count).toBe(1);
    expect(store().aborted).toContain(ic.body.upload_id);
    expect(store().openMultipart()).not.toContain(ic.body.upload_id);
    expect((await rows('SELECT 1 FROM creative_transfers WHERE creative_id = ?', [c.body.id])).length).toBe(0);
  });

  it('han muc: qua 150 phan/gio/nguoi -> 429; qua 30 khoi tao/gio -> 429', async () => {
    const b = bytesOf(200_000);
    const r = await create(content, '/admin/v1', b); // nguoi dung rieng: bo dem gio cua admin da dung o cac test tren
    await init(content, '/admin/v1', r.body.id);
    const uid = (await rows("SELECT id FROM admins WHERE email = ?", [env.byRole('content_manager')]))[0].id;
    await env.rt.kv.incrBy!(`rl:media-part:${uid}`, 149, 3600);
    const p1 = slice(b, 1);
    expect((await putPart(content, '/admin/v1', r.body.id, 1, p1, len(p1))).status).toBe(200); // thu 150
    const x = await putPart(content, '/admin/v1', r.body.id, 1, p1, len(p1));
    expect(x.status).toBe(429);
    expect(x.headers.get('retry-after')).toBeTruthy();
    const r2 = await create(content, '/admin/v1', b);
    await env.rt.kv.incrBy!(`rl:media-mpinit:${uid}`, 40, 3600);
    expect((await init(content, '/admin/v1', r2.body.id)).status).toBe(429);
  });

  it('kho khong ho tro multipart -> 409 multipart_unsupported', async () => {
    const b = bytesOf(200_000);
    const r = await create(admin, '/admin/v1', b);
    const s = store();
    const saved = s.multipartCreate;
    s.multipartCreate = undefined;
    const x = await init(admin, '/admin/v1', r.body.id);
    s.multipartCreate = saved;
    expect(x.status).toBe(409);
    expect(x.body.error.code).toBe('multipart_unsupported');
  });
});

describe('tep lon that voi phan 32 MiB mac dinh (khong ghi de)', () => {
  let env2: Env;
  let adm: Session;
  beforeAll(async () => {
    env2 = await setup({});
    adm = await login(env2, env2.byRole('super_admin'));
    (env2.rt.objects as any).signedPut = false;
  }, 120_000);

  it('video 4K thang may ~ 40 MB: 2 phan (32 MiB + phan du), confirm doc header bang range read, KHONG bam sha256 (> 32 MB) va giu khoa tai len', async () => {
    const b = bigMp4(2160, 3840, 20, 40 * 1048576);
    const K = env2.seed.customers['K001']!;
    const r = await adm.json('POST', '/admin/v1/media/upload-url', { customer_id: K, name: 'big4k.mp4', content_type: 'video/mp4', size_bytes: b.length, width: 2160, height: 3840, duration_sec: 20, target_type: 'elevator' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const i = await adm.json('POST', `/admin/v1/media/${r.body.id}/multipart`, {});
    expect(i.body).toMatchObject({ part_size: 32 * 1048576, total_parts: 2 });
    const send = async (n: number) => {
      const p = b.slice((n - 1) * 32 * 1048576, Math.min(b.length, n * 32 * 1048576));
      const x = await env2.app.request(`/admin/v1/media/${r.body.id}/parts/${n}`, { method: 'PUT', headers: { cookie: adm.cookie, 'x-csrf-token': adm.csrf, 'content-length': String(p.length) }, body: p as any } as any);
      expect(x.status, await x.clone().text()).toBe(200);
      return { n, etag: ((await x.json()) as any).etag as string };
    };
    const parts = [await send(1), await send(2)];
    expect((await adm.json('POST', `/admin/v1/media/${r.body.id}/multipart/complete`, { parts })).status).toBe(200);
    const cf = await adm.json('POST', `/admin/v1/media/${r.body.id}/confirm`, {});
    expect(cf.status, JSON.stringify(cf.body)).toBe(200);
    expect(cf.body).toMatchObject({ width: 2160, height: 3840, duration_sec: 20, sha256: null, size_bytes: b.length });
    const row = (await env2.rt.db.query<any>('SELECT storage_key FROM creatives WHERE id = ?', [r.body.id]))[0];
    expect(row.storage_key).toBe(r.body.key); // tep > 32 MB giu khoa tai len (khong chep sang khoa dong bang)
  }, 120_000);
});
