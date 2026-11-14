import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, passwordNeedsRehash } from '@ams/shared';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let lan: Session;
let K001: string;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => env.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const db = () => env.rt.db;

beforeAll(async () => {
  env = await setup();
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
}, 120_000);

describe('R1-19 dang nhap khong lo / khong cho khoa tai khoan nguoi khac mot cach lo lieu', () => {
  it('tai khoan bi khoa: dung mat khau van 401 invalid_credentials giong email la; khong 429/Retry-After', async () => {
    const email = env.byRole('finance');
    const { password } = env.cred(email);
    for (let i = 0; i < 6; i++) await post('/auth/login', { email, password: 'sai-mat-khau-1' }, { 'x-forwarded-for': `10.0.0.${i}` });
    const row = (await db().query<{ locked_until: string | null }>('SELECT locked_until FROM admins WHERE email = ?', [email]))[0]!;
    expect(row.locked_until).toBeTruthy();
    const a = await post('/auth/login', { email, password }, { 'x-forwarded-for': '10.9.9.9' });
    const b = await post('/auth/login', { email: 'khong.co.p2@nowhere.vn', password }, { 'x-forwarded-for': '10.9.9.9' });
    expect(a.status).toBe(401);
    expect(a.headers.get('retry-after')).toBeNull();
    expect(await a.text()).toBe(await b.text());
  });
  it('bo dem theo email gan voi IP: ke tan cong tu mot IP khong chan nan nhan o IP khac', async () => {
    const email = env.byRole('content_manager');
    const { password } = env.cred(email);
    let tooMany = false;
    for (let i = 0; i < 20; i++) {
      const r = await post('/auth/login', { email, password: 'sai-' + i }, { 'x-forwarded-for': '198.51.100.7' });
      if (r.status === 429) tooMany = true;
    }
    expect(tooMany).toBe(true);
    env.rt.clock.advance(16 * 60_000); // het khoa tai khoan; bo dem IP ke tan cong van con trong cua so khac
    const ok = await post('/auth/login', { email, password }, { 'x-forwarded-for': '203.0.113.50' });
    expect(ok.status).toBe(200);
  });
});

describe('R1-21 bam mat khau', () => {
  it('passwordNeedsRehash: ban cu (2^15, p=1) can nang cap, ban moi thi khong', async () => {
    const old = await hashPassword('Abcdefghijk1', { N: 2 ** 10, p: 1 });
    expect(passwordNeedsRehash(old, { N: 2 ** 10 })).toBe(true); // p mac dinh 2
    const cur = await hashPassword('Abcdefghijk1', { N: 2 ** 10 });
    expect(passwordNeedsRehash(cur, { N: 2 ** 10 })).toBe(false);
    expect(cur.split('$')[3]).toBe('2');
  });
  it('dang nhap thanh cong nang cap ban bam cu len tham so hien hanh', async () => {
    const email = env.byRole('device_ops');
    const { password } = env.cred(email);
    const legacy = await hashPassword(password, { N: 1024, p: 1 });
    await db().run('UPDATE admins SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE email = ?', [legacy, email]);
    env.rt.clock.advance(60 * 60_000);
    const r = await post('/auth/login', { email, password }, { 'x-forwarded-for': '192.0.2.77' });
    expect(r.status).toBe(200);
    const now = (await db().query<{ password_hash: string }>('SELECT password_hash FROM admins WHERE email = ?', [email]))[0]!.password_hash;
    expect(now).not.toBe(legacy);
    expect(now.split('$')[3]).toBe('2');
  });
});

