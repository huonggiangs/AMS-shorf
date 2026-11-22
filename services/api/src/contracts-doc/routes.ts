// Soan hop dong tu mau + xuat PDF: /admin/v1/contract-docs
//  - Mau (phien ban, ban nhap -> luat su duyet), ban soan theo hop dong (nhap -> chot), logo watermark.
//  - Chot ban (final) can admin:approve VA mau da duoc luat su duyet; ban nhap xuat PDF co dau "BAN NHAP".
import { Hono } from 'hono';
import { z } from 'zod';
import { CONTRACT_VARIABLES, legalDraftProblems, sha256Hex, validateArticles } from '@ams/shared';
import type { ArticleOverrides, ContractArticle } from '@ams/shared';
import { PDFDocument } from 'pdf-lib';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { getRt, jsonParse, num, parseBody } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';
import { renderContractPdf } from './pdf.js';
import {
  DOC_COLS,
  LOGO_MAX_BYTES,
  LOGO_SETTING,
  TPL_COLS,
  buildModel,
  cleanVariables,
  ensureDefaultTemplate,
  getLogoMeta,
  loadContext,
  loadLogo,
  loadTemplate,
  parseArticles,
  pdfInputFrom,
  pickDefaultTemplate,
  unknownVariablesIn,
} from './service.js';
import type { DocModel, DocRow, LogoMeta, TemplateRow } from './service.js';
import { EXPORT_FORMAT, IMPORT_MAX_BYTES, ImportError, parseTemplateFile } from './import.js';

const articleSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000),
  numbered: z.boolean().optional(),
});
const articlesSchema = z.array(articleSchema).min(1).max(40);

const presentTemplate = (t: TemplateRow, withBody = false) => {
  const articles = parseArticles(t.articles);
  return {
    id: t.id,
    code: t.code,
    version: t.version,
    name: t.name,
    status: t.status,
    lawyer_ref: t.lawyer_ref,
    approved_at: t.approved_at,
    change_note: t.change_note,
    created_at: t.created_at,
    article_count: articles.length,
    draft_problems: legalDraftProblems(articles.map((a) => `${a.title}\n${a.body}`).join('\n\n')),
    ...(withBody ? { articles } : {}),
  };
};

const overridesSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), z.object({ title: z.string().trim().min(1).max(200).optional(), body: z.string().max(20_000).optional() }));

const presentDocBrief = (d: DocRow, tpl: { code: string; version: number; status: string }) => ({
  id: d.id,
  contract_id: d.contract_id,
  version: d.version,
  status: d.status,
  content_hash: d.content_hash,
  finalized_at: d.finalized_at,
  created_at: d.created_at,
  updated_at: d.updated_at,
  template_id: d.template_id,
  template_code: tpl.code,
  template_version: tpl.version,
  template_status: tpl.status,
});

async function loadDoc(rt: ReturnType<typeof getRt>, id: string): Promise<DocRow> {
  const d = (await rt.db.query<DocRow>(`SELECT ${DOC_COLS} FROM contract_docs WHERE id = ?`, [id]))[0];
  if (!d) throw notFound('Không tìm thấy bản soạn hợp đồng.');
  return d;
}

/** Mo hinh van ban cua mot ban soan: ban chot doc tu snapshot (bat bien), ban nhap dung lai tu mau + ho so hien tai. */
async function modelOf(rt: ReturnType<typeof getRt>, d: DocRow): Promise<{ model: DocModel; tpl: TemplateRow }> {
  const tpl = await loadTemplate(rt.db, d.template_id);
  if (d.status !== 'draft' && d.snapshot) {
    const snap = jsonParse<DocModel | null>(d.snapshot, null);
    if (snap) return { model: { ...snap, hash: d.content_hash ?? snap.hash, text: d.rendered_text ?? snap.text, missing: [] }, tpl };
  }
  const ctx = await loadContext(rt, d.contract_id);
  const model = await buildModel(rt, ctx, tpl, d.version, cleanVariables(jsonParse(d.variables, {})), jsonParse<ArticleOverrides>(d.article_overrides, {}));
  return { model, tpl };
}

