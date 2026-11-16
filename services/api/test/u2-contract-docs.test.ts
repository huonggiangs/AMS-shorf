import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';
import { renderContractPdf } from '../src/contracts-doc/pdf.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let finance: Session;
let content: Session;
let lan: Session;
let contractId = '';
let otherContractId = '';
const BASE = '/admin/v1/contract-docs';
const latin1 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('latin1');
const OUT = process.env['AMS_TEST_PDF_OUT'];

/** PNG RGBA don gian (hinh tron xanh) de thu tai logo. */
function makePng(w: number, h: number): Uint8Array {
  const crcT = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (w / 2.2) ** 2;
      raw[o] = 20;
      raw[o + 1] = 160;
      raw[o + 2] = 90;
      raw[o + 3] = inside ? 255 : 0;
    }
  }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

function pdftotext(bytes: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'ams-pdf-'));
  const f = join(dir, 'a.pdf');
  writeFileSync(f, bytes);
  const r = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}
const stripPdfText = (t: string) => t.replace(/\s+/g, ' ');

beforeAll(async () => {
  env = await setup();
  admin = await login(env, env.byRole('super_admin'));
  finance = await login(env, env.byRole('finance'));
  content = await login(env, env.byRole('content_manager'));
  lan = await login(env, 'lan@vinamilk.example');
  const rows = await env.rt.db.query<{ id: string }>('SELECT id FROM contracts ORDER BY no LIMIT 2');
  contractId = rows[0]!.id;
  otherContractId = rows[1]!.id;
  // hop dong co dong gia thoa thuan de bang gia co don gia moi luot
  const ln = await admin.json('POST', `/admin/v1/contracts/${contractId}/lines`, { screen_type: 'tv', region_id: 'HN', daypart: 'peak', frequency: 10, duration_s: 15, qty: 2, impression_price_micro_vnd: 120_500_000 });
  expect(ln.status).toBe(201);
}, 120_000);

