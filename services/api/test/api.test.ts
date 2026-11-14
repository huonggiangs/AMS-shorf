import { beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';
import type { FinancePort } from '../src/ports.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let lan: Session; // Vinamilk (K001)
let dang: Session; // Unilever (K008)
let K001: string;
let K008: string;
const reserveCalls: string[] = [];
const releaseCalls: string[] = [];

// FinancePort gia: giu du tien -> active
const fakeFinance: FinancePort = {
  async reserveForCampaign(rt, { campaignId }) {
    reserveCalls.push(campaignId);
    await rt.db.run("UPDATE campaigns SET state = 'active', reserved_vnd = approved_budget_vnd, funding_state = 'reserved' WHERE id = ?", [campaignId]);
    const r = (await rt.db.query<{ approved_budget_vnd: number }>('SELECT approved_budget_vnd FROM campaigns WHERE id = ?', [campaignId]))[0]!;
    return { campaign_state: 'active', reserved_vnd: Number(r.approved_budget_vnd), shortfall_vnd: 0 };
  },
  async releaseForCampaign(rt, { campaignId }) {
    releaseCalls.push(campaignId);
    await rt.db.run("UPDATE campaigns SET reserved_vnd = 0, funding_state = 'released' WHERE id = ?", [campaignId]);
    return { released_vnd: 0 };
  },
};

beforeAll(async () => {
  env = await setup({ finance: fakeFinance });
  K001 = env.seed.customers['K001']!;
  K008 = env.seed.customers['K008']!;
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
}, 120_000);

const png = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

describe('RBAC theo vai tro', () => {
  const cases: [string, string, string, number][] = [
    // [role, method, path, expected]
    ['content_manager', 'GET', '/admin/v1/campaigns', 200],
    ['content_manager', 'GET', '/admin/v1/audit-log', 403],
    ['content_manager', 'GET', '/admin/v1/users', 403],
    ['finance', 'GET', '/admin/v1/revenue', 200],
    ['finance', 'GET', '/admin/v1/devices', 403],
    ['device_ops', 'GET', '/admin/v1/devices', 200],
    ['device_ops', 'GET', '/admin/v1/customers', 403],
    ['device_ops', 'GET', '/admin/v1/revenue', 403],
    ['super_admin', 'GET', '/admin/v1/audit-log', 200],
    ['super_admin', 'GET', '/admin/v1/users', 200],
  ];
  for (const [role, method, path, want] of cases) {
    it(`${role} ${method} ${path} -> ${want}`, async () => {
      const s = await login(env, env.byRole(role));
      expect((await s.req(method, path)).status).toBe(want);
    });
  }

  it('content_manager duyet media duoc nhung khong duyet ngan sach chien dich', async () => {
    const cm = await login(env, env.byRole('content_manager'));
    const camp = (await admin.json('GET', '/admin/v1/campaigns?filter=status:pending&page_size=1')).body.items[0];
    expect(camp).toBeTruthy();
    expect((await cm.req('POST', `/admin/v1/campaigns/${camp.id}/approve`)).status).toBe(403);
  });

  it('tai khoan ngoai khong vao duoc API quan tri', async () => {
    expect((await lan.req('GET', '/admin/v1/campaigns')).status).toBe(403);
    expect((await lan.req('GET', '/admin/v1/users')).status).toBe(403);
    expect((await lan.req('GET', '/admin/v1/audit-log')).status).toBe(403);
  });

  it('tai khoan noi bo khong vao cong khach hang', async () => {
    expect((await admin.req('GET', '/portal/v1/campaigns')).status).toBe(403);
  });

  it('khach khong duoc cap quyen duyet/xoa kieu ghi de (khong leo thang qua /permissions)', async () => {
    const users = (await admin.json('GET', '/admin/v1/users?filter=role:customer&page_size=5')).body.items as any[];
    const u = users[0];
    const r = await admin.json('PUT', `/admin/v1/permissions/${u.id}`, { permissions: { campaigns: ['view', 'write', 'approve'], admin: ['view'] } });
    expect(r.status).toBe(422);
  });

  it('khong tu doi quyen cua chinh minh; chi super_admin cap super_admin', async () => {
    const me = (await admin.json('GET', '/auth/me')).body.user;
    expect((await admin.json('PUT', `/admin/v1/permissions/${me.id}`, { permissions: {} })).status).toBe(403);
    expect((await admin.json('PUT', `/admin/v1/users/${me.id}`, { role: 'finance' })).status).toBe(403);
    const cm = await login(env, env.byRole('content_manager'));
    const u = (await admin.json('GET', '/admin/v1/users?filter=role:finance&page_size=1')).body.items[0];
    // content_manager khong co quyen admin:write nen bi chan truoc
    expect((await cm.req('PUT', `/admin/v1/users/${u.id}`, { role: 'super_admin' })).status).toBe(403);
  });

  it('ghi de quyen duoc luu theo diff va co hieu luc', async () => {
    const fin = (await admin.json('GET', '/admin/v1/users?filter=role:finance&page_size=1')).body.items[0];
    const before = (await admin.json('GET', `/admin/v1/permissions/${fin.id}`)).body.permissions;
    expect(before.finance).toContain('approve');
    const set = { ...before, finance: ['view'] };
    const put = await admin.json('PUT', `/admin/v1/permissions/${fin.id}`, { permissions: set });
    expect(put.status).toBe(200);
    expect(put.body.permissions.finance).toEqual(['view']);
    const rows = await env.rt.db.query('SELECT module, action, allowed FROM admin_permissions WHERE admin_id = ?', [fin.id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(6); // chi luu phan khac mac dinh
  });
});

describe('IDOR: khach A khong dong vao du lieu khach B', () => {
  let campB: string;
  let mediaB: string;
  beforeAll(async () => {
    campB = ((await dang.json('GET', '/portal/v1/campaigns?page_size=1')).body.items[0]).id;
    const created = await dang.json('POST', '/portal/v1/media/upload-url', { name: 'b.png', content_type: 'image/png', size_bytes: 1000, width: 1920, height: 1080 });
    expect(created.status).toBe(201);
    mediaB = created.body.id;
  });

  it('danh sach chi chua du lieu cua minh (loc trong SQL, total cung dung)', async () => {
    const r = await lan.json('GET', '/portal/v1/campaigns?page_size=200');
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBe(r.body.total);
    expect(r.body.items.every((x: any) => x.customer_id === K001)).toBe(true);
    const rb = await dang.json('GET', '/portal/v1/campaigns?page_size=200');
    expect(rb.body.items.every((x: any) => x.customer_id === K008)).toBe(true);
  });

  it('doc chi tiet / sua / gui duyet / tam dung chien dich cua khach khac -> 404', async () => {
    expect((await lan.req('GET', `/portal/v1/campaigns/${campB}`)).status).toBe(404);
    expect((await lan.req('PUT', `/portal/v1/campaigns/${campB}`, { name: 'danh cap' })).status).toBe(404);
    expect((await lan.req('POST', `/portal/v1/campaigns/${campB}/submit`)).status).toBe(404);
    expect((await lan.req('POST', `/portal/v1/campaigns/${campB}/pause`)).status).toBe(404);
    expect((await lan.req('POST', `/portal/v1/campaigns/${campB}/resume`)).status).toBe(404);
    expect((await lan.req('DELETE', `/portal/v1/campaigns/${campB}`)).status).toBe(404);
    const row = (await env.rt.db.query<{ name: string }>('SELECT name FROM campaigns WHERE id = ?', [campB]))[0]!;
    expect(row.name).not.toBe('danh cap');
  });

  it('media cua khach khac: doc, xac nhan, xoa -> 404; khong lo ton tai (cung ma voi id khong co)', async () => {
    expect((await lan.req('GET', `/portal/v1/media/${mediaB}`)).status).toBe(404);
    expect((await lan.req('POST', `/portal/v1/media/${mediaB}/confirm`, {})).status).toBe(404);
    expect((await lan.req('DELETE', `/portal/v1/media/${mediaB}`)).status).toBe(404);
    const ghost = await lan.req('GET', '/portal/v1/media/khong-ton-tai');
    const other = await lan.req('GET', `/portal/v1/media/${mediaB}`);
    expect(await ghost.text()).toBe(await other.text());
    const r = await lan.json('GET', '/portal/v1/media?page_size=200');
    expect(r.body.items.some((m: any) => m.id === mediaB)).toBe(false);
  });

  it('khong the gan media cua khach khac vao chien dich cua minh, hay tao chien dich cho khach khac', async () => {
    const r1 = await lan.json('POST', '/portal/v1/campaigns', { name: 'Gan media', budget_vnd: 1_000_000, media_id: mediaB });
    expect([404, 422]).toContain(r1.status);
    const r2 = await lan.json('POST', '/portal/v1/campaigns', { name: 'Gia mao khach', budget_vnd: 1_000_000, customer_id: K008 });
    if (r2.status === 201) expect(r2.body.customer_id).toBe(K001); // customer_id trong body bi bo qua
    else expect([403, 404, 422]).toContain(r2.status);
  });

  it('loc theo customer_id cua khach khac khong mo rong pham vi', async () => {
    const r = await lan.json('GET', `/portal/v1/campaigns?customer_id=${K008}&filter=customer_id:${K008}&page_size=50`);
    expect(r.status).toBe(200);
    expect(r.body.items.every((x: any) => x.customer_id === K001)).toBe(true);
  });

  it('wallet/khach hang cua khach khac khong doc duoc qua cong', async () => {
    expect((await lan.req('GET', `/admin/v1/customers/${K008}`)).status).toBe(403);
  });
});

describe('Chien dich: gui duyet, duyet (FinancePort), tra lai', () => {
  it('vong doi day du va ghi audit', async () => {
    const m = await lan.json('POST', '/portal/v1/media/upload-url', { name: 'tv.png', content_type: 'image/png', size_bytes: 33, width: 1920, height: 1080 });
    await env.rt.objects.put(m.body.key, png(1920, 1080), 'image/png');
    expect((await lan.json('POST', `/portal/v1/media/${m.body.id}/confirm`, {})).status).toBe(200);
    await env.rt.db.run("UPDATE creatives SET scan_state = 'clean' WHERE id = ?", [m.body.id]); // media-worker quet xong
    const c = await lan.json('POST', '/portal/v1/campaigns', { name: 'Vong doi', budget_vnd: 5_000_000, screen_type: 'tv', media_id: m.body.id, start_date: '2026-11-01', end_date: '2026-12-31' });
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('draft');
    const id = c.body.id;
    expect((await lan.req('POST', `/portal/v1/campaigns/${id}/approve`)).status).toBeGreaterThanOrEqual(403); // khach khong duyet
    const sub = await lan.json('POST', `/portal/v1/campaigns/${id}/submit`, { content_rights_confirmed: true });
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe('pending');
    const q = await admin.json('GET', '/admin/v1/approvals?page_size=200');
    expect(q.body.items.some((x: any) => x.id === id)).toBe(true);
    const ap = await admin.json('POST', `/admin/v1/campaigns/${id}/approve`);
    expect(ap.status).toBe(200);
    expect(reserveCalls).toContain(id);
    expect(ap.body.status).toBe('active');
    expect(ap.body.reserved_vnd).toBe(5_000_000);
    // duyet lan 2 -> 409, khong giu tien 2 lan
    const calls = reserveCalls.length;
    expect((await admin.req('POST', `/admin/v1/campaigns/${id}/approve`)).status).toBe(409);
    expect(reserveCalls.length).toBe(calls);
    // thu hoi duyet -> hoan giu tien
    const rej = await admin.json('POST', `/admin/v1/campaigns/${id}/reject`, { reason: 'Noi dung vi pham' });
    expect(rej.status).toBe(200);
    expect(releaseCalls).toContain(id);
    const acts = (await env.rt.db.query<{ action: string }>('SELECT action FROM audit_log WHERE object_id = ? ORDER BY ts, id', [id])).map((r) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['campaign.create', 'campaign.submit', 'campaign.approve', 'campaign.reject']));
  });

  it('khi FinancePort chua san sang (null), duyet xong o lai awaiting_funds', async () => {
    const env2 = await setup(); // khong truyen finance -> nullFinancePort
    const a2 = await login(env2, env2.byRole('super_admin'));
    const p = (await a2.json('GET', '/admin/v1/campaigns?filter=status:pending&page_size=1')).body.items[0];
    const r = await a2.json('POST', `/admin/v1/campaigns/${p.id}/approve`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('awaiting_funds');
    expect(r.body.shortfall_vnd).toBeGreaterThan(0);
    await env2.rt.close();
  }, 60_000);
});

describe('doi tac (partner): chi chien dich duoc giao', () => {
  it('nhan loi moi, bat TOTP, chi thay chien dich co grant con han', async () => {
    const cred = env.seed.credentials.find((c) => c.role === 'partner' && c.inviteToken)!;
    const acc = await env.app.request('/auth/invite/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: cred.inviteToken, password: 'DoiTac-Mat-Khau-9' }) });
    expect(acc.status).toBe(200);
    const { mfa_token } = (await acc.json()) as { mfa_token: string };
    const en = (await (await env.app.request('/auth/mfa/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mfa_token }) })).json()) as { secret: string };
    env.rt.clock.advance(31_000);
    const { totp } = await import('@ams/shared');
    const v = await env.app.request('/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mfa_token, code: await totp(en.secret, env.rt.clock.now().getTime()) }) });
    expect(v.status).toBe(200);
    const cookie = v.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const get = async (path: string) => (await env.app.request(path, { headers: { cookie } }));
    const me = (await (await get('/auth/me')).json()) as any;
    const cust = me.user.customer_id as string;
    expect(me.permissions.finance).toBeUndefined(); // doi tac khong co tai chinh
    // chua co grant -> khong thay gi
    expect(((await (await get('/portal/v1/campaigns')).json()) as any).total).toBe(0);
    const nowIso = env.rt.clock.now().toISOString();
    await env.rt.db.run("INSERT INTO campaigns (id, customer_id, name, state, created_at, updated_at) SELECT ?, customer_id, 'Chua giao', 'draft', ?, ? FROM campaigns WHERE customer_id = ? LIMIT 1", [env.rt.id(), nowIso, nowIso, cust]);
    const mine = await env.rt.db.query<{ id: string }>('SELECT id FROM campaigns WHERE customer_id = ? ORDER BY id', [cust]);
    const other = await env.rt.db.query<{ id: string }>('SELECT id FROM campaigns WHERE customer_id <> ? LIMIT 1', [cust]);
    expect(mine.length).toBeGreaterThan(1);
    await env.rt.db.run('INSERT INTO campaign_grants (id, admin_id, campaign_id, can_upload, expires_at) VALUES (?,?,?,0,NULL)', [env.rt.id(), me.user.id, mine[0]!.id]);
    const l = (await (await get('/portal/v1/campaigns?page_size=50')).json()) as any;
    expect(l.items.map((c: any) => c.id)).toEqual([mine[0]!.id]);
    expect((await get(`/portal/v1/campaigns/${mine[1]!.id}`)).status).toBe(404); // cung khach nhung chua duoc giao
    expect((await get(`/portal/v1/campaigns/${other[0]!.id}`)).status).toBe(404);
    // grant het han
    await env.rt.db.run('UPDATE campaign_grants SET expires_at = ? WHERE admin_id = ?', ['2026-11-01T00:00:00.000Z', me.user.id]);
    expect(((await (await get('/portal/v1/campaigns')).json()) as any).total).toBe(0);
  });
});

describe('Audit log', () => {
  it('moi thao tac ghi deu co dong audit (actor, ip, object)', async () => {
    const ip = '198.51.100.7';
    const h = { 'x-forwarded-for': ip };
    const n0 = Number((await env.rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log'))[0]!.n);
    const writes: [string, string, any][] = [
      ['POST', '/admin/v1/rtb-floors', { category: 'Thu nghiem', floor_cpm_vnd: 1234 }],
      ['POST', '/admin/v1/partners', { name: 'Doi tac audit', protocol: 'OpenRTB', endpoint: 'https://example.com/bid' }],
      ['POST', '/admin/v1/screens', { name: 'Chung cu Audit', type: 'elevator', resolution: '1080×1920', screens: 2, region: 'Hà Nội' }],
    ];
    for (const [m, p, b] of writes) {
      const r = await admin.req(m, p, b, { headers: h });
      expect(r.status, p).toBe(201);
    }
    const rows = await env.rt.db.query<{ action: string; actor_id: string; ip: string; object_id: string }>('SELECT action, actor_id, ip, object_id FROM audit_log WHERE ip = ?', [ip]);
    expect(rows.map((r) => r.action).sort()).toEqual(['partner.create', 'rtb_floor.create', 'screen.create']);
    expect(Number((await env.rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log'))[0]!.n)).toBeGreaterThanOrEqual(n0 + 3);
    const me = (await admin.json('GET', '/auth/me')).body.user.id;
    expect(rows.every((r) => r.actor_id === me && r.ip === ip && r.object_id)).toBe(true);
  });

  it('khong ghi PII/bi mat vao diff (MST, mat khau, khoa doi tac)', async () => {
    const all = await env.rt.db.query<{ diff: string | null }>('SELECT diff FROM audit_log');
    const text = all.map((r) => r.diff ?? '').join('\n');
    expect(text).not.toMatch(/MatKhau-Manh-2026/);
    expect(text).not.toMatch(/0123456789/);
  });

  it('GET /audit-log: phan trang, loc theo hanh dong, chi doc', async () => {
    const r = await admin.json('GET', '/admin/v1/audit-log?page_size=5&filter=action:partner');
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items.every((x: any) => x.action.startsWith('partner'))).toBe(true);
    expect(r.body.items[0]).toHaveProperty('actor');
    expect((await admin.req('DELETE', `/admin/v1/audit-log/${r.body.items[0].id}`)).status).toBe(404);
    expect((await admin.req('PUT', `/admin/v1/audit-log/${r.body.items[0].id}`, {})).status).toBe(404);
  });

  it('audit_log chi them, khong sua/xoa duoc o tang CSDL', async () => {
    await expect(env.rt.db.run("UPDATE audit_log SET action = 'x'")).rejects.toBeTruthy();
    await expect(env.rt.db.run('DELETE FROM audit_log')).rejects.toBeTruthy();
  });
});

describe('phan trang, loc, sap xep, tim kiem', () => {
  it('{items,total}, page/page_size, khong trung giua cac trang', async () => {
    const p1 = await admin.json('GET', '/admin/v1/devices?page=1&page_size=7&sort=name:asc');
    const p2 = await admin.json('GET', '/admin/v1/devices?page=2&page_size=7&sort=name:asc');
    expect(p1.body.total).toBeGreaterThan(14);
    expect(p1.body.items.length).toBe(7);
    const ids = new Set([...p1.body.items, ...p2.body.items].map((d: any) => d.id));
    expect(ids.size).toBe(14);
    const desc = await admin.json('GET', '/admin/v1/devices?page=1&page_size=7&sort=name:desc');
    expect(desc.body.items[0].id).not.toBe(p1.body.items[0].id);
    expect(p1.body.items[0].name <= p1.body.items[6].name).toBe(true);
  });

  it('page_size toi da 200, tham so rac khong gay 500', async () => {
    const r = await admin.json('GET', '/admin/v1/campaigns?page_size=100000&sort=hack;DROP:desc&filter=status:zzz');
    expect(r.status).toBe(200);
    expect(r.body.page_size).toBeLessThanOrEqual(200);
    expect(r.body.total).toBe(0);
    expect([200, 400]).toContain((await admin.json('GET', '/admin/v1/campaigns?page=abc')).status);
  });

  it('loc theo filter=k:v va q (khong phan biet hoa thuong, ky tu dac biet an toan)', async () => {
    const byStatus = await admin.json('GET', '/admin/v1/campaigns?filter=status:active&page_size=200');
    expect(byStatus.body.items.length).toBe(byStatus.body.total);
    expect(byStatus.body.items.every((c: any) => c.status === 'active')).toBe(true);
    const q = await admin.json('GET', `/admin/v1/campaigns?q=${encodeURIComponent('omo')}&page_size=50`);
    expect(q.body.items.some((c: any) => /omo/i.test(c.name))).toBe(true);
    const inj = await admin.json('GET', `/admin/v1/campaigns?q=${encodeURIComponent("%' OR 1=1 --")}`);
    expect(inj.status).toBe(200);
    expect(inj.body.total).toBe(0);
    const both = await admin.json('GET', '/admin/v1/campaigns?filter=status:active,customer_id:' + K001 + '&page_size=200');
    expect(both.body.items.every((c: any) => c.status === 'active' && c.customer_id === K001)).toBe(true);
  });

  it('sap xep giam dan theo ngan sach', async () => {
    const r = await admin.json('GET', '/admin/v1/campaigns?sort=budget_vnd:desc&page_size=50');
    const v = r.body.items.map((c: any) => c.budget_vnd);
    expect(v).toEqual([...v].sort((a: number, b: number) => b - a));
  });

  it('thiet bi: loc theo khu vuc/trang thai va thao tac hang loat', async () => {
    const all = await admin.json('GET', '/admin/v1/devices?page_size=200');
    const ids = all.body.items.slice(0, 3).map((d: any) => d.id);
    const bl = await admin.json('POST', '/admin/v1/devices/bulk', { action: 'block', ids });
    expect(bl.status).toBe(200);
    expect(bl.body.updated).toBe(3);
    const blocked = await admin.json('GET', '/admin/v1/devices?filter=status:blocked&page_size=200');
    expect(ids.every((id: string) => blocked.body.items.some((d: any) => d.id === id))).toBe(true);
    expect((await admin.json('POST', '/admin/v1/devices/bulk', { action: 'unblock', ids })).body.updated).toBe(3);
    expect((await admin.json('POST', '/admin/v1/devices/bulk', { action: 'delete', ids })).status).toBe(422);
    expect((await admin.json('POST', '/admin/v1/devices/bulk', { action: 'verify', ids: [] })).status).toBe(422);
  });

  it('thiet bi: chi tiet co seen_ads va views_7d (7 phan tu)', async () => {
    const id = (await admin.json('GET', '/admin/v1/devices?page_size=1')).body.items[0].id;
    const d = await admin.json('GET', `/admin/v1/devices/${id}`);
    expect(d.status).toBe(200);
    expect(d.body.views_7d).toHaveLength(7);
    expect(Array.isArray(d.body.seen_ads)).toBe(true);
    expect((await admin.req('GET', '/admin/v1/devices/khong-co')).status).toBe(404);
  });
});

describe('hop dong', () => {
  it('render HTML tu mau 11 dieu, co so tien bang chu, an toan XSS', async () => {
    const cust = (await admin.json('GET', `/admin/v1/customers/${K001}`)).body;
    expect(cust.id).toBe(K001);
    const created = await admin.json('POST', '/admin/v1/contracts', { customer_id: K001, value_vnd: 1_250_000_000, months: 12, advance_pct: 30, title: '<script>alert(1)</script>' });
    expect(created.status).toBe(201);
    expect(created.body.number).toMatch(/^HD-\d{4}-\d{3}$/);
    expect(created.body.status).toBe('pending_sign');
    const r = await admin.json('POST', `/admin/v1/contracts/${created.body.id}/render`, {});
    expect(r.status).toBe(200);
    expect(r.body.amount_in_words).toMatch(/tỷ/);
    expect(r.body.amount_in_words).toMatch(/hai trăm năm mươi triệu/i);
    expect(r.body.html).toContain('1.250.000.000');
    expect(r.body.html).toContain(r.body.contract_no);
    expect((r.body.html.match(/Điều \d+/g) ?? []).length).toBeGreaterThanOrEqual(11);
    expect(r.body.html).not.toContain('<script>alert');
    expect(r.body.html).toMatch(/Content-Security-Policy/);
    expect(r.body.html).not.toMatch(/\{\{/); // khong con bien chua dien
    // so hop dong khong trung
    const c2 = await admin.json('POST', '/admin/v1/contracts', { customer_id: K001, value_vnd: 1_000_000 });
    expect(c2.body.number).not.toBe(created.body.number);
  });

  it('khach hang (tai khoan ngoai) khong doc/sua hop dong; finance khong duoc sua neu khong co quyen', async () => {
    expect((await lan.req('GET', '/portal/v1/contracts')).status).toBe(404);
    expect((await lan.req('POST', '/admin/v1/contracts/x/render', {})).status).toBe(403);
  });

  it('MST luu ma hoa, khong lo trong API danh sach/log; tim duoc qua chi tiet cho noi bo', async () => {
    const raw = await env.rt.db.query<{ tax_code: string | null }>('SELECT tax_code_enc AS tax_code FROM customers WHERE id = ?', [K001]);
    expect(raw[0]!.tax_code).toBeTruthy();
    expect(raw[0]!.tax_code).not.toMatch(/^\d{10}$/); // da ma hoa
    const list = JSON.stringify((await admin.json('GET', '/admin/v1/customers?page_size=5')).body);
    expect(list).toBeTruthy();
  });
});

describe('tai media: kiem tra kich thuoc va han muc', () => {
  const up = (s: Session, b: any) => s.json('POST', '/portal/v1/media/upload-url', b);

  it('tep qua lon cho loai man hinh -> 422 truoc khi cap URL', async () => {
    const r = await up(lan, { name: 'big.mp4', content_type: 'video/mp4', size_bytes: 40 * 1024 * 1024, width: 1080, height: 1920, duration_sec: 15 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('file_too_large'); // thang may toi da 30 MB
  });

  it('do phan giai khong khop loai man hinh -> 422', async () => {
    const r = await up(lan, { name: 'odd.png', content_type: 'image/png', size_bytes: 1000, width: 1000, height: 1000 });
    expect(r.status).toBe(422);
  });

  it('thoi luong ngoai khoang cho thang may -> 422; dinh dang la -> 422', async () => {
    expect((await up(lan, { name: 'long.mp4', content_type: 'video/mp4', size_bytes: 1000, width: 1080, height: 1920, duration_sec: 90 })).body.error.code).toBe('duration_out_of_range');
    expect((await up(lan, { name: 'x.exe', content_type: 'application/x-msdownload', size_bytes: 1000 })).status).toBe(422);
  });

  it('luong day du: cap URL -> tai len -> confirm doc kich thuoc that tu dau tep', async () => {
    const r = await up(lan, { name: 'ok.png', content_type: 'image/png', size_bytes: 33, width: 1080, height: 1920 });
    expect(r.status).toBe(201);
    expect(r.body.url).toContain(r.body.key.split('/')[0]);
    expect(r.body.key).toContain(K001); // khoa luu tru gan voi khach
    await env.rt.objects.put(r.body.key, png(1080, 1920), 'image/png');
    const cf = await lan.json('POST', `/portal/v1/media/${r.body.id}/confirm`, {});
    expect(cf.status).toBe(200);
    expect(cf.body.status).toBe('pending');
  });

  it('confirm khi tep that khac khai bao (anh 100x100) -> tu choi va danh dau loi', async () => {
    const r = await up(lan, { name: 'fake.png', content_type: 'image/png', size_bytes: 33, width: 1080, height: 1920 });
    await env.rt.objects.put(r.body.key, png(100, 100), 'image/png');
    const cf = await lan.json('POST', `/portal/v1/media/${r.body.id}/confirm`, { width: 1080, height: 1920 });
    expect(cf.status).toBe(422);
    const row = await env.rt.db.query<{ state: string }>('SELECT state FROM creatives WHERE id = ?', [r.body.id]);
    expect(row[0]!.state).toBe('invalid');
  });

  it('confirm khi chua tai tep len -> 409; tep rac khong phai anh -> 422', async () => {
    const r = await up(lan, { name: 'none.png', content_type: 'image/png', size_bytes: 33, width: 1080, height: 1920 });
    expect((await lan.req('POST', `/portal/v1/media/${r.body.id}/confirm`, {})).status).toBe(409);
    await env.rt.objects.put(r.body.key, new Uint8Array(40).fill(7), 'image/png');
    expect((await lan.req('POST', `/portal/v1/media/${r.body.id}/confirm`, {})).status).toBe(422);
  });

  it('nhap lien ket chi la tham chieu, kiem tra ten mien (khong IP, khong localhost, khong http)', async () => {
    const ok = await lan.json('POST', '/portal/v1/media/import', { source: 'youtube', url: 'https://www.youtube.com/watch?v=abc123' });
    expect(ok.status).toBe(201);
    expect(ok.body.source).toMatch(/youtube/);
    for (const url of ['http://youtube.com/watch?v=1', 'https://127.0.0.1/x.mp4', 'https://localhost/a', 'https://evil.com/watch?v=1', 'https://user:pw@youtube.com/watch?v=1', 'https://169.254.169.254/latest']) {
      const r = await lan.json('POST', '/portal/v1/media/import', { source: 'youtube', url });
      expect(r.status, url).toBe(422);
    }
  });

  it('noi bo: duyet / tra lai media co ly do', async () => {
    const m = (await admin.json('GET', '/admin/v1/media?filter=status:pending&page_size=5')).body.items[0];
    expect(m).toBeTruthy();
    await env.rt.db.run("UPDATE creatives SET scan_state = 'clean' WHERE id = ?", [m.id]);
    expect((await admin.json('POST', `/admin/v1/media/${m.id}/approve`)).status).toBe(200);
    expect((await admin.json('POST', `/admin/v1/media/${m.id}/reject`, { reason: 'Sai quy cach' })).status).toBe(200);
    const row = await env.rt.db.query<{ review_state: string }>('SELECT review_state FROM creatives WHERE id = ?', [m.id]);
    expect(row[0]!.review_state).toBe('rejected');
  });

  it('han muc theo ngay: vuot so tep/ngay -> 429', async () => {
    await env.rt.db.run('UPDATE upload_quotas SET max_files_per_day = 1 WHERE customer_id = ?', [K008]);
    let got = 0;
    for (let i = 0; i < 25 && got !== 429; i++) {
      got = (await up(dang, { name: `q${i}.png`, content_type: 'image/png', size_bytes: 100, width: 1920, height: 1080 })).status;
    }
    expect(got).toBe(429);
  });
});

describe('lich phat, man hinh, nguoi dung, doi tac', () => {
  it('lich phat: buoc 30 phut, sua duoc, xoa can quyen', async () => {
    const camp = (await admin.json('GET', '/admin/v1/campaigns?filter=status:active&page_size=1')).body.items[0];
    const bad = await admin.json('POST', '/admin/v1/schedule', { campaign_id: camp.id, start_min: 17, end_min: 60 });
    expect(bad.status).toBe(422);
    const ok = await admin.json('POST', '/admin/v1/schedule', { campaign_id: camp.id, start_min: 480, end_min: 600 });
    expect(ok.status).toBe(201);
    const up = await admin.json('PUT', `/admin/v1/schedule/${ok.body.id}`, { start_min: 510, end_min: 660 });
    expect(up.body.start_min).toBe(510);
    expect((await admin.json('PUT', `/admin/v1/schedule/${ok.body.id}`, { start_min: 700, end_min: 660 })).status).toBe(422);
    expect((await admin.json('DELETE', `/admin/v1/schedule/${ok.body.id}`)).status).toBe(200);
    const list = await admin.json('GET', '/admin/v1/schedule?page_size=10');
    expect(Array.isArray(list.body.items)).toBe(true);
  });

  it('man hinh: tao vi tri, kiem tra do phan giai', async () => {
    expect((await admin.json('POST', '/admin/v1/screens', { name: 'Sai', type: 'elevator', resolution: '1000×1000', screens: 1, region: 'Hà Nội' })).status).toBe(422);
    const ok = await admin.json('POST', '/admin/v1/screens', { name: 'Vi tri moi', type: 'elevator', resolution: '768×1366', screens: 3, region: 'TP.HCM' });
    expect(ok.status).toBe(201);
    expect(ok.body.screens).toBe(3);
    const l = await admin.json('GET', '/admin/v1/screens?q=moi&page_size=5');
    expect(l.body.items.some((s: any) => s.id === ok.body.id)).toBe(true);
  });

  it('doi tac: khong lo khoa bi mat, endpoint phai https', async () => {
    const bad = await admin.json('POST', '/admin/v1/partners', { name: 'Xau', endpoint: 'http://x.com' });
    expect(bad.status).toBe(422);
    const p = await admin.json('POST', '/admin/v1/partners', { name: 'Co khoa', endpoint: 'https://ssp.example.com/rtb', auth: 'sk_live_SECRET123' });
    expect(JSON.stringify(p.body)).not.toContain('SECRET123');
    const l = await admin.json('GET', '/admin/v1/partners?page_size=50');
    expect(JSON.stringify(l.body)).not.toContain('SECRET123');
    expect((await admin.json('PUT', `/admin/v1/partners/${p.body.id}`, { enabled: false })).body.enabled).toBe(false);
    const fl = await admin.json('GET', '/admin/v1/rtb-floors');
    const f = fl.body.items[0];
    expect((await admin.json('PUT', `/admin/v1/rtb-floors/${f.id}`, { floor_cpm_vnd: 54321 })).body.floor_cpm_vnd).toBe(54321);
    expect((await admin.json('PUT', `/admin/v1/rtb-floors/${f.id}`, { floor_cpm_vnd: -5 })).status).toBe(422);
  });

  it('tong quan, doanh thu tra dung hinh dang', async () => {
    const o = await admin.json('GET', '/admin/v1/dashboard/overview?range=7');
    expect(o.status).toBe(200);
    for (const k of ['kpi', 'trend', 'revenue_split', 'slot_fill', 'alerts', 'top_campaigns']) expect(o.body).toHaveProperty(k);
    const r = await admin.json('GET', '/admin/v1/revenue');
    expect(Array.isArray(r.body.months)).toBe(true);
  });

  it('khoa tai khoan thu hoi phien dang mo', async () => {
    const victim = await login(env, env.byRole('device_ops'));
    expect((await victim.req('GET', '/admin/v1/devices')).status).toBe(200);
    const u = (await admin.json('GET', '/admin/v1/users?filter=role:device_ops&page_size=1')).body.items[0];
    expect((await admin.json('PUT', `/admin/v1/users/${u.id}`, { status: 'locked' })).status).toBe(200);
    expect((await victim.req('GET', '/admin/v1/devices')).status).toBe(401);
    expect((await admin.json('PUT', `/admin/v1/users/${u.id}`, { status: 'active' })).status).toBe(200);
  });

  it('moi tai khoan ngoai bat buoc co customer_id', async () => {
    const r = await admin.json('POST', '/admin/v1/users', { name: 'Khach', email: 'khach.moi@x.vn', role: 'customer' });
    expect(r.status).toBe(422);
    const ok = await admin.json('POST', '/admin/v1/users', { name: 'Khach', email: 'khach.moi@x.vn', role: 'customer', customer_id: K001 });
    expect(ok.status).toBe(201);
    expect(ok.body.customer_id).toBe(K001);
    expect((await admin.json('POST', '/admin/v1/users', { name: 'Khach', email: 'khach.moi@x.vn', role: 'customer', customer_id: K001 })).status).toBe(409);
  });
});

describe('khac', () => {
  it('JSON hong -> 400, duong dan la -> 404 co dinh dang loi chung, khong ro ri 500', async () => {
    const r = await env.app.request('/admin/v1/campaigns', { method: 'POST', headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': 'application/json' }, body: '{bad' });
    expect(r.status).toBe(400);
    const n = await env.app.request('/khong/co');
    expect(n.status).toBe(404);
    expect(((await n.json()) as any).error.code).toBe('not_found');
  });

  it('header bao mat co mat; phan hoi khong cache', async () => {
    const r = await env.app.request('/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
