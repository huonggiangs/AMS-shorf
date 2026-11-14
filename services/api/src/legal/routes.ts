// Van ban phap ly: quan tri (soan/phat hanh/lich su chap nhan) + cong khach (can chap nhan) + cong khai (doc ban da phat hanh).
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { LEGAL_KINDS, LEGAL_VERSION_RE, legalDraftProblems, sha256Hex } from '@ams/shared';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { getRt, num, parseBody, runList } from '../lib/http.js';
import type { ListSpec } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';
import { LEGAL_COLS, ensureDraftDocuments, pendingFor, publishedDocs, recordAcceptances } from './service.js';
import type { LegalDocRow } from './service.js';

const present = (r: LegalDocRow) => ({ ...r, requires_acceptance: num(r.requires_acceptance) === 1, is_draft_marked: undefined });

const createBody = z.object({
  kind: z.enum(LEGAL_KINDS),
  version: z.string().trim().regex(LEGAL_VERSION_RE, 'Phiên bản gồm chữ, số, dấu chấm, gạch (tối đa 24 ký tự)'),
  title: z.string().trim().min(3).max(200),
  body_md: z.string().min(20).max(400_000),
  requires_acceptance: z.boolean().default(true),
  change_note: z.string().trim().max(500).optional(),
});

const listSpec: ListSpec = {
  from: 'FROM legal_documents d',
  select: LEGAL_COLS.split(', ').map((c) => `d.${c}`).join(', '),
  search: ['d.title', 'd.version'],
  sorts: { kind: 'd.kind', version: 'd.version', status: 'd.status', created_at: 'd.created_at', published_at: 'd.published_at' },
  defaultSort: 'created_at:desc',
  tiebreak: 'd.id',
  filters: { kind: (v) => ({ sql: 'd.kind = ?', params: [v] }), status: (v) => ({ sql: 'd.status = ?', params: [v] }) },
};