describe('u2 mau hop dong', () => {
  let tplId = '';
  it('mau mac dinh nap san o trang thai nhap va con cho trong cua luat su', async () => {
    const l = await content.json('GET', `${BASE}/templates`);
    expect(l.status).toBe(200);
    expect(l.body.items).toHaveLength(1);
    expect(l.body.items[0].status).toBe('draft');
    expect(l.body.items[0].draft_problems.length).toBeGreaterThan(0);
    tplId = l.body.items[0].id;
    const d = await content.json('GET', `${BASE}/templates/${tplId}`);
    const keys = d.body.articles.map((a: any) => a.key);
    expect(keys).toEqual(['parties', 'services', 'price', 'payment', 'content_rules', 'liability', 'confidentiality', 'data_protection', 'termination', 'dispute', 'final']);
    expect(JSON.stringify(d.body.articles)).toContain('kid-safe');
    expect(JSON.stringify(d.body.articles)).toContain('13/2023/NĐ-CP');
  });
  it('khong duyet duoc khi thieu xac nhan, thieu quyen, hoac con dau hieu ban nhap', async () => {
    expect((await admin.json('POST', `${BASE}/templates/${tplId}/approve`, {})).status).toBe(422);
    expect((await finance.json('POST', `${BASE}/templates/${tplId}/approve`, { confirm_lawyer_approved: true })).status).toBe(403);
    const r = await admin.json('POST', `${BASE}/templates/${tplId}/approve`, { confirm_lawyer_approved: true });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('draft_not_final');
  });
  it('chi super_admin (admin:write) tao/sua mau; nguoi khac 403', async () => {
    expect((await finance.json('POST', `${BASE}/templates`, { name: 'x mau', articles: [{ key: 'a', title: 'A', body: 'b' }] })).status).toBe(403);
    expect((await content.json('PUT', `${BASE}/templates/${tplId}`, { name: 'xxx yyy' })).status).toBe(403);
  });
  it('mau co bien la bi tu choi', async () => {
    const r = await admin.json('POST', `${BASE}/templates`, { name: 'Mau loi', articles: [{ key: 'a', title: 'A', body: 'x {{khong.co}}' }] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_template');
  });
});

describe('u2 ban soan hop dong + chot', () => {
  let docId = '';
  let tplId = '';
  it('RBAC + IDOR khi tao ban soan', async () => {
    expect((await content.json('POST', `${BASE}/by-contract/${contractId}`, {})).status).toBe(403);
    expect((await lan.json('GET', `${BASE}/templates`)).status).toBe(403); // tai khoan khach khong vao API quan tri
    expect((await lan.json('POST', `${BASE}/by-contract/${contractId}`, {})).status).toBe(403);
    expect((await finance.json('POST', `${BASE}/by-contract/khong-co`, {})).status).toBe(404);
    expect((await content.json('GET', `${BASE}/by-contract/khong-co`)).status).toBe(404);
    const r = await finance.json('POST', `${BASE}/by-contract/${contractId}`, {});
    expect(r.status).toBe(201);
    docId = r.body.id;
    expect(r.body.status).toBe('draft');
    expect(r.body.version).toBe(1);
    tplId = r.body.template_id;
    expect(r.body.template_status).toBe('draft');
    const again = await finance.json('POST', `${BASE}/by-contract/${contractId}`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('draft_exists');
    expect((await content.json('GET', `${BASE}/by-contract/${contractId}`)).body.items).toHaveLength(1);
    expect((await content.json('GET', `${BASE}/by-contract/${otherContractId}`)).body.items).toHaveLength(0);
    expect((await content.json('GET', `${BASE}/${'x'.repeat(10)}`)).status).toBe(404);
  });

  it('xem truoc: bien tu dong, bang gia tu dong hop dong, bien thieu duoc bao', async () => {
    const p = await content.json('GET', `${BASE}/${docId}/preview`);
    expect(p.status).toBe(200);
    expect(p.body.status).toBe('draft');
    expect(p.body.price.lines.length).toBeGreaterThanOrEqual(2);
    const priced = p.body.price.lines.find((l: any) => l.impression_price_vnd === '120.5');
    expect(priced).toMatchObject({ screen_type: 'Smart TV', daypart: 'Cao điểm', qty: 2 });
    expect(p.body.price.total_vnd).toBe(p.body.price.value_vnd + p.body.price.vat_vnd);
    expect(p.body.text).toContain('Điều 2. Giá dịch vụ');
    expect(p.body.text).not.toContain('{{');
    expect(p.body.missing).toContain('payment.account');
    expect(p.body.effective_variables['seller.name']).toBeTruthy();
    expect(p.body.computed_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sua bien + dieu khoan; bien la, dieu khoan la, ban chot khong sua duoc', async () => {
    expect((await content.json('PUT', `${BASE}/${docId}`, { variables: { 'payment.account': 'x' } })).status).toBe(403);
    expect((await finance.json('PUT', `${BASE}/${docId}`, { variables: { 'khong.co': 'x' } })).status).toBe(422);
    expect((await finance.json('PUT', `${BASE}/${docId}`, { article_overrides: { zzz: { body: 'x' } } })).status).toBe(422);
    expect((await finance.json('PUT', `${BASE}/${docId}`, { article_overrides: { payment: { body: 'x {{khong.co}}' } } })).status).toBe(422);
    const before = (await admin.json('GET', `${BASE}/${docId}`)).body.computed_hash;
    const u = await finance.json('PUT', `${BASE}/${docId}`, {
      variables: { 'payment.account': '0123456789 - Vietcombank - Cong ty ANIO', 'customer.rep_title': 'Giám đốc', 'terms.liability_cap_pct': '50' },
      article_overrides: { confidentiality: { body: 'Hai bên giữ bí mật {{terms.confidential_years}} năm. Đặc biệt: Nguyễn Thị Hương, Đặng Văn Ưu.' } },
    });
    expect(u.status).toBe(200);
    expect(u.body.missing).not.toContain('payment.account');
    expect(u.body.text).toContain('0123456789');
    expect(u.body.text).toContain('50%');
    expect(u.body.text).toContain('Nguyễn Thị Hương');
    expect(u.body.articles.find((a: any) => a.key === 'confidentiality').overridden).toBe(true);
    expect(u.body.computed_hash).not.toBe(before);
  });

  it('PDF ban nhap: header %PDF, A4, nhieu trang, dau BAN NHAP, watermark ANIO mac dinh, font nhung, Trang x/y', async () => {
    expect((await lan.req('GET', `${BASE}/${docId}/pdf`)).status).toBe(403);
    const res = await content.req('GET', `${BASE}/${docId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.pdf"$/);
    expect(res.headers.get('x-contract-doc-status')).toBe('draft');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(latin1(bytes.slice(0, 5))).toBe('%PDF-');
    const raw = latin1(bytes);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    for (const p of doc.getPages()) expect(p.getSize().width).toBeCloseTo(595.28, 1);
    expect(p0(doc).height).toBeCloseTo(841.89, 1);
    // font Be Vietnam Pro nhung that (khong phai font chuan)
    expect(raw).toMatch(/\/BaseFont \/(?:[A-Z]{6}\+)?BeVietnamPro-(?:Regular|Bold)/);
    expect(raw).toContain('/FontFile2');
    expect(raw).toContain('/Identity-H');
    // watermark: do mo 9% (ExtGState) tren moi trang; nam TRUOC noi dung (ve dau tien)
    expect(raw).toContain('/ca 0.09');
    expect(raw).toContain('/ca 0.12'); // con dau BAN NHAP
    const txt = pdftotext(bytes);
    if (txt) {
      const flat = stripPdfText(txt);
      expect(flat).toContain('BẢN NHÁP');
      expect(flat).toContain('HỢP ĐỒNG DỊCH VỤ QUẢNG CÁO');
      expect(flat).toContain('Điều 4. Quy định về nội dung quảng cáo và bảo vệ trẻ em');
      expect(flat).toContain('Nguyễn Thị Hương, Đặng Văn Ưu');
      expect(flat).toContain(`Trang 1/${doc.getPageCount()}`);
      expect(flat).toContain(`Trang ${doc.getPageCount()}/${doc.getPageCount()}`);
      expect(flat).toContain('Đơn giá/lượt');
      expect(flat).toContain('ĐẠI DIỆN BÊN A');
      expect(flat).toContain('ĐẠI DIỆN BÊN B');
      expect((txt.match(/ANIO/g) ?? []).length).toBeGreaterThanOrEqual(doc.getPageCount()); // logo chu o moi trang
    }
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, 'draft.pdf'), bytes);
    }
    // thu tu ve: watermark (ExtGState gs co ca 0.09) xuat hien trong noi dung trang truoc van ban chinh
    const firstPage = doc.getPage(0);
    expect(firstPage.node.Resources()?.has((await import('pdf-lib')).PDFName.of('ExtGState'))).toBe(true);
  });

  it('chot: can admin:approve, mau phai duoc luat su duyet, khong con cho trong', async () => {
    expect((await finance.json('POST', `${BASE}/${docId}/finalize`, {})).status).toBe(403);
    const r = await admin.json('POST', `${BASE}/${docId}/finalize`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('template_not_approved');
    // luat su dien cho trong (sua mau ban nhap) roi duyet
    const t = (await admin.json('GET', `${BASE}/templates/${tplId}`)).body;
    const filled = t.articles.map((a: any) => ({ key: a.key, title: a.title, body: a.body.replace(/`\[[^\]]*\]`/g, ''), ...(a.numbered === false ? { numbered: false } : {}) }));
    expect((await admin.json('PUT', `${BASE}/templates/${tplId}`, { articles: filled })).status).toBe(200);
    const ap = await admin.json('POST', `${BASE}/templates/${tplId}/approve`, { confirm_lawyer_approved: true, lawyer_ref: 'LS Nguyễn Văn A, 16/11/2026' });
    expect(ap.status).toBe(200);
    expect(ap.body.draft_problems).toEqual([]);
    // mau da duyet la bat bien
    expect((await admin.json('PUT', `${BASE}/templates/${tplId}`, { name: 'doi ten mau' })).status).toBe(409);
    // thieu thong tin (tai khoan nhan tien) thi khong chot
    const blank = await admin.json('PUT', `${BASE}/${docId}`, { variables: { 'payment.account': '' } });
    expect(blank.status).toBe(200);
    const miss = await admin.json('POST', `${BASE}/${docId}/finalize`, {});
    expect(miss.status).toBe(422);
    expect(miss.body.error.code).toBe('missing_variables');
    expect(miss.body.error.details.missing).toContain('payment.account');
    expect((await admin.json('PUT', `${BASE}/${docId}`, { variables: { 'payment.account': '0123456789 - Vietcombank - Cong ty ANIO', 'customer.rep_title': 'Giám đốc' } })).status).toBe(200);
  });

  let finalHash = '';
  it('chot ghi dau van tay vao audit, bat bien sau khi chot, hash cu bi tu choi', async () => {
    const pv = (await admin.json('GET', `${BASE}/${docId}/preview`)).body;
    const stale = await admin.json('POST', `${BASE}/${docId}/finalize`, { content_hash: 'a'.repeat(64) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('content_changed');
    const ok = await admin.json('POST', `${BASE}/${docId}/finalize`, { content_hash: pv.computed_hash });
    expect(ok.status).toBe(200);
    finalHash = ok.body.content_hash;
    expect(finalHash).toBe(pv.computed_hash);
    const au = await env.rt.db.query<{ diff: string; actor_id: string }>("SELECT diff, actor_id FROM audit_log WHERE action = 'contract_doc.finalize' AND object_id = ?", [docId]);
    expect(au).toHaveLength(1);
    expect(JSON.parse(au[0]!.diff)).toMatchObject({ content_hash: finalHash, version: 1 });
    expect((await admin.json('PUT', `${BASE}/${docId}`, { variables: { 'payment.days': '9' } })).status).toBe(409);
    expect((await admin.json('DELETE', `${BASE}/${docId}`)).status).toBe(409);
    expect((await admin.json('POST', `${BASE}/${docId}/finalize`, {})).status).toBe(409);
    const d = (await content.json('GET', `${BASE}/${docId}`)).body;
    expect(d.status).toBe('final');
    expect(d.content_hash).toBe(finalHash);
    expect(d.computed_hash).toBe(finalHash);
  });

  it('ban chot khong doi khi ho so hop dong/mau thay doi sau do (doc tu snapshot)', async () => {
    await env.rt.db.run("UPDATE customers SET legal_name = 'DOI TEN SAU KHI CHOT' WHERE id = (SELECT customer_id FROM contracts WHERE id = ?)", [contractId]);
    const d = (await content.json('GET', `${BASE}/${docId}`)).body;
    expect(d.text).not.toContain('DOI TEN SAU KHI CHOT');
    expect(d.computed_hash).toBe(finalHash);
  });

  it('PDF ban chot: khong dau BAN NHAP, co ma bam day du, ghi audit xuat', async () => {
    const res = await content.req('GET', `${BASE}/${docId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-hash')).toBe(finalHash);
    expect(res.headers.get('x-contract-doc-status')).toBe('final');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const raw = latin1(bytes);
    expect(raw).toContain('/ca 0.09');
    expect(raw).not.toContain('/ca 0.12');
    const txt = pdftotext(bytes);
    if (txt) {
      const flat = stripPdfText(txt);
      expect(flat).not.toContain('BẢN NHÁP');
      expect(flat.replace(/ /g, '')).toContain(finalHash);
      expect(flat).toContain('bản chốt');
    }
    if (OUT) writeFileSync(join(OUT, 'final.pdf'), bytes);
    const au = await env.rt.db.query('SELECT 1 FROM audit_log WHERE action = ? AND object_id = ?', ['contract_doc.export_pdf', docId]);
    expect(au.length).toBeGreaterThanOrEqual(2);
  });

  it('phien ban moi: ban nhap v2, chot v2 thi v1 thanh superseded', async () => {
    const r = await finance.json('POST', `${BASE}/by-contract/${contractId}`, {});
    expect(r.status).toBe(201);
    expect(r.body.version).toBe(2);
    expect(r.body.template_status).toBe('approved');
    const p = (await admin.json('GET', `${BASE}/${r.body.id}/preview`)).body;
    expect(p.text).toContain('DOI TEN SAU KHI CHOT');
    expect(p.computed_hash).not.toBe(finalHash);
    expect((await admin.json('PUT', `${BASE}/${r.body.id}`, { variables: { 'payment.account': '1 - NH', 'customer.rep_title': 'GD' } })).status).toBe(200);
    expect((await admin.json('POST', `${BASE}/${r.body.id}/finalize`, {})).status).toBe(200);
    const list = (await admin.json('GET', `${BASE}/by-contract/${contractId}`)).body.items;
    expect(list.map((x: any) => `${x.version}:${x.status}`)).toEqual(['2:final', '1:superseded']);
    expect((await admin.json('DELETE', `${BASE}/${r.body.id}`)).status).toBe(409);
  });
});

describe('u2 logo watermark', () => {
  it('tai logo: quyen, dinh dang, kich thuoc; luu vao kho doi tuong + audit', async () => {
    expect((await content.json('GET', `${BASE}/logo`)).body).toMatchObject({ is_default: true, default_text: 'ANIO' });
    expect((await content.json('GET', `${BASE}/logo/image`)).status).toBe(404);
    const png = makePng(128, 128);
    expect((await finance.json('PUT', `${BASE}/logo`, { content_type: 'image/png', data_base64: b64(png) })).status).toBe(403);
    expect((await admin.json('PUT', `${BASE}/logo`, { content_type: 'image/jpeg', data_base64: b64(png) })).status).toBe(422); // khai bao sai dinh dang
    expect((await admin.json('PUT', `${BASE}/logo`, { content_type: 'image/png', data_base64: b64(new TextEncoder().encode('<svg onload=alert(1)>................')) })).status).toBe(422);
    expect((await admin.json('PUT', `${BASE}/logo`, { content_type: 'image/png', data_base64: b64(makePng(16, 16)) })).status).toBe(422); // qua nho
    const huge = new Uint8Array(700 * 1024);
    huge.set(png);
    expect((await admin.json('PUT', `${BASE}/logo`, { content_type: 'image/png', data_base64: b64(huge) })).status).toBe(422);
    const ok = await admin.json('PUT', `${BASE}/logo`, { content_type: 'image/png', data_base64: b64(png) });
    expect(ok.status).toBe(200);
    expect(ok.body.logo).toMatchObject({ width: 128, height: 128, content_type: 'image/png' });
    const img = await content.req('GET', `${BASE}/logo/image`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(png);
    expect(await env.rt.db.query("SELECT 1 FROM audit_log WHERE action = 'contract_logo.set'")).toHaveLength(1);
  });

  it('PDF dung logo anh o moi trang thay cho chu ANIO', async () => {
    const d = (await admin.json('GET', `${BASE}/by-contract/${contractId}`)).body.items[0];
    const res = await admin.req('GET', `${BASE}/${d.id}/pdf`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const raw = latin1(bytes);
    expect(raw).toContain('/Subtype /Image');
    expect(raw).toContain('/ca 0.09');
    const doc = await PDFDocument.load(bytes);
    const txt = pdftotext(bytes);
    if (txt) expect((txt.match(/ANIO/g) ?? []).length).toBeLessThan(doc.getPageCount()); // khong con chu ANIO lam watermark
    if (OUT) writeFileSync(join(OUT, 'final-logo.pdf'), bytes);
    expect((await admin.json('DELETE', `${BASE}/logo`)).body.is_default).toBe(true);
  });
});

describe('u2 renderContractPdf (don vi)', () => {
  const base = {
    title: 'Hợp đồng thử', contractNo: 'HD-TEST-001', docVersion: 1, status: 'draft' as const, templateApproved: false, contentHash: 'f'.repeat(64), stampIso: '2026-11-16T00:00:00.000Z',
    seller: { name: 'Công ty TNHH ANIO', tax_code: '0312345678', address: '12 Nguyễn Huệ, Quận 1', phone: '', email: 'a@anio.vn' },
    partyA: { name: 'Công ty TNHH ANIO', rep: 'Lê Trường Sơn', title: 'Giám đốc' },
    partyB: { name: 'Công ty Cổ phần Thương mại Đặng Ưu', rep: 'Phạm Thị Hồng Nhung', title: 'Tổng giám đốc' },
    price: { lines: [], value_vnd: 0, vat_rate: 10, vat_vnd: 0, total_vnd: 0 },
  };
  const longArticles = Array.from({ length: 30 }, (_, i) => ({ key: `a${i}`, no: i + 1, title: `Điều khoản số ${i + 1} ặằẳẵắ`, blocks: [{ type: 'p' as const, text: 'Nội dung rất dài '.repeat(60) + '**đậm**' }] }));

  it('tu dong sang trang, dem trang dung, moi trang deu co watermark', async () => {
    const bytes = await renderContractPdf({ ...base, articles: longArticles });
    const doc = await PDFDocument.load(bytes);
    const n = doc.getPageCount();
    expect(n).toBeGreaterThan(5);
    const raw = latin1(bytes);
    // moi trang tham chieu mot ExtGState do mo thap (watermark) trong tai nguyen
    const pagesWithGs = doc.getPages().filter((p) => p.node.Resources()?.has((PDFNameOf('ExtGState')))).length;
    expect(pagesWithGs).toBe(n);
    expect(raw.match(/\/ca 0\.09/g)!.length).toBeGreaterThanOrEqual(1);
    const txt = pdftotext(bytes);
    if (txt) {
      expect(txt).toContain(`Trang ${n}/${n}`);
      expect(txt).toContain('ặằẳẵắ');
    }
  });
  it('xuat hai lan cung dau vao cho cung noi dung (xac dinh)', async () => {
    const a = await renderContractPdf({ ...base, status: 'final', templateApproved: true, articles: longArticles.slice(0, 2) });
    const b = await renderContractPdf({ ...base, status: 'final', templateApproved: true, articles: longArticles.slice(0, 2) });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
  it('logo hong khong lam hong xuat PDF (roi ve logo chu)', async () => {
    const bytes = await renderContractPdf({ ...base, articles: longArticles.slice(0, 1), logo: { bytes: new Uint8Array([1, 2, 3]), type: 'png' } });
    expect(latin1(bytes.slice(0, 5))).toBe('%PDF-');
  });
});

import { PDFName } from 'pdf-lib';
const PDFNameOf = (s: string) => PDFName.of(s);
const p0 = (d: PDFDocument) => d.getPage(0).getSize();
