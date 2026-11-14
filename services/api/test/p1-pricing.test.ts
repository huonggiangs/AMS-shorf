// p1-pricing: bang gia (CRUD, quyen, audit, phien ban theo ngay), chot gia luc duyet, bao gia cho khach, hop dong ghi de gia, production tu choi khi chua co bang gia.
import { beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';
import type { FinancePort } from '../src/ports.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const vnd = (n: number) => n * 1_000_000;
const fakeFinance: FinancePort = {
  async reserveForCampaign(rt, { campaignId }) {
    await rt.db.run("UPDATE campaigns SET state = 'active', reserved_vnd = approved_budget_vnd, funding_state = 'reserved' WHERE id = ?", [campaignId]);
    const r = (await rt.db.query<{ approved_budget_vnd: number }>('SELECT approved_budget_vnd FROM campaigns WHERE id = ?', [campaignId]))[0]!;
    return { campaign_state: 'active', reserved_vnd: Number(r.approved_budget_vnd), shortfall_vnd: 0 };
  },
  async releaseForCampaign() {
    return { released_vnd: 0 };
  },
};

let env: Env;
let admin: Session;
let fin: Session;
let cm: Session;
let lan: Session;
let K001: string;

beforeAll(async () => {
  env = await setup({ finance: fakeFinance });
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  fin = await login(env, env.byRole('finance'));
  cm = await login(env, env.byRole('content_manager'));
  lan = await login(env, 'lan@vinamilk.example');
}, 120_000);

const pendingCampaign = async (s: Session, nth = 0): Promise<any> => (await s.json('GET', '/admin/v1/campaigns?filter=status:pending&page_size=50')).body.items[nth];

describe('bang gia: CRUD, quyen, audit, phien ban', () => {
  it('demo seed co bang gia mau; finance xem duoc, khach/noi dung khong ghi duoc', async () => {
    const l = await fin.json('GET', '/admin/v1/rate-cards?page_size=50&current=1');
    expect(l.status).toBe(200);
    expect(l.body.total).toBeGreaterThanOrEqual(9);
    expect(l.body.items.every((x: any) => x.status === 'current')).toBe(true);
    const body = { screen_type: 'tv', region_id: 'DN', daypart: 'peak', price_vnd: '41.5', floor_vnd: '20' };
    expect((await cm.json('POST', '/admin/v1/rate-cards', body)).status).toBe(403); // content_manager khong co finance
    expect((await lan.req('GET', '/admin/v1/rate-cards')).status).toBe(403); // cong khach hang khong vao admin
    expect((await lan.req('POST', '/admin/v1/rate-cards', body)).status).toBe(403);
  });

  it('tao dong gia (VND thap phan -> micro nguyen), ghi audit, kiem tra san va thoi diem hieu luc', async () => {
    const body = { screen_type: 'tv', region_id: 'DN', daypart: 'peak', price_vnd: '41.5', floor_vnd: '20', note: 'Da Nang gio cao diem' };
    const c = await fin.json('POST', '/admin/v1/rate-cards', body);
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ price_micro_vnd: 41_500_000, price_vnd: '41.5', floor_micro_vnd: vnd(20), model: 'per_impression', status: 'current', daypart: 'peak', region_id: 'DN' });
    const audit = await env.rt.db.query<{ action: string; actor_id: string }>("SELECT action, actor_id FROM audit_log WHERE object_id = ? AND action = 'rate_card.create'", [c.body.id]);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_id).toBeTruthy();
    // gia sau dau phay > 6 chu so / am / khong phai so
    for (const bad of ['0.0000001', '-5', 'abc', '1e3']) expect((await fin.json('POST', '/admin/v1/rate-cards', { ...body, region_id: 'CT', price_vnd: bad })).status).toBe(422);
    // gia < san
    const low = await fin.json('POST', '/admin/v1/rate-cards', { ...body, region_id: 'CT', price_vnd: '10', floor_vnd: '20' });
    expect(low.status).toBe(422);
    expect(low.body.error.code).toBe('price_below_floor');
    // cpm: 30.000 d CPM = 30 d/luot >= san 20
    const cpm = await fin.json('POST', '/admin/v1/rate-cards', { ...body, region_id: 'CT', model: 'cpm', price_vnd: '30000', floor_vnd: '20' });
    expect(cpm.status).toBe(201);
    expect(cpm.body.model).toBe('cpm');
    // cpm 10.000 d = 10 d/luot < san 20
    expect((await fin.json('POST', '/admin/v1/rate-cards', { ...body, region_id: 'HP', model: 'cpm', price_vnd: '10000', floor_vnd: '20' })).status).toBe(422);
    // khong dat hieu luc trong qua khu; trung khoa + cung thoi diem => 409
    expect((await fin.json('POST', '/admin/v1/rate-cards', { ...body, region_id: 'HP', effective_from: '2026-01-01T00:00:00Z' })).status).toBe(422);
    expect((await fin.json('POST', '/admin/v1/rate-cards', body)).status).toBe(409);
    expect((await fin.json('POST', '/admin/v1/rate-cards', { ...body, customer_id: 'khong-co' })).status).toBe(422);
  });

  it('"sua" gia = phien ban moi co hieu luc sau: dong cu giu nguyen va ket thuc tai effective_from moi; ket thuc dong', async () => {
    const created = (await fin.json('POST', '/admin/v1/rate-cards', { screen_type: 'elevator', region_id: 'HP', daypart: 'off_peak', price_vnd: '55', floor_vnd: '30' })).body;
    const later = new Date(env.rt.clock.now().getTime() + 3600_000).toISOString();
    const v2 = await fin.json('PUT', `/admin/v1/rate-cards/${created.id}`, { price_vnd: '58', effective_from: later });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ price_micro_vnd: vnd(58), floor_micro_vnd: vnd(30), status: 'scheduled', effective_from: later });
    const old = (await fin.json('GET', `/admin/v1/rate-cards/${created.id}`)).body;
    expect(old).toMatchObject({ price_micro_vnd: vnd(55), effective_to: later, status: 'current' }); // van la gia hien hanh cho den luc do
    expect((await fin.json('PUT', `/admin/v1/rate-cards/${created.id}`, { price_vnd: '60', effective_from: later })).status).toBe(409); // phien ban trung thoi diem
    // sau thoi diem hieu luc: dong cu het han, dong moi la hien hanh
    env.rt.clock.advance(3600_000 + 1000);
    expect((await fin.json('GET', `/admin/v1/rate-cards/${created.id}`)).body.status).toBe('expired');
    expect((await fin.json('GET', `/admin/v1/rate-cards/${v2.body.id}`)).body.status).toBe('current');
    expect((await fin.json('DELETE', `/admin/v1/rate-cards/${v2.body.id}`)).status).toBe(200);
    expect((await fin.json('GET', `/admin/v1/rate-cards/${v2.body.id}`)).body.status).toBe('expired');
    expect((await fin.json('DELETE', `/admin/v1/rate-cards/${v2.body.id}`)).status).toBe(409);
    const acts = (await env.rt.db.query<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'rate_card.%' ORDER BY ts, id")).map((r) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['rate_card.create', 'rate_card.revise', 'rate_card.end']));
  });
});