export function adminLegalRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/documents', requirePerm('admin', 'view'), async (c) => {
    const rt = getRt(c);
    await ensureDraftDocuments(rt);
    const res = await runList<LegalDocRow>(c, listSpec);
    return c.json({ ...res, items: res.items.map(present) });
  });

  r.get('/documents/:id', requirePerm('admin', 'view'), async (c) => {
    const rt = getRt(c);
    const d = (await rt.db.query<LegalDocRow & { body_md: string }>(`SELECT ${LEGAL_COLS}, body_md FROM legal_documents WHERE id = ?`, [c.req.param('id')]))[0];
    if (!d) throw notFound('Không tìm thấy văn bản.');
    const accepted = num((await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM legal_acceptances WHERE document_id = ?', [d.id]))[0]?.n);
    return c.json({ ...present(d), body_md: d.body_md, draft_problems: legalDraftProblems(d.body_md), acceptances: accepted });
  });

  r.post('/documents', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, createBody);
    const id = rt.id();
    const sha = await sha256Hex(b.body_md);
    await rt.db.tx(async (db) => {
      const ins = await db.run(
        `INSERT INTO legal_documents (id, kind, version, title, body_md, sha256, status, requires_acceptance, change_note, created_by, created_at)
         SELECT ?,?,?,?,?,?, 'draft', ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM legal_documents WHERE kind = ? AND version = ?)`,
        [id, b.kind, b.version, b.title, b.body_md, sha, b.requires_acceptance ? 1 : 0, b.change_note ?? null, c.get('user').id, rt.clock.now().toISOString(), b.kind, b.version],
      );
      if (ins.changes !== 1) throw conflict('Phiên bản này đã tồn tại cho loại văn bản.', 'duplicate_version');
      await auditCtx(c, db, { action: 'legal.document.create', objectType: 'legal_document', objectId: id, diff: { kind: b.kind, version: b.version, sha256: sha } });
    });
    return c.json({ id, sha256: sha, status: 'draft' }, 201);
  });

  // Chi sua ban nhap; da phat hanh la bat bien (muon doi phai tao phien ban moi)
  r.put('/documents/:id', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, createBody.pick({ title: true, body_md: true, requires_acceptance: true, change_note: true }).partial());
    const cur = (await rt.db.query<{ id: string; title: string; body_md: string; requires_acceptance: number; change_note: string | null }>('SELECT id, title, body_md, requires_acceptance, change_note FROM legal_documents WHERE id = ?', [c.req.param('id')]))[0];
    if (!cur) throw notFound('Không tìm thấy văn bản.');
    const body = b.body_md ?? cur.body_md;
    const sha = await sha256Hex(body);
    await rt.db.tx(async (db) => {
      const u = await db.run(
        "UPDATE legal_documents SET title = ?, body_md = ?, sha256 = ?, requires_acceptance = ?, change_note = ? WHERE id = ? AND status = 'draft'",
        [b.title ?? cur.title, body, sha, (b.requires_acceptance ?? num(cur.requires_acceptance) === 1) ? 1 : 0, b.change_note ?? cur.change_note, cur.id],
      );
      if (u.changes !== 1) throw conflict('Chỉ sửa được văn bản ở trạng thái nháp. Hãy tạo phiên bản mới.', 'invalid_state');
      await auditCtx(c, db, { action: 'legal.document.update', objectType: 'legal_document', objectId: cur.id, diff: { sha256: sha } });
    });
    return c.json({ id: cur.id, sha256: sha, status: 'draft' });
  });

  // draft -> published. Hanh dong cua quan tri xac nhan luat su da duyet (khong tu dong). Phien ban published truoc do cung loai -> retired.
  r.post('/documents/:id/publish', requirePerm('admin', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({
      confirm_lawyer_approved: z.literal(true, { errorMap: () => ({ message: 'Phải xác nhận luật sư đã duyệt văn bản này' }) }),
      lawyer_ref: z.string().trim().max(200).optional(),
      allow_draft_markers: z.boolean().optional(),
    }));
    const d = (await rt.db.query<{ id: string; kind: string; version: string; body_md: string; sha256: string }>('SELECT id, kind, version, body_md, sha256 FROM legal_documents WHERE id = ?', [c.req.param('id')]))[0];
    if (!d) throw notFound('Không tìm thấy văn bản.');
    const problems = legalDraftProblems(d.body_md);
    if (problems.length && !b.allow_draft_markers) throw unprocessable('Văn bản còn dấu hiệu bản nháp, chưa thể phát hành cho khách.', 'draft_not_final', { problems });
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE legal_documents SET status = 'published', published_at = ?, published_by = ? WHERE id = ? AND status = 'draft'", [now, c.get('user').id, d.id]);
      if (u.changes !== 1) throw conflict('Văn bản không còn ở trạng thái nháp.', 'invalid_state');
      await db.run("UPDATE legal_documents SET status = 'retired' WHERE kind = ? AND status = 'published' AND id <> ?", [d.kind, d.id]);
      await auditCtx(c, db, { action: 'legal.document.publish', objectType: 'legal_document', objectId: d.id, diff: { kind: d.kind, version: d.version, sha256: d.sha256, lawyer_ref: b.lawyer_ref ?? null, draft_markers_overridden: problems.length > 0 } });
    });
    return c.json({ id: d.id, status: 'published', published_at: now, draft_problems: problems });
  });

  r.post('/documents/:id/retire', requirePerm('admin', 'approve'), async (c) => {
    const rt = getRt(c);
    const d = (await rt.db.query<{ id: string; kind: string; version: string }>('SELECT id, kind, version FROM legal_documents WHERE id = ?', [c.req.param('id')]))[0];
    if (!d) throw notFound('Không tìm thấy văn bản.');
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE legal_documents SET status = 'retired' WHERE id = ? AND status = 'published'", [d.id]);
      if (u.changes !== 1) throw conflict('Chỉ gỡ được văn bản đang phát hành.', 'invalid_state');
      await auditCtx(c, db, { action: 'legal.document.retire', objectType: 'legal_document', objectId: d.id, diff: { kind: d.kind, version: d.version } });
    });
    return c.json({ id: d.id, status: 'retired' });
  });

  // Lich su chap nhan (bang chung): ai, phien ban/dau van tay, luc nao, IP.
  r.get('/acceptances', requirePerm('admin', 'view'), async (c) => {
    const res = await runList<Record<string, unknown>>(c, {
      from: 'FROM legal_acceptances a JOIN admins ad ON ad.id = a.admin_id LEFT JOIN customers cu ON cu.id = a.customer_id',
      select: 'a.id, a.admin_id, ad.email, ad.name, a.customer_id, cu.short_name AS customer, a.document_id, a.kind, a.version, a.sha256, a.accepted_at, a.ip, a.user_agent',
      search: ['ad.email', 'cu.short_name'],
      sorts: { accepted_at: 'a.accepted_at', kind: 'a.kind', customer: 'cu.short_name' },
      defaultSort: 'accepted_at:desc',
      tiebreak: 'a.id',
      filters: { kind: (v) => ({ sql: 'a.kind = ?', params: [v] }), document_id: (v) => ({ sql: 'a.document_id = ?', params: [v] }), customer_id: (v) => ({ sql: 'a.customer_id = ?', params: [v] }) },
    });
    return c.json(res);
  });

  // Tien do: bao nhieu tai khoan ngoai con thieu chap nhan ban dang phat hanh
  r.get('/coverage', requirePerm('admin', 'view'), async (c) => {
    const rt = getRt(c);
    const docs = await publishedDocs(rt.db);
    const ext = num((await rt.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM admins WHERE account_kind <> 'internal' AND status = 'active'"))[0]?.n);
    const items = [];
    for (const d of docs) {
      const accepted = num((await rt.db.query<{ n: number }>('SELECT COUNT(DISTINCT a.admin_id) AS n FROM legal_acceptances a JOIN admins ad ON ad.id = a.admin_id WHERE a.document_id = ? AND ad.status = ?', [d.id, 'active']))[0]?.n);
      items.push({ document_id: d.id, kind: d.kind, version: d.version, requires_acceptance: d.requires_acceptance, accepted, pending: Math.max(0, ext - accepted) });
    }
    return c.json({ external_accounts: ext, items });
  });
  return r;
}

/** Cong khach hang: danh sach van ban dang cho chap nhan + ghi chap nhan. Duoc go cua (termsGate) cho phep ca khi chua chap nhan. */
export function portalLegalRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/pending', async (c) => {
    const rt = getRt(c);
    const pend = await pendingFor(rt.db, c.get('user'));
    const out = [];
    for (const d of pend) {
      const body = (await rt.db.query<{ body_md: string }>('SELECT body_md FROM legal_documents WHERE id = ?', [d.id]))[0]?.body_md ?? '';
      out.push({ id: d.id, kind: d.kind, version: d.version, title: d.title, sha256: d.sha256, published_at: d.published_at, body_md: body });
    }
    return c.json({ pending: out, required: out.length > 0 });
  });
  r.get('/documents', async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const docs = await publishedDocs(rt.db);
    const acc = new Set((await rt.db.query<{ document_id: string }>('SELECT document_id FROM legal_acceptances WHERE admin_id = ?', [u.id])).map((x) => x.document_id));
    return c.json({ items: docs.map((d) => ({ id: d.id, kind: d.kind, version: d.version, title: d.title, published_at: d.published_at, accepted: acc.has(d.id) })) });
  });
  r.get('/documents/:id', async (c) => {
    const rt = getRt(c);
    const d = (await rt.db.query<{ id: string; kind: string; version: string; title: string; sha256: string; body_md: string }>("SELECT id, kind, version, title, sha256, body_md FROM legal_documents WHERE id = ? AND status = 'published'", [c.req.param('id')]))[0];
    if (!d) throw notFound('Không tìm thấy văn bản.');
    return c.json(d);
  });
  r.post('/accept', async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ acceptances: z.array(z.object({ document_id: z.string().min(1).max(64), sha256: z.string().length(64) })).min(1).max(10) }));
    const res = await rt.db.tx((db) => recordAcceptances(rt, db, c.get('user'), b.acceptances, c.get('ip'), c.req.header('user-agent')));
    if (!res.ok) {
      const msg = res.code === 'hash_mismatch' ? 'Nội dung văn bản đã thay đổi, hãy tải lại và đọc phiên bản mới.' : res.code === 'not_published' ? 'Văn bản không còn hiệu lực, hãy tải lại.' : 'Không tìm thấy văn bản.';
      throw conflict(msg, res.code === 'unknown_document' ? 'not_found' : res.code, { document_id: res.document_id });
    }
    const still = await pendingFor(rt.db, c.get('user'));
    return c.json({ recorded: res.recorded, pending: still.map((d) => ({ id: d.id, kind: d.kind, version: d.version })), required: still.length > 0 });
  });
  return r;
}

