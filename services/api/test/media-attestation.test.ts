// Cam ket phap ly noi dung (0029): ky khi duyet / tai len / bo sung / hang loat; khong tu ky; doi noi dung va thu hoi vo hieu hoa.
import { beforeAll, describe, expect, it } from 'vitest';
import { LEGAL_ATTESTATION_VERSION } from '@ams/shared';
import { createCfCreativeValidator } from '../src/lib/cf-creative-validate.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const cat = (...p: (number[] | Uint8Array)[]) => Uint8Array.from(p.flatMap((x) => [...x]));
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
const chunk = (type: string, body: number[] = []) => [...be32(body.length), ...tag(type), ...body, 0, 0, 0, 0];
const png = (w: number, h: number) => cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', [...be32(w), ...be32(h), 8, 2, 0, 0, 0]), chunk('IDAT', [1, 2, 3]), chunk('IEND'));
const OK = { accepted: true, version: LEGAL_ATTESTATION_VERSION };

let env: Env;
let admin: Session;
let lan: Session;
let finance: Session;
let K001: string;

beforeAll(async () => {
  env = await setup({});
  await env.rt.db.run("DELETE FROM settings WHERE key = 'allow_unscanned_creatives'");
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
  finance = await login(env, env.byRole('finance'));
  createCfCreativeValidator(env.rt).subscribe();
}, 120_000);

let seq = 0;
async function upload(s: Session, prefix: '/admin/v1' | '/portal/v1', extra: Record<string, unknown> = {}) {
  const bytes = png(1920, 1080);
  const r = await s.json('POST', `${prefix}/media/upload-url`, { name: `att${++seq}.png`, content_type: 'image/png', size_bytes: bytes.length, ...(prefix === '/admin/v1' ? { customer_id: K001 } : {}), ...extra });
  if (r.status !== 201) return r;
  await env.rt.objects.put(r.body.key, bytes, 'image/png');
  expect((await s.json('POST', `${prefix}/media/${r.body.id}/confirm`, {})).status).toBe(200);
  await env.rt.queue.drain();
  return r;
}
const rows = async (id: string) => env.rt.db.query<any>('SELECT * FROM creative_attestations WHERE creative_id = ? ORDER BY signed_at, id', [id]);
const info = async (id: string) => (await admin.json('GET', `/admin/v1/media/${id}`)).body;
const manifestIds = async () => {
  // gateway dung chung CSDL: kiem tra dieu kien phat bang SQL tuong duong (xem edge-gateway/test/attestation.test.ts cho manifest that)
  return (await env.rt.db.query<any>("SELECT m.id FROM creatives m JOIN creative_attestations a ON a.creative_id = m.id AND a.revoked_at IS NULL LEFT JOIN creative_security s ON s.creative_id = m.id WHERE m.review_state = 'approved' AND a.content_version = COALESCE(s.content_version, 1)")).map((r: any) => r.id);
};

