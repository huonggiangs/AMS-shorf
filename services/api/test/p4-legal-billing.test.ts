import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';
import { assertComplianceForApproval } from '../src/compliance/approval.js';
import { assertCreditForApproval, runDunning } from '../src/billing/dunning.js';
import { runRetention } from '../src/compliance/retention.js';
import { retryDueEinvoices } from '../src/billing/einvoice.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let finance: Session;
let lan: Session;
let K001: string;
const db = () => env.rt.db;
const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
let nextResponses: { status: number; body: unknown }[] = [];
const fakeFetch = (async (url: string, init: any) => {
  calls.push({ url, headers: init.headers, body: init.body });
  const r = nextResponses.shift() ?? { status: 200, body: { InvoiceNo: '0000123', InvoiceSeries: 'C26TAA', LookupCode: 'LK123', TransactionID: 'TX1', InvoiceDate: '2026-11-12' } };
  return new Response(JSON.stringify(r.body), { status: r.status });
}) as unknown as typeof fetch;

beforeAll(async () => {
  env = await setup({ einvoiceHooks: { fetchFn: fakeFetch } });
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  finance = await login(env, env.byRole('finance'));
  lan = await login(env, 'lan@vinamilk.example');
}, 120_000);

// dong ho test duoc tien nhieu ngay (nhac no): dang nhap lai truoc moi test de phien khong het han
beforeEach(async () => {
  admin = await login(env, env.byRole('super_admin'));
  finance = await login(env, env.byRole('finance'));
});
const loginAccepted = async (email: string): Promise<Session> => {
  const s = await login(env, email);
  const pend = (await s.json('GET', '/portal/v1/legal/pending')).body.pending as any[];
  if (pend.length) await s.json('POST', '/portal/v1/legal/accept', { acceptances: pend.map((d) => ({ document_id: d.id, sha256: d.sha256 })) });
  return s;
};
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('');

describe('P0-6 van ban phap ly + cong chap nhan dieu khoan', () => {
  let termsId = '';
  it('ban nhap nap tu docs/legal, chua phat hanh => cong chua chan khach', async () => {
    const l = await admin.json('GET', '/admin/v1/legal/documents?page_size=50');
    expect(l.status).toBe(200);
    const kinds = l.body.items.map((d: any) => d.kind).sort();
    expect(kinds).toEqual(['privacy', 'sla', 'terms']);
    expect(l.body.items.every((d: any) => d.status === 'draft')).toBe(true);
    termsId = l.body.items.find((d: any) => d.kind === 'terms').id;
    expect((await lan.json('GET', '/portal/v1/campaigns')).status).toBe(200);
    expect((await lan.json('GET', '/portal/v1/legal/pending')).body.required).toBe(false);
    const det = await admin.json('GET', `/admin/v1/legal/documents/${termsId}`);
    expect(det.body.draft_problems.length).toBeGreaterThan(0);
  });
  it('phat hanh can xac nhan luat su va chan van ban con dau hieu ban nhap', async () => {
    expect((await admin.json('POST', `/admin/v1/legal/documents/${termsId}/publish`, {})).status).toBe(422);
    const blocked = await admin.json('POST', `/admin/v1/legal/documents/${termsId}/publish`, { confirm_lawyer_approved: true });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('draft_not_final');
    // nhan vien khong co quyen approve khong phat hanh duoc
    expect((await finance.json('POST', `/admin/v1/legal/documents/${termsId}/publish`, { confirm_lawyer_approved: true, allow_draft_markers: true })).status).toBe(403);
  });
  it('phat hanh ban hoan thien => khach bi chan 403 cho toi khi chap nhan; /me va /legal van vao duoc', async () => {
    const created = await admin.json('POST', '/admin/v1/legal/documents', { kind: 'terms', version: '1.0', title: 'Điều khoản dịch vụ AMS', body_md: '# Điều khoản dịch vụ\n\nNội dung đã được luật sư duyệt hoàn chỉnh, không còn chỗ trống.', requires_acceptance: true });
    expect(created.status).toBe(201);
    const pub = await admin.json('POST', `/admin/v1/legal/documents/${created.body.id}/publish`, { confirm_lawyer_approved: true, lawyer_ref: 'LS-2026-11' });
    expect(pub.status).toBe(200);
    // sua van ban da phat hanh bi tu choi
    expect((await admin.json('PUT', `/admin/v1/legal/documents/${created.body.id}`, { title: 'Doi ten' })).status).toBe(409);

    const g = await lan.json('GET', '/portal/v1/campaigns');
    expect(g.status).toBe(403);
    expect(g.body.error.code).toBe('terms_acceptance_required');
    expect((await lan.json('GET', '/portal/v1/me')).status).toBe(200);
    expect((await lan.json('GET', '/portal/v1/invoices')).status).toBe(403);
    // noi bo khong bi anh huong
    expect((await admin.json('GET', '/admin/v1/campaigns')).status).toBe(200);

    const pend = await lan.json('GET', '/portal/v1/legal/pending');
    expect(pend.body.required).toBe(true);
    const doc = pend.body.pending[0];
    expect(doc.body_md).toContain('Điều khoản dịch vụ');

    const bad = await lan.json('POST', '/portal/v1/legal/accept', { acceptances: [{ document_id: doc.id, sha256: 'a'.repeat(64) }] });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('hash_mismatch');
    const ok = await lan.req('POST', '/portal/v1/legal/accept', { acceptances: [{ document_id: doc.id, sha256: doc.sha256 }] }, { headers: { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'vitest' } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).required).toBe(false);
    expect(doc.sha256).toBe(await sha(doc.body_md));
    expect((await lan.json('GET', '/portal/v1/campaigns')).status).toBe(200);

    // bang chung: ban ghi chap nhan + audit co IP/phien ban/hash
    const acc = await admin.json('GET', '/admin/v1/legal/acceptances');
    expect(acc.body.items.some((a: any) => a.document_id === doc.id && a.sha256 === doc.sha256 && a.ip === '203.0.113.9' && a.version === '1.0')).toBe(true);
    const au = (await db().query<{ ip: string; diff: string }>("SELECT ip, diff FROM audit_log WHERE action = 'legal.accept' ORDER BY ts DESC LIMIT 1"))[0]!;
    expect(au.ip).toBe('203.0.113.9');
    expect(JSON.parse(au.diff)).toMatchObject({ kind: 'terms', version: '1.0', sha256: doc.sha256 });
    // chap nhan lai idempotent
    const again = await lan.json('POST', '/portal/v1/legal/accept', { acceptances: [{ document_id: doc.id, sha256: doc.sha256 }] });
    expect(again.body.recorded).toBe(0);
  });
  it('phien ban moi => gap lai cong; ban cu chuyen retired; doc cong khai chi ban da phat hanh', async () => {
    const created = await admin.json('POST', '/admin/v1/legal/documents', { kind: 'terms', version: '1.1', title: 'Điều khoản dịch vụ AMS', body_md: '# Điều khoản dịch vụ v1.1\n\nBổ sung điều khoản về hóa đơn điện tử, không còn chỗ trống.' });
    expect((await admin.json('POST', '/admin/v1/legal/documents', { kind: 'terms', version: '1.1', title: 'Trung', body_md: 'x'.repeat(40) })).status).toBe(409);
    await admin.json('POST', `/admin/v1/legal/documents/${created.body.id}/publish`, { confirm_lawyer_approved: true });
    expect((await lan.json('GET', '/portal/v1/campaigns')).body.error.code).toBe('terms_acceptance_required');
    const list = await admin.json('GET', '/admin/v1/legal/documents?filter=kind:terms&page_size=50');
    expect(list.body.items.filter((d: any) => d.status === 'published')).toHaveLength(1);
    const pub = await env.app.request('/legal/documents/terms');
    expect(pub.status).toBe(200);
    expect(((await pub.json()) as any).version).toBe('1.1');
    expect((await env.app.request('/legal/documents/sla')).status).toBe(404);
    const cov = await admin.json('GET', '/admin/v1/legal/coverage');
    expect(cov.body.items[0].pending).toBeGreaterThan(0);
    const pend = (await lan.json('GET', '/portal/v1/legal/pending')).body.pending[0];
    expect((await lan.json('POST', '/portal/v1/legal/accept', { acceptances: [{ document_id: pend.id, sha256: pend.sha256 }] })).status).toBe(200);
    expect((await lan.json('GET', '/portal/v1/campaigns')).status).toBe(200);
  });
});