/** Doc cong khai ban da phat hanh (trang dang ky/chan trang). Khong tra ban nhap/da go. */
export function publicLegalRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/documents', async (c) => {
    const rt = getRt(c);
    const rows = await rt.db.query<{ id: string; kind: string; version: string; title: string; published_at: string | null; sha256: string }>("SELECT id, kind, version, title, published_at, sha256 FROM legal_documents WHERE status = 'published' ORDER BY kind");
    return c.json({ items: rows });
  });
  r.get('/documents/:kind', async (c) => {
    const rt = getRt(c);
    const d = (await rt.db.query<{ id: string; kind: string; version: string; title: string; body_md: string; sha256: string; published_at: string | null }>("SELECT id, kind, version, title, body_md, sha256, published_at FROM legal_documents WHERE kind = ? AND status = 'published'", [c.req.param('kind')]))[0];
    if (!d) throw notFound('Văn bản này chưa được phát hành.');
    return c.json(d);
  });
  return r;
}

const GATE_EXEMPT = ['/portal/v1/me', '/portal/v1/legal'];
/** Cong chap nhan dieu khoan: tai khoan ngoai chua chap nhan van ban bat buoc da phat hanh => 403 `terms_acceptance_required` (tru /me va /legal). */
export const termsGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.get('user');
  if (u.kind === 'internal') return next();
  const p = c.req.path;
  if (GATE_EXEMPT.some((x) => p === x || p.startsWith(`${x}/`))) return next();
  const pend = await pendingFor(c.get('rt').db, u);
  if (pend.length) throw forbidden('Vui lòng đọc và chấp nhận điều khoản dịch vụ mới nhất trước khi tiếp tục.', 'terms_acceptance_required', { pending: pend.map((d) => ({ id: d.id, kind: d.kind, version: d.version })) });
  return next();
};