describe('chot gia luc duyet va bao gia', () => {
  it('khach thay bao gia truoc khi gui (khong thay san/nguon); duyet chot gia; doi bang gia sau do khong doi chien dich da duyet', async () => {
    const q0 = await lan.json('GET', '/portal/v1/pricing/quote?screen_type=tv&budget_vnd=5000000');
    expect(q0.status).toBe(200);
    expect(q0.body).toMatchObject({ status: 'quoted', locked: false, budget_vnd: 5_000_000 });
    const tvPeak = q0.body.lines.find((l: any) => l.daypart === 'peak' && l.region_id === '*');
    expect(tvPeak).toMatchObject({ unit_price_micro_vnd: vnd(40), unit_price_vnd: '40', estimated_impressions: 125_000 });
    expect(tvPeak.floor_micro_vnd).toBeUndefined();
    expect(tvPeak.source).toBeUndefined();
    const qa = await admin.json('GET', '/admin/v1/pricing/quote?screen_type=tv&customer_id=' + K001);
    expect(qa.body.lines[0].floor_micro_vnd).toBeGreaterThan(0); // noi bo thay san/nguon
    expect(qa.body.lines[0].source).toBeTruthy();

    const p = await pendingCampaign(admin);
    const qBefore = await admin.json('GET', `/admin/v1/campaigns/${p.id}/quote`);
    expect(qBefore.body).toMatchObject({ status: 'quoted', locked: false });
    const ap = await admin.json('POST', `/admin/v1/campaigns/${p.id}/approve`);
    expect(ap.status).toBe(200);
    const snap = await env.rt.db.query<any>('SELECT * FROM campaign_prices WHERE campaign_id = ? ORDER BY region_id, daypart', [p.id]);
    expect(snap.length).toBeGreaterThanOrEqual(2);
    const lockedPeak = snap.find((r: any) => r.region_id === '*' && r.daypart === 'peak');
    expect(Number(lockedPeak.unit_price_micro_vnd)).toBe(vnd(40));
    const audit = (await env.rt.db.query<{ diff: string }>("SELECT diff FROM audit_log WHERE object_id = ? AND action = 'campaign.approve'", [p.id]))[0]!;
    expect(audit.diff).toContain('price_snapshot');

    // doi bang gia: TV gio cao diem 40 -> 70 (co hieu luc ngay)
    const cur = (await fin.json('GET', '/admin/v1/rate-cards?current=1&screen_type=tv&daypart=peak&region_id=*&page_size=5')).body.items[0];
    const rev = await fin.json('PUT', `/admin/v1/rate-cards/${cur.id}`, { price_vnd: '70', floor_vnd: '20' });
    expect(rev.status).toBe(201);
    const after = await admin.json('GET', `/admin/v1/campaigns/${p.id}/quote`);
    expect(after.body.locked).toBe(true);
    expect(after.body.lines.find((l: any) => l.daypart === 'peak' && l.region_id === '*').unit_price_micro_vnd).toBe(vnd(40)); // gia chot khong doi
    const rows2 = await env.rt.db.query<any>('SELECT unit_price_micro_vnd FROM campaign_prices WHERE campaign_id = ? AND daypart = ? AND region_id = ?', [p.id, 'peak', '*']);
    expect(Number(rows2[0].unit_price_micro_vnd)).toBe(vnd(40));
    // chien dich moi (chua duyet) thay gia moi
    const q1 = await lan.json('GET', '/portal/v1/pricing/quote?screen_type=tv');
    expect(q1.body.lines.find((l: any) => l.daypart === 'peak' && l.region_id === '*').unit_price_micro_vnd).toBe(vnd(70));
  });

  it('hop dong dang hieu luc co gia thoa thuan ghi de bang gia; thap hon san thi bi nang len san; chi nguoi co quyen tai chinh moi dat gia', async () => {
    const ct = (await env.rt.db.query<{ id: string }>("SELECT id FROM contracts WHERE customer_id = ? AND state = 'active' ORDER BY id LIMIT 1", [K001]))[0]!;
    await env.rt.db.run("UPDATE contracts SET start_date = '2026-01-01', end_date = '2027-12-31' WHERE id = ?", [ct.id]);
    expect((await cm.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'tv', impression_price_micro_vnd: vnd(33) })).status).toBe(403);
    const line = await admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'tv', daypart: 'peak', impression_price_micro_vnd: vnd(33) });
    expect(line.status).toBe(201);
    const c = await admin.json('POST', '/admin/v1/campaigns', { customer_id: K001, name: 'Gia hop dong', budget_vnd: 3_000_000, screen_type: 'tv' });
    expect(c.status).toBe(201);
    const q = await admin.json('GET', `/admin/v1/campaigns/${c.body.id}/quote`);
    const peak = q.body.lines.find((l: any) => l.daypart === 'peak' && l.region_id === '*');
    const off = q.body.lines.find((l: any) => l.daypart === 'off_peak' && l.region_id === '*');
    expect(peak).toMatchObject({ unit_price_micro_vnd: vnd(33), source: 'contract', source_ref: line.body.id });
    expect(off.source).not.toBe('contract'); // dong hop dong chi cho gio cao diem
    // khach thay gia (33) nhung khong thay nguon
    const qc = await lan.json('GET', `/portal/v1/pricing/quote?screen_type=tv`);
    expect(qc.body.lines.find((l: any) => l.daypart === 'peak' && l.region_id === '*')).toMatchObject({ unit_price_micro_vnd: vnd(33) });
    // gia thoa thuan 1 d < san: bi nang len san
    await admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'tv', daypart: 'off_peak', region_id: null, impression_price_micro_vnd: vnd(1) });
    const q2 = await admin.json('GET', `/admin/v1/campaigns/${c.body.id}/quote`);
    const off2 = q2.body.lines.find((l: any) => l.daypart === 'off_peak' && l.region_id === '*');
    expect(off2).toMatchObject({ floored: true, source: 'contract' });
    expect(off2.unit_price_micro_vnd).toBe(off2.floor_micro_vnd);
    expect(off2.unit_price_micro_vnd).toBeGreaterThan(vnd(1));
    const detail = await admin.json('GET', `/admin/v1/contracts/${ct.id}`);
    expect(detail.body.lines.some((l: any) => l.impression_price_micro_vnd === vnd(33))).toBe(true);
  });
});