describe('P0-5 / P1-1 hoa don dien tu', () => {
  const mkInvoice = async (amount = 1_000_000, period = '2026-10') => {
    const inv = await admin.json('POST', '/admin/v1/invoices', { customer_id: K001, period, amount_vnd: amount, vat_rate: 10, allow_additional: true });
    expect(inv.status).toBe(201);
    const iss = await admin.json('POST', `/admin/v1/invoices/${inv.body.id}/issue`, {});
    expect(iss.status).toBe(200);
    return inv.body.id as string;
  };

  it('manual (mac dinh): nhap so hoa don -> issued, dong bo einvoice_ref, idempotent; thieu so -> pending roi confirm', async () => {
    const id = await mkInvoice();
    const a = await admin.json('POST', `/admin/v1/einvoices/invoice/${id}/issue`, { manual_ref: 'C26TAA-0000777' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ provider: 'manual', status: 'issued', einvoice_no: 'C26TAA-0000777', total_vnd: 1_100_000 });
    expect((await admin.json('GET', `/admin/v1/invoices/${id}`)).body.einvoice_ref).toBe('C26TAA-0000777');
    const b = await admin.json('POST', `/admin/v1/einvoices/invoice/${id}/issue`, { manual_ref: 'KHAC' });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.einvoice_no).toBe('C26TAA-0000777'); // khong tao chung tu thu hai

    const id2 = await mkInvoice(2_000_000, '2026-09');
    const p = await admin.json('POST', `/admin/v1/einvoices/invoice/${id2}/issue`, {});
    expect(p.body.status).toBe('pending');
    const c = await admin.json('POST', `/admin/v1/einvoices/${p.body.id}/confirm`, { einvoice_no: '0000888', series: 'C26TAA', lookup_code: 'ABC' });
    expect(c.body).toMatchObject({ status: 'issued', einvoice_no: '0000888', lookup_code: 'ABC' });
    expect((await admin.json('GET', `/admin/v1/invoices/${id2}`)).body.einvoice_ref).toBe('C26TAA-0000888');
    // khach thay hoa don dien tu cua minh
    const mine = await lan.json('GET', '/portal/v1/einvoices');
    expect(mine.status).toBe(200);
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items[0].lookup_code).toBeDefined();
  });

  it('hoa don dieu chinh khi hoan tien: tach VAT, khong vuot hoa don goc, idempotent theo refund_request_id', async () => {
    const id = await mkInvoice(1_000_000, '2026-08');
    await admin.json('POST', `/admin/v1/einvoices/invoice/${id}/issue`, { manual_ref: 'C26TAA-0001000' });
    const adj = await admin.json('POST', '/admin/v1/einvoices/adjust', { invoice_id: id, refund_total_vnd: 330_000, reason: 'Hoàn tiền ví chưa dùng', refund_request_id: 'RR1', manual_ref: 'C26TAA-0001001' });
    expect(adj.status).toBe(201);
    expect(adj.body).toMatchObject({ kind: 'adjustment', status: 'issued', amount_vnd: -300_000, vat_vnd: -30_000, total_vnd: -330_000 });
    const dup = await admin.json('POST', '/admin/v1/einvoices/adjust', { invoice_id: id, refund_total_vnd: 330_000, reason: 'Hoàn tiền ví chưa dùng', refund_request_id: 'RR1' });
    expect(dup.status).toBe(200);
    expect(dup.body.id).toBe(adj.body.id);
    const over = await admin.json('POST', '/admin/v1/einvoices/adjust', { invoice_id: id, refund_total_vnd: 900_000, reason: 'Vượt hóa đơn gốc', refund_request_id: 'RR2' });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('adjustment_exceeds_original');
    const noOrig = await mkInvoice(500_000, '2026-07');
    expect((await admin.json('POST', '/admin/v1/einvoices/adjust', { invoice_id: noOrig, refund_total_vnd: 1000, reason: 'khong co goc' })).body.error.code).toBe('no_original_einvoice');
  });

  it('job: hoan tien da chi tu tao chung tu dieu chinh (idempotent); khong co hoa don goc => thong bao cho tai chinh', async () => {
    const id = await mkInvoice(1_000_000, '2026-06');
    await admin.json('POST', `/admin/v1/einvoices/invoice/${id}/issue`, { manual_ref: 'C26TAA-0002000' });
    await db().run("INSERT INTO refund_requests (id, customer_id, amount_vnd, reason, status, requested_by, created_at) VALUES ('RRJ1', ?, 110000, 'x', 'paid', NULL, ?)", [K001, env.rt.clock.now().toISOString()]);
    const { adjustPaidRefunds } = await import('../src/billing/einvoice.js');
    const r1 = await adjustPaidRefunds(env.rt);
    expect(r1.adjusted).toBe(1);
    expect((await adjustPaidRefunds(env.rt)).adjusted).toBe(0);
    const d = (await db().query<any>("SELECT kind, status, total_vnd, refund_request_id FROM einvoice_documents WHERE refund_request_id = 'RRJ1'"))[0];
    expect(d).toMatchObject({ kind: 'adjustment', status: 'pending', refund_request_id: 'RRJ1' }); // manual: cho ke toan nhap so
    expect(Number(d.total_vnd)).toBe(-110_000);
  });

  it('MISA/Viettel: cau hinh sandbox, chu ky + idempotency-key, loi tam thoi -> thu lai co lui, 4xx -> failed, thieu khoa -> khong goi mang', async () => {
    // bat nha cung cap that o che do that can xac nhan
    const base = { provider: 'misa', series: 'C26TAA', template_code: '1/001', auto_issue: false, auto_adjust_on_refund: true };
    expect((await admin.json('PUT', '/admin/v1/einvoices/settings', { ...base, sandbox: false })).body.error.code).toBe('confirm_production_required');
    // finance khong sua cai dat (admin:write)
    expect((await finance.json('PUT', '/admin/v1/einvoices/settings', { ...base, sandbox: true })).status).toBe(403);
    const put = await admin.json('PUT', '/admin/v1/einvoices/settings', { ...base, sandbox: true });
    expect(put.status).toBe(200);
    expect(put.body.connection.configured).toBe(false);
    expect(put.body.connection.missing.length).toBe(4);

    const id = await mkInvoice(4_000_000, '2026-05');
    const noCfg = await admin.json('POST', `/admin/v1/einvoices/invoice/${id}/issue`, {});
    expect(noCfg.body.status).toBe('failed');
    expect(noCfg.body.last_error).toMatch(/Chưa cấu hình/);
    expect(calls).toHaveLength(0);

    Object.assign(env.rt.config.env, { EINVOICE_MISA_SANDBOX_URL: 'https://sandbox.einvoice.invalid', EINVOICE_MISA_CLIENT_ID: 'test-client', EINVOICE_MISA_SECRET: 'test-secret', EINVOICE_MISA_SELLER_TAX_CODE: '0100000000' });
    expect((await admin.json('GET', '/admin/v1/einvoices/settings')).body.connection.configured).toBe(true);

    nextResponses = [{ status: 503, body: {} }];
    const retry1 = await admin.json('POST', `/admin/v1/einvoices/${noCfg.body.id}/retry`, {});
    expect(retry1.body).toMatchObject({ status: 'pending', attempts: 2 });
    expect(retry1.body.next_retry_at).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['Idempotency-Key']).toBe(`ams:${id}:original`);
    expect(calls[0]!.headers['X-Signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0]!.headers['X-Sandbox']).toBe('1');
    expect(calls[0]!.url).toContain('sandbox.einvoice.invalid');
    expect(JSON.parse(calls[0]!.body).Buyer.legal_name).toBeTruthy();

    // chua den han: job khong goi
    expect((await retryDueEinvoices(env.rt, { fetchFn: fakeFetch })).retried).toBe(0);
    env.rt.clock.advance(5 * 60_000);
    const job = await retryDueEinvoices(env.rt, { fetchFn: fakeFetch });
    expect(job).toMatchObject({ retried: 1, issued: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers['Idempotency-Key']).toBe(calls[0]!.headers['Idempotency-Key']);
    const doc = (await admin.json('GET', `/admin/v1/einvoices/${noCfg.body.id}`)).body;
    expect(doc).toMatchObject({ status: 'issued', einvoice_no: '0000123', series: 'C26TAA', provider: 'misa', sandbox: true });
    expect((await admin.json('GET', `/admin/v1/invoices/${id}`)).body.einvoice_ref).toBe('C26TAA-0000123');

    // 4xx: khong thu lai
    const id3 = await mkInvoice(1_000_000, '2026-04');
    nextResponses = [{ status: 422, body: { message: 'MST nguoi mua khong hop le' } }];
    const rej = await admin.json('POST', `/admin/v1/einvoices/invoice/${id3}/issue`, {});
    expect(rej.body.status).toBe('failed');
    expect(rej.body.last_error).toMatch(/MST/);
    expect(rej.body.next_retry_at).toBeNull();

    // dieu chinh qua nha cung cap
    const adj = await admin.json('POST', '/admin/v1/einvoices/adjust', { invoice_id: id, refund_total_vnd: 440_000, reason: 'Hoàn tiền', refund_request_id: 'RRM' });
    expect(adj.body).toMatchObject({ kind: 'adjustment', status: 'issued', total_vnd: -440_000 });
    expect(JSON.parse(calls.at(-1)!.body).Operation).toBe('adjust');
    // huy hoa don noi bo da co chung tu -> chung tu huy
    const refreshed = await admin.json('POST', `/admin/v1/einvoices/${noCfg.body.id}/refresh`, {});
    expect(refreshed.status).toBe(200);
    // tra ve manual de cac test sau khong dung nha cung cap
    await admin.json('PUT', '/admin/v1/einvoices/settings', { ...base, provider: 'manual', sandbox: true });
  });
});