describe('cam ket phap ly: tai len', () => {
  it('noi bo tai len KHONG tick: van tu duyet nhung KHONG co cam ket (he thong khong tu ky), nhan "missing"', async () => {
    const r = await upload(admin, '/admin/v1');
    const id = r.body.id as string;
    expect((await info(id)).status).toBe('approved');
    expect(await rows(id)).toEqual([]);
    expect((await info(id)).attestation).toMatchObject({ status: 'missing', kid_safe: false });
    expect(await manifestIds()).not.toContain(id);
  });

  it('noi bo tick luc tai len: ghi nguoi ky that + phien ban + bam IP/UA + audit; kid_safe mac dinh false; duyet tu dong, co cam ket hieu luc', async () => {
    const r = await upload(admin, '/admin/v1', { attest: OK });
    const id = r.body.id as string;
    const [a] = await rows(id);
    expect(a).toMatchObject({ version: 'legal-v1', kid_safe: 0, source: 'upload', content_version: 1, revoked_at: null });
    expect(a.signed_by).toBe((await env.rt.db.query<any>('SELECT id FROM admins WHERE email = ?', [env.byRole('super_admin')]))[0].id);
    expect(a.signed_by_name.length).toBeGreaterThan(0);
    expect(await env.rt.db.query<any>("SELECT 1 FROM audit_log WHERE object_id = ? AND action = 'media.attest'", [id])).toHaveLength(1);
    expect((await info(id)).attestation).toMatchObject({ status: 'valid', version: 'legal-v1', kid_safe: false });
    expect(await manifestIds()).toContain(id);
  });

  it('kid_safe do nguoi ky chon', async () => {
    const r = await upload(admin, '/admin/v1', { attest: { ...OK, kid_safe: true } });
    expect((await rows(r.body.id))[0].kid_safe).toBe(1);
  });

  it('accepted=false / thieu / sai phien ban => khong ghi; khach (portal) gui attest => 403', async () => {
    expect((await upload(admin, '/admin/v1', { attest: { accepted: false, version: 'legal-v1' } })).status).toBe(422);
    expect((await upload(admin, '/admin/v1', { attest: { version: 'legal-v1' } })).status).toBe(422);
    const bytes = png(1920, 1080);
    const c = await lan.json('POST', '/portal/v1/media/upload-url', { name: 'k.png', content_type: 'image/png', size_bytes: bytes.length, attest: OK });
    expect(c.status).toBe(403);
    expect(c.body.error.code).toBe('attest_forbidden');
  });
});