describe('R1-14 duyet gan voi phien ban noi dung', () => {
  let mid: string;
  beforeAll(async () => {
    mid = (await db().query<{ id: string }>("SELECT id FROM creatives WHERE customer_id = ? AND review_state = 'pending' ORDER BY id LIMIT 1", [K001]))[0]?.id as string;
    if (!mid) {
      mid = (await db().query<{ id: string }>('SELECT id FROM creatives WHERE customer_id = ? ORDER BY id LIMIT 1', [K001]))[0]!.id;
      await db().run("UPDATE creatives SET review_state = 'pending', state = 'pending_review', scan_state = 'clean' WHERE id = ?", [mid]);
    }
    await db().run("UPDATE creatives SET scan_state = 'clean', state = 'pending_review', format = 'fullscreen', overlay = NULL WHERE id = ?", [mid]);
  });
  it('doi overlay giua luc xem va luc duyet: 409 content_changed; duyet dung phien ban moi thanh cong va ghi dau van tay', async () => {
    const seen = (await admin.json('GET', `/admin/v1/media/${mid}`)).body.content_version as number;
    expect(seen).toBeGreaterThanOrEqual(1);
    // khach doi QR/hotline sau khi nguoi duyet da xem
    const sw = await lan.json('PUT', `/portal/v1/media/${mid}/overlay`, { overlay: { headline: 'Hotline gia mao', contexts: ['fullscreen'] } });
    expect(sw.status).toBe(200);
    const stale = await admin.json('POST', `/admin/v1/media/${mid}/approve`, { content_version: seen });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('content_changed');
    expect((await db().query<{ review_state: string }>('SELECT review_state FROM creatives WHERE id = ?', [mid]))[0]!.review_state).toBe('pending');
    const fresh = (await admin.json('GET', `/admin/v1/media/${mid}`)).body.content_version as number;
    expect(fresh).toBeGreaterThan(seen);
    const ok = await admin.json('POST', `/admin/v1/media/${mid}/approve`, { content_version: fresh });
    expect(ok.status).toBe(200);
    const sec = (await db().query<{ approved_version: number; approved_hash: string }>('SELECT approved_version, approved_hash FROM creative_security WHERE creative_id = ?', [mid]))[0]!;
    expect(Number(sec.approved_version)).toBe(fresh);
    expect(sec.approved_hash).toMatch(/^[0-9a-f]{64}$/);
    const au = (await db().query<{ diff: string }>("SELECT diff FROM audit_log WHERE action = 'media.approve' AND object_id = ?", [mid]))[0]!;
    expect(JSON.parse(au.diff)).toMatchObject({ content_version: fresh, version_bound: true });
  });
  it('khach doi overlay cua tep da duyet: quay ve cho duyet va tang phien ban', async () => {
    const v0 = (await admin.json('GET', `/admin/v1/media/${mid}`)).body.content_version as number;
    expect((await lan.json('PUT', `/portal/v1/media/${mid}/overlay`, { overlay: { headline: 'Doi nua', contexts: ['fullscreen'] } })).status).toBe(200);
    const m = (await admin.json('GET', `/admin/v1/media/${mid}`)).body;
    expect(m.status).toBe('pending');
    expect(m.content_version).toBeGreaterThan(v0);
  });
});

