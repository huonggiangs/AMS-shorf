// d-cust: (1) xoa mem thiet bi (don le + hang loat, gateway 410 device_deleted, dang ky lai = thiet bi moi), (2) sua/xoa khach hang (chan co ly do, luu tru, khoa tai khoan cong),
// (3) nhap mau hop dong tu .docx/.txt/.md/.html/.json (xem truoc, lam sach, luu thanh ban nhap moi) + xuat .json.
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { createGateway, type Gateway } from '@ams/edge-gateway';
import { generateEd25519KeyPair, signRequest } from '@ams/edge-gateway/testing';
import { createApp } from '../src/app.js';
import { login, NOW, type Env, type Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let rt: TestRuntime;
let env: Env;
let gw: Gateway;
let admin: Session;
let devops: Session;
let finance: Session;
let content: Session;

const nowS = () => Math.floor(rt.clock.now().getTime() / 1000);
async function registerTv(keys?: { publicKey: string; privateKey: string }) {
  const k = keys ?? (await generateEd25519KeyPair());
  const body = JSON.stringify({ pubkey: k.publicKey, kind: 'tv', model: 'BRAVIA', os: 'android-tv-12', app_version: '1.0.1', region: 'HN' });
  const s = await signRequest(k.privateKey, { method: 'POST', path: '/v1/register', body, ts: nowS() });
  const res = await gw.app.request('/v1/register', { method: 'POST', body, headers: s.headers });
  const j = (await res.json()) as any;
  return { keys: k, status: res.status, id: j.device_id as string, body: j };
}
async function hb(keys: { privateKey: string }, id: string) {
  const body = JSON.stringify({ state: 0, app_ver: '1.0.1' });
  const s = await signRequest(keys.privateKey, { method: 'POST', path: '/v1/heartbeat', body, deviceId: id, ts: nowS() });
  const res = await gw.app.request('/v1/heartbeat', { method: 'POST', body, headers: s.headers });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const audit = (prefix: string) => rt.db.query<{ action: string; object_id: string | null; diff: string | null }>('SELECT action, object_id, diff FROM audit_log WHERE action LIKE ? ORDER BY ts, id', [`${prefix}%`]);

beforeAll(async () => {
  rt = await createTestRuntime({ now: NOW, dialect: 'sqlite', env: { SCRYPT_N: '1024', HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000' } });
  const s = await seed(rt, { log: false, passwordParams: { N: 1024 }, deviceCount: 5 });
  const app = createApp(rt);
  const creds = new Map(s.credentials.map((c) => [c.email, c]));
  env = {
    rt, app, seed: s,
    cred: (email) => { const c = creds.get(email)!; return { password: c.password!, totpSecret: c.totpSecret!, role: c.role }; },
    byRole: (role, nth = 0) => s.credentials.filter((c) => c.role === role && c.status === 'active')[nth]!.email,
  };
  gw = createGateway(rt);
  admin = await login(env, env.byRole('super_admin'));
  devops = await login(env, env.byRole('device_ops'));
  finance = await login(env, env.byRole('finance'));
  content = await login(env, env.byRole('content_manager'));
}, 120_000);
afterAll(async () => rt.close());

describe('xoa thiet bi', () => {
  it('quyen: device_ops (khong co devices:delete) bi 403; super_admin xoa mem, gateway tra 410 device_deleted, danh sach an, dong va su kien cu con', async () => {
    const tv = await registerTv();
    await rt.db.run("UPDATE devices SET trust_level = 1, paired_at = ? WHERE id = ?", [NOW, tv.id]);
    await gw.devices.invalidate(tv.id);
    expect((await hb(tv.keys, tv.id)).status).toBe(200);
    // du lieu lien quan: chuong trinh phat + ma ghep dang cho + su kien cu
    const other = await registerTv();
    for (const id of ['prog_a', 'prog_b']) await rt.db.run('INSERT INTO broadcast_programs (id, name, target_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, id, 'tv', NOW, NOW]);
    for (const [p, d] of [['prog_a', tv.id], ['prog_a', other.id], ['prog_b', tv.id]]) await rt.db.run('INSERT INTO broadcast_program_devices (program_id, device_id) VALUES (?, ?)', [p, d]);
    expect((await devops.json('DELETE', `/admin/v1/devices/${tv.id}`)).status).toBe(403);
    expect((await devops.json('POST', '/admin/v1/devices/bulk-delete', { ids: [tv.id] })).status).toBe(403);
    expect((await admin.json('GET', `/admin/v1/devices/${tv.id}`)).status).toBe(200);
    const r = await admin.json('DELETE', `/admin/v1/devices/${tv.id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ deleted: 1, requested: 1 });
    const row = (await rt.db.query<any>('SELECT deleted_at, deleted_by, blocked, pubkey_ed25519 FROM devices WHERE id = ?', [tv.id]))[0];
    expect(row.deleted_at).toBeTruthy();
    expect(row.pubkey_ed25519).toBeNull();
    expect(Number(row.blocked)).toBe(1);
    // chuong trinh con thiet bi khac: go thiet bi bi xoa; chuong trinh chi con thiet bi bi xoa: giu dong (khong bien thanh phat theo khu vuc)
    expect((await rt.db.query<any>("SELECT device_id FROM broadcast_program_devices WHERE program_id = 'prog_a'")).map((x) => x.device_id)).toEqual([other.id]);
    expect((await rt.db.query<any>("SELECT device_id FROM broadcast_program_devices WHERE program_id = 'prog_b'")).map((x) => x.device_id)).toEqual([tv.id]);
    await gw.devices.invalidate(tv.id); // bo nho dem tung instance gateway het han <= 30 giay (kv da bi API xoa)
    // gateway: 410 voi ma ro rang
    const after = await hb(tv.keys, tv.id);
    expect(after.status).toBe(410);
    expect(after.body.error.code).toBe('device_deleted');
    // danh sach an; GET don le 404 voi nguoi thuong, super_admin xem duoc o bo loc da xoa
    const list = await devops.json('GET', '/admin/v1/devices?page_size=200');
    expect(list.body.items.some((d: any) => d.id === tv.id)).toBe(false);
    expect((await devops.json('GET', `/admin/v1/devices/${tv.id}`)).status).toBe(404);
    expect((await devops.json('GET', '/admin/v1/devices?deleted=1')).status).toBe(403);
    const del = await admin.json('GET', '/admin/v1/devices?deleted=1&page_size=200');
    expect(del.body.items.map((d: any) => d.id)).toContain(tv.id);
    expect(del.body.items.find((d: any) => d.id === tv.id).status).toBe('deleted');
    // xoa lan hai -> 404; audit
    expect((await admin.json('DELETE', `/admin/v1/devices/${tv.id}`)).status).toBe(404);
    expect((await audit('device.delete')).map((a) => a.object_id)).toContain(tv.id);
    // dang ky lai cung phan cung (cung khoa) => thiet bi MOI, khong bi chan
    const again = await registerTv(tv.keys);
    expect(again.status).toBe(201);
    expect(again.id).not.toBe(tv.id);
    expect((await hb(again.keys, again.id)).status).toBe(200);
  });

  it('xoa hang loat: chia cum >100 id, bo qua id khong ton tai/da xoa, audit tong hop; thao tac khoa hang loat khong dong vao thiet bi da xoa', async () => {
    const tvs = [];
    for (let i = 0; i < 3; i++) tvs.push(await registerTv());
    const fake = Array.from({ length: 120 }, (_, i) => `khong-co-${i}`);
    const ids = [...tvs.map((t) => t.id), ...fake];
    const r = await admin.json('POST', '/admin/v1/devices/bulk-delete', { ids });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.deleted).toBe(3);
    expect(r.body.skipped.length).toBe(120);
    expect((await admin.json('POST', '/admin/v1/devices/bulk-delete', { ids: [] })).status).toBe(422);
    expect((await admin.json('POST', '/admin/v1/devices/bulk-delete', { ids: Array.from({ length: 201 }, (_, i) => `x${i}`) })).status).toBe(422);
    for (const t of tvs) expect((await hb(t.keys, t.id)).status).toBe(410);
    expect((await audit('device.bulk_delete')).length).toBeGreaterThan(0);
    // verify hang loat khong hoi sinh thiet bi da xoa
    await admin.json('POST', '/admin/v1/devices/bulk', { action: 'verify', ids: tvs.map((t) => t.id) });
    expect(Number((await rt.db.query<any>('SELECT trust_level FROM devices WHERE id = ?', [tvs[0]!.id]))[0].trust_level)).toBe(0);
  });
});

describe('sua / xoa khach hang', () => {
  let cid: string;
  it('them khach, sua qua PATCH (ghi chu, lien he), kiem tra MST, ma bat bien, kiem soat sua dong thoi, quyen', async () => {
    const c = await admin.json('POST', '/admin/v1/customers', { legal_name: 'Công ty Thử Nghiệm Xóa', short_name: 'ThuNghiem', tax_code: '0109876543', email: 'a@b.vn' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    cid = c.body.id;
    const code = c.body.code;
    const p1 = await admin.json('PATCH', `/admin/v1/customers/${cid}`, { address: '1 Nguyễn Huệ', notes: 'Khách thân thiết', contacts: [{ name: 'Chị Lan', phone: '0900000001', email: 'lan@x.vn', is_primary: true }, { name: 'Anh Bình' }] });
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect(p1.body).toMatchObject({ address: '1 Nguyễn Huệ', notes: 'Khách thân thiết' });
    const detail = await admin.json('GET', `/admin/v1/customers/${cid}`);
    expect(detail.body.contacts.length).toBe(2);
    expect(detail.body.contacts.find((x: any) => x.is_primary).name).toBe('Chị Lan');
    // MST sai -> 422; email sai -> 422
    expect((await admin.json('PATCH', `/admin/v1/customers/${cid}`, { tax_code: '123' })).status).toBe(422);
    expect((await admin.json('PATCH', `/admin/v1/customers/${cid}`, { email: 'khong-hop-le' })).status).toBe(422);
    // ma khach hang bat bien
    const imm = await admin.json('PATCH', `/admin/v1/customers/${cid}`, { code: 'K999' });
    expect(imm.status).toBe(422);
    expect(imm.body.error.code).toBe('immutable_field');
    expect((await admin.json('PATCH', `/admin/v1/customers/${cid}`, { code, short_name: 'ThuNghiem2' })).status).toBe(200);
    // sua dong thoi
    rt.clock.advance(5000);
    expect((await admin.json('PATCH', `/admin/v1/customers/${cid}`, { notes: 'v2' })).status).toBe(200);
    const cur = (await admin.json('GET', `/admin/v1/customers/${cid}`)).body.updated_at;
    rt.clock.advance(5000); // dong ho test dung yen: tien len de updated_at doi
    expect((await admin.json('PATCH', `/admin/v1/customers/${cid}`, { industry: 'FMCG', if_updated_at: cur })).status).toBe(200);
    const stale = await admin.json('PATCH', `/admin/v1/customers/${cid}`, { industry: 'Khac', if_updated_at: cur });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_update');
    // quyen: content_manager chi xem
    expect((await content.json('PATCH', `/admin/v1/customers/${cid}`, { notes: 'x' })).status).toBe(403);
    expect((await audit('customer.update')).length).toBeGreaterThanOrEqual(3);
  });

  it('xoa bi chan khi con chien dich / so du vi / cong no, tra ly do tieng Viet; finance (khong co customers:delete) bi 403', async () => {
    const seeded = (await rt.db.query<{ customer_id: string }>("SELECT customer_id FROM campaigns WHERE state IN ('active','scheduled','paused','pending_review','awaiting_funds') LIMIT 1"))[0];
    if (seeded) {
      const r = await admin.json('DELETE', `/admin/v1/customers/${seeded.customer_id}`);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('customer_has_blockers');
      expect(r.body.error.details.blockers.some((b: any) => b.code === 'active_campaigns')).toBe(true);
      expect(r.body.error.message).toContain('chiến dịch');
    }
    await rt.db.run('UPDATE ad_wallets SET balance_vnd = 500000 WHERE customer_id = ?', [cid]);
    const w = await admin.json('DELETE', `/admin/v1/customers/${cid}`);
    expect(w.status).toBe(409);
    expect(w.body.error.details.blockers.map((b: any) => b.code)).toContain('wallet_balance');
    await rt.db.run('UPDATE ad_wallets SET balance_vnd = 0 WHERE customer_id = ?', [cid]);
    await rt.db.run("INSERT INTO receivables (id, customer_id, amount_vnd, paid_vnd, state) VALUES ('rc_d1', ?, 1000000, 200000, 'partial')", [cid]);
    const rc = await admin.json('DELETE', `/admin/v1/customers/${cid}`);
    expect(rc.status).toBe(409);
    expect(rc.body.error.details.blockers.map((b: any) => b.code)).toContain('unpaid_receivables');
    expect((await finance.json('DELETE', `/admin/v1/customers/${cid}`)).status).toBe(403);
    await rt.db.run("UPDATE receivables SET paid_vnd = amount_vnd, state = 'paid' WHERE id = 'rc_d1'");
  });

  it('xoa thanh cong = luu tru: an khoi danh sach, khoa tai khoan cong + thu hoi phien, giu so lieu, khong sua duoc nua, audit', async () => {
    const tenant = (await rt.db.query<{ tenant_id: string }>('SELECT tenant_id FROM customers WHERE id = ?', [cid]))[0]!.tenant_id;
    await rt.db.run("INSERT INTO admins (id, tenant_id, email, name, role, account_kind, customer_id, status, created_at) VALUES ('ad_portal_d', ?, 'portal-d@x.vn', 'Portal D', 'customer', 'customer', ?, 'active', ?)", [tenant, cid, NOW]);
    await rt.db.run("INSERT INTO sessions (id, admin_id, token_hash, csrf_token, mfa_verified, created_at, last_seen_at, expires_at) VALUES ('ss_d', 'ad_portal_d', 'hash_d', 'c', 1, ?, ?, ?)", [NOW, NOW, '2099-01-01T00:00:00.000Z']);
    const r = await admin.json('DELETE', `/admin/v1/customers/${cid}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ archived: true, portal_users_disabled: 1 });
    const row = (await rt.db.query<any>('SELECT archived_at, state FROM customers WHERE id = ?', [cid]))[0];
    expect(row.archived_at).toBeTruthy();
    expect(row.state).toBe('terminated');
    expect((await rt.db.query<any>("SELECT status FROM admins WHERE id = 'ad_portal_d'"))[0].status).toBe('disabled');
    expect((await rt.db.query<any>("SELECT revoked_at FROM sessions WHERE id = 'ss_d'"))[0].revoked_at).toBeTruthy();
    expect((await rt.db.query('SELECT 1 FROM ad_wallets WHERE customer_id = ?', [cid])).length).toBe(1); // khong xoa du lieu tai chinh
    const list = await admin.json('GET', '/admin/v1/customers?page_size=200');
    expect(list.body.items.some((x: any) => x.id === cid)).toBe(false);
    expect((await admin.json('GET', '/admin/v1/customers?archived=1&page_size=200')).body.items.some((x: any) => x.id === cid)).toBe(true);
    expect((await finance.json('GET', '/admin/v1/customers?archived=1')).status).toBe(403);
    expect((await admin.json('PATCH', `/admin/v1/customers/${cid}`, { notes: 'sau khi xoa' })).status).toBe(409);
    expect((await admin.json('DELETE', `/admin/v1/customers/${cid}`)).status).toBe(404);
    expect((await audit('customer.delete')).map((a) => a.object_id)).toContain(cid);
  });
});

// ---------------------------------------------------------------- nhap mau hop dong
const crcTable = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** Tao mot tep zip toi thieu (dung cho .docx trong test). */
function zip(files: Record<string, string>, store = false): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = store ? raw : deflateRawSync(raw);
    const nm = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(store ? 0 : 8, 8); lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(store ? 0 : 8, 10); ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data);
    centrals.push(ch, nm);
    off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const W = (t: string, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const P = (inner: string, style?: string, num = false) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${num ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>${inner}</w:p>`;
const docx = (body: string): Buffer => zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>` });

const preview = (s: Session, filename: string, bytes: Uint8Array | string) =>
  s.req('POST', `/admin/v1/contract-docs/templates/import-preview?filename=${encodeURIComponent(filename)}`, undefined).then(() => null as never).catch(() => null as never);

async function importPreview(s: Session, filename: string, bytes: Uint8Array | string): Promise<{ status: number; body: any }> {
  const res = await env.app.request(`/admin/v1/contract-docs/templates/import-preview?filename=${encodeURIComponent(filename)}`, { method: 'POST', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': 'application/octet-stream' }, body: typeof bytes === 'string' ? bytes : (bytes as Uint8Array) });
  return { status: res.status, body: await res.json() };
}
void preview;

describe('nhap mau hop dong tu tep', () => {
  const BASE = '/admin/v1/contract-docs';
  it('.docx: tieu de Dieu (kieu Heading + chu dam), gach dau dong, bang gia, bang khac, giu {{bien}}, doi [..] va ten bien lech chuan, bo the HTML', async () => {
    const body = [
      P(W('CÔNG TY {{seller.name}} và [Tên khách hàng]')),
      P(W('Điều 1. Đối tượng hợp đồng', true)),
      P(W('Bên A cung cấp dịch vụ cho {{customer.name}} theo hợp đồng số {{contract.number}}. <script>alert(1)</script>')),
      P(W('Phát sóng trên màn hình thang máy'), undefined, true),
      P(W('Phát sóng trên TV'), undefined, true),
      P(W('Giá và thanh toán'), 'Heading2'),
      P(W('Giá trị trước thuế: {{contract.value_vnd}} đồng. Điền [......] khi ký.')),
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Loại màn hình</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Đơn giá</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>TV</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Hạng mục</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ghi chú</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    ].join('');
    const r = await importPreview(admin, 'Mau HD quang cao.docx', docx(body));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const b = r.body;
    expect(b.source).toBe('docx');
    expect(b.name).toBe('Mau HD quang cao');
    expect(b.articles.map((a: any) => a.title)).toEqual(['Phần mở đầu', 'Đối tượng hợp đồng', 'Giá và thanh toán']);
    expect(b.articles[0].numbered).toBe(false);
    expect(b.articles[0].body).toContain('{{customer.legal_name}}'); // [Tên khách hàng] => bien chuan
    expect(b.articles[1].body).toContain('{{customer.legal_name}}'); // {{customer.name}} => {{customer.legal_name}}
    expect(b.articles[1].body).toContain('{{contract.no}}');
    expect(b.articles[1].body).not.toContain('<script');
    expect(b.articles[1].body).toContain('- Phát sóng trên màn hình thang máy\n- Phát sóng trên TV');
    expect(b.articles[2].body).toContain('{{price_table}}');
    expect(b.articles[2].body).toContain('- Hạng mục: Ghi chú');
    expect(b.mapped.some((m: any) => m.from === '{{customer.name}}' && m.to === '{{customer.legal_name}}')).toBe(true);
    expect(b.warnings.join(' ')).toContain('[...]');
    expect(b.issues).toEqual([]);
    for (const a of b.articles) expect(a.key).toMatch(/^[a-z][a-z0-9_]{0,40}$/);
  });

  it('.txt / .md / .html / .json (xuat cua chinh minh) parse dung; bien la duoc bao o issues; quyen, kich thuoc, dinh dang, tep hong', async () => {
    const txt = 'Điều 1: Phạm vi\nNội dung một.\n- ý a\n- ý b\n\nĐiều 2. Giá\nTổng {{contract.total_vnd}}';
    const t = await importPreview(admin, 'm.txt', txt);
    expect(t.body.articles.map((a: any) => a.title)).toEqual(['Phạm vi', 'Giá']);
    expect(t.body.articles[0].body).toBe('Nội dung một.\n\n- ý a\n- ý b');
    const md = await importPreview(admin, 'm.md', '# Điều 1. Phạm vi\n**Quan trọng** xem [trang](https://x.vn).\n\n## Điều 2. Giá\n{{bien.la}}');
    expect(md.body.articles[0].body).toBe('Quan trọng xem trang.');
    expect(md.body.issues.some((i: any) => i.code === 'unknown_variable')).toBe(true);
    const html = await importPreview(admin, 'm.html', '<html><head><style>x{}</style><script>evil()</script></head><body><h2>Điều 1. Phạm vi</h2><p onclick="x()">Dịch vụ &amp; hỗ trợ <b>tốt</b><img src=x onerror=alert(1)></p><ul><li>Mục 1</li></ul></body></html>');
    expect(html.status, JSON.stringify(html.body)).toBe(200);
    expect(html.body.articles[0].body).toBe('Dịch vụ & hỗ trợ tốt\n\n- Mục 1');
    expect(JSON.stringify(html.body)).not.toMatch(/evil|onerror|onclick|<script/);
    // vong tron json: luu -> xuat -> nhap
    const save = await admin.json('POST', `${BASE}/templates`, { code: 'ads-service', name: 'Mẫu nhập thử', articles: t.body.articles, import_source: 'txt' });
    expect(save.status, JSON.stringify(save.body)).toBe(201);
    expect(save.body.status).toBe('draft');
    expect((await audit('contract_template.create')).some((a) => (a.diff ?? '').includes('"import_source":"txt"'))).toBe(true);
    const exp = await content.json('GET', `${BASE}/templates/${save.body.id}/export`);
    expect(exp.status).toBe(200);
    expect(exp.body.format).toBe('ams-contract-template');
    const back = await importPreview(admin, 'xuat.json', JSON.stringify(exp.body));
    expect(back.status).toBe(200);
    expect(back.body.articles).toEqual(t.body.articles);
    expect(back.body.name).toBe('Mẫu nhập thử');
    expect((await importPreview(admin, 'x.json', '{"articles":[{"title":1}]}')).status).toBe(422);
    expect((await importPreview(admin, 'x.json', 'khong phai json')).body.error.code).toBe('bad_json');
    // quyen + kich thuoc + loai tep + docx hong
    expect((await importPreview(content, 'm.txt', txt)).status).toBe(403);
    const big = await importPreview(admin, 'big.txt', 'a'.repeat(2 * 1024 * 1024 + 1));
    expect([413, 422]).toContain(big.status);
    expect(['file_too_large', 'payload_too_large']).toContain(big.body.error.code);
    expect((await importPreview(admin, 'm.exe', 'MZ')).body.error.code).toBe('unsupported_type');
    expect((await importPreview(admin, 'bad.docx', 'PK\u0003\u0004khong-phai-zip')).body.error.code).toBe('bad_docx');
    expect((await importPreview(admin, 'rong.txt', '')).body.error.code).toBe('empty_file');
    // xem truoc khong ghi gi: so mau khong tang
    const n0 = (await rt.db.query<any>('SELECT COUNT(*) AS n FROM contract_doc_templates'))[0].n;
    await importPreview(admin, 'm2.txt', txt);
    expect((await rt.db.query<any>('SELECT COUNT(*) AS n FROM contract_doc_templates'))[0].n).toBe(n0);
  });

  it('.docx dang luu (khong nen) cung doc duoc; zip bom bi chan', async () => {
    const stored = zip({ 'word/document.xml': `<w:document><w:body>${P(W('Điều 1. Một', true))}${P(W('Nội dung'))}</w:body></w:document>` }, true);
    expect((await importPreview(admin, 's.docx', stored)).body.articles[0].title).toBe('Một');
    const bomb = zip({ 'word/document.xml': `<w:document><w:body>${'<w:p><w:r><w:t>a</w:t></w:r></w:p>'.repeat(1)}${' '.repeat(13 * 1024 * 1024)}</w:body></w:document>` });
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    const r = await importPreview(admin, 'bomb.docx', bomb);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('docx_too_large');
  });
});
