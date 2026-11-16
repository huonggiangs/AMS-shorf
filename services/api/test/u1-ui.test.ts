// u1-ui: dong gia hop dong (list/them/sua/xoa, CPM, ngay hieu luc, RBAC, IDOR, audit) + hang duyet creative (phan trang, phien ban noi dung, audit).
import { beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';
import { bumpContentVersion } from '../src/lib/creative-security.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const vnd = (n: number) => n * 1_000_000;
let env: Env;
let admin: Session;
let fin: Session;
let cm: Session;
let lan: Session;
let ct: { id: string; customer_id: string };
let ct2: { id: string };

beforeAll(async () => {
  env = await setup();
  admin = await login(env, env.byRole('super_admin'));
  fin = await login(env, env.byRole('finance'));
  cm = await login(env, env.byRole('content_manager'));
  lan = await login(env, 'lan@vinamilk.example');
  const cts = await env.rt.db.query<{ id: string; customer_id: string }>("SELECT id, customer_id FROM contracts WHERE state = 'active' ORDER BY id LIMIT 2");
  ct = cts[0]!;
  ct2 = cts[1]!;
  await env.rt.db.run("UPDATE contracts SET start_date = '2026-01-01', end_date = '2027-12-31' WHERE id IN (?, ?)", [ct.id, ct2.id]);
}, 120_000);

const lines = async (s: Session, id = ct.id) => s.json('GET', `/admin/v1/contracts/${id}/lines`);
const audits = async (action: string, objectId: string) => env.rt.db.query<{ diff: string }>('SELECT diff FROM audit_log WHERE action = ? AND object_id = ?', [action, objectId]);

describe('dong gia hop dong: API', () => {
  it('RBAC: finance:view xem, finance:approve ghi; noi dung/khach khong vao', async () => {
    expect((await lines(fin)).status).toBe(200);
    expect((await lines(cm)).status).toBe(403);
    expect((await lan.req('GET', `/admin/v1/contracts/${ct.id}/lines`)).status).toBe(403);
    const body = { screen_type: 'tv', daypart: 'peak', price_micro_vnd: vnd(30) };
    expect((await cm.json('POST', `/admin/v1/contracts/${ct.id}/lines`, body)).status).toBe(403);
    expect((await lan.req('POST', `/admin/v1/contracts/${ct.id}/lines`, body)).status).toBe(403);
    expect((await cm.json('PUT', `/admin/v1/contracts/${ct.id}/lines/x`, body)).status).toBe(403);
    expect((await cm.json('DELETE', `/admin/v1/contracts/${ct.id}/lines/x`)).status).toBe(403);
  });

  it('them dong co dinh + CPM (lam tron len), ngay hieu luc, audit; list tra mo hinh va gia', async () => {
    const a = await admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'tv', daypart: 'peak', price_micro_vnd: vnd(33), effective_from: '2026-02-01', effective_to: '2027-06-30' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ impression_price_micro_vnd: vnd(33), model: 'fixed', effective_from: '2026-02-01', effective_to: '2027-06-30' });
    const b = await admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'led_p5', price_model: 'cpm', price_micro_vnd: 33_333_333_333 }); // CPM 33.333,333333 d
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ model: 'cpm', cpm_micro_vnd: 33_333_333_333, impression_price_micro_vnd: 33_333_334 }); // ceil
    const old = await admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'elevator', impression_price_micro_vnd: vnd(50) }); // truong cu van dung duoc
    expect(old.status).toBe(201);
    const l = await lines(fin);
    expect(l.body.editable).toBe(true);
    expect(l.body.items.find((x: any) => x.id === b.body.id)).toMatchObject({ model: 'cpm', cpm_vnd: '33333.333333', impression_price_vnd: '33.333334' });
    expect(l.body.items.find((x: any) => x.id === old.body.id)).toMatchObject({ model: 'fixed', cpm_micro_vnd: null, effective_from: null });
    expect((await audits('contract.line_price', ct.id)).length).toBeGreaterThanOrEqual(3);
  });

  it('kiem tra hop le: gia, ngay, ngoai thoi han hop dong, thieu gia', async () => {
    const base = { screen_type: 'tv', price_micro_vnd: vnd(10) };
    const post = (extra: object) => admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { ...base, ...extra });
    expect((await post({ price_micro_vnd: 0 })).status).toBe(422);
    expect((await post({ price_micro_vnd: -5 })).status).toBe(422);
    expect((await post({ price_micro_vnd: 1.5 })).status).toBe(422);
    expect((await post({ price_micro_vnd: 2e12 })).status).toBe(422);
    expect((await post({ screen_type: 'radio' })).status).toBe(422);
    expect((await post({ daypart: 'night' })).status).toBe(422);
    expect((await post({ effective_from: '2026-13-01' })).status).toBe(422);
    const rev = await post({ effective_from: '2026-05-01', effective_to: '2026-04-01' });
    expect(rev.status).toBe(422);
    expect(rev.body.error.code).toBe('line_bad_dates');
    const out = await post({ effective_from: '2025-01-01' });
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe('line_outside_term');
    const none = await admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'tv' });
    expect(none.body.error.code).toBe('price_required');
  });

  it('sua dong: doi gia/mo hinh/ngay, audit co truoc-sau; IDOR: dong cua hop dong khac => 404', async () => {
    const a = await admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'tv', daypart: 'off_peak', price_micro_vnd: vnd(20) });
    const u = await fin.json('PUT', `/admin/v1/contracts/${ct.id}/lines/${a.body.id}`, { screen_type: 'tv', daypart: 'off_peak', price_model: 'cpm', price_micro_vnd: vnd(24_000), effective_to: '2027-01-31' });
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ model: 'cpm', cpm_micro_vnd: vnd(24_000), impression_price_micro_vnd: vnd(24), effective_to: '2027-01-31' });
    const au = await audits('contract.line_update', ct.id);
    expect(au.length).toBe(1);
    expect(JSON.parse(au[0]!.diff)).toMatchObject({ line_id: a.body.id, impression_price_micro_vnd: { from: vnd(20), to: vnd(24) }, model: { from: 'fixed', to: 'cpm' } });
    // IDOR: sua/xoa dong cua ct qua URL cua ct2
    expect((await admin.json('PUT', `/admin/v1/contracts/${ct2.id}/lines/${a.body.id}`, { screen_type: 'tv', price_micro_vnd: 1 })).status).toBe(404);
    expect((await admin.json('DELETE', `/admin/v1/contracts/${ct2.id}/lines/${a.body.id}`)).status).toBe(404);
    expect((await lines(admin, ct.id)).body.items.some((x: any) => x.id === a.body.id)).toBe(true);
    expect((await admin.json('PUT', `/admin/v1/contracts/${ct.id}/lines/khong-co`, { screen_type: 'tv', price_micro_vnd: 1 })).status).toBe(404);
    expect((await admin.json('GET', '/admin/v1/contracts/khong-co/lines')).status).toBe(404);
  });

  it('xoa dong: bien mat khoi list, xoa bang phu, audit; hop dong da ket thuc khong sua duoc', async () => {
    const a = await admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'tv', price_micro_vnd: vnd(12) });
    expect((await fin.json('DELETE', `/admin/v1/contracts/${ct.id}/lines/${a.body.id}`)).status).toBe(200);
    expect((await lines(admin)).body.items.some((x: any) => x.id === a.body.id)).toBe(false);
    for (const t of ['contract_line_prices', 'contract_line_terms']) expect((await env.rt.db.query(`SELECT 1 FROM ${t} WHERE contract_line_id = ?`, [a.body.id])).length).toBe(0);
    expect((await audits('contract.line_delete', ct.id)).length).toBe(1);
    expect((await admin.json('DELETE', `/admin/v1/contracts/${ct.id}/lines/${a.body.id}`)).status).toBe(404);
    await env.rt.db.run("UPDATE contracts SET state = 'expired' WHERE id = ?", [ct2.id]);
    expect((await admin.json('POST', `/admin/v1/contracts/${ct2.id}/lines`, { screen_type: 'tv', price_micro_vnd: vnd(5) })).status).toBe(409);
    expect((await lines(admin, ct2.id)).body.editable).toBe(false);
  });

  it('ngay hieu luc cua dong ap vao bao gia: dong chua toi ngay / da qua ngay khong ghi de bang gia', async () => {
    const c = await admin.json('POST', '/admin/v1/campaigns', { customer_id: ct.customer_id, name: 'Gia dong hieu luc', budget_vnd: 3_000_000, screen_type: 'tv' });
    const cid = c.body.id;
    await env.rt.db.run('UPDATE campaigns SET contract_id = ? WHERE id = ?', [ct.id, cid]);
    await env.rt.db.run('DELETE FROM contract_lines WHERE contract_id = ?', [ct.id]);
    const pk = async () => (await admin.json('GET', `/admin/v1/campaigns/${cid}/quote`)).body.lines.find((l: any) => l.daypart === 'peak' && l.region_id === '*');
    const ok = await admin.json('POST', `/admin/v1/contracts/${ct.id}/lines`, { screen_type: 'tv', daypart: 'peak', price_micro_vnd: vnd(77), effective_from: '2026-11-01', effective_to: '2026-12-31' }); // NOW = 2026-11-12
    expect(await pk()).toMatchObject({ source: 'contract', unit_price_micro_vnd: vnd(77) });
    await admin.json('PUT', `/admin/v1/contracts/${ct.id}/lines/${ok.body.id}`, { screen_type: 'tv', daypart: 'peak', price_micro_vnd: vnd(77), effective_from: '2026-12-01' });
    expect((await pk()).source).not.toBe('contract');
    await admin.json('PUT', `/admin/v1/contracts/${ct.id}/lines/${ok.body.id}`, { screen_type: 'tv', daypart: 'peak', price_micro_vnd: vnd(77), effective_to: '2026-11-11' });
    expect((await pk()).source).not.toBe('contract');
  });
});

