// Tuan thu: KYC nha quang cao, quyen chu the du lieu (DSR), luu giu du lieu, so dang ky xu ly/dong y, duyet lan hai nganh han che.
import { Hono } from 'hono';
import { z } from 'zod';
import { AD_CATEGORIES, DSR_DEFAULT_DUE_HOURS, DSR_SUBJECT_TYPES, KYC_DOC_TYPES, RETENTION_SETTINGS_KEY, isRestrictedCategory, parseRetentionPolicy } from '@ams/shared';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { forbidden, conflict, notFound, unprocessable } from '../lib/errors.js';
import { eq, getRt, num, parseBody, runList } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';
import { restrictionInfo } from './approval.js';
import { anonymizeSubject, exportSubject } from './dsr.js';
import type { SubjectType } from './dsr.js';
import { assertCustomer, confirmDocUpload, decideKyc, deleteDoc, listDocs, loadProfile, reviewDoc, saveProfile, startDocUpload, submitKyc } from './kyc.js';
import type { Actor } from './kyc.js';
import { loadRetentionPolicy, runRetention } from './retention.js';
import { ensureProcessingRecords } from './registers.js';

const actorOf = (c: Ctx): Actor => {
  const u = c.get('user');
  return { id: u.id, ip: c.get('ip'), internal: u.kind === 'internal' };
};

const profileBody = z.object({
  business_reg_no: z.string().trim().max(40).nullable().optional(),
  business_reg_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  business_reg_place: z.string().trim().max(120).nullable().optional(),
  legal_rep_name: z.string().trim().max(120).nullable().optional(),
  legal_rep_title: z.string().trim().max(80).nullable().optional(),
});
const uploadBody = z.object({
  doc_type: z.enum(KYC_DOC_TYPES), category: z.string().trim().max(40).optional(), file_name: z.string().trim().min(1).max(200), content_type: z.string().min(3).max(100),
  size_bytes: z.number().int().min(1).max(50 * 1024 * 1024), expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().trim().max(300).optional(),
});
const stripUndef = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

async function kycView(c: Ctx, customerId: string, staff: boolean) {
  const rt = getRt(c);
  const cu = await assertCustomer(rt.db, customerId);
  const profile = await loadProfile(rt.db, customerId);
  const docs = await listDocs(rt.db, customerId);
  const out = [];
  for (const d of docs) {
    const row = staff ? (await rt.db.query<{ storage_key: string }>('SELECT storage_key FROM kyc_documents WHERE id = ?', [d.id]))[0] : undefined;
    out.push({ ...d, size_bytes: num(d.size_bytes), ...(staff && row ? { preview_url: await rt.objects.getSigned(row.storage_key, 300) } : {}) });
  }
  return { customer: { id: cu.id, name: cu.short_name, industry: cu.industry }, profile, documents: out };
}

/** Cong khach hang: chi tai khoan loai `customer` (khong phai doi tac) quan ly KYC cua chinh khach. */
export function portalKycRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('*', async (c, next) => {
    const u = c.get('user');
    if (u.kind !== 'customer' || !u.customerId) throw forbidden('Chỉ tài khoản khách hàng mới quản lý hồ sơ pháp lý.', 'forbidden');
    await next();
  });
  const cid = (c: Ctx): string => c.get('user').customerId!;
  r.get('/', async (c) => c.json(await kycView(c, cid(c), false)));
  r.put('/profile', requirePerm('campaigns', 'write'), async (c) => {
    const b = await parseBody(c, profileBody);
    return c.json(await saveProfile(getRt(c), cid(c), stripUndef(b), actorOf(c)));
  });
  r.post('/documents/upload-url', requirePerm('campaigns', 'write'), async (c) => c.json(await startDocUpload(getRt(c), cid(c), stripUndef(await parseBody(c, uploadBody)), actorOf(c)), 201));
  r.post('/documents/:id/confirm', requirePerm('campaigns', 'write'), async (c) => c.json(await confirmDocUpload(getRt(c), cid(c), c.req.param('id'), actorOf(c))));
  r.delete('/documents/:id', requirePerm('campaigns', 'write'), async (c) => {
    await deleteDoc(getRt(c), cid(c), c.req.param('id'), actorOf(c));
    return c.json({ ok: true });
  });
  r.post('/submit', requirePerm('campaigns', 'write'), async (c) => c.json(await submitKyc(getRt(c), cid(c), actorOf(c))));
  return r;
}

