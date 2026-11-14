// KYC nha quang cao: ho so phap nhan + giay to (kho tep, tien to kyc/), nguoi duyet xac nhan, co nganh han che.
import type { Db, Runtime } from '@ams/runtime';
import { KYC_ALLOWED_MIME, KYC_MAX_BYTES, KYC_MAX_DOCS_PER_CUSTOMER, kycSubmissionProblems, sha256Hex } from '@ams/shared';
import type { KycDocType } from '@ams/shared';
import { writeAudit } from '../lib/audit.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { jsonParse, num } from '../lib/http.js';

export interface Actor {
  id: string;
  ip: string;
  internal: boolean;
}
export interface KycProfile {
  customer_id: string;
  business_reg_no: string | null;
  business_reg_date: string | null;
  business_reg_place: string | null;
  legal_rep_name: string | null;
  legal_rep_title: string | null;
  state: string;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  restricted_industry: boolean;
  restricted_categories: string[];
}
export interface KycDoc {
  id: string;
  doc_type: string;
  category: string | null;
  file_name: string;
  mime: string;
  size_bytes: number;
  state: string;
  expires_on: string | null;
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
}
const DOC_COLS = 'id, doc_type, category, file_name, mime, size_bytes, state, expires_on, note, created_at, reviewed_at';

export async function loadProfile(db: Db, customerId: string): Promise<KycProfile> {
  const r = (await db.query<Record<string, unknown>>('SELECT * FROM customer_kyc WHERE customer_id = ?', [customerId]))[0];
  return {
    customer_id: customerId,
    business_reg_no: (r?.['business_reg_no'] as string) ?? null,
    business_reg_date: (r?.['business_reg_date'] as string) ?? null,
    business_reg_place: (r?.['business_reg_place'] as string) ?? null,
    legal_rep_name: (r?.['legal_rep_name'] as string) ?? null,
    legal_rep_title: (r?.['legal_rep_title'] as string) ?? null,
    state: (r?.['state'] as string) ?? 'none',
    submitted_by: (r?.['submitted_by'] as string) ?? null,
    submitted_at: (r?.['submitted_at'] as string) ?? null,
    reviewed_by: (r?.['reviewed_by'] as string) ?? null,
    reviewed_at: (r?.['reviewed_at'] as string) ?? null,
    review_note: (r?.['review_note'] as string) ?? null,
    restricted_industry: num(r?.['restricted_industry']) === 1,
    restricted_categories: jsonParse<string[]>(r?.['restricted_categories'], []),
  };
}
export const listDocs = (db: Db, customerId: string): Promise<KycDoc[]> => db.query<KycDoc>(`SELECT ${DOC_COLS} FROM kyc_documents WHERE customer_id = ? AND state <> 'uploading' ORDER BY created_at, id`, [customerId]);

export async function assertCustomer(db: Db, customerId: string): Promise<{ id: string; industry: string | null; short_name: string }> {
  const c = (await db.query<{ id: string; industry: string | null; short_name: string }>('SELECT id, industry, short_name FROM customers WHERE id = ?', [customerId]))[0];
  if (!c) throw notFound('Không tìm thấy khách hàng.');
  return c;
}