describe('hang duyet creative (scan-review)', () => {
  let ids: string[];
  beforeAll(async () => {
    ids = (await env.rt.db.query<{ id: string }>('SELECT id FROM creatives ORDER BY id LIMIT 4')).map((x) => x.id);
    for (const id of ids) {
      await env.rt.db.run("UPDATE creatives SET scan_state = 'needs_manual_review' WHERE id = ?", [id]);
      await env.rt.db.run("INSERT INTO creative_validation (creative_id, engine, verdict, detail, sha256, checked_at) VALUES (?,?,?,?,NULL,?) ON CONFLICT (creative_id) DO UPDATE SET detail = excluded.detail", [id, 'cf-validator-v1', 'needs_manual_review', JSON.stringify({ reasons: ['png_trailing_data'] }), '2026-11-12T00:00:00Z']);
    }
  });

  it('chi media:approve; phan trang, co ten khach, phien ban noi dung, ly do', async () => {
    expect((await lan.req('GET', '/admin/v1/media/scan-review/queue')).status).toBe(403);
    expect((await fin.json('GET', '/admin/v1/media/scan-review/queue')).status).toBe(403);
    const p1 = await admin.json('GET', '/admin/v1/media/scan-review/queue?page=1&page_size=3');
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ total: 4, page: 1, page_size: 3 });
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.items[0]).toMatchObject({ scan_state: 'needs_manual_review', content_version: 1, reasons: ['png_trailing_data'] });
    expect(typeof p1.body.items[0].customer_name).toBe('string');
    const p2 = await admin.json('GET', '/admin/v1/media/scan-review/queue?page=2&page_size=3');
    expect(p2.body.items).toHaveLength(1);
    expect(p1.body.items.some((x: any) => x.id === p2.body.items[0].id)).toBe(false);
    expect((await admin.json('GET', '/admin/v1/media/scan-review/queue?page=abc&page_size=9999')).status).toBe(200); // tham so hong => mac dinh
  });

  it('quyet dinh gan phien ban: noi dung doi => 409 content_changed; dung phien ban => duyet / tu choi co audit', async () => {
    const [a, b] = ids as [string, string];
    await bumpContentVersion(env.rt.db, a, '2026-11-12T03:00:00Z');
    const stale = await admin.json('POST', `/admin/v1/media/${a}/scan-review`, { decision: 'approve', note: 'da xem tay', content_version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('content_changed');
    const q = await admin.json('GET', '/admin/v1/media/scan-review/queue?page_size=100');
    expect(q.body.items.find((x: any) => x.id === a).content_version).toBe(2);
    expect((await admin.json('POST', `/admin/v1/media/${a}/scan-review`, { decision: 'approve', note: 'da xem tay', content_version: 2 })).status).toBe(200);
    expect((await admin.json('POST', `/admin/v1/media/${b}/scan-review`, { decision: 'reject', note: '' })).status).toBe(422); // ly do bat buoc
    expect((await admin.json('POST', `/admin/v1/media/${b}/scan-review`, { decision: 'reject', note: 'co du lieu la', content_version: 1 })).status).toBe(200);
    const au = await audits('media.scan_review.reject', b);
    expect(JSON.parse(au[0]!.diff)).toMatchObject({ content_version: 1, note: 'co du lieu la' });
    const q2 = await admin.json('GET', '/admin/v1/media/scan-review/queue?page_size=100');
    expect(q2.body.total).toBe(2);
  });
});