export function contractDocRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ---------- danh muc bien ----------
  r.get('/variables', requirePerm('customers', 'view'), (c) => c.json({ items: CONTRACT_VARIABLES }));

  // ---------- mau ----------
  r.get('/templates', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    await ensureDefaultTemplate(rt);
    const rows = await rt.db.query<TemplateRow>(`SELECT ${TPL_COLS} FROM contract_doc_templates ORDER BY code, version DESC`);
    return c.json({ items: rows.map((t) => presentTemplate(t)) });
  });

  // Nhap mau tu tep may tinh: CHI xem truoc (khong ghi DB). Than yeu cau = byte tho cua tep (<= 2 MB), ten tep o ?filename=.
  // Luu bang POST /templates (co `import_source`), nen mau nhap luon la phien ban NHAP moi, can luat su duyet nhu moi mau khac.
  r.post('/templates/import-preview', requirePerm('admin', 'write'), async (c) => {
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > IMPORT_MAX_BYTES + 1024) throw unprocessable('Tệp quá lớn (tối đa 2 MB).', 'file_too_large');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const filename = (c.req.query('filename') ?? '').slice(0, 200);
    try {
      return c.json(await parseTemplateFile(filename, bytes));
    } catch (e) {
      if (e instanceof ImportError) throw unprocessable(e.message, e.code);
      throw e;
    }
  });

  // Xuat mau ra .json (khung giong tep nhap): vong tron xuat -> nhap
  r.get('/templates/:id/export', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    const t = await loadTemplate(rt.db, c.req.param('id'));
    await auditCtx(c, rt.db, { action: 'contract_template.export', objectType: 'contract_doc_template', objectId: t.id, diff: { code: t.code, version: t.version } });
    return c.json({ format: EXPORT_FORMAT, version: 1, code: t.code, template_version: t.version, name: t.name, status: t.status, exported_at: rt.clock.now().toISOString(), articles: parseArticles(t.articles) });
  });

  r.get('/templates/:id', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    return c.json(presentTemplate(await loadTemplate(rt.db, c.req.param('id')), true));
  });

  r.post('/templates', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ code: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).default('ads-service'), name: z.string().trim().min(3).max(200), articles: articlesSchema, change_note: z.string().trim().max(500).optional(), import_source: z.enum(['docx', 'txt', 'md', 'html', 'json']).optional() }));
    const issues = validateArticles(b.articles as ContractArticle[]);
    if (issues.length) throw unprocessable('Mẫu hợp đồng chưa hợp lệ.', 'invalid_template', { issues });
    await ensureDefaultTemplate(rt);
    const id = rt.id();
    await rt.db.tx(async (db) => {
      const mx = num((await db.query<{ v: number | null }>('SELECT MAX(version) AS v FROM contract_doc_templates WHERE code = ?', [b.code]))[0]?.v);
      const ins = await db.run(
        `INSERT INTO contract_doc_templates (id, code, version, name, articles, status, change_note, created_by, created_at)
         SELECT ?,?,?,?,?, 'draft', ?,?,? WHERE NOT EXISTS (SELECT 1 FROM contract_doc_templates WHERE code = ? AND version = ?)`,
        [id, b.code, mx + 1, b.name, JSON.stringify(b.articles), b.change_note ?? null, c.get('user').id, rt.clock.now().toISOString(), b.code, mx + 1],
      );
      if (ins.changes !== 1) throw conflict('Phiên bản mẫu vừa được tạo bởi người khác. Hãy thử lại.', 'duplicate_version');
      await auditCtx(c, db, { action: 'contract_template.create', objectType: 'contract_doc_template', objectId: id, diff: { code: b.code, version: mx + 1, ...(b.import_source ? { import_source: b.import_source, articles: b.articles.length } : {}) } });
    });
    return c.json(presentTemplate(await loadTemplate(rt.db, id), true), 201);
  });

  // Chi sua mau o trang thai nhap (mau da duyet la bat bien: muon doi thi tao phien ban moi)
  r.put('/templates/:id', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ name: z.string().trim().min(3).max(200).optional(), articles: articlesSchema.optional(), change_note: z.string().trim().max(500).optional() }));
    const cur = await loadTemplate(rt.db, c.req.param('id'));
    const articles = b.articles ?? parseArticles(cur.articles);
    const issues = validateArticles(articles as ContractArticle[]);
    if (issues.length) throw unprocessable('Mẫu hợp đồng chưa hợp lệ.', 'invalid_template', { issues });
    const json = JSON.stringify(articles);
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE contract_doc_templates SET name = ?, articles = ?, change_note = ? WHERE id = ? AND status = 'draft'", [b.name ?? cur.name, json, b.change_note ?? cur.change_note, cur.id]);
      if (u.changes !== 1) throw conflict('Chỉ sửa được mẫu ở trạng thái nháp. Hãy tạo phiên bản mới.', 'invalid_state');
      await auditCtx(c, db, { action: 'contract_template.update', objectType: 'contract_doc_template', objectId: cur.id, diff: { sha256: await sha256Hex(json) } });
    });
    return c.json(presentTemplate(await loadTemplate(rt.db, cur.id), true));
  });

  // draft -> approved: hanh dong cua nguoi co admin:approve xac nhan luat su da duyet (khong bao gio tu dong)
  r.post('/templates/:id/approve', requirePerm('admin', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({
      confirm_lawyer_approved: z.literal(true, { errorMap: () => ({ message: 'Phải xác nhận luật sư đã duyệt mẫu này' }) }),
      lawyer_ref: z.string().trim().max(200).optional(),
      allow_draft_markers: z.boolean().optional(),
    }));
    const t = await loadTemplate(rt.db, c.req.param('id'));
    const articles = parseArticles(t.articles);
    const problems = legalDraftProblems(articles.map((a) => `${a.title}\n${a.body}`).join('\n\n'));
    if (problems.length && !b.allow_draft_markers) throw unprocessable('Mẫu còn dấu hiệu bản nháp, chưa thể duyệt.', 'draft_not_final', { problems });
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE contract_doc_templates SET status = 'approved', approved_by = ?, approved_at = ?, lawyer_ref = ? WHERE id = ? AND status = 'draft'", [c.get('user').id, now, b.lawyer_ref ?? null, t.id]);
      if (u.changes !== 1) throw conflict('Mẫu không còn ở trạng thái nháp.', 'invalid_state');
      await db.run("UPDATE contract_doc_templates SET status = 'retired' WHERE code = ? AND status = 'approved' AND id <> ?", [t.code, t.id]);
      await auditCtx(c, db, { action: 'contract_template.approve', objectType: 'contract_doc_template', objectId: t.id, diff: { code: t.code, version: t.version, sha256: await sha256Hex(t.articles), lawyer_ref: b.lawyer_ref ?? null, draft_markers_overridden: problems.length > 0 } });
    });
    return c.json({ id: t.id, status: 'approved', approved_at: now, draft_problems: problems });
  });

  // ---------- logo watermark ----------
  r.get('/logo', requirePerm('customers', 'view'), async (c) => {
    const m = await getLogoMeta(getRt(c).db);
    return c.json({ is_default: !m, default_text: 'ANIO', logo: m ? { content_type: m.content_type, sha256: m.sha256, width: m.width, height: m.height, bytes: m.bytes, uploaded_at: m.uploaded_at } : null });
  });

  r.get('/logo/image', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    const m = await getLogoMeta(rt.db);
    const bytes = m ? await rt.objects.get(m.key) : null;
    if (!m || !bytes) throw notFound('Chưa tải logo, đang dùng logo chữ mặc định.', 'logo_not_found');
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': m.content_type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  });

  r.put('/logo', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ content_type: z.enum(['image/png', 'image/jpeg']), data_base64: z.string().min(16).max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 8) }));
    let bytes: Uint8Array;
    try {
      const bin = atob(b.data_base64.replace(/\s+/g, ''));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      throw unprocessable('Dữ liệu ảnh không phải base64 hợp lệ.', 'bad_image');
    }
    if (bytes.length > LOGO_MAX_BYTES) throw unprocessable('Logo tối đa 600 KB.', 'logo_too_large', { limit_bytes: LOGO_MAX_BYTES });
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if ((b.content_type === 'image/png' && !isPng) || (b.content_type === 'image/jpeg' && !isJpg)) throw unprocessable('Nội dung tệp không khớp định dạng đã khai báo (chỉ PNG hoặc JPEG).', 'bad_image');
    // pdf-lib phan tich anh that: tep hong/khong phai anh bi tu choi, dong thoi lay kich thuoc
    let width = 0;
    let height = 0;
    try {
      const probe = await PDFDocument.create();
      const img = isPng ? await probe.embedPng(bytes) : await probe.embedJpg(bytes);
      width = img.width;
      height = img.height;
    } catch {
      throw unprocessable('Không đọc được ảnh. Hãy dùng PNG hoặc JPEG hợp lệ.', 'bad_image');
    }
    if (width < 64 || height < 64 || width > 4000 || height > 4000) throw unprocessable('Kích thước logo từ 64x64 đến 4000x4000 điểm ảnh.', 'bad_image_size', { width, height });
    const sha = await sha256Hex(bytes);
    const key = `branding/contract-logo-${sha.slice(0, 16)}`;
    const meta: LogoMeta = { key, content_type: b.content_type, sha256: sha, width, height, bytes: bytes.length, uploaded_by: c.get('user').id, uploaded_at: rt.clock.now().toISOString() };
    await rt.objects.put(key, bytes, b.content_type);
    await rt.db.tx(async (db) => {
      await db.run(
        'INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        [LOGO_SETTING, JSON.stringify(meta), meta.uploaded_by, meta.uploaded_at],
      );
      await auditCtx(c, db, { action: 'contract_logo.set', objectType: 'setting', objectId: LOGO_SETTING, diff: { sha256: sha, width, height, bytes: bytes.length } });
    });
    return c.json({ is_default: false, logo: { content_type: meta.content_type, sha256: sha, width, height, bytes: bytes.length, uploaded_at: meta.uploaded_at } });
  });

  r.delete('/logo', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    await rt.db.tx(async (db) => {
      await db.run('DELETE FROM settings WHERE key = ?', [LOGO_SETTING]);
      await auditCtx(c, db, { action: 'contract_logo.clear', objectType: 'setting', objectId: LOGO_SETTING });
    });
    return c.json({ is_default: true, logo: null });
  });

  // ---------- ban soan theo hop dong ----------
  r.get('/by-contract/:contractId', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    const cid = c.req.param('contractId');
    if (!(await rt.db.query('SELECT 1 AS x FROM contracts WHERE id = ?', [cid]))[0]) throw notFound('Không tìm thấy hợp đồng.');
    const rows = await rt.db.query<DocRow & { t_code: string; t_version: number; t_status: string }>(
      `SELECT ${DOC_COLS.split(', ').map((x) => `d.${x}`).join(', ')}, t.code AS t_code, t.version AS t_version, t.status AS t_status FROM contract_docs d JOIN contract_doc_templates t ON t.id = d.template_id WHERE d.contract_id = ? ORDER BY d.version DESC`,
      [cid],
    );
    return c.json({ items: rows.map((d) => presentDocBrief(d, { code: d.t_code, version: d.t_version, status: d.t_status })) });
  });

  r.post('/by-contract/:contractId', requirePerm('customers', 'write'), async (c) => {
    const rt = getRt(c);
    const cid = c.req.param('contractId');
    const b = await parseBody(c, z.object({ template_id: z.string().max(64).optional() }));
    const ctx = await loadContext(rt, cid); // 404 neu khong co hop dong
    const tpl = b.template_id ? await loadTemplate(rt.db, b.template_id) : await pickDefaultTemplate(rt);
    if (tpl.status === 'retired') throw conflict('Mẫu này đã ngừng dùng.', 'template_retired');
    const id = rt.id();
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      const open = (await db.query<{ id: string }>("SELECT id FROM contract_docs WHERE contract_id = ? AND status = 'draft'", [cid]))[0];
      if (open) throw conflict('Hợp đồng này đã có bản soạn nháp. Hãy tiếp tục sửa bản đó.', 'draft_exists', { id: open.id });
      const mx = num((await db.query<{ v: number | null }>('SELECT MAX(version) AS v FROM contract_docs WHERE contract_id = ?', [cid]))[0]?.v);
      await db.run(
        `INSERT INTO contract_docs (id, contract_id, template_id, version, status, variables, article_overrides, created_by, created_at, updated_at) VALUES (?,?,?,?, 'draft', '{}', '{}', ?,?,?)`,
        [id, cid, tpl.id, mx + 1, c.get('user').id, now, now],
      );
      await auditCtx(c, db, { action: 'contract_doc.create', objectType: 'contract_doc', objectId: id, customerId: ctx.customerId, diff: { contract_id: cid, version: mx + 1, template: `${tpl.code}@${tpl.version}` } });
    });
    return c.json(presentDocBrief(await loadDoc(rt, id), tpl), 201);
  });

  const detail = async (c: Ctx, d: DocRow) => {
    const rt = getRt(c);
    const { model, tpl } = await modelOf(rt, d);
    const articles = parseArticles(tpl.articles);
    const ov = jsonParse<ArticleOverrides>(d.article_overrides, {});
    return {
      ...presentDocBrief(d, tpl),
      variables: cleanVariables(jsonParse(d.variables, {})),
      effective_variables: model.vars,
      articles: articles.map((a) => ({ key: a.key, numbered: a.numbered !== false, title: ov[a.key]?.title ?? a.title, body: ov[a.key]?.body ?? a.body, overridden: Boolean(ov[a.key]) })),
      rendered: model.rendered,
      price: model.price,
      text: model.text,
      missing: model.missing,
      computed_hash: model.hash,
      is_draft_notice: d.status === 'draft',
      template_approved: tpl.status === 'approved',
    };
  };

  r.get('/:id', requirePerm('customers', 'view'), async (c) => c.json(await detail(c, await loadDoc(getRt(c), c.req.param('id')))));
  r.get('/:id/preview', requirePerm('customers', 'view'), async (c) => c.json(await detail(c, await loadDoc(getRt(c), c.req.param('id')))));

  r.put('/:id', requirePerm('customers', 'write'), async (c) => {
    const rt = getRt(c);
    const d = await loadDoc(rt, c.req.param('id'));
    const b = await parseBody(c, z.object({ variables: z.record(z.string().max(100), z.string().max(2000)).optional(), article_overrides: overridesSchema.optional() }));
    if (d.status !== 'draft') throw conflict('Bản đã chốt không sửa được. Hãy tạo phiên bản mới.', 'invalid_state');
    const tpl = await loadTemplate(rt.db, d.template_id);
    const keys = new Set(parseArticles(tpl.articles).map((a) => a.key));
    const vars = b.variables ? cleanVariables(b.variables) : cleanVariables(jsonParse(d.variables, {}));
    if (b.variables) {
      const unknown = Object.keys(b.variables).filter((k) => !(k in vars));
      if (unknown.length) throw unprocessable('Có biến không có trong danh mục.', 'unknown_variable', { variables: unknown });
    }
    const ov: ArticleOverrides = b.article_overrides ?? jsonParse<ArticleOverrides>(d.article_overrides, {});
    const badKeys = Object.keys(ov).filter((k) => !keys.has(k));
    if (badKeys.length) throw unprocessable('Điều khoản không có trong mẫu.', 'unknown_article', { keys: badKeys });
    const bad = unknownVariablesIn(ov);
    if (bad.length) throw unprocessable('Có biến không có trong danh mục.', 'unknown_variable', { variables: bad });
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE contract_docs SET variables = ?, article_overrides = ?, updated_at = ? WHERE id = ? AND status = 'draft'", [JSON.stringify(vars), JSON.stringify(ov), now, d.id]);
      if (u.changes !== 1) throw conflict('Bản soạn không còn ở trạng thái nháp.', 'invalid_state');
      await auditCtx(c, db, { action: 'contract_doc.update', objectType: 'contract_doc', objectId: d.id, diff: { variables: Object.keys(vars), articles_overridden: Object.keys(ov) } });
    });
    return c.json(await detail(c, await loadDoc(rt, d.id)));
  });

  r.delete('/:id', requirePerm('customers', 'write'), async (c) => {
    const rt = getRt(c);
    const d = await loadDoc(rt, c.req.param('id'));
    await rt.db.tx(async (db) => {
      const u = await db.run("DELETE FROM contract_docs WHERE id = ? AND status = 'draft'", [d.id]);
      if (u.changes !== 1) throw conflict('Chỉ xóa được bản nháp.', 'invalid_state');
      await auditCtx(c, db, { action: 'contract_doc.delete', objectType: 'contract_doc', objectId: d.id, diff: { version: d.version } });
    });
    return c.json({ ok: true });
  });

  // chot: nhap -> final. admin:approve + mau da duoc luat su duyet + khong con cho trong. Ghi dau van tay vao audit.
  r.post('/:id/finalize', requirePerm('admin', 'approve'), async (c) => {
    const rt = getRt(c);
    const d = await loadDoc(rt, c.req.param('id'));
    const b = await parseBody(c, z.object({ content_hash: z.string().regex(/^[0-9a-f]{64}$/).optional() }));
    if (d.status !== 'draft') throw conflict('Bản này không còn ở trạng thái nháp.', 'invalid_state');
    const tpl = await loadTemplate(rt.db, d.template_id);
    if (tpl.status !== 'approved') throw unprocessable('Mẫu hợp đồng chưa được luật sư duyệt nên chưa thể chốt bản ký.', 'template_not_approved', { template_status: tpl.status });
    const ctx = await loadContext(rt, d.contract_id);
    const model = await buildModel(rt, ctx, tpl, d.version, cleanVariables(jsonParse(d.variables, {})), jsonParse<ArticleOverrides>(d.article_overrides, {}));
    if (model.missing.length) throw unprocessable('Còn thông tin trống trong hợp đồng.', 'missing_variables', { missing: model.missing });
    if (b.content_hash && b.content_hash !== model.hash) throw conflict('Nội dung đã thay đổi kể từ lần xem trước. Hãy xem lại rồi chốt.', 'content_changed', { content_hash: model.hash });
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      const u = await db.run("UPDATE contract_docs SET status = 'final', snapshot = ?, rendered_text = ?, content_hash = ?, finalized_by = ?, finalized_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'", [JSON.stringify({ ...model, missing: [] }), model.text, model.hash, c.get('user').id, now, now, d.id]);
      if (u.changes !== 1) throw conflict('Bản này không còn ở trạng thái nháp.', 'invalid_state');
      await db.run("UPDATE contract_docs SET status = 'superseded' WHERE contract_id = ? AND status = 'final' AND id <> ?", [d.contract_id, d.id]);
      await auditCtx(c, db, { action: 'contract_doc.finalize', objectType: 'contract_doc', objectId: d.id, customerId: ctx.customerId, diff: { contract_no: ctx.contractNo, version: d.version, content_hash: model.hash, template: `${tpl.code}@${tpl.version}`, lawyer_ref: tpl.lawyer_ref } });
    });
    return c.json({ id: d.id, status: 'final', content_hash: model.hash, finalized_at: now });
  });

  // xuat PDF: ban nhap co dau BAN NHAP; ban chot chi khi mau da duoc duyet (da dam bao luc chot)
  r.get('/:id/pdf', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    const d = await loadDoc(rt, c.req.param('id'));
    const { model, tpl } = await modelOf(rt, d);
    const final = d.status !== 'draft';
    const bytes = await renderContractPdf(pdfInputFrom(model, { docVersion: d.version, status: final ? 'final' : 'draft', templateApproved: tpl.status === 'approved' || final, stampIso: d.finalized_at ?? d.updated_at, logo: await loadLogo(rt) }));
    await rt.db.tx(async (db) => auditCtx(c, db, { action: 'contract_doc.export_pdf', objectType: 'contract_doc', objectId: d.id, diff: { version: d.version, status: d.status, content_hash: model.hash } }));
    const name = `${model.contractNo}-v${d.version}${final ? '' : '-BAN-NHAP'}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Hash': model.hash,
      'X-Contract-Doc-Status': d.status,
      'Content-Length': String(bytes.length),
    });
  });

  return r;
}
