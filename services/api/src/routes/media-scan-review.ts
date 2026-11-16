// Duyet tay creative 'needs_manual_review' (duong Cloudflare, khong co ClamAV): xem docs/CLOUDFLARE-MEDIA-LIMITS.md.
// Chi nguoi co quyen media:approve; moi quyet dinh ghi audit. Duyet => scan_state='clean' (van phai qua buoc duyet noi dung nhu thuong).
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePerm } from '../auth/middleware.js';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { assertContentVersion } from '../lib/creative-security.js';
import { conflict, notFound } from '../lib/errors.js';
import { getRt, parseBody } from '../lib/http.js';
import { bumpManifest } from '../lib/manifest.js';
import type { AppEnv } from '../types.js';

export const NEEDS_MANUAL_REVIEW = 'needs_manual_review';

interface QueueRow {
  id: string; customer_id: string; customer_name: string | null; name: string | null; mime: string | null; kind: string | null; source: string | null; storage_key: string | null;
  size_bytes: number | null; duration_s: number | null; px_w: number | null; px_h: number | null; scan_state: string; created_at: string; engine: string | null; detail: string | null; sha256: string | null; content_version: number | null;
}

const queueQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).catch(1).default(1), page_size: z.coerce.number().int().min(1).max(100).catch(20).default(20) });

export function mediaScanReviewRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Hang cho kiem tra thu cong, phan trang (page/page_size). Moi muc co phien ban noi dung (content_version) de quyet dinh gan dung phien ban da xem.
  r.get('/scan-review/queue', requirePerm('media', 'approve'), async (c) => {
    const rt = getRt(c);
    const q = queueQuery.parse({ page: c.req.query('page'), page_size: c.req.query('page_size') });
    const total = Number((await rt.db.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM creatives WHERE scan_state = ?', [NEEDS_MANUAL_REVIEW]))[0]?.n ?? 0);
    const rows = await rt.db.query<QueueRow>(
      `SELECT m.id, m.customer_id, cu.short_name AS customer_name, m.name, m.mime, m.kind, m.source, m.storage_key, m.size_bytes, m.duration_s, m.px_w, m.px_h, m.scan_state, m.created_at,
              v.engine, v.detail, COALESCE(v.sha256, m.sha256) AS sha256, COALESCE(sec.content_version, 1) AS content_version
         FROM creatives m JOIN customers cu ON cu.id = m.customer_id LEFT JOIN creative_validation v ON v.creative_id = m.id LEFT JOIN creative_security sec ON sec.creative_id = m.id
        WHERE m.scan_state = ? ORDER BY m.created_at, m.id LIMIT ? OFFSET ?`,
      [NEEDS_MANUAL_REVIEW, q.page_size, (q.page - 1) * q.page_size],
    );
    const items = await Promise.all(
      rows.map(async (x) => {
        let d: { reasons?: string[] } = {};
        try {
          d = x.detail ? JSON.parse(x.detail) : {};
        } catch {
          /* chi tiet hong: bo qua */
        }
        let preview_url: string | null = null;
        if (x.source === 'upload' && x.storage_key) {
          try {
            preview_url = await rt.objects.getSigned(x.storage_key, 300);
          } catch {
            preview_url = null;
          }
        }
        return {
          id: x.id, customer_id: x.customer_id, customer_name: x.customer_name, name: x.name, mime: x.mime, kind: x.kind, size_bytes: x.size_bytes === null ? null : Number(x.size_bytes),
          duration_s: x.duration_s === null ? null : Number(x.duration_s), width: x.px_w === null ? null : Number(x.px_w), height: x.px_h === null ? null : Number(x.px_h),
          scan_state: x.scan_state, content_version: Number(x.content_version ?? 1), created_at: x.created_at, engine: x.engine, sha256: x.sha256, reasons: d.reasons ?? [], preview_url,
        };
      }),
    );
    return c.json({ items, total, page: q.page, page_size: q.page_size });
  });

  r.post('/:id/scan-review', requirePerm('media', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().min(3, 'Nhập ghi chú (tối thiểu 3 ký tự)').max(500), content_version: z.coerce.number().int().min(1).optional() }));
    const id = c.req.param('id');
    const m = (await rt.db.query<{ id: string; customer_id: string; scan_state: string; review_state: string }>('SELECT id, customer_id, scan_state, review_state FROM creatives WHERE id = ?', [id]))[0];
    if (!m) throw notFound('Không thấy tệp.');
    if (m.scan_state !== NEEDS_MANUAL_REVIEW) throw conflict('Tệp không ở trạng thái chờ kiểm tra thủ công.', 'invalid_state', { scan_state: m.scan_state });
    await assertContentVersion(rt.db, id, b.content_version); // R1-14: quyet dinh gan voi phien ban noi dung nguoi duyet da xem
    const prev = (await rt.db.query<{ detail: string | null }>('SELECT detail FROM creative_validation WHERE creative_id = ?', [id]))[0]?.detail ?? null;
    const approve = b.decision === 'approve';
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await assertContentVersion(db, id, b.content_version); // kiem lai trong giao dich
      // dieu kien scan_state => hai admin bam dong thoi chi mot nguoi thang
      const res = approve
        ? await db.run("UPDATE creatives SET scan_state = 'clean' WHERE id = ? AND scan_state = ?", [id, NEEDS_MANUAL_REVIEW])
        : await db.run("UPDATE creatives SET scan_state = 'failed', review_state = 'rejected', review_note = ?, state = 'rejected' WHERE id = ? AND scan_state = ?", [b.note, id, NEEDS_MANUAL_REVIEW]);
      if (res.changes === 0) throw conflict('Tệp vừa được người khác xử lý.', 'invalid_state');
      await db.run(
        `INSERT INTO creative_validation (creative_id, engine, verdict, detail, sha256, checked_at) VALUES (?,?,?,?,NULL,?)
         ON CONFLICT (creative_id) DO UPDATE SET engine = excluded.engine, verdict = excluded.verdict, detail = excluded.detail, checked_at = excluded.checked_at`,
        [id, 'manual', approve ? 'clean' : 'rejected', JSON.stringify({ by: c.get('user')?.id ?? null, note: b.note, previous: prev }), now],
      );
      await auditCtx(c, db, { action: approve ? 'media.scan_review.approve' : 'media.scan_review.reject', objectType: 'creative', objectId: id, customerId: m.customer_id, diff: { content_version: b.content_version ?? null, scan_state: { from: NEEDS_MANUAL_REVIEW, to: approve ? 'clean' : 'failed' }, note: b.note, validation: prev } });
    });
    await bumpManifest(rt);
    return c.json({ id, scan_state: approve ? 'clean' : 'failed' });
  });

  return r;
}
