import { beforeAll, describe, expect, it } from 'vitest';
import { createFinancePort } from '../src/finance/index.js';
import { runOutbox, sweepOutbox, TOPIC_CAMPAIGN_RELEASE, TOPIC_MEDIA_UPLOADED } from '../src/outbox.js';
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
const STRONG = 'Mat-Khau-Moi-2026x';

describe('w1: buoc doi mat khau bat buoc (force_password_change)', () => {
  let env: Env;
  let email: string;
  let id: string;
  beforeAll(async () => {
    env = await setup();
    email = env.byRole('content_manager');
    id = (await env.rt.db.query<{ id: string }>('SELECT id FROM admins WHERE email = ?', [email]))[0]!.id;
  }, 120_000);

  it('dang nhap thanh cong nhung moi route khac 403 password_change_required; /auth/me va logout van dung duoc', async () => {
    await env.rt.db.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', [`force_password_change:${id}`, '1', null, env.rt.clock.now().toISOString()]);
    const s = await login(env, email);
    const me = await s.json('GET', '/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.must_change_password).toBe(true);
    for (const p of ['/admin/v1/campaigns', '/admin/v1/media', '/admin/v1/dashboard/overview']) {
      const r = await s.json('GET', p);
      expect([r.status, r.body.error.code], p).toEqual([403, 'password_change_required']);
    }
    expect((await s.json('POST', '/admin/v1/media/upload-url', { name: 'a.png', content_type: 'image/png', size_bytes: 33 })).body.error.code).toBe('password_change_required');
  });

  it('doi mat khau: sai mat khau cu 422, mat khau yeu 422, thieu CSRF 403; khong xoa co khi that bai', async () => {
    const s = await login(env, email);
    const { password } = env.cred(email);
    expect((await s.json('POST', '/auth/change-password', { current_password: 'sai-hoan-toan-1A', new_password: STRONG })).body.error.code).toBe('invalid_current_password');
    for (const weak of ['Ngan1a', 'khongcohoa123456', 'KHONGCOTHUONG1234', 'KhongCoChuSoNao', password]) {
      const r = await s.json('POST', '/auth/change-password', { current_password: password, new_password: weak });
      expect([r.status, r.body.error.code], weak).toEqual([422, 'weak_password']);
    }
    expect((await s.req('POST', '/auth/change-password', { current_password: password, new_password: STRONG }, { csrf: null })).status).toBe(403);
    expect((await s.json('GET', '/admin/v1/campaigns')).status).toBe(403); // van bi khoa
  });

  it('doi mat khau thanh cong: xoa co, huy phien khac, audit, mat khau cu het hieu luc, route mo lai', async () => {
    const other = await login(env, email); // phien khac se bi huy
    const s = await login(env, email);
    const { password } = env.cred(email);
    const r = await s.json('POST', '/auth/change-password', { current_password: password, new_password: STRONG });
    expect(r.status).toBe(200);
    expect(r.body.other_sessions_revoked).toBeGreaterThanOrEqual(1);
    expect(await env.rt.db.query('SELECT 1 FROM settings WHERE key = ?', [`force_password_change:${id}`])).toHaveLength(0);
    expect((await s.json('GET', '/admin/v1/campaigns')).status).toBe(200); // phien hien tai song, het bi chan
    expect((await other.json('GET', '/auth/me')).status).toBe(401); // phien khac bi huy
    const acts = (await env.rt.db.query<{ action: string }>('SELECT action FROM audit_log WHERE object_id = ?', [id])).map((x) => x.action);
    expect(acts).toEqual(expect.arrayContaining(['auth.password_change_failed', 'auth.password_changed']));
    const bad = await env.app.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    expect(bad.status).toBe(401);
    const good = await env.app.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: STRONG }) });
    expect(good.status).toBe(200);
  });

  it('chua dang nhap -> 401; khach (portal) cung bi chan khi co co; ten thay the /auth/password/change {current,new}', async () => {
    expect((await env.app.request('/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    const cust = 'lan@vinamilk.example';
    const cid = (await env.rt.db.query<{ id: string }>('SELECT id FROM admins WHERE email = ?', [cust]))[0]!.id;
    await env.rt.db.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', [`force_password_change:${cid}`, '1', null, env.rt.clock.now().toISOString()]);
    const s = await login(env, cust);
    expect((await s.json('GET', '/portal/v1/campaigns')).body.error.code).toBe('password_change_required');
    const { password } = env.cred(cust);
    expect((await s.json('POST', '/auth/password/change', { current: password, new: STRONG })).status).toBe(200);
    expect((await s.json('GET', '/portal/v1/campaigns')).status).toBe(200);
  });

  it('dang nhap tra must_change_password trong phan hoi (khong MFA)', async () => {
    await env.rt.db.run("UPDATE admins SET mfa_required = 0, totp_secret_enc = NULL WHERE id = ?", [id]);
    await env.rt.db.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', [`force_password_change:${id}`, '1', null, env.rt.clock.now().toISOString()]);
    const r = await env.app.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: STRONG }) });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).must_change_password).toBe(true);
  });
});