export async function saveProfile(rt: Runtime, customerId: string, p: Partial<Pick<KycProfile, 'business_reg_no' | 'business_reg_date' | 'business_reg_place' | 'legal_rep_name' | 'legal_rep_title'>>, a: Actor): Promise<KycProfile> {
  await assertCustomer(rt.db, customerId);
  const cur = await loadProfile(rt.db, customerId);
  const now = rt.clock.now().toISOString();
  const next = { ...cur, ...p };
  // sua sau khi duyet => phai duyet lai
  const state = cur.state === 'approved' ? 'submitted' : cur.state;
  await rt.db.tx(async (db) => {
    await db.run(
      `INSERT INTO customer_kyc (customer_id, business_reg_no, business_reg_date, business_reg_place, legal_rep_name, legal_rep_title, state, updated_at) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (customer_id) DO UPDATE SET business_reg_no = excluded.business_reg_no, business_reg_date = excluded.business_reg_date, business_reg_place = excluded.business_reg_place,
         legal_rep_name = excluded.legal_rep_name, legal_rep_title = excluded.legal_rep_title, state = ?, updated_at = excluded.updated_at`,
      [customerId, next.business_reg_no, next.business_reg_date, next.business_reg_place, next.legal_rep_name, next.legal_rep_title, cur.state, now, state],
    );
    if (cur.state === 'approved') await db.run('UPDATE customer_kyc SET submitted_by = ?, submitted_at = ? WHERE customer_id = ?', [a.id, now, customerId]);
    await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: 'kyc.profile.save', objectType: 'customer_kyc', objectId: customerId, customerId, diff: { state: { from: cur.state, to: state }, business_reg_no: next.business_reg_no } });
  });
  return loadProfile(rt.db, customerId);
}

const safeName = (s: string): string => s.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'file';