export function adminComplianceRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ===== KYC =====
  r.get('/kyc', requirePerm('customers', 'view'), async (c) => {
    const res = await runList<Record<string, unknown>>(c, {
      from: 'FROM customers cu LEFT JOIN customer_kyc k ON k.customer_id = cu.id',
      select: `cu.id AS customer_id, cu.short_name AS customer, cu.industry, COALESCE(k.state, 'none') AS state, k.submitted_at, k.reviewed_at, COALESCE(k.restricted_industry, 0) AS restricted_industry,
        (SELECT COUNT(*) FROM kyc_documents d WHERE d.customer_id = cu.id AND d.state = 'pending') AS pending_docs`,
      search: ['cu.short_name'],
      sorts: { customer: 'cu.short_name', state: "COALESCE(k.state,'none')", submitted_at: 'k.submitted_at' },
      defaultSort: 'submitted_at:asc',
      tiebreak: 'cu.id',
      filters: { state: (v) => ({ sql: "COALESCE(k.state,'none') = ?", params: [v] }) },
    });
    return c.json({ ...res, items: res.items.map((x) => ({ ...x, restricted_industry: num(x['restricted_industry']) === 1, pending_docs: num(x['pending_docs']) })) });
  });
  r.get('/kyc/:customerId', requirePerm('customers', 'view'), async (c) => c.json(await kycView(c, c.req.param('customerId'), true)));
  r.put('/kyc/:customerId/profile', requirePerm('customers', 'write'), async (c) => c.json(await saveProfile(getRt(c), c.req.param('customerId'), stripUndef(await parseBody(c, profileBody)), actorOf(c))));
  r.post('/kyc/:customerId/documents/upload-url', requirePerm('customers', 'write'), async (c) => c.json(await startDocUpload(getRt(c), c.req.param('customerId'), stripUndef(await parseBody(c, uploadBody)), actorOf(c)), 201));
  r.post('/kyc/:customerId/documents/:id/confirm', requirePerm('customers', 'write'), async (c) => c.json(await confirmDocUpload(getRt(c), c.req.param('customerId'), c.req.param('id'), actorOf(c))));
  r.post('/kyc/:customerId/submit', requirePerm('customers', 'write'), async (c) => c.json(await submitKyc(getRt(c), c.req.param('customerId'), actorOf(c))));
  r.post('/kyc/:customerId/documents/:id/review', requirePerm('customers', 'approve'), async (c) => {
    const b = await parseBody(c, z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() }));
    return c.json(await reviewDoc(getRt(c), c.req.param('customerId'), c.req.param('id'), b.decision, b.note, actorOf(c)));
  });
  r.post('/kyc/:customerId/decision', requirePerm('customers', 'approve'), async (c) => {
    const b = await parseBody(c, z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional(), restricted_industry: z.boolean().optional(), restricted_categories: z.array(z.enum(AD_CATEGORIES)).max(20).optional() }));
    return c.json(await decideKyc(getRt(c), c.req.param('customerId'), stripUndef(b), actorOf(c)));
  });

  // ===== duyet lan hai nganh han che =====
  r.get('/campaigns/:id', requirePerm('campaigns', 'view'), async (c) => {
    const rt = getRt(c);
    const row = (await rt.db.query<{ id: string; customer_id: string; state: string; name: string }>('SELECT id, customer_id, state, name FROM campaigns WHERE id = ?', [c.req.param('id')]))[0];
    if (!row) throw notFound('Không tìm thấy chiến dịch.');
    return c.json({ campaign: row, ...(await restrictionInfo(rt.db, row.id, row.customer_id)) });
  });
  r.put('/campaigns/:id/category', requirePerm('campaigns', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ category: z.enum(AD_CATEGORIES) }));
    const row = (await rt.db.query<{ id: string; customer_id: string }>('SELECT id, customer_id FROM campaigns WHERE id = ?', [c.req.param('id')]))[0];
    if (!row) throw notFound('Không tìm thấy chiến dịch.');
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      // doi nganh => xoa duyet lan hai cu (nguoi khac phai duyet lai)
      await db.run(
        `INSERT INTO campaign_compliance (campaign_id, customer_id, category, declared_by, declared_at, updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT (campaign_id) DO UPDATE SET category = excluded.category, declared_by = excluded.declared_by, declared_at = excluded.declared_at, second_approved_by = NULL, second_approved_at = NULL, second_note = NULL, updated_at = excluded.updated_at`,
        [row.id, row.customer_id, b.category, c.get('user').id, now, now],
      );
      await auditCtx(c, db, { action: 'compliance.campaign.category', objectType: 'campaign', objectId: row.id, customerId: row.customer_id, diff: { category: b.category, restricted: isRestrictedCategory(b.category) } });
    });
    return c.json({ ...(await restrictionInfo(rt.db, row.id, row.customer_id)) });
  });
  r.post('/campaigns/:id/second-approval', requirePerm('campaigns', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ note: z.string().trim().min(3, 'Ghi chú duyệt nội dung (tối thiểu 3 ký tự)').max(500) }));
    const row = (await rt.db.query<{ id: string; customer_id: string; state: string }>('SELECT id, customer_id, state FROM campaigns WHERE id = ?', [c.req.param('id')]))[0];
    if (!row) throw notFound('Không tìm thấy chiến dịch.');
    if (row.state !== 'pending_review') throw conflict('Chỉ duyệt lần hai cho chiến dịch đang chờ duyệt.', 'invalid_state');
    const info = await restrictionInfo(rt.db, row.id, row.customer_id);
    if (!info.restricted) throw unprocessable('Chiến dịch không thuộc ngành hạn chế.', 'not_restricted');
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run(
        `INSERT INTO campaign_compliance (campaign_id, customer_id, category, second_approved_by, second_approved_at, second_note, updated_at) VALUES (?,?,'general',?,?,?,?)
         ON CONFLICT (campaign_id) DO UPDATE SET second_approved_by = excluded.second_approved_by, second_approved_at = excluded.second_approved_at, second_note = excluded.second_note, updated_at = excluded.updated_at`,
        [row.id, row.customer_id, c.get('user').id, now, b.note, now],
      );
      await auditCtx(c, db, { action: 'compliance.campaign.second_approval', objectType: 'campaign', objectId: row.id, customerId: row.customer_id, diff: { sources: info.sources, note: b.note } });
    });
    return c.json(await restrictionInfo(rt.db, row.id, row.customer_id));
  });

  // ===== quyen chu the du lieu (DSR) =====
  const dsrSpec = {
    from: 'FROM dsr_requests q LEFT JOIN customers cu ON cu.id = q.customer_id',
    select: 'q.id, q.kind, q.subject_type, q.subject_id, q.customer_id, cu.short_name AS customer, q.requester, q.channel, q.note, q.state, q.result_summary, q.due_at, q.created_at, q.completed_at',
    search: ['q.requester', 'q.subject_id', 'cu.short_name'],
    sorts: { created_at: 'q.created_at', due_at: 'q.due_at', state: 'q.state' },
    defaultSort: 'created_at:desc',
    tiebreak: 'q.id',
    filters: { state: eq('q.state'), kind: eq('q.kind') },
  };
  r.get('/dsr', requirePerm('admin', 'view'), async (c) => c.json(await runList(c, dsrSpec)));
  r.post('/dsr', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({
      kind: z.enum(['export', 'anonymize']), subject_type: z.enum(DSR_SUBJECT_TYPES), subject_id: z.string().min(1).max(64),
      requester: z.string().trim().max(200).optional(), channel: z.string().trim().max(60).optional(), note: z.string().trim().max(500).optional(),
    }));
    const id = rt.id();
    const now = rt.clock.now();
    // xac minh chu the ton tai (404 neu khong) va lay customer_id
    let customerId: string | null = null;
    if (b.subject_type === 'end_user') {
      if (!(await rt.db.query('SELECT 1 AS x FROM end_users WHERE id = ?', [b.subject_id]))[0]) throw notFound('Không tìm thấy chủ thể dữ liệu.');
    } else {
      const a = (await rt.db.query<{ customer_id: string | null; account_kind: string }>('SELECT customer_id, account_kind FROM admins WHERE id = ?', [b.subject_id]))[0];
      const k = a ? null : (await rt.db.query<{ customer_id: string }>('SELECT customer_id FROM customer_contacts WHERE id = ?', [b.subject_id]))[0];
      if (!a && !k) throw notFound('Không tìm thấy chủ thể dữ liệu.');
      if (a?.account_kind === 'internal') throw conflict('Tài khoản nội bộ không thuộc phạm vi yêu cầu này.', 'internal_account');
      customerId = a?.customer_id ?? k?.customer_id ?? null;
    }
    await rt.db.tx(async (db) => {
      await db.run(
        'INSERT INTO dsr_requests (id, kind, subject_type, subject_id, customer_id, requester, channel, note, state, due_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, b.kind, b.subject_type, b.subject_id, customerId, b.requester ?? null, b.channel ?? null, b.note ?? null, 'requested', new Date(now.getTime() + DSR_DEFAULT_DUE_HOURS * 3600_000).toISOString(), c.get('user').id, now.toISOString()],
      );
      await auditCtx(c, db, { action: 'compliance.dsr.create', objectType: 'dsr_request', objectId: id, customerId, diff: { kind: b.kind, subject_type: b.subject_type, subject_id: b.subject_id } });
    });
    return c.json({ id, state: 'requested' }, 201);
  });
  // Thuc hien: export tra JSON trong phan hoi (khong luu du lieu ca nhan o dau khac); anonymize can confirm=true.
  r.post('/dsr/:id/execute', requirePerm('admin', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ confirm: z.boolean().optional() }));
    const q = (await rt.db.query<{ id: string; kind: string; subject_type: SubjectType; subject_id: string; customer_id: string | null; state: string }>('SELECT id, kind, subject_type, subject_id, customer_id, state FROM dsr_requests WHERE id = ?', [c.req.param('id')]))[0];
    if (!q) throw notFound('Không tìm thấy yêu cầu.');
    if (q.state !== 'requested') throw conflict('Yêu cầu đã được xử lý.', 'invalid_state');
    const a = { id: c.get('user').id, ip: c.get('ip') };
    let summary: Record<string, unknown>;
    let payload: unknown = null;
    if (q.kind === 'export') {
      const ex = await exportSubject(rt, q.subject_type, q.subject_id);
      summary = { counts: ex.counts };
      payload = ex;
      await auditCtx(c, rt.db, { action: 'compliance.dsr.export', objectType: 'dsr_request', objectId: q.id, customerId: q.customer_id, diff: { counts: ex.counts } });
    } else {
      if (b.confirm !== true) throw unprocessable('Ẩn danh không thể hoàn tác. Gửi confirm=true để xác nhận.', 'confirm_required');
      const res = await anonymizeSubject(rt, q.subject_type, q.subject_id, a);
      summary = { ...res };
    }
    const now = rt.clock.now().toISOString();
    const u = await rt.db.run("UPDATE dsr_requests SET state = 'completed', completed_by = ?, completed_at = ?, result_summary = ? WHERE id = ? AND state = 'requested'", [a.id, now, JSON.stringify(summary), q.id]);
    if (u.changes !== 1) throw conflict('Yêu cầu vừa được xử lý.', 'invalid_state');
    return c.json({ id: q.id, state: 'completed', summary, ...(payload ? { export: payload } : {}) });
  });
  r.post('/dsr/:id/reject', requirePerm('admin', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ reason: z.string().trim().min(3).max(500) }));
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE dsr_requests SET state = 'rejected', completed_by = ?, completed_at = ?, result_summary = ? WHERE id = ? AND state = 'requested'", [c.get('user').id, rt.clock.now().toISOString(), JSON.stringify({ reason: b.reason }), c.req.param('id')]);
      if (u.changes !== 1) throw conflict('Yêu cầu không còn chờ xử lý.', 'invalid_state');
      await auditCtx(c, db, { action: 'compliance.dsr.reject', objectType: 'dsr_request', objectId: c.req.param('id'), diff: { reason: b.reason } });
    });
    return c.json({ id: c.req.param('id'), state: 'rejected' });
  });

  // ===== luu giu du lieu =====
  r.get('/retention', requirePerm('admin', 'view'), async (c) => c.json({ policy: await loadRetentionPolicy(getRt(c).db), preview: (await runRetention(getRt(c), { dryRun: true })).deleted }));
  r.put('/retention', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ ev_heartbeat_days: z.number().int().min(0).max(3650), ev_ad_impression_days: z.number().int().min(0).max(3650), ev_proof_of_play_days: z.number().int().min(0).max(3650), impression_hourly_days: z.number().int().min(0).max(3650) }));
    const val = parseRetentionPolicy(b);
    const before = await loadRetentionPolicy(rt.db);
    await rt.db.tx(async (db) => {
      await db.run(
        'INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        [RETENTION_SETTINGS_KEY, JSON.stringify(val), c.get('user').id, rt.clock.now().toISOString()],
      );
      await auditCtx(c, db, { action: 'compliance.retention.settings', objectType: 'settings', objectId: RETENTION_SETTINGS_KEY, diff: { before, after: val } });
    });
    return c.json({ policy: val });
  });
  r.post('/retention/run', requirePerm('admin', 'approve'), async (c) => c.json(await runRetention(getRt(c), { actorId: c.get('user').id })));

  // ===== so dang ky xu ly + dong y =====
  const prBody = z.object({
    activity: z.string().trim().min(3).max(200), purpose: z.string().trim().min(3).max(500), data_categories: z.string().trim().min(2).max(500), data_subjects: z.string().trim().max(300).optional(),
    legal_basis: z.string().trim().max(300).optional(), recipients: z.string().trim().max(300).optional(), cross_border: z.boolean().default(false), retention: z.string().trim().max(200).optional(),
    owner: z.string().trim().max(100).optional(), active: z.boolean().default(true),
  });
  r.get('/processing-records', requirePerm('admin', 'view'), async (c) => {
    const rt = getRt(c);
    await ensureProcessingRecords(rt);
    const rows = await rt.db.query<Record<string, unknown>>('SELECT * FROM processing_records ORDER BY created_at, id');
    return c.json({ items: rows.map((x) => ({ ...x, cross_border: num(x['cross_border']) === 1, active: num(x['active']) === 1 })) });
  });
  r.post('/processing-records', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, prBody);
    const id = rt.id();
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run(
        'INSERT INTO processing_records (id, activity, purpose, data_categories, data_subjects, legal_basis, recipients, cross_border, retention, owner, active, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, b.activity, b.purpose, b.data_categories, b.data_subjects ?? null, b.legal_basis ?? null, b.recipients ?? null, b.cross_border ? 1 : 0, b.retention ?? null, b.owner ?? null, b.active ? 1 : 0, c.get('user').id, now, now],
      );
      await auditCtx(c, db, { action: 'compliance.processing_record.create', objectType: 'processing_record', objectId: id, diff: { activity: b.activity, cross_border: b.cross_border } });
    });
    return c.json({ id }, 201);
  });
  r.put('/processing-records/:id', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, prBody);
    await rt.db.tx(async (db) => {
      const u = await db.run(
        'UPDATE processing_records SET activity=?, purpose=?, data_categories=?, data_subjects=?, legal_basis=?, recipients=?, cross_border=?, retention=?, owner=?, active=?, updated_by=?, updated_at=? WHERE id = ?',
        [b.activity, b.purpose, b.data_categories, b.data_subjects ?? null, b.legal_basis ?? null, b.recipients ?? null, b.cross_border ? 1 : 0, b.retention ?? null, b.owner ?? null, b.active ? 1 : 0, c.get('user').id, rt.clock.now().toISOString(), c.req.param('id')],
      );
      if (u.changes !== 1) throw notFound('Không tìm thấy mục đăng ký.');
      await auditCtx(c, db, { action: 'compliance.processing_record.update', objectType: 'processing_record', objectId: c.req.param('id'), diff: { activity: b.activity } });
    });
    return c.json({ id: c.req.param('id') });
  });
  r.get('/consents', requirePerm('admin', 'view'), async (c) => c.json(await runList(c, {
    from: 'FROM consent_records k',
    select: 'k.id, k.subject_type, k.subject_id, k.purpose, k.granted, k.version, k.source, k.recorded_by, k.created_at',
    search: ['k.subject_id', 'k.purpose'],
    sorts: { created_at: 'k.created_at', purpose: 'k.purpose' },
    defaultSort: 'created_at:desc',
    tiebreak: 'k.id',
    filters: { subject_id: eq('k.subject_id'), subject_type: eq('k.subject_type') },
  })));
  r.post('/consents', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ subject_type: z.enum(DSR_SUBJECT_TYPES), subject_id: z.string().min(1).max(64), purpose: z.string().trim().min(2).max(200), granted: z.boolean(), version: z.string().trim().max(40).optional(), source: z.string().trim().max(100).optional() }));
    const id = rt.id();
    await rt.db.tx(async (db) => {
      await db.run('INSERT INTO consent_records (id, subject_type, subject_id, purpose, granted, version, source, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, b.subject_type, b.subject_id, b.purpose, b.granted ? 1 : 0, b.version ?? null, b.source ?? null, c.get('user').id, rt.clock.now().toISOString()]);
      await auditCtx(c, db, { action: 'compliance.consent.record', objectType: 'consent', objectId: id, diff: { subject_type: b.subject_type, purpose: b.purpose, granted: b.granted } });
    });
    return c.json({ id }, 201);
  });
  return r;
}