describe('w1: media.uploaded + cua quet ma doc', () => {
  let env: Env;
  let admin: Session;
  let lan: Session;
  const received: any[] = [];
  beforeAll(async () => {
    env = await setup();
    await env.rt.db.run("DELETE FROM settings WHERE key = 'allow_unscanned_creatives'"); // mac dinh san xuat: tat
    env.rt.queue.subscribe(TOPIC_MEDIA_UPLOADED, async (m) => {
      received.push(m);
    });
    admin = await login(env, env.byRole('super_admin'));
    lan = await login(env, 'lan@vinamilk.example');
  }, 120_000);

  const upload = async (name = 'tv.png') => {
    const m = await lan.json('POST', '/portal/v1/media/upload-url', { name, content_type: 'image/png', size_bytes: 33, width: 1920, height: 1080 });
    expect(m.status).toBe(201);
    await env.rt.objects.put(m.body.key, png(1920, 1080), 'image/png');
    return m.body.id as string;
  };
  const setScan = (id: string, s: string) => env.rt.db.run('UPDATE creatives SET scan_state = ? WHERE id = ?', [s, id]);
  const setPolicy = (v: string | null) =>
    v === null
      ? env.rt.db.run("DELETE FROM settings WHERE key = 'allow_unscanned_creatives'")
      : env.rt.db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('allow_unscanned_creatives', ?, NULL, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [v, env.rt.clock.now().toISOString()]);

  it('confirm ghi outbox media.uploaded {creative_id} (khoa khu trung) va chuyen sang queue cho media-worker', async () => {
    const id = await upload();
    expect((await lan.json('POST', `/portal/v1/media/${id}/confirm`, {})).status).toBe(200);
    const row = (await env.rt.db.query<{ payload: string; status: string }>('SELECT payload, status FROM outbox WHERE topic = ? AND dedupe_key = ?', [TOPIC_MEDIA_UPLOADED, `${TOPIC_MEDIA_UPLOADED}:${id}`]))[0];
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.payload)).toEqual({ creative_id: id });
    expect(row!.status).toBe('done'); // da day ngay sau commit
    expect(received).toContainEqual({ creative_id: id });
    // confirm lai (idempotent) khong sinh them viec
    await lan.json('POST', `/portal/v1/media/${id}/confirm`, {});
    expect(await env.rt.db.query('SELECT 1 FROM outbox WHERE dedupe_key = ?', [`${TOPIC_MEDIA_UPLOADED}:${id}`])).toHaveLength(1);
  });

  it('confirm that bai (tep sai) khong ghi outbox', async () => {
    const m = await lan.json('POST', '/portal/v1/media/upload-url', { name: 'bad.png', content_type: 'image/png', size_bytes: 33, width: 1080, height: 1920 });
    await env.rt.objects.put(m.body.key, png(100, 100), 'image/png');
    expect((await lan.json('POST', `/portal/v1/media/${m.body.id}/confirm`, { width: 1080, height: 1920 })).status).toBe(422);
    expect(await env.rt.db.query('SELECT 1 FROM outbox WHERE dedupe_key = ?', [`${TOPIC_MEDIA_UPLOADED}:${m.body.id}`])).toHaveLength(0);
  });

  it('duyet media: pending -> 409 creative_scan_pending; infected -> 422; clean -> 200', async () => {
    const id = await upload('a.png');
    await lan.json('POST', `/portal/v1/media/${id}/confirm`, {});
    let r = await admin.json('POST', `/admin/v1/media/${id}/approve`);
    expect([r.status, r.body.error.code]).toEqual([409, 'creative_scan_pending']);
    await setScan(id, 'infected');
    r = await admin.json('POST', `/admin/v1/media/${id}/approve`);
    expect([r.status, r.body.error.code]).toEqual([422, 'creative_infected']);
    await setScan(id, 'clean');
    r = await admin.json('POST', `/admin/v1/media/${id}/approve`);
    expect([r.status, r.body.status]).toEqual([200, 'approved']);
  });

  it("'unscanned': chan mac dinh (creative_not_scanned); cho qua khi bat allow_unscanned_creatives; hien canh bao", async () => {
    const id = await upload('b.png');
    await lan.json('POST', `/portal/v1/media/${id}/confirm`, {});
    await setScan(id, 'unscanned');
    const view = await admin.json('GET', `/admin/v1/media/${id}`);
    expect(view.body.scan_warning).toMatch(/Chưa quét/);
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`)).body.error.code).toBe('creative_not_scanned');
    await setPolicy('0');
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`)).status).toBe(422);
    await setPolicy('1');
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`)).status).toBe(200);
    await setPolicy(null);
    // infected khong bao gio qua du bat setting
    const id2 = await upload('c.png');
    await lan.json('POST', `/portal/v1/media/${id2}/confirm`, {});
    await setScan(id2, 'infected');
    await setPolicy('1');
    expect((await admin.json('POST', `/admin/v1/media/${id2}/approve`)).status).toBe(422);
    await setPolicy(null);
  });

  it('tep lien ket (import) chua tai ve: khong duyet duoc, ma loi rieng', async () => {
    const r = await lan.json('POST', '/portal/v1/media/import', { source: 'youtube', url: 'https://www.youtube.com/watch?v=abc123' });
    const a = await admin.json('POST', `/admin/v1/media/${r.body.id}/approve`);
    expect([a.status, a.body.error.code]).toEqual([422, 'creative_link_not_ingested']);
  });

  it('duyet chien dich: creative chua quet bi chan, quet sach thi duyet duoc', async () => {
    const id = await upload('d.png');
    await lan.json('POST', `/portal/v1/media/${id}/confirm`, {});
    const c = await lan.json('POST', '/portal/v1/campaigns', { name: 'Quet', budget_vnd: 1_000_000, screen_type: 'tv', media_id: id, start_date: '2026-11-01', end_date: '2026-12-31' });
    expect(c.status).toBe(201);
    await lan.json('POST', `/portal/v1/campaigns/${c.body.id}/submit`);
    const cid = (await env.rt.db.query<{ campaign_id: string }>('SELECT campaign_id FROM creatives WHERE customer_id = (SELECT customer_id FROM creatives WHERE id = ?) AND campaign_id IS NOT NULL AND name = ? ORDER BY created_at DESC', [id, 'd.png']))[0]!.campaign_id;
    let r = await admin.json('POST', `/admin/v1/campaigns/${c.body.id}/approve`);
    expect([r.status, r.body.error.code]).toEqual([409, 'creative_scan_pending']);
    await env.rt.db.run('UPDATE creatives SET scan_state = ? WHERE campaign_id = ?', ['clean', cid]);
    r = await admin.json('POST', `/admin/v1/campaigns/${c.body.id}/approve`);
    expect(r.status).toBe(200);
  });
});

describe('w1: hoan tien (reject/end/delete) qua outbox', () => {
  async function funded(env: Env, admin: Session, lan: Session, name: string) {
    const m = await lan.json('POST', '/portal/v1/media/upload-url', { name: `${name}.png`, content_type: 'image/png', size_bytes: 33, width: 1920, height: 1080 });
    await env.rt.objects.put(m.body.key, png(1920, 1080), 'image/png');
    await lan.json('POST', `/portal/v1/media/${m.body.id}/confirm`, {});
    await env.rt.db.run("UPDATE creatives SET scan_state = 'clean' WHERE id = ?", [m.body.id]);
    const cu = (await env.rt.db.query<{ customer_id: string }>('SELECT customer_id FROM creatives WHERE id = ?', [m.body.id]))[0]!.customer_id;
    await env.rt.db.run('UPDATE ad_wallets SET balance_vnd = balance_vnd + 100000000 WHERE customer_id = ?', [cu]);
    const c = await lan.json('POST', '/portal/v1/campaigns', { name, budget_vnd: 3_000_000, screen_type: 'tv', media_id: m.body.id, start_date: '2026-11-01', end_date: '2026-12-31' });
    await lan.json('POST', `/portal/v1/campaigns/${c.body.id}/submit`);
    const ap = await admin.json('POST', `/admin/v1/campaigns/${c.body.id}/approve`);
    expect(ap.body.status).toBe('active');
    return { id: c.body.id as string, cu };
  }
  const state = async (env: Env, id: string) => (await env.rt.db.query<any>('SELECT state, funding_state, reserved_vnd FROM campaigns WHERE id = ?', [id]))[0];
  const wallet = async (env: Env, cu: string) => (await env.rt.db.query<any>('SELECT reserved_vnd FROM ad_wallets WHERE customer_id = ?', [cu]))[0];

  it('end: trang thai + viec hoan tien cung giao dich; chay inline hoan du; ket thuc khong mat tien', async () => {
    const env = await setup({ finance: createFinancePort() });
    const admin = await login(env, env.byRole('super_admin'));
    const lan = await login(env, 'lan@vinamilk.example');
    const { id, cu } = await funded(env, admin, lan, 'end1');
    const before = Number((await wallet(env, cu)).reserved_vnd);
    const r = await admin.json('POST', `/admin/v1/campaigns/${id}/end`);
    expect(r.status).toBe(200);
    expect(r.body.released_vnd).toBe(3_000_000);
    expect(r.body.release_pending).toBeUndefined();
    expect((await state(env, id)).funding_state).toBe('released');
    expect(Number((await wallet(env, cu)).reserved_vnd)).toBe(before - 3_000_000);
    expect(await env.rt.db.query('SELECT 1 FROM outbox WHERE topic = ? AND status = ?', [TOPIC_CAMPAIGN_RELEASE, 'done'])).toHaveLength(1);
    // chay lai viec: khong hoan lan hai
    await runOutbox(env.rt, () => Promise.resolve(createFinancePort()));
    expect(Number((await wallet(env, cu)).reserved_vnd)).toBe(before - 3_000_000);
  }, 120_000);

  it('end khi finance loi giua chung: trang thai da doi, tien con giu, viec con trong outbox; sweep sau do hoi tu', async () => {
    const real = createFinancePort();
    let failing = true;
    const flaky = { ...real, releaseForCampaign: (rt: any, a: any) => (failing ? Promise.reject(new Error('tai chinh sap')) : real.releaseForCampaign(rt, a)) };
    const env = await setup({ finance: flaky as any });
    const admin = await login(env, env.byRole('super_admin'));
    const lan = await login(env, 'lan@vinamilk.example');
    const { id, cu } = await funded(env, admin, lan, 'end2');
    const before = Number((await wallet(env, cu)).reserved_vnd);
    const r = await admin.json('POST', `/admin/v1/campaigns/${id}/end`);
    expect(r.status).toBe(200);
    expect(r.body.release_pending).toBe(true);
    expect(r.body.released_vnd).toBe(0);
    expect(await state(env, id)).toMatchObject({ state: 'ended', funding_state: 'reserved' }); // chua mat dau vet tien
    expect(Number((await wallet(env, cu)).reserved_vnd)).toBe(before);
    failing = false;
    env.rt.clock.advance(10 * 60_000); // qua thoi gian backoff
    const sw = await sweepOutbox(env.rt, () => Promise.resolve(real));
    expect(sw.failed).toBe(0);
    expect(await state(env, id)).toMatchObject({ state: 'ended', funding_state: 'released' });
    expect(Number((await wallet(env, cu)).reserved_vnd)).toBe(before - 3_000_000);
  }, 120_000);

  it('mat dien giua doi trang thai va ghi outbox (D1): reconcileReleases ghi bu', async () => {
    const env = await setup({ finance: createFinancePort() });
    const admin = await login(env, env.byRole('super_admin'));
    const lan = await login(env, 'lan@vinamilk.example');
    const { id, cu } = await funded(env, admin, lan, 'end3');
    const before = Number((await wallet(env, cu)).reserved_vnd);
    // gia lap: da ended nhung khong co viec hoan tien
    await env.rt.db.run("UPDATE campaigns SET state = 'ended', updated_at = ? WHERE id = ?", [env.rt.clock.now().toISOString(), id]);
    const sw = await sweepOutbox(env.rt, () => Promise.resolve(createFinancePort()));
    expect(sw.requeued).toBeGreaterThanOrEqual(1);
    expect(Number((await wallet(env, cu)).reserved_vnd)).toBe(before - 3_000_000);
    expect((await sweepOutbox(env.rt, () => Promise.resolve(createFinancePort()))).requeued).toBe(0);
  }, 120_000);

  it('reject (thu hoi duyet): hoan tien qua outbox; duyet lai truoc khi viec chay thi viec bi bo qua (khong giai phong tien lan moi)', async () => {
    const env = await setup({ finance: createFinancePort() });
    const admin = await login(env, env.byRole('super_admin'));
    const lan = await login(env, 'lan@vinamilk.example');
    const { id, cu } = await funded(env, admin, lan, 'rej1');
    const before = Number((await wallet(env, cu)).reserved_vnd);
    expect((await admin.json('POST', `/admin/v1/campaigns/${id}/reject`, { reason: 'Vi pham chinh sach' })).status).toBe(200);
    expect(await state(env, id)).toMatchObject({ state: 'rejected', funding_state: 'released' });
    expect(Number((await wallet(env, cu)).reserved_vnd)).toBe(before - 3_000_000);
    // viec huy cua mot campaign da duoc duyet lai: handler bo qua
    const handlers = (await import('../src/outbox.js')).createOutboxHandlers(() => Promise.resolve(createFinancePort()));
    await lan.json('POST', `/portal/v1/campaigns/${id}/submit`);
    await admin.json('POST', `/admin/v1/campaigns/${id}/approve`);
    const reserved = Number((await state(env, id)).reserved_vnd);
    await handlers[TOPIC_CAMPAIGN_RELEASE]!({ id: 'x', topic: TOPIC_CAMPAIGN_RELEASE, payload: { campaignId: id, actorId: null, reason: 'cu' }, attempts: 1 } as any, env.rt);
    expect(Number((await state(env, id)).reserved_vnd)).toBe(reserved);
  }, 120_000);

  it('delete chien dich dang con tien giu: hoan roi moi xoa (outbox); loi giua chung thi chien dich con va tra 202', async () => {
    const real = createFinancePort();
    let failing = true;
    const flaky = { ...real, releaseForCampaign: (rt: any, a: any) => (failing ? Promise.reject(new Error('tai chinh sap')) : real.releaseForCampaign(rt, a)) };
    const env = await setup({ finance: flaky as any });
    const admin = await login(env, env.byRole('super_admin'));
    const lan = await login(env, 'lan@vinamilk.example');
    const { id, cu } = await funded(env, admin, lan, 'del1');
    const before = Number((await wallet(env, cu)).reserved_vnd);
    // dua ve trang thai xoa duoc nhung con tien giu (awaiting_funds + reserved)
    await env.rt.db.run("UPDATE campaigns SET state = 'awaiting_funds' WHERE id = ?", [id]);
    const r = await admin.json('DELETE', `/admin/v1/campaigns/${id}`);
    expect(r.status).toBe(202);
    expect(r.body.pending).toBe(true);
    expect(await state(env, id)).toBeTruthy();
    failing = false;
    env.rt.clock.advance(10 * 60_000);
    await sweepOutbox(env.rt, () => Promise.resolve(real));
    expect(await state(env, id)).toBeUndefined();
    expect(Number((await wallet(env, cu)).reserved_vnd)).toBe(before - 3_000_000);
    const acts = (await env.rt.db.query<{ action: string }>('SELECT action FROM audit_log WHERE object_id = ?', [id])).map((x) => x.action);
    expect(acts).toEqual(expect.arrayContaining(['campaign.delete_requested', 'campaign.delete']));
  }, 120_000);

  it('delete chien dich khong co tien giu: xoa ngay nhu cu (200)', async () => {
    const env = await setup({ finance: createFinancePort() });
    const admin = await login(env, env.byRole('super_admin'));
    const lan = await login(env, 'lan@vinamilk.example');
    const c = await lan.json('POST', '/portal/v1/campaigns', { name: 'nhap', budget_vnd: 1_000_000, screen_type: 'tv', start_date: '2026-11-01', end_date: '2026-12-31' });
    expect(c.status).toBe(201);
    expect((await admin.json('DELETE', `/admin/v1/campaigns/${c.body.id}`)).status).toBe(200);
  }, 120_000);
});