describe('P1-3 nhac no, tu tam dung, han muc, so du thap', () => {
  const addRecv = async (id: string, customer: string, due: string, amount = 5_000_000, state = 'open') => {
    await db().run('INSERT INTO receivables (id, customer_id, contract_id, invoice_id, amount_vnd, due_date, paid_vnd, state) VALUES (?,?,NULL,NULL,?,?,0,?)', [id, customer, amount, due, state]);
  };
  const cust = (n: string) => env.seed.customers[n]!;

  it('danh dau qua han + email nhac theo moc, chay lai khong gui trung', async () => {
    const C = cust('K002');
    await db().run("UPDATE customers SET email = 'ketoan@k002.example' WHERE id = ?", [C]);
    await addRecv('RC-A', C, '2026-11-05'); // today = 2026-11-12 => qua han 7 ngay
    const before = env.rt.mail.outbox.length;
    const s1 = await runDunning(env.rt);
    expect(s1.overdue_marked).toBeGreaterThanOrEqual(1);
    expect((await db().query<any>("SELECT state FROM receivables WHERE id = 'RC-A'"))[0].state).toBe('overdue');
    const sent = env.rt.mail.outbox.slice(before).filter((m) => m.to === 'ketoan@k002.example');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('quá hạn 7 ngày');
    const s2 = await runDunning(env.rt);
    expect(env.rt.mail.outbox.slice(before).filter((m) => m.to === 'ketoan@k002.example')).toHaveLength(1);
    expect(s2.overdue_marked).toBe(0);
    // ngay hom sau: moc ke tiep (14) chua den => khong gui; sau 7 ngay nua thi gui moc 14
    env.rt.clock.advance(7 * 86_400_000);
    await runDunning(env.rt);
    expect(env.rt.mail.outbox.slice(before).filter((m) => m.to === 'ketoan@k002.example')).toHaveLength(2);
    admin = await login(env, env.byRole('super_admin')); // dong ho da tien 7 ngay
    const ev = await admin.json('GET', '/admin/v1/billing/events?filter=kind:reminder');
    expect(ev.body.items.length).toBeGreaterThanOrEqual(2);
    expect(ev.body.items.every((e: any) => e.mail_sent === true)).toBe(true);
    // thu loi: khong co email => khong ghi su kien nhac (lan sau thu lai)
    await db().run("UPDATE customers SET email = NULL WHERE id = ?", [C]);
  });

  it('gui email loi => khong danh dau da gui (thu lai lan sau)', async () => {
    const C = cust('K003');
    await db().run("UPDATE customers SET email = 'loi@k003.example' WHERE id = ?", [C]);
    await addRecv('RC-F', C, '2026-11-18'); // truoc han 3 ngay vao 2026-11-15 ... today 2026-11-19 => qua han 1, moc 0
    const mail = env.rt.mail as any;
    const orig = mail.send.bind(mail);
    mail.send = async () => { throw new Error('smtp down'); };
    const s = await runDunning(env.rt);
    expect(s.reminders_failed).toBeGreaterThanOrEqual(1);
    expect((await db().query<any>("SELECT COUNT(*) AS n FROM dunning_events WHERE receivable_id = 'RC-F' AND kind = 'reminder'"))[0].n).toBe(0);
    mail.send = orig;
    const s2 = await runDunning(env.rt);
    expect(s2.reminders_sent).toBeGreaterThanOrEqual(1);
  });

  it('tu tam dung chien dich dang chay khi qua han vuot nguong; ghi audit + thong bao; khach khong tu mo lai', async () => {
    const C = cust('K008');
    const dang = await loginAccepted('dang@unilever.example');
    const camps = await db().query<{ id: string; state: string }>("SELECT id, state FROM campaigns WHERE customer_id = ? AND state IN ('active','scheduled')", [C]);
    expect(camps.length).toBeGreaterThan(0);
    await addRecv('RC-P', C, '2026-10-20'); // qua han > 15 ngay so voi 2026-11-19
    const s = await runDunning(env.rt);
    expect(s.customers_paused).toBeGreaterThanOrEqual(1);
    const after = await db().query<{ id: string; state: string }>("SELECT id, state FROM campaigns WHERE customer_id = ? AND id IN (" + camps.map(() => '?').join(',') + ')', [C, ...camps.map((x) => x.id)]);
    expect(after.every((x) => x.state === 'paused')).toBe(true);
    const au = await db().query<any>("SELECT diff FROM audit_log WHERE action = 'campaign.pause' AND object_id = ? ORDER BY ts DESC LIMIT 1", [camps[0]!.id]);
    expect(JSON.parse(au[0].diff).reason).toBe('dunning_auto_pause');
    expect((await dang.json('POST', `/portal/v1/campaigns/${camps[0]!.id}/resume`, {})).status).toBe(403);
    expect((await db().query<any>("SELECT COUNT(*) AS n FROM dunning_events WHERE kind = 'auto_pause' AND customer_id = ?", [C]))[0].n).toBe(1);
    // chay lai: khong tam dung them / khong ghi them
    await runDunning(env.rt);
    expect((await db().query<any>("SELECT COUNT(*) AS n FROM dunning_events WHERE kind = 'auto_pause' AND customer_id = ?", [C]))[0].n).toBe(1);
  });

  it('khach co no qua han khong duoc duyet chien dich moi; thu no xong thi duoc', async () => {
    await expect(assertCreditForApproval(db(), cust('K008'))).rejects.toMatchObject({ code: 'receivable_overdue' });
    await db().run("UPDATE receivables SET paid_vnd = amount_vnd, state = 'paid' WHERE customer_id = ?", [cust('K008')]);
    await expect(assertCreditForApproval(db(), cust('K008'))).resolves.toBeUndefined();
  });

  it('han muc cong no: phat hanh hoa don vuot han muc -> 409; khach han muc 0 khong bi chan', async () => {
    const C = cust('K004');
    await db().run('UPDATE customers SET credit_limit_vnd = 1500000 WHERE id = ?', [C]);
    const mk = async (amount: number, period: string) => (await admin.json('POST', '/admin/v1/invoices', { customer_id: C, period, amount_vnd: amount, vat_rate: 0, allow_additional: true })).body.id as string;
    const a = await mk(1_000_000, '2026-03');
    expect((await admin.json('POST', `/admin/v1/invoices/${a}/issue`, {})).status).toBe(200);
    const b = await mk(600_000, '2026-02');
    const over = await admin.json('POST', `/admin/v1/invoices/${b}/issue`, {});
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('credit_limit_exceeded');
    expect((await db().query<any>('SELECT status FROM invoices WHERE id = ?', [b]))[0].status).toBe('draft');
    await db().run('UPDATE customers SET credit_limit_vnd = 0 WHERE id = ?', [C]);
    expect((await admin.json('POST', `/admin/v1/invoices/${b}/issue`, {})).status).toBe(200);
  });

  it('canh bao so du thap qua email, mot lan moi ngay', async () => {
    const C = cust('K005');
    await db().run("UPDATE customers SET email = 'vi@k005.example' WHERE id = ?", [C]);
    const w = (await db().query<any>('SELECT 1 AS x FROM ad_wallets WHERE customer_id = ?', [C]))[0];
    if (!w) await db().run("INSERT INTO ad_wallets (customer_id, balance_vnd, reserved_vnd, spent_vnd, low_balance_alert_pct, updated_at) VALUES (?,0,0,0,10,?)", [C, env.rt.clock.now().toISOString()]);
    await db().run('UPDATE ad_wallets SET balance_vnd = 50000, reserved_vnd = 0, low_balance_alert_pct = 10 WHERE customer_id = ?', [C]);
    await db().run("INSERT INTO topups (id, code, customer_id, amount_vnd, method, status, requested_at, credited_at) VALUES ('TP-LOW', 'NAP-LOW', ?, 5000000, 'manual', 'credited', ?, ?)", [C, env.rt.clock.now().toISOString(), env.rt.clock.now().toISOString()]);
    const before = env.rt.mail.outbox.filter((m) => m.to === 'vi@k005.example').length;
    const s = await runDunning(env.rt);
    const after = env.rt.mail.outbox.filter((m) => m.to === 'vi@k005.example').length;
    expect(s.low_balance_emails).toBeGreaterThanOrEqual(1);
    expect(after).toBe(before + 1);
    await runDunning(env.rt);
    expect(env.rt.mail.outbox.filter((m) => m.to === 'vi@k005.example').length).toBe(after);
  });

  it('cai dat nhac no: finance xem, chi admin:write sua; gia tri ngoai khoang bi tu choi', async () => {
    expect((await finance.json('GET', '/admin/v1/billing/settings')).status).toBe(200);
    expect((await finance.json('PUT', '/admin/v1/billing/settings', { reminder_offsets_days: [0], auto_pause_after_days: 5, enforce_credit_limit: true, low_balance_email: true, send_emails: true })).status).toBe(403);
    expect((await admin.json('PUT', '/admin/v1/billing/settings', { reminder_offsets_days: [999], auto_pause_after_days: 5, enforce_credit_limit: true, low_balance_email: true, send_emails: true })).status).toBe(422);
    const ok = await admin.json('PUT', '/admin/v1/billing/settings', { reminder_offsets_days: [7, 0, -3], auto_pause_after_days: 0, enforce_credit_limit: true, low_balance_email: false, send_emails: false });
    expect(ok.body.settings.reminder_offsets_days).toEqual([-3, 0, 7]);
    expect((await admin.json('GET', '/admin/v1/billing/receivables?filter=unpaid:1')).status).toBe(200);
    expect((await admin.json('GET', '/admin/v1/billing/summary')).body.by_state).toBeDefined();
    expect((await finance.json('POST', '/admin/v1/billing/run', {})).status).toBe(200);
  });
});