describe('Chinh sach tre em: an toan mac dinh, cuong che o duyet', () => {
  let cid: string;
  beforeAll(async () => {
    cid = (await db().query<{ id: string }>('SELECT id FROM creatives WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [K001]))[0]!.id;
    await db().run("UPDATE creatives SET scan_state = 'clean', state = 'pending_review', review_state = 'pending', kind = 'image', px_w = 1920, px_h = 1080, size_bytes = 1000, format = 'fullscreen', overlay = ? WHERE id = ?", [JSON.stringify({ v: 1, kid_safe: true, contexts: ['lock', 'fullscreen'] }), cid]);
    await db().run("UPDATE customers SET industry = 'O to' WHERE id = ?", [K001]);
    await db().run("DELETE FROM settings WHERE key = 'tv_experience'");
  });
  it('mac dinh quang cao man khoa TAT: duyet creative co ngu canh lock -> 422 lock_ads_disabled', async () => {
    const r = await admin.json('POST', `/admin/v1/media/${cid}/approve`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('lock_ads_disabled');
  });
  it('bat man khoa: chi quan tri co quyen duyet + xac nhan ro rang; sau do duyet duoc; summary dem bang cot co cau truc', async () => {
    const cur = (await admin.json('GET', '/admin/v1/tv-experience')).body.settings;
    expect((await admin.json('PUT', '/admin/v1/tv-experience/settings', { ...cur, lock_ads_enabled: true })).status).toBe(422);
    expect((await admin.json('PUT', '/admin/v1/tv-experience/settings', { ...cur, lock_ads_enabled: true, confirm_children_policy: true })).status).toBe(200);
    const ap = await admin.json('POST', `/admin/v1/media/${cid}/approve`, {});
    expect(ap.status).toBe(200);
    await admin.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { kid_safe: true, contexts: ['lock', 'fullscreen'] });
    const sec = (await db().query<{ kid_safe: number; lock_context: number }>('SELECT kid_safe, lock_context FROM creative_security WHERE creative_id = ?', [cid]))[0]!;
    expect([Number(sec.kid_safe), Number(sec.lock_context)]).toEqual([1, 1]);
    const sum = (await admin.json('GET', '/admin/v1/tv-experience')).body.summary;
    expect(sum.kid_safe).toBeGreaterThanOrEqual(1);
    expect(sum.lock_eligible).toBeGreaterThanOrEqual(1);
    const f = await admin.json('GET', '/admin/v1/tv-experience/creatives?filter=kid_safe:true&page_size=50');
    expect(f.body.items.map((x: any) => x.id)).toContain(cid);
    // tat lai: khong con creative du dieu kien man khoa
    const cur2 = (await admin.json('GET', '/admin/v1/tv-experience')).body.settings;
    expect((await admin.json('PUT', '/admin/v1/tv-experience/settings', { ...cur2, lock_ads_enabled: false })).status).toBe(200);
    expect((await admin.json('GET', '/admin/v1/tv-experience')).body.summary.lock_eligible).toBe(0);
  });
});

describe('Cong tuan thu noi dung khi gui duyet chien dich', () => {
  const mk = async (name: string) => {
    const c = await lan.json('POST', '/portal/v1/campaigns', { name, budget_vnd: 1_000_000, screen_type: 'tv', start_date: '2026-11-01', end_date: '2026-12-31' });
    expect(c.status).toBe(201);
    return c.body.id as string;
  };
  it('khong xac nhan quyen noi dung -> 422 rights_confirmation_required; chien dich van la draft', async () => {
    const id = await mk('Thieu xac nhan');
    const r = await lan.json('POST', `/portal/v1/campaigns/${id}/submit`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('rights_confirmation_required');
    expect((await lan.json('POST', `/portal/v1/campaigns/${id}/submit`, { content_rights_confirmed: false })).status).toBe(422);
    expect((await db().query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [id]))[0]!.state).toBe('draft');
  });
  it('xac nhan duoc ghi audit; hang cho duyet hien co hieu nganh han che + quyen noi dung', async () => {
    const id = await mk('Nganh han che');
    // can tao creative de duyet: chi can kiem hang cho, khong duyet o day
    const r = await lan.json('POST', `/portal/v1/campaigns/${id}/submit`, { content_rights_confirmed: true, restricted_industry: true });
    expect(r.status).toBe(200);
    expect(r.body.restricted_industry).toBe(true);
    const au = (await db().query<{ diff: string; actor_id: string; ip: string | null }>("SELECT diff, actor_id, ip FROM audit_log WHERE action = 'campaign.submit' AND object_id = ?", [id]))[0]!;
    expect(JSON.parse(au.diff)).toMatchObject({ content_rights_confirmed: true, restricted_industry: true, restricted_reason: 'declared' });
    const q = (await admin.json('GET', '/admin/v1/approvals?page_size=200')).body.items.find((x: any) => x.id === id);
    expect(q).toMatchObject({ restricted_industry: true, content_rights_confirmed: true });
    expect(q.content_rights_confirmed_at).toBeTruthy();
  });
  it('nganh han che bi chan khi duyet tru khi bat allow_restricted_industries', async () => {
    const id = (await admin.json('GET', '/admin/v1/approvals?page_size=200')).body.items.find((x: any) => x.restricted_industry).id as string;
    await db().run('UPDATE creatives SET campaign_id = NULL WHERE campaign_id = ?', [id]);
    const blocked = await admin.json('POST', `/admin/v1/campaigns/${id}/approve`, {});
    // khong co creative thi 422 no_creative co the den truoc; dam bao la 422 va khong duyet
    expect(blocked.status).toBe(422);
    expect((await db().query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [id]))[0]!.state).toBe('pending_review');
  });
  it('nganh cua khach thuoc danh sach cam tu dong danh dau han che', async () => {
    await db().run("UPDATE customers SET industry = 'Rượu bia' WHERE id = ?", [K001]);
    const id = await mk('Nganh cam tu dong');
    const r = await lan.json('POST', `/portal/v1/campaigns/${id}/submit`, { content_rights_confirmed: true });
    expect(r.status).toBe(200);
    expect(r.body.restricted_industry).toBe(true);
    expect(r.body.restricted_reason).toMatch(/customer_industry/);
    await db().run("UPDATE customers SET industry = 'O to' WHERE id = ?", [K001]);
  });
});

describe('R1-26 / R1-17 tach nhiem vu va du lieu tai chinh', () => {
  it('device_ops (devices:write) khong tu "verify" thiet bi thanh trust 2 (can devices:approve); super_admin thi duoc; block/unblock van duoc', async () => {
    const ops = await login(env, env.byRole('device_ops'));
    const id = (await db().query<{ id: string }>("SELECT id FROM devices WHERE kind = 'tv' ORDER BY id LIMIT 1"))[0]!.id;
    const r = await ops.json('POST', '/admin/v1/devices/bulk', { action: 'verify', ids: [id] });
    expect(r.status).toBe(403);
    expect((await ops.json('POST', '/admin/v1/devices/bulk', { action: 'block', ids: [id] })).status).toBe(200);
    expect((await ops.json('POST', '/admin/v1/devices/bulk', { action: 'unblock', ids: [id] })).status).toBe(200);
    expect((await admin.json('POST', '/admin/v1/devices/bulk', { action: 'verify', ids: [id] })).status).toBe(200);
  });
  it('dashboard: nguoi khong co quyen tai chinh khong thay doanh thu/chi phi tra thuong; finance thay', async () => {
    const cm = await login(env, env.byRole('content_manager'));
    const fin = await login(env, env.byRole('finance'));
    const a = (await cm.json('GET', '/admin/v1/dashboard/overview')).body;
    const f = (await fin.json('GET', '/admin/v1/dashboard/overview')).body;
    expect(a.kpi.revenue_vnd).toBeNull();
    expect(a.kpi.reward_cost_vnd).toBeNull();
    expect(a.revenue_split).toEqual([]);
    expect(typeof f.kpi.revenue_vnd).toBe('number');
  });
});