export async function startDocUpload(rt: Runtime, customerId: string, b: { doc_type: KycDocType; category?: string | undefined; file_name: string; content_type: string; size_bytes: number; expires_on?: string | undefined; note?: string | undefined }, a: Actor) {
  await assertCustomer(rt.db, customerId);
  const mime = b.content_type.toLowerCase().split(';')[0]!.trim();
  if (!(KYC_ALLOWED_MIME as readonly string[]).includes(mime)) throw unprocessable('Chỉ nhận PDF, PNG hoặc JPG.', 'unsupported_type');
  if (b.size_bytes > KYC_MAX_BYTES) throw unprocessable(`Tệp vượt giới hạn ${Math.floor(KYC_MAX_BYTES / 1024 / 1024)} MB.`, 'file_too_large', { limit_bytes: KYC_MAX_BYTES });
  const n = num((await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM kyc_documents WHERE customer_id = ? AND state <> 'rejected'", [customerId]))[0]?.n);
  if (n >= KYC_MAX_DOCS_PER_CUSTOMER) throw unprocessable('Đã đạt số tệp tối đa cho hồ sơ KYC.', 'too_many_documents');
  const id = rt.id();
  const key = `kyc/${customerId}/${id}/${safeName(b.file_name)}`;
  const signed = await rt.objects.putSigned(key, mime, 900, { maxBytes: b.size_bytes });
  await rt.db.tx(async (db) => {
    await db.run(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, category, file_name, storage_key, mime, size_bytes, state, expires_on, note, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,'uploading',?,?,?,?)`,
      [id, customerId, b.doc_type, b.category ?? null, b.file_name.slice(0, 200), key, mime, b.size_bytes, b.expires_on ?? null, b.note ?? null, a.id, rt.clock.now().toISOString()],
    );
    await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: 'kyc.document.upload_url', objectType: 'kyc_document', objectId: id, customerId, diff: { doc_type: b.doc_type, size_bytes: b.size_bytes, mime } });
  });
  return { id, url: signed.url, method: 'PUT', headers: signed.headers, key, expires_in: 900 };
}

export async function confirmDocUpload(rt: Runtime, customerId: string, docId: string, a: Actor): Promise<KycDoc> {
  const d = (await rt.db.query<{ id: string; storage_key: string; mime: string; size_bytes: unknown; state: string }>('SELECT id, storage_key, mime, size_bytes, state FROM kyc_documents WHERE id = ? AND customer_id = ?', [docId, customerId]))[0];
  if (!d) throw notFound('Không tìm thấy tệp.');
  if (d.state === 'uploading') {
    const head = await rt.objects.head(d.storage_key);
    if (!head) throw conflict('Chưa thấy tệp trên kho lưu trữ. Hãy tải lên bằng đường dẫn đã cấp rồi xác nhận lại.', 'upload_missing');
    const got = head.contentType.toLowerCase().split(';')[0]!.trim();
    const bad = head.size > KYC_MAX_BYTES || head.size <= 0 || (got && got !== d.mime && got !== 'application/octet-stream');
    if (bad) {
      await rt.db.run("UPDATE kyc_documents SET state = 'rejected', note = ? WHERE id = ? AND state = 'uploading'", ['Tệp không hợp lệ (kích thước hoặc loại tệp).', d.id]);
      try { await rt.objects.delete?.(d.storage_key); } catch { /* khong chan phan hoi */ }
      throw unprocessable('Tệp tải lên không hợp lệ (kích thước hoặc loại tệp).', 'invalid_upload');
    }
    let sha: string | null = null;
    if (head.size <= KYC_MAX_BYTES) {
      const bytes = await rt.objects.get(d.storage_key);
      if (bytes) sha = await sha256Hex(bytes);
    }
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE kyc_documents SET state = 'pending', size_bytes = ?, sha256 = ? WHERE id = ? AND state = 'uploading'", [head.size, sha, d.id]);
      if (u.changes === 1) {
        // them giay to sau khi duyet => ho so quay lai cho duyet
        await db.run("UPDATE customer_kyc SET state = 'submitted', submitted_by = ?, submitted_at = ?, updated_at = ? WHERE customer_id = ? AND state = 'approved'", [a.id, rt.clock.now().toISOString(), rt.clock.now().toISOString(), customerId]);
        await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: 'kyc.document.confirm', objectType: 'kyc_document', objectId: d.id, customerId, diff: { sha256: sha, size_bytes: head.size } });
      }
    });
  }
  return (await listDocs(rt.db, customerId)).find((x) => x.id === docId)!;
}

export async function deleteDoc(rt: Runtime, customerId: string, docId: string, a: Actor): Promise<void> {
  const d = (await rt.db.query<{ storage_key: string; state: string }>('SELECT storage_key, state FROM kyc_documents WHERE id = ? AND customer_id = ?', [docId, customerId]))[0];
  if (!d) throw notFound('Không tìm thấy tệp.');
  if (d.state === 'approved') throw conflict('Không xóa được giấy tờ đã duyệt. Tải bản mới để thay thế.', 'invalid_state');
  await rt.db.tx(async (db) => {
    await db.run('DELETE FROM kyc_documents WHERE id = ?', [docId]);
    await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: 'kyc.document.delete', objectType: 'kyc_document', objectId: docId, customerId });
  });
  try { await rt.objects.delete?.(d.storage_key); } catch { /* ton luu tru mo coi: khong anh huong */ }
}

/** Nop duyet (khach hoac nhan vien nop ho): kiem tra du ho so + giay to. */
export async function submitKyc(rt: Runtime, customerId: string, a: Actor): Promise<KycProfile> {
  await assertCustomer(rt.db, customerId);
  const p = await loadProfile(rt.db, customerId);
  if (p.state === 'submitted') throw conflict('Hồ sơ đang chờ duyệt.', 'invalid_state');
  const docs = (await listDocs(rt.db, customerId)).filter((d) => d.state !== 'rejected');
  const problems = kycSubmissionProblems({ business_reg_no: p.business_reg_no, legal_rep_name: p.legal_rep_name, docTypes: docs.map((d) => d.doc_type), restricted: p.restricted_industry });
  if (problems.length) throw unprocessable('Hồ sơ KYC chưa đủ để nộp duyệt.', 'kyc_incomplete', { problems });
  const now = rt.clock.now().toISOString();
  await rt.db.tx(async (db) => {
    await db.run(
      `INSERT INTO customer_kyc (customer_id, state, submitted_by, submitted_at, updated_at) VALUES (?, 'submitted', ?, ?, ?)
       ON CONFLICT (customer_id) DO UPDATE SET state = 'submitted', submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at, review_note = NULL, updated_at = excluded.updated_at`,
      [customerId, a.id, now, now],
    );
    await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: 'kyc.submit', objectType: 'customer_kyc', objectId: customerId, customerId, diff: { state: { from: p.state, to: 'submitted' } } });
  });
  return loadProfile(rt.db, customerId);
}

export async function reviewDoc(rt: Runtime, customerId: string, docId: string, decision: 'approve' | 'reject', note: string | undefined, a: Actor): Promise<KycDoc> {
  const d = (await rt.db.query<{ state: string }>('SELECT state FROM kyc_documents WHERE id = ? AND customer_id = ?', [docId, customerId]))[0];
  if (!d) throw notFound('Không tìm thấy tệp.');
  const to = decision === 'approve' ? 'approved' : 'rejected';
  await rt.db.tx(async (db) => {
    const u = await db.run("UPDATE kyc_documents SET state = ?, note = COALESCE(?, note), reviewed_by = ?, reviewed_at = ? WHERE id = ? AND state IN ('pending','approved','rejected')", [to, note ?? null, a.id, rt.clock.now().toISOString(), docId]);
    if (u.changes !== 1) throw conflict('Tệp chưa tải xong.', 'invalid_state');
    await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: `kyc.document.${decision}`, objectType: 'kyc_document', objectId: docId, customerId, diff: { state: { from: d.state, to }, note: note ?? null } });
  });
  return (await listDocs(rt.db, customerId)).find((x) => x.id === docId)!;
}

/** Quyet dinh cuoi: bon mat (nguoi nop noi bo khong tu duyet). Duyet can giay phep kinh doanh da duyet (+ giay phep nganh khi han che). */
export async function decideKyc(rt: Runtime, customerId: string, b: { decision: 'approve' | 'reject'; note?: string | undefined; restricted_industry?: boolean | undefined; restricted_categories?: string[] | undefined }, a: Actor): Promise<KycProfile> {
  const p = await loadProfile(rt.db, customerId);
  if (p.state !== 'submitted') throw conflict('Hồ sơ không ở trạng thái chờ duyệt.', 'invalid_state');
  if (p.submitted_by === a.id) throw conflict('Người nộp hồ sơ không được tự duyệt (nguyên tắc hai người).', 'four_eyes');
  const restricted = b.restricted_industry ?? p.restricted_industry;
  const cats = b.restricted_categories ?? p.restricted_categories;
  if (b.decision === 'approve') {
    const approved = (await listDocs(rt.db, customerId)).filter((d) => d.state === 'approved').map((d) => d.doc_type);
    const problems = kycSubmissionProblems({ business_reg_no: p.business_reg_no, legal_rep_name: p.legal_rep_name, docTypes: approved, restricted });
    if (problems.length) throw unprocessable('Chưa thể duyệt: giấy tờ bắt buộc chưa được duyệt.', 'kyc_incomplete', { problems });
  } else if (!b.note?.trim()) throw unprocessable('Nhập lý do từ chối.', 'note_required');
  const to = b.decision === 'approve' ? 'approved' : 'rejected';
  const now = rt.clock.now().toISOString();
  await rt.db.tx(async (db) => {
    const u = await db.run(
      "UPDATE customer_kyc SET state = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, restricted_industry = ?, restricted_categories = ?, updated_at = ? WHERE customer_id = ? AND state = 'submitted'",
      [to, a.id, now, b.note ?? null, restricted ? 1 : 0, JSON.stringify(cats), now, customerId],
    );
    if (u.changes !== 1) throw conflict('Hồ sơ vừa được xử lý.', 'invalid_state');
    await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: `kyc.${b.decision}`, objectType: 'customer_kyc', objectId: customerId, customerId, diff: { state: { from: 'submitted', to }, restricted_industry: restricted, restricted_categories: cats, note: b.note ?? null } });
  });
  return loadProfile(rt.db, customerId);
}