describe('production: bang gia rong => tu choi ro rang', () => {
  it('khong co dong bang gia (AMS_ENV=production): gui duyet va duyet deu 422 no_rate_card; tao bang gia xong thi gui duoc', async () => {
    const env2 = await setup({ finance: fakeFinance });
    try {
      const a2 = await login(env2, env2.byRole('super_admin'));
      await env2.rt.db.run('DELETE FROM rate_cards');
      await env2.rt.db.run('DELETE FROM campaign_prices');
      (env2.rt.config.env as Record<string, string>)['AMS_ENV'] = 'production';
      const pending = (await a2.json('GET', '/admin/v1/campaigns?filter=status:pending&page_size=5')).body.items[0];
      const ap = await a2.json('POST', `/admin/v1/campaigns/${pending.id}/approve`);
      expect(ap.status).toBe(422);
      expect(ap.body.error.code).toBe('no_rate_card');
      expect(ap.body.error.message).toMatch(/bảng giá/);
      expect((await env2.rt.db.query('SELECT 1 AS x FROM campaign_prices WHERE campaign_id = ?', [pending.id])).length).toBe(0);
      expect((await env2.rt.db.query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [pending.id]))[0]!.state).toBe('pending_review'); // khong doi trang thai
      const draft = (await a2.json('GET', '/admin/v1/campaigns?filter=status:draft&page_size=5')).body.items[0];
      const sub = await a2.json('POST', `/admin/v1/campaigns/${draft.id}/submit`, { content_rights_confirmed: true });
      expect(sub.status).toBe(422);
      expect(sub.body.error.code).toBe('no_rate_card');
      const quote = await a2.json('GET', `/admin/v1/campaigns/${draft.id}/quote`);
      expect(quote.body).toMatchObject({ status: 'unavailable', lines: [] });
      // dat bang gia mac dinh dau tien
      const f2 = await login(env2, env2.byRole('finance'));
      expect((await f2.json('POST', '/admin/v1/rate-cards', { price_vnd: '30', floor_vnd: '15', note: 'gia dau tien' })).status).toBe(201);
      expect((await a2.json('POST', `/admin/v1/campaigns/${draft.id}/submit`, { content_rights_confirmed: true })).status).toBe(200);
      const ap2 = await a2.json('POST', `/admin/v1/campaigns/${pending.id}/approve`);
      expect(ap2.status).toBe(200);
      const snap = await env2.rt.db.query<any>('SELECT source, unit_price_micro_vnd FROM campaign_prices WHERE campaign_id = ?', [pending.id]);
      expect(snap.length).toBe(2);
      expect(snap.every((r: any) => r.source === 'default_card' && Number(r.unit_price_micro_vnd) === vnd(30))).toBe(true);
    } finally {
      await env2.rt.close();
    }
  }, 60_000);
});