describe('cam ket phap ly: duyet / ky bo sung / vo hieu', () => {
  it('khach tai len -> nguoi duyet duyet KEM attest: ghi cam ket (source approve); sai phien ban 409; accepted=false 422; khong attest => khong ky', async () => {
    const r = await upload(lan, '/portal/v1');
    const id = r.body.id as string;
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`, { attest: { accepted: false, version: 'legal-v1' } })).status).toBe(422);
    const bad = await admin.json('POST', `/admin/v1/media/${id}/approve`, { attest: { accepted: true, version: 'legal-v0' } });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('legal_version_mismatch');
    expect((await info(id)).status).toBe('pending');
    const ok = await admin.json('POST', `/admin/v1/media/${id}/approve`, { attest: { ...OK, kid_safe: true } });
    expect(ok.status).toBe(200);
    expect(ok.body.attestation).toMatchObject({ status: 'valid', kid_safe: true });
    expect((await rows(id))).toHaveLength(1);
    expect((await rows(id))[0].source).toBe('approve');
  });

  it('duyet KHONG kem attest: duoc duyet nhung khong co cam ket; ky bo sung sau (idempotent), lich su xem duoc', async () => {
    const r = await upload(lan, '/portal/v1');
    const id = r.body.id as string;
    const nope = await admin.json('POST', `/admin/v1/media/${id}/attest`, { attest: OK });
    expect(nope.status).toBe(409); // chua duyet
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`)).status).toBe(200);
    expect(await rows(id)).toEqual([]);
    const s1 = await admin.json('POST', `/admin/v1/media/${id}/attest`, { attest: OK });
    expect(s1.status).toBe(200);
    expect(s1.body.result).toBe('signed');
    expect((await admin.json('POST', `/admin/v1/media/${id}/attest`, { attest: OK })).body.result).toBe('already_valid');
    expect(await rows(id)).toHaveLength(1);
    const h = await admin.json('GET', `/admin/v1/media/${id}/attestations`);
    expect(h.body.current.status).toBe('valid');
    expect(h.body.items[0]).toMatchObject({ version: 'legal-v1', effective: true });
  });

  it('phan quyen + IDOR: tai chinh (khong co media:approve) 403; khach khong goi duoc route admin va portal khong co route ky', async () => {
    const r = await upload(lan, '/portal/v1');
    const id = r.body.id as string;
    await admin.json('POST', `/admin/v1/media/${id}/approve`);
    expect((await finance.json('POST', `/admin/v1/media/${id}/attest`, { attest: OK })).status).toBe(403);
    expect((await finance.json('POST', '/admin/v1/media/attest-bulk', { ids: [id], attest: OK, confirm: true })).status).toBe(403);
    expect((await lan.json('POST', `/admin/v1/media/${id}/attest`, { attest: OK })).status).toBeGreaterThanOrEqual(401);
    expect([404, 405]).toContain((await lan.json('POST', `/portal/v1/media/${id}/attest`, { attest: OK })).status);
    expect((await lan.json('GET', `/portal/v1/media/${id}`)).body.attestation).toBeNull(); // khach khong thay
    expect(await rows(id)).toEqual([]);
  });

  it('doi noi dung (content_version tang) vo hieu cam ket cu; ky lai moi co hieu luc', async () => {
    const r = await upload(admin, '/admin/v1', { attest: OK });
    const id = r.body.id as string;
    expect(await manifestIds()).toContain(id);
    const o = await admin.json('PUT', `/admin/v1/media/${id}/overlay`, { format: 'fullscreen', overlay: { title: 'Doi noi dung' } });
    expect(o.status).toBe(200);
    expect((await info(id)).attestation.status).toBe('stale');
    expect(await manifestIds()).not.toContain(id);
    expect((await admin.json('POST', `/admin/v1/media/${id}/attest`, { attest: OK })).body.result).toBe('signed');
    expect(await manifestIds()).toContain(id);
    expect((await rows(id)).length).toBe(2); // lich su giu ca ban cu
  });

  it('tra lai (reject) thu hoi cam ket (khong xoa dong); duyet lai khong tu khoi phuc', async () => {
    const r = await upload(admin, '/admin/v1', { attest: OK });
    const id = r.body.id as string;
    expect((await admin.json('POST', `/admin/v1/media/${id}/reject`, { reason: 'khong phu hop' })).status).toBe(200);
    const [a] = await rows(id);
    expect(a.revoked_at).not.toBeNull();
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`)).status).toBe(200);
    expect((await info(id)).attestation.status).toBe('missing');
    expect(await rows(id)).toHaveLength(1);
  });

  it('ky hang loat: bat buoc confirm; moi creative ghi nguoi ky + audit; bo qua tep chua duyet / da hop le', async () => {
    const a = (await upload(admin, '/admin/v1')).body.id as string; // da duyet, thieu cam ket
    const b = (await upload(admin, '/admin/v1', { attest: OK })).body.id as string; // da hop le
    const c = (await upload(lan, '/portal/v1')).body.id as string; // chua duyet
    expect((await admin.json('POST', '/admin/v1/media/attest-bulk', { ids: [a, b, c], attest: OK })).status).toBe(422);
    expect((await admin.json('POST', '/admin/v1/media/attest-bulk', { ids: [a, b, c], attest: OK, confirm: false })).status).toBe(422);
    const r = await admin.json('POST', '/admin/v1/media/attest-bulk', { ids: [a, b, c, 'khong-ton-tai'], attest: OK, confirm: true });
    expect(r.status).toBe(200);
    expect(r.body.signed).toEqual([a]);
    expect(r.body.skipped).toEqual(expect.arrayContaining([{ id: b, reason: 'already_valid' }, { id: c, reason: 'not_approved' }, { id: 'khong-ton-tai', reason: 'not_found' }]));
    expect((await rows(a))[0]).toMatchObject({ source: 'bulk', kid_safe: 0 });
    expect(await env.rt.db.query<any>("SELECT 1 FROM audit_log WHERE object_id = ? AND action = 'media.attest'", [a])).toHaveLength(1);
    expect(await rows(c)).toEqual([]);
  });

  it('loc danh sach theo trang thai cam ket', async () => {
    const miss = await admin.json('GET', '/admin/v1/media?attestation=missing&page_size=100');
    expect(miss.status).toBe(200);
    expect(miss.body.items.every((m: any) => m.attestation.status === 'missing')).toBe(true);
    const val = await admin.json('GET', '/admin/v1/media?attestation=valid&page_size=100');
    expect(val.body.items.every((m: any) => m.attestation.status === 'valid')).toBe(true);
  });
});