describe('P1-5 quyen chu the du lieu (ND13) + luu giu', () => {
  let euId = '';
  it('xuat du lieu nguoi dung cuoi: JSON day du, khong chua bi mat; ghi audit', async () => {
    euId = (await db().query<{ id: string }>('SELECT id FROM end_users ORDER BY id LIMIT 1'))[0]!.id;
    const q = await admin.json('POST', '/admin/v1/compliance/dsr', { kind: 'export', subject_type: 'end_user', subject_id: euId, requester: 'nguyenvana@example.com', channel: 'email' });
    expect(q.status).toBe(201);
    expect((await finance.json('POST', `/admin/v1/compliance/dsr/${q.body.id}/execute`, {})).status).toBe(403);
    const ex = await admin.json('POST', `/admin/v1/compliance/dsr/${q.body.id}/execute`, {});
    expect(ex.status).toBe(200);
    expect(ex.body.export.data.profile.id).toBe(euId);
    expect(ex.body.export.data.profile.email).toContain('@');
    expect(JSON.stringify(ex.body.export)).not.toMatch(/password_hash|totp/);
    expect(ex.body.summary.counts.reward_wallet_ledger).toBeGreaterThanOrEqual(0);
    expect((await admin.json('POST', `/admin/v1/compliance/dsr/${q.body.id}/execute`, {})).status).toBe(409);
    const list = await admin.json('GET', '/admin/v1/compliance/dsr?filter=state:completed');
    expect(list.body.items.some((x: any) => x.id === q.body.id)).toBe(true);
    // ket qua luu khong chua du lieu ca nhan
    expect(JSON.stringify(list.body.items.find((x: any) => x.id === q.body.id).result_summary)).not.toContain('@');
  });
  it('an danh nguoi dung cuoi: can confirm, xoa PII, giu so cai, idempotent', async () => {
    const ledgerBefore = (await db().query<any>('SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id = ?', [euId]))[0].n;
    const q = await admin.json('POST', '/admin/v1/compliance/dsr', { kind: 'anonymize', subject_type: 'end_user', subject_id: euId, requester: 'nguyenvana' });
    expect((await admin.json('POST', `/admin/v1/compliance/dsr/${q.body.id}/execute`, {})).body.error.code).toBe('confirm_required');
    const ok = await admin.json('POST', `/admin/v1/compliance/dsr/${q.body.id}/execute`, { confirm: true });
    expect(ok.status).toBe(200);
    expect(ok.body.summary.retained).toContain('wallet_ledger');
    const u = (await db().query<any>('SELECT display_name, phone_hash, email_enc FROM end_users WHERE id = ?', [euId]))[0];
    expect(u).toEqual({ display_name: 'Đã ẩn danh', phone_hash: null, email_enc: null });
    expect((await db().query<any>('SELECT COUNT(*) AS n FROM wallet_ledger WHERE user_id = ?', [euId]))[0].n).toBe(ledgerBefore);
    expect((await db().query<any>('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?', [euId]))[0].n).toBe(0);
    const q2 = await admin.json('POST', '/admin/v1/compliance/dsr', { kind: 'anonymize', subject_type: 'end_user', subject_id: euId });
    expect((await admin.json('POST', `/admin/v1/compliance/dsr/${q2.body.id}/execute`, { confirm: true })).body.summary.already).toBe(true);
  });
  it('an danh tai khoan khach: thu hoi phien, doi ten/email, khong dang nhap duoc; tai khoan noi bo bi tu choi', async () => {
    const acct = (await db().query<{ id: string; email: string }>("SELECT id, email FROM admins WHERE email = 'lan@vinamilk.example'"))[0]!;
    const q = await admin.json('POST', '/admin/v1/compliance/dsr', { kind: 'anonymize', subject_type: 'customer_contact', subject_id: acct.id });
    expect(q.status).toBe(201);
    const ok = await admin.json('POST', `/admin/v1/compliance/dsr/${q.body.id}/execute`, { confirm: true });
    expect(ok.status).toBe(200);
    const row = (await db().query<any>('SELECT name, email, status, password_hash, totp_secret_enc FROM admins WHERE id = ?', [acct.id]))[0];
    expect(row.name).toBe('Đã ẩn danh');
    expect(row.email).toMatch(/^anonymized\+.*@invalid\.example$/);
    expect(row.status).toBe('disabled');
    expect(row.password_hash).toBeNull();
    expect((await lan.json('GET', '/portal/v1/me')).status).toBe(401);
    // audit_log khong bi sua (bat bien) va khong lo email goc trong diff cua yeu cau an danh
    const au = (await db().query<any>("SELECT diff FROM audit_log WHERE action = 'compliance.dsr.anonymize' AND object_id = ?", [acct.id]))[0];
    expect(au.diff).not.toContain('lan@vinamilk.example');
    const internal = (await db().query<{ id: string }>("SELECT id FROM admins WHERE account_kind = 'internal' LIMIT 1"))[0]!;
    expect((await admin.json('POST', '/admin/v1/compliance/dsr', { kind: 'export', subject_type: 'customer_contact', subject_id: internal.id })).status).toBe(409);
    expect((await admin.json('POST', '/admin/v1/compliance/dsr', { kind: 'export', subject_type: 'end_user', subject_id: 'khong-co' })).status).toBe(404);
  });
  it('chinh sach luu giu: xoa ev_* qua han, giu so cai; dry-run chi dem; nen toi thieu 7 ngay', async () => {
    const now = env.rt.clock.now();
    const old = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    const recent = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    await db().run("INSERT INTO ev_heartbeat (ts, device_id) VALUES (?, 'dev-old'), (?, 'dev-new')", [old, recent]);
    const ledger = (await db().query<any>('SELECT COUNT(*) AS n FROM wallet_entries'))[0].n;
    const dry = await runRetention(env.rt, { dryRun: true });
    expect(dry.deleted['ev_heartbeat']).toBeGreaterThanOrEqual(1);
    expect((await db().query<any>("SELECT COUNT(*) AS n FROM ev_heartbeat WHERE device_id = 'dev-old'"))[0].n).toBe(1);
    const r = await admin.json('POST', '/admin/v1/compliance/retention/run', {});
    expect(r.status).toBe(200);
    expect((await db().query<any>("SELECT COUNT(*) AS n FROM ev_heartbeat WHERE device_id = 'dev-old'"))[0].n).toBe(0);
    expect((await db().query<any>("SELECT COUNT(*) AS n FROM ev_heartbeat WHERE device_id = 'dev-new'"))[0].n).toBe(1);
    expect((await db().query<any>('SELECT COUNT(*) AS n FROM wallet_entries'))[0].n).toBe(ledger);
    const put = await admin.json('PUT', '/admin/v1/compliance/retention', { ev_heartbeat_days: 3, ev_ad_impression_days: 365, ev_proof_of_play_days: 365, impression_hourly_days: 0 });
    expect(put.body.policy.ev_heartbeat_days).toBe(30);
    expect(put.body.policy.impression_hourly_days).toBe(0);
  });
  it('so dang ky xu ly + so dong y', async () => {
    const l = await admin.json('GET', '/admin/v1/compliance/processing-records');
    expect(l.body.items.length).toBeGreaterThanOrEqual(5);
    const c = await admin.json('POST', '/admin/v1/compliance/processing-records', { activity: 'Gửi bản tin', purpose: 'Marketing', data_categories: 'Email', cross_border: true });
    expect(c.status).toBe(201);
    expect((await admin.json('POST', '/admin/v1/compliance/consents', { subject_type: 'end_user', subject_id: euId, purpose: 'Nhận thông báo', granted: true, version: 'privacy-1.0', source: 'tv-app' })).status).toBe(201);
    expect((await admin.json('GET', `/admin/v1/compliance/consents?filter=subject_id:${euId}`)).body.items).toHaveLength(1);
  });
});

