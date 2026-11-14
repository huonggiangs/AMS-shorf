import { beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let finance: Session;
let content: Session;
let devops: Session;
let lan: Session; // K001
let dang: Session; // K008
let K001: string;
let K008: string;
let campA: string;
let campB: string;
const db = () => env.rt.db;

beforeAll(async () => {
  env = await setup({}, process.env['W2_SQLITE'] ? 'sqlite' : 'postgres');
  K001 = env.seed.customers['K001']!;
  K008 = env.seed.customers['K008']!;
  admin = await login(env, env.byRole('super_admin'));
  finance = await login(env, env.byRole('finance'));
  content = await login(env, env.byRole('content_manager'));
  devops = await login(env, env.byRole('device_ops'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
  campA = (await db().query<{ id: string }>('SELECT id FROM campaigns WHERE customer_id = ? ORDER BY id LIMIT 1', [K001]))[0]!.id;
  campB = (await db().query<{ id: string }>('SELECT id FROM campaigns WHERE customer_id = ? ORDER BY id LIMIT 1', [K008]))[0]!.id;
}, 120_000);

const auditActions = async (prefix: string) => (await db().query<{ action: string }>('SELECT action FROM audit_log WHERE action LIKE ?', [`${prefix}%`])).map((x) => x.action);

describe('TvExperience: kid_safe + overlay', () => {
  let cid: string; // creative cua K001 de duyet
  beforeAll(async () => {
    cid = (await db().query<{ id: string }>('SELECT id FROM creatives WHERE customer_id = ? ORDER BY id LIMIT 1', [K001]))[0]!.id;
    await db().run("UPDATE creatives SET review_state = 'approved', kind = 'image', px_w = 1920, px_h = 1080, size_bytes = 1000000, format = 'fullscreen', overlay = NULL WHERE id = ?", [cid]);
    await db().run("UPDATE customers SET industry = 'Ô tô' WHERE id = ?", [K001]);
  });

  it('RBAC: khach 403, content_manager chi xem, device_ops sua duoc nhung khong duyet kid_safe/lock', async () => {
    expect((await lan.req('GET', '/admin/v1/tv-experience')).status).toBe(403);
    expect((await content.req('GET', '/admin/v1/tv-experience')).status).toBe(200);
    expect((await content.req('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { duration_s: 10 })).status).toBe(403);
    expect((await devops.req('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { kid_safe: true })).status).toBe(403);
    expect((await devops.req('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { contexts: ['lock'] })).status).toBe(403);
    const ok = await devops.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { duration_s: 20, safe_area: { top: 5, right: 5, bottom: 5, left: 5 }, contexts: ['fullscreen', 'pause'] });
    expect(ok.status).toBe(200);
    expect(ok.body.kid_safe).toBe(false);
    expect((await db().query<{ duration_s: number }>('SELECT duration_s FROM creatives WHERE id = ?', [cid]))[0]!.duration_s).toBe(20); // dong bo sang creatives.duration_s
  });

  it('khach khong tu dat kid_safe/lock qua media route: 422 ro rang (reviewerFields reject), khong ghi gi', async () => {
    const before = (await db().query<{ overlay: string | null }>('SELECT overlay FROM creatives WHERE id = ?', [cid]))[0]!.overlay;
    const bad = await lan.json('PUT', `/portal/v1/media/${cid}/overlay`, { overlay: { headline: 'Khuyen mai', kid_safe: true, contexts: ['lock', 'fullscreen'], duration_s: 15 } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('bad_overlay');
    expect((await db().query<{ overlay: string | null }>('SELECT overlay FROM creatives WHERE id = ?', [cid]))[0]!.overlay).toBe(before);
    const r = await lan.json('PUT', `/portal/v1/media/${cid}/overlay`, { overlay: { headline: 'Khuyen mai', contexts: ['fullscreen'], kid_safe: false, duration_s: 15 } });
    expect(r.status).toBe(200);
    const stored = JSON.parse((await db().query<{ overlay: string }>('SELECT overlay FROM creatives WHERE id = ?', [cid]))[0]!.overlay);
    expect(stored.kid_safe).toBe(false);
    expect(stored.contexts).toEqual(['fullscreen']);
    expect(stored.duration_s).toBe(15);
    await db().run("UPDATE creatives SET review_state = 'approved' WHERE id = ?", [cid]); // khach sua da dua ve cho duyet; duyet lai de test tiep
  });

  it('chan kid_safe: nganh cam, chua duyet, anh sai ti le', async () => {
    await db().run("UPDATE customers SET industry = 'Rượu bia' WHERE id = ?", [K001]);
    const a = await admin.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { kid_safe: true });
    expect(a.status).toBe(422);
    expect(a.body.error.code).toBe('kid_safe_blocked');
    await db().run("UPDATE customers SET industry = 'Ô tô' WHERE id = ?", [K001]);
    await db().run("UPDATE creatives SET review_state = 'pending' WHERE id = ?", [cid]);
    expect((await admin.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { kid_safe: true })).status).toBe(422);
    await db().run("UPDATE creatives SET review_state = 'approved', px_w = 1000, px_h = 1000 WHERE id = ?", [cid]);
    expect((await admin.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { kid_safe: true })).status).toBe(422);
    await db().run('UPDATE creatives SET px_w = 1920, px_h = 1080 WHERE id = ?', [cid]);
  });

  it('nguoi duyet dat kid_safe + lock; overlay luu du truong; tim duoc theo bo loc; audit', async () => {
    // chinh sach tre em (p2): man khoa TAT mac dinh => chua cho dat ngu canh 'lock'
    const off = await admin.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { kid_safe: true, contexts: ['lock', 'fullscreen'], duration_s: 25 });
    expect(off.status).toBe(422);
    expect(off.body.error.code).toBe('lock_ads_disabled');
    await db().run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('tv_experience', ?, NULL, ?)", [JSON.stringify({ lock_ads_enabled: true, fullscreen_ads_enabled: true, frequency: { per_hour: 30, min_gap_s: 60, same_creative_gap_s: 300 }, banned_industries: ['rượu bia'] }), '2026-11-12T03:00:00.000Z']);
    const r = await admin.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { kid_safe: true, contexts: ['lock', 'fullscreen'], duration_s: 25 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kid_safe: true, lock_eligible: true, duration_s: 25 });
    const stored = JSON.parse((await db().query<{ overlay: string }>('SELECT overlay FROM creatives WHERE id = ?', [cid]))[0]!.overlay);
    expect(stored).toMatchObject({ kid_safe: true, contexts: ['lock', 'fullscreen'], duration_s: 25, headline: 'Khuyen mai' });
    const list = await admin.json('GET', '/admin/v1/tv-experience/creatives?filter=kid_safe:true&page_size=50');
    expect(list.body.items.map((x: any) => x.id)).toContain(cid);
    expect((await admin.json('GET', '/admin/v1/tv-experience')).body.summary.lock_eligible).toBeGreaterThanOrEqual(1);
    expect(await auditActions('tv.')).toEqual(expect.arrayContaining(['tv.kid_safe.approve', 'tv.creative.update']));
  });

  it('khach sua overlay sau khi duyet: kid_safe tu mat (an toan); thu hoi kid_safe go luon ngu canh lock', async () => {
    const r = await admin.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { kid_safe: false });
    expect(r.status).toBe(200);
    expect(r.body.contexts).toEqual(['fullscreen']);
    expect(r.body.lock_eligible).toBe(false);
    expect((await admin.json('PUT', `/admin/v1/tv-experience/creatives/${cid}`, { contexts: ['lock'] })).status).toBe(422); // lock ma chua kid_safe
  });

  it('cai dat: validate, bat man khoa can quyen duyet, ghi audit', async () => {
    await db().run("DELETE FROM settings WHERE key = 'tv_experience'"); // bo cai dat dung de test man khoa o tren
    const cur = (await admin.json('GET', '/admin/v1/tv-experience')).body.settings;
    expect(cur.lock_ads_enabled).toBe(false); // mac dinh an toan
    expect((await admin.json('PUT', '/admin/v1/tv-experience/settings', { ...cur, frequency: { ...cur.frequency, per_hour: 0 } })).status).toBe(422);
    expect((await devops.req('PUT', '/admin/v1/tv-experience/settings', { ...cur, lock_ads_enabled: true })).status).toBe(403);
    expect((await devops.req('PUT', '/admin/v1/tv-experience/settings', { ...cur, frequency: { ...cur.frequency, per_hour: 20 } })).status).toBe(200);
    const noAck = await admin.json('PUT', '/admin/v1/tv-experience/settings', { ...cur, frequency: { ...cur.frequency, per_hour: 20 }, lock_ads_enabled: true });
    expect(noAck.status).toBe(422); // bat man khoa/tre em can xac nhan ro rang
    expect(noAck.body.error.code).toBe('children_policy_confirmation_required');
    const on = await admin.json('PUT', '/admin/v1/tv-experience/settings', { ...cur, frequency: { ...cur.frequency, per_hour: 20 }, lock_ads_enabled: true, confirm_children_policy: true });
    expect(on.status).toBe(200);
    expect((await admin.json('GET', '/admin/v1/tv-experience')).body.settings.lock_ads_enabled).toBe(true);
    expect((await auditActions('tv.settings')).length).toBe(2);
  });

  it('creative khong ton tai -> 404', async () => {
    expect((await admin.req('PUT', '/admin/v1/tv-experience/creatives/khong-co', { duration_s: 10 })).status).toBe(404);
  });
});

describe('History / proof-of-play', () => {
  const ts = (h: number) => `2026-11-10T0${h}:30:00.000Z`;
  beforeAll(async () => {
    const dev = (await db().query<{ id: string }>('SELECT id FROM devices ORDER BY id LIMIT 1'))[0]!.id;
    for (let i = 0; i < 5; i++) {
      await db().run('INSERT INTO ev_ad_impression (ts, event_id, device_id, screen_id, campaign_id, vcr_pct, valid, reject_reason, revenue_micro_vnd, reward_vnd) VALUES (?,?,?,?,?,?,?,?,?,?)', [ts(i), `evA${i}`, dev, 'scr1', campA, i === 4 ? 60 : 100, i === 4 ? 0 : 1, i === 4 ? 'vcr_low' : null, 2_000_000, 10]);
    }
    for (let i = 0; i < 3; i++) await db().run('INSERT INTO ev_ad_impression (ts, event_id, device_id, screen_id, campaign_id, vcr_pct, valid, revenue_micro_vnd, reward_vnd) VALUES (?,?,?,?,?,?,?,?,?)', [ts(i), `evB${i}`, dev, 'scr2', campB, 100, 1, 3_000_000, 10]);
    const cr = (await db().query<{ id: string }>('SELECT id FROM creatives WHERE customer_id = ? ORDER BY id LIMIT 1', [K008]))[0]!.id;
    await db().run('INSERT INTO ev_proof_of_play (ts, screen_id, creative_id, duration_ms, source) VALUES (?,?,?,?,?)', [ts(1), 'scr2', cr, 15000, 'tv']);
  });

  it('admin: loc, phan trang, tong; finance thay doanh thu; content_manager khong', async () => {
    const all = await finance.json('GET', `/admin/v1/history?campaign_id=${campA}&page_size=2&page=2`);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(5);
    expect(all.body.items.length).toBe(2);
    expect(all.body.items[0].revenue_vnd).toBe(2);
    const inv = await finance.json('GET', `/admin/v1/history?campaign_id=${campA}&valid=false`);
    expect(inv.body.items.map((x: any) => x.reject_reason)).toEqual(['vcr_low']);
    const day = await finance.json('GET', `/admin/v1/history?campaign_id=${campA}&from=2026-11-10&to=2026-11-10`);
    expect(day.body.total).toBe(5);
    expect((await finance.json('GET', '/admin/v1/history?from=2026-11-11')).body.items.filter((x: any) => x.campaign.id === campA).length).toBe(0);
    expect((await finance.json('GET', '/admin/v1/history?from=bad')).status).toBe(422);
    const cm = await content.json('GET', `/admin/v1/history?campaign_id=${campA}`);
    expect(cm.status).toBe(200);
    expect(cm.body.items[0].revenue_vnd).toBeUndefined();
    expect((await lan.req('GET', '/admin/v1/history')).status).toBe(403);
  });

  it('IDOR: khach chi thay luot xem cua minh, khong co doanh thu/thiet bi; id khach khac -> 404', async () => {
    const mine = await lan.json('GET', '/portal/v1/history?page_size=200');
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(mine.body.items.length);
    expect(mine.body.items.length).toBe(5);
    expect(mine.body.items.every((x: any) => x.campaign.id === campA)).toBe(true);
    expect(mine.body.items.every((x: any) => x.revenue_vnd === undefined && x.reward_vnd === undefined && x.device === undefined && x.screen_id === undefined)).toBe(true);
    const other = await lan.req('GET', '/portal/v1/history/evB0');
    const ghost = await lan.req('GET', '/portal/v1/history/khong-co');
    expect(other.status).toBe(404);
    expect(await other.text()).toBe(await ghost.text());
    expect((await lan.req('GET', '/portal/v1/history/evA0')).status).toBe(200);
    // loc theo chien dich/khach khac khong mo rong pham vi
    const probe = await lan.json('GET', `/portal/v1/history?campaign_id=${campB}&customer_id=${K008}&filter=customer_id:${K008}`);
    expect(probe.body.total).toBe(0);
    const pop = await lan.json('GET', '/portal/v1/history/proof-of-play');
    expect(pop.body.total).toBe(0);
    expect((await dang.json('GET', '/portal/v1/history/proof-of-play')).body.items.length).toBe(1);
    expect((await dang.json('GET', '/portal/v1/history/proof-of-play')).body.items[0].screen_id).toBeUndefined();
    expect((await admin.json('GET', '/admin/v1/history/proof-of-play')).body.total).toBe(1);
  });
});

describe('Hoa don VAT', () => {
  let invId: string;
  let walletBefore: unknown;
  beforeAll(async () => {
    walletBefore = await db().query('SELECT * FROM wallet_entries ORDER BY id');
  });

  it('RBAC + validate + tinh VAT so nguyen', async () => {
    expect((await content.req('GET', '/admin/v1/invoices')).status).toBe(403);
    expect((await lan.req('GET', '/admin/v1/invoices')).status).toBe(403);
    expect((await finance.json('POST', '/admin/v1/invoices', { customer_id: K001, period: '2026-13', amount_vnd: 1000, vat_rate: 10 })).status).toBe(422);
    expect((await finance.json('POST', '/admin/v1/invoices', { customer_id: K001, period: '2026-09', amount_vnd: 1000.5, vat_rate: 10 })).status).toBe(422);
    expect((await finance.json('POST', '/admin/v1/invoices', { customer_id: K001, period: '2026-09', amount_vnd: 1000, vat_rate: 7 })).status).toBe(422);
    expect((await finance.json('POST', '/admin/v1/invoices', { customer_id: 'khong-co', period: '2026-09', amount_vnd: 1000, vat_rate: 10 })).status).toBe(404);
    const r = await finance.json('POST', '/admin/v1/invoices', { customer_id: K001, period: '2026-09', amount_vnd: 12_345_679, vat_rate: 8 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'draft', vat_vnd: 987_654, total_vnd: 13_333_333 });
    invId = r.body.id;
  });

  it('khong tao trung ky du 5 yeu cau dong thoi', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => finance.req('POST', '/admin/v1/invoices', { customer_id: K008, period: '2026-08', amount_vnd: 5_000_000, vat_rate: 10 })));
    expect(rs.map((x) => x.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect((await db().query('SELECT 1 FROM invoices WHERE customer_id = ? AND period = ?', [K008, '2026-08'])).length).toBe(1);
  });

  it('phat hanh dung mot lan (dua nhau), tao dung mot cong no, khach thay; ban nhap thi khong', async () => {
    const draftSeen = await lan.json('GET', '/portal/v1/invoices?page_size=100');
    expect(draftSeen.body.items.some((x: any) => x.id === invId)).toBe(false);
    expect((await lan.req('GET', `/portal/v1/invoices/${invId}`)).status).toBe(404);
    const rs = await Promise.all([1, 2, 3].map(() => finance.req('POST', `/admin/v1/invoices/${invId}/issue`, { einvoice_ref: 'HD0001' })));
    expect(rs.map((x) => x.status).sort()).toEqual([200, 409, 409]);
    const rc = await db().query<{ amount_vnd: number }>('SELECT amount_vnd FROM receivables WHERE invoice_id = ?', [invId]);
    expect(rc.length).toBe(1);
    expect(Number(rc[0]!.amount_vnd)).toBe(13_333_333);
    expect((await finance.json('PUT', `/admin/v1/invoices/${invId}`, { amount_vnd: 1 })).status).toBe(409); // chi sua ban nhap
    const mine = await lan.json('GET', `/portal/v1/invoices/${invId}`);
    expect(mine.status).toBe(200);
    expect(mine.body.customer_id).toBeUndefined();
  });

  it('IDOR: khach khac 404 giong id khong ton tai; danh sach chi cua minh', async () => {
    const other = await dang.req('GET', `/portal/v1/invoices/${invId}`);
    const ghost = await dang.req('GET', '/portal/v1/invoices/khong-co');
    expect(other.status).toBe(404);
    expect(await other.text()).toBe(await ghost.text());
    const l = await dang.json('GET', '/portal/v1/invoices?page_size=200');
    expect(l.body.items.every((x: any) => x.id !== invId)).toBe(true);
    const all = await dang.json('GET', `/portal/v1/invoices?customer_id=${K001}&filter=customer_id:${K001}`);
    expect(all.body.items.every((x: any) => x.id !== invId)).toBe(true);
  });

  it('thanh toan -> dong cong no; khong huy hoa don da thu; huy ban nhap xoa cong no', async () => {
    const pay = await finance.json('POST', `/admin/v1/invoices/${invId}/pay`, {});
    expect(pay.status).toBe(200);
    expect(pay.body).toMatchObject({ status: 'paid', receivable_state: 'paid', paid_vnd: 13_333_333 });
    expect((await finance.req('POST', `/admin/v1/invoices/${invId}/pay`, {})).status).toBe(409);
    expect((await finance.req('POST', `/admin/v1/invoices/${invId}/void`, { reason: 'nham' })).status).toBe(409);
    const d = (await finance.json('POST', '/admin/v1/invoices', { customer_id: K001, period: '2026-07', amount_vnd: 1_000_000, vat_rate: 10 })).body.id;
    expect((await finance.req('POST', `/admin/v1/invoices/${d}/void`, {})).status).toBe(422); // thieu ly do
    expect((await finance.json('POST', `/admin/v1/invoices/${d}/void`, { reason: 'lap nham ky' })).body.status).toBe('void');
    expect((await finance.req('POST', `/admin/v1/invoices/${d}/issue`, {})).status).toBe(409);
  });

  it('so cai vi khong bi dong vao; co audit day du; list/loc/phan trang', async () => {
    expect(await db().query('SELECT * FROM wallet_entries ORDER BY id')).toEqual(walletBefore);
    expect(await auditActions('invoice.')).toEqual(expect.arrayContaining(['invoice.create', 'invoice.issue', 'invoice.pay', 'invoice.void']));
    const l = await finance.json('GET', `/admin/v1/invoices?customer_id=${K001}&status=paid&page_size=5`);
    expect(l.body.items.map((x: any) => x.id)).toContain(invId);
    expect(l.body.total).toBe(l.body.items.length);
  });
});

describe('Chi tra thuong (payouts)', () => {
  let pid: string;
  let uid: string;
  beforeAll(async () => {
    const p = (await db().query<{ id: string; user_id: string }>("SELECT id, user_id FROM payouts WHERE status = 'pending' ORDER BY id LIMIT 1"))[0]!;
    pid = p.id;
    uid = p.user_id;
  });
  it('thieu so du -> 409, trang thai va so cai khong doi', async () => {
    const before = (await db().query('SELECT * FROM wallet_ledger WHERE user_id = ?', [uid])).length;
    expect((await finance.req('POST', `/admin/v1/payouts/${pid}/pay`, { external_ref: 'FT1' })).status).toBe(409);
    expect((await db().query<{ status: string }>('SELECT status FROM payouts WHERE id = ?', [pid]))[0]!.status).toBe('pending');
    expect((await db().query('SELECT * FROM wallet_ledger WHERE user_id = ?', [uid])).length).toBe(before);
  });
  it('RBAC: content_manager 403; chi tra mot lan duy nhat du bam dup', async () => {
    expect((await content.req('GET', '/admin/v1/payouts')).status).toBe(403);
    await db().run("INSERT INTO wallet_ledger (id, user_id, kind, amount_vnd, ref_type, ref_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)", ['L1', uid, 'reward', 100_000, 'test', null, 'posted', '2026-11-12T00:00:00.000Z']);
    const rs = await Promise.all([1, 2, 3].map(() => finance.req('POST', `/admin/v1/payouts/${pid}/pay`, { external_ref: 'FT2' })));
    expect(rs.map((x) => x.status).sort()).toEqual([200, 409, 409]);
    const rows = await db().query<{ amount_vnd: number }>("SELECT amount_vnd FROM wallet_ledger WHERE user_id = ? AND kind = 'payout'", [uid]);
    expect(rows.map((x) => Number(x.amount_vnd))).toEqual([-50_000]);
    expect(await auditActions('payout.')).toContain('payout.pay');
    const l = await finance.json('GET', '/admin/v1/payouts?status=paid');
    expect(l.body.items.every((x: any) => x.user_id !== undefined && x.email === undefined)).toBe(true);
  });
  it('tu choi lenh cho: khong cham so cai', async () => {
    const p2 = (await db().query<{ id: string }>("SELECT id FROM payouts WHERE status = 'pending' ORDER BY id LIMIT 1"))[0];
    if (!p2) return;
    const n = (await db().query('SELECT 1 FROM wallet_ledger')).length;
    expect((await finance.json('POST', `/admin/v1/payouts/${p2.id}/reject`, { reason: 'sai tai khoan' })).body.status).toBe('rejected');
    expect((await db().query('SELECT 1 FROM wallet_ledger')).length).toBe(n);
    expect((await finance.req('POST', `/admin/v1/payouts/${p2.id}/reject`, { reason: 'lan hai' })).status).toBe(409);
  });

  it('hai lenh chi dong thoi cung nguoi dung, so du chi du cho mot: dung mot lenh thanh cong, so du khong am', async () => {
    const t = '2026-11-12T00:00:00.000Z';
    const u = 'RACE_U';
    await db().run('INSERT INTO end_users (id, display_name, created_at) VALUES (?,?,?)', [u, 'Race', t]);
    await db().run("INSERT INTO wallet_ledger (id, user_id, kind, amount_vnd, ref_type, ref_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)", ['RL1', u, 'reward', 80_000, 'test', null, 'posted', t]);
    for (const id of ['RP1', 'RP2', 'RP3']) await db().run("INSERT INTO payouts (id, user_id, amount_vnd, channel, status, requested_at) VALUES (?,?,?,?,?,?)", [id, u, 50_000, 'bank', 'pending', t]);
    const rs = await Promise.all(['RP1', 'RP2', 'RP3'].map((id) => finance.req('POST', `/admin/v1/payouts/${id}/pay`, { external_ref: 'RACE-' + id })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const sum = Number((await db().query<{ s: unknown }>("SELECT SUM(amount_vnd) AS s FROM wallet_ledger WHERE user_id = ? AND status = 'posted'", [u]))[0]!.s);
    expect(sum).toBe(30_000);
    expect((await db().query("SELECT 1 FROM payouts WHERE user_id = ? AND status = 'paid'", [u])).length).toBe(1);
  });
});

describe('Doanh thu theo gio', () => {
  it('chia theo gio Viet Nam, co freshness_at, stale khi du lieu cu', async () => {
    // 2026-11-10T18:00Z = 01:00 ngay 11/11 gio VN
    await db().run("INSERT INTO impression_hourly (hour, campaign_id, partner_id, region, impressions, valid, revenue_micro_vnd, reward_vnd) VALUES (?,?,?,?,?,?,?,?)", ['2026-11-10T18:00:00.000Z', campA, '', '', 10, 8, 5_000_000, 40]);
    await db().run("INSERT INTO impression_hourly (hour, campaign_id, partner_id, region, impressions, valid, revenue_micro_vnd, reward_vnd) VALUES (?,?,?,?,?,?,?,?)", ['2026-11-10T18:00:00.000Z', campB, '', '', 2, 2, 1_000_000, 8]);
    const r = await finance.json('GET', '/admin/v1/revenue/hourly?date=2026-11-11');
    expect(r.status).toBe(200);
    expect(r.body.hours.length).toBe(24);
    expect(r.body.hours[1]).toMatchObject({ impressions: 12, valid: 10, revenue_vnd: 6, reward_vnd: 48 });
    expect(r.body.total.impressions).toBe(12);
    expect(typeof r.body.freshness_at).toBe('string');
    expect(typeof r.body.stale).toBe('boolean');
    expect((await finance.json('GET', '/admin/v1/revenue/hourly?date=2026-11-12')).body.total.impressions).toBe(0);
    expect((await finance.req('GET', '/admin/v1/revenue/hourly?date=xx')).status).toBe(422);
    expect((await devops.req('GET', '/admin/v1/revenue/hourly')).status).toBe(403);
    expect((await lan.req('GET', '/admin/v1/revenue/hourly')).status).toBe(403);
  });
});
