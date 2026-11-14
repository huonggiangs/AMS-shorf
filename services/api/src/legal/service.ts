// Van ban phap ly co phien ban + ghi nhan chap nhan (P0-6). Ban nap san tu docs/legal la BAN NHAP: khong bao gio tu phat hanh.
import type { Db, Runtime } from '@ams/runtime';
import { LEGAL_KINDS, legalDraftProblems, pendingAcceptances, sha256Hex } from '@ams/shared';
import type { PublishedDoc } from '@ams/shared';
import { SEED_LEGAL_DOCS } from './documents.gen.js';
import type { AuthUser } from '../types.js';

export interface LegalDocRow {
  id: string;
  kind: string;
  version: string;
  title: string;
  sha256: string;
  status: string;
  requires_acceptance: number;
  change_note: string | null;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
}
export const LEGAL_COLS = 'id, kind, version, title, sha256, status, requires_acceptance, change_note, published_at, published_by, created_at';

/** Nap ban nhap tu docs/legal neu chua co (idempotent, cho phep chay song song: chen co dieu kien). Tra ve so van ban moi. */
export async function ensureDraftDocuments(rt: Runtime, db: Db = rt.db): Promise<number> {
  let n = 0;
  const now = rt.clock.now().toISOString();
  for (const d of SEED_LEGAL_DOCS) {
    const exists = (await db.query('SELECT 1 AS x FROM legal_documents WHERE kind = ?', [d.kind]))[0];
    if (exists) continue; // da co bat ky phien ban nao (ke ca da phat hanh): khong nap lai ban nhap
    const sha = await sha256Hex(d.body_md);
    const r = await db.run(
      `INSERT INTO legal_documents (id, kind, version, title, body_md, sha256, status, requires_acceptance, change_note, created_by, created_at)
       SELECT ?,?,?,?,?,?, 'draft', 1, ?, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM legal_documents WHERE kind = ? AND version = ?)`,
      [rt.id(), d.kind, d.version, d.title, d.body_md, sha, 'Bản nháp nạp từ docs/legal — chưa được luật sư duyệt.', now, d.kind, d.version],
    );
    n += r.changes;
  }
  return n;
}

export async function publishedDocs(db: Db): Promise<(PublishedDoc & { title: string; published_at: string | null })[]> {
  const rows = await db.query<{ id: string; kind: string; version: string; sha256: string; title: string; requires_acceptance: number; published_at: string | null }>(
    "SELECT id, kind, version, sha256, title, requires_acceptance, published_at FROM legal_documents WHERE status = 'published' ORDER BY kind, published_at",
  );
  return rows.map((r) => ({ ...r, requires_acceptance: Number(r.requires_acceptance) === 1 }));
}

/** Van ban da phat hanh bat buoc chap nhan ma tai khoan chua chap nhan. Tai khoan noi bo: luon rong (cong chi ap dung cho khach ngoai). */
export async function pendingFor(db: Db, u: Pick<AuthUser, 'id' | 'kind'>): Promise<(PublishedDoc & { title: string; published_at: string | null })[]> {
  if (u.kind === 'internal') return [];
  const docs = await publishedDocs(db);
  if (!docs.some((d) => d.requires_acceptance)) return [];
  const acc = await db.query<{ document_id: string }>('SELECT document_id FROM legal_acceptances WHERE admin_id = ?', [u.id]);
  return pendingAcceptances(docs, new Set(acc.map((a) => a.document_id)));
}

export interface AcceptInput {
  document_id: string;
  sha256: string;
}
export type AcceptResult = { ok: true; recorded: number } | { ok: false; code: 'unknown_document' | 'hash_mismatch' | 'not_published'; document_id: string };

/** Ghi nhan chap nhan: kiem tra dung van ban dang phat hanh + dau van tay noi dung ma khach da xem. Chi INSERT. */
export async function recordAcceptances(rt: Runtime, db: Db, u: AuthUser, items: AcceptInput[], ip: string, ua: string | undefined): Promise<AcceptResult> {
  const now = rt.clock.now().toISOString();
  let recorded = 0;
  for (const it of items) {
    const d = (await db.query<{ id: string; kind: string; version: string; sha256: string; status: string }>('SELECT id, kind, version, sha256, status FROM legal_documents WHERE id = ?', [it.document_id]))[0];
    if (!d) return { ok: false, code: 'unknown_document', document_id: it.document_id };
    if (d.status !== 'published') return { ok: false, code: 'not_published', document_id: it.document_id };
    if (d.sha256 !== it.sha256) return { ok: false, code: 'hash_mismatch', document_id: it.document_id };
    const r = await db.run(
      `INSERT INTO legal_acceptances (id, admin_id, customer_id, document_id, kind, version, sha256, accepted_at, ip, user_agent)
       SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM legal_acceptances WHERE admin_id = ? AND document_id = ?)`,
      [rt.id(), u.id, u.customerId, d.id, d.kind, d.version, d.sha256, now, ip, (ua ?? '').slice(0, 200), u.id, d.id],
    );
    recorded += r.changes;
    if (r.changes) await db.run('INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, customer_id, ip, diff) VALUES (?,?,?,?,?,?,?,?,?)', [
      rt.id(), now, u.id, 'legal.accept', 'legal_document', d.id, u.customerId, ip, JSON.stringify({ kind: d.kind, version: d.version, sha256: d.sha256, user_agent: (ua ?? '').slice(0, 120) }),
    ]);
  }
  return { ok: true, recorded };
}

export { LEGAL_KINDS, legalDraftProblems };