describe('P1-9 KYC nha quang cao + duyet lan hai nganh han che', () => {
  let cust: Session;
  let C: string;
  const upload = async (s: Session, base: string, doc_type: string, name = 'gpkd.pdf') => {
    const up = await s.json('POST', `${base}/documents/upload-url`, { doc_type, file_name: name, content_type: 'application/pdf', size_bytes: 12 });
    expect(up.status).toBe(201);
    await env.rt.objects.put(up.body.key, new TextEncoder().encode('%PDF-1.4 abc'), 'application/pdf');
    const cf = await s.json('POST', `${base}/documents/${up.body.id}/confirm`, {});
    expect(cf.status).toBe(200);
    return cf.body.id as string;
  };
  beforeAll(async () => {
    // tai khoan khach khac (K002) de khong dung tai khoan da an danh o tren
    const email = 'dang@unilever.example';
    C = (await db().query<{ customer_id: string }>('SELECT customer_id FROM admins WHERE email = ?', [email]))[0]!.customer_id;
    // chap nhan dieu khoan hien hanh de khong bi cong chan
    cust = await loginAccepted(email);
  });
  it('khach nop ho so: thieu giay to -> 422; du -> submitted; tep sai loai bi tu choi', async () => {
    const bad = await cust.json('POST', '/portal/v1/kyc/documents/upload-url', { doc_type: 'other', file_name: 'x.exe', content_type: 'application/x-msdownload', size_bytes: 10 });
    expect(bad.status).toBe(422);
    expect((await cust.json('POST', '/portal/v1/kyc/submit', {})).body.error.code).toBe('kyc_incomplete');
    expect((await cust.json('PUT', '/portal/v1/kyc/profile', { business_reg_no: '0101234567', legal_rep_name: 'Nguyễn Văn A', legal_rep_title: 'Giám đốc' })).status).toBe(200);
    const docId = await upload(cust, '/portal/v1/kyc', 'business_registration');
    const sub = await cust.json('POST', '/portal/v1/kyc/submit', {});
    expect(sub.status).toBe(200);
    expect(sub.body.state).toBe('submitted');
    expect((await cust.json('POST', '/portal/v1/kyc/submit', {})).status).toBe(409);
    // khach khong thay link tai, khong tu duyet
    expect((await cust.json('GET', '/portal/v1/kyc')).body.documents[0].preview_url).toBeUndefined();
    expect((await cust.json('POST', `/admin/v1/compliance/kyc/${C}/decision`, { decision: 'approve' })).status).toBe(403);
    void docId;
  });
  it('nguoi duyet: phai duyet giay to truoc; nganh han che can giay phep nganh; duyet ghi audit', async () => {
    const q = await admin.json('GET', '/admin/v1/compliance/kyc?filter=state:submitted');
    expect(q.body.items.some((x: any) => x.customer_id === C)).toBe(true);
    const view = await admin.json('GET', `/admin/v1/compliance/kyc/${C}`);
    expect(view.body.documents[0].preview_url).toContain('http');
    expect((await admin.json('POST', `/admin/v1/compliance/kyc/${C}/decision`, { decision: 'approve' })).body.error.code).toBe('kyc_incomplete');
    await admin.json('POST', `/admin/v1/compliance/kyc/${C}/documents/${view.body.documents[0].id}/review`, { decision: 'approve' });
    const restricted = await admin.json('POST', `/admin/v1/compliance/kyc/${C}/decision`, { decision: 'approve', restricted_industry: true, restricted_categories: ['alcohol'] });
    expect(restricted.status).toBe(422);
    expect(restricted.body.error.details.problems.join(' ')).toMatch(/giấy phép ngành/);
    const ok = await admin.json('POST', `/admin/v1/compliance/kyc/${C}/decision`, { decision: 'approve' });
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe('approved');
    expect((await db().query<any>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'kyc.approve' AND customer_id = ?", [C]))[0].n).toBe(1);
    // them giay to sau khi duyet => quay lai cho duyet
    await upload(cust, '/portal/v1/kyc', 'industry_licence', 'gp.pdf');
    expect((await admin.json('GET', `/admin/v1/compliance/kyc/${C}`)).body.profile.state).toBe('submitted');
  });
  it('nganh han che: can bat allow + KYC duyet + duyet lan hai bang NGUOI KHAC', async () => {
    const camp = (await db().query<{ id: string }>("SELECT id FROM campaigns WHERE customer_id = ? LIMIT 1", [C]))[0]!;
    const v = { id: camp.id, customer_id: C };
    await db().run("UPDATE campaigns SET state = 'pending_review' WHERE id = ?", [camp.id]);
    await assertComplianceForApproval(db(), v, 'u-a'); // chua han che: khong chan
    // dat nganh han che bang API (cung nguon voi duyet lan hai)
    expect((await admin.json('PUT', `/admin/v1/compliance/campaigns/${camp.id}/category`, { category: 'alcohol' })).body.restricted).toBe(true);
    await expect(assertComplianceForApproval(db(), v, 'u-a')).rejects.toMatchObject({ code: 'restricted_industry_blocked' });
    await db().run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('allow_restricted_industries','1',NULL,?)", [env.rt.clock.now().toISOString()]);
    await expect(assertComplianceForApproval(db(), v, 'u-a')).rejects.toMatchObject({ code: 'kyc_required' }); // KYC dang cho duyet lai
    await db().run("UPDATE customer_kyc SET state = 'approved' WHERE customer_id = ?", [C]);
    await expect(assertComplianceForApproval(db(), v, 'u-a')).rejects.toMatchObject({ code: 'second_approval_required' });
    expect((await finance.json('POST', `/admin/v1/compliance/campaigns/${camp.id}/second-approval`, { note: 'Đã xem nội dung' })).status).toBe(403);
    const sec = await admin.json('POST', `/admin/v1/compliance/campaigns/${camp.id}/second-approval`, { note: 'Đã xem nội dung và giấy phép' });
    expect(sec.status).toBe(200);
    const secBy = sec.body.second_approved_by as string;
    await expect(assertComplianceForApproval(db(), v, secBy)).rejects.toMatchObject({ code: 'second_approval_same_person' });
    await expect(assertComplianceForApproval(db(), v, 'nguoi-khac')).resolves.toBeUndefined();
    // doi nganh => phai duyet lai
    await admin.json('PUT', `/admin/v1/compliance/campaigns/${camp.id}/category`, { category: 'gambling' });
    await expect(assertComplianceForApproval(db(), v, 'nguoi-khac')).rejects.toMatchObject({ code: 'second_approval_required' });
    // cong thuc te: p2 gate flag cung la dau vao
    await db().run("UPDATE campaign_compliance SET category = 'general' WHERE campaign_id = ?", [camp.id]);
    await db().run("INSERT INTO campaign_gate (campaign_id, restricted_industry, updated_at) VALUES (?,1,?) ON CONFLICT (campaign_id) DO UPDATE SET restricted_industry = 1", [camp.id, env.rt.clock.now().toISOString()]);
    await expect(assertComplianceForApproval(db(), v, 'nguoi-khac')).rejects.toMatchObject({ code: 'second_approval_required' });
    await db().run("DELETE FROM settings WHERE key = 'allow_restricted_industries'");
  });
  it('kyc_required_for_approval bat => khach chua KYC khong duoc duyet chien dich', async () => {
    await db().run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('kyc_required_for_approval','1',NULL,?)", [env.rt.clock.now().toISOString()]);
    await expect(assertComplianceForApproval(db(), { id: 'x', customer_id: K001 }, 'u')).rejects.toMatchObject({ code: 'kyc_required' });
    await db().run("DELETE FROM settings WHERE key = 'kyc_required_for_approval'");
  });
});
