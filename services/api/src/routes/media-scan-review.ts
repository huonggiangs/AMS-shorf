// Duyet tay creative 'needs_manual_review' (duong Cloudflare, khong co ClamAV): xem docs/CLOUDFLARE-MEDIA-LIMITS.md.
// Chi nguoi co quyen media:approve; moi quyet dinh ghi audit. Duyet => scan_state='clean' (van phai qua buoc duyet noi dung nhu thuong).
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePerm } from '../auth/middleware.js';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, notFound } from '../lib/errors.js';
import { getRt, parseBody } from '../lib/http.js';
import { bumpManifest } from '../lib/manifest.js';
import type { AppEnv } from '../types.js';

export const NEEDS_MANUAL_REVIEW = 'needs_manual_review';

interface QueueRow { id: string; customer_id: string; name: string | null; mime: string | null; size_bytes: number | null; created_at: string; engine: string | null; detail: string | null; sha256: string | null }

export function mediaScanReviewRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/scan-review/queue', requirePerm('media', 'approve'), async (c) => {
    const rt = getRt(c);
    const rows = await rt.db.query<QueueRow>(
      `SELECT m.id, m.customer_id, m.name, m.mime, m.size_bytes, m.created_at, v.engine, v.detail, COALESCE(v.sha256, m.sha256) AS sha256
         FROM creatives m LEFT JOIN creative_validation v ON v.creative_id = m.id
        WHERE m.scan_state = ? ORDER BY m.created_at LIMIT 200`,
      [NEEDS_MANUAL_REVIEW],
    );
    return c.json({
      items: rows.map((x) => {
        let d: { reasons?: string[] } = {};
        try {
          d = x.detail ? JSON.parse(x.detail) : {};
        } catch {
          /* chi tiet hong: bo qua */
        }
        return { id: x.id, customer_id: x.customer_id, name: x.name, mime: x.mime, size_bytes: x.size_bytes === null ? null : Number(x.size_bytes), created_at: x.created_at, engine: x.engine, sha256: x.sha256, reasons: d.reasons ?? [] };
      }),
    });
  });

  r.post('/:id/scan-review', requirePerm('media', 'approve'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().min(3, 'Nhập ghi chú (tối thiểu 3 ký tự)').max(500) }));
    const id = c.req.param('id');
    const m = (await rt.db.query<{ id: string; customer_id: string; scan_state: string; review_state: string }>('SELECT id, customer_id, scan_state, review_state FROM creatives WHERE id = ?', [id]))[0];
    if (!m) throw notFound('Không thấy tệp.');
    if (m.scan_state !== NEEDS_MANUAL_REVIEW) throw conflict('Tệp không ở trạng thái chờ kiểm tra thủ công.', 'invalid_state', { scan_state: m.scan_state });
    const prev = (await rt.db.query<{ detail: string | null }>('SELECT detail FROM creative_validation WHERE creative_id = ?', [id]))[0]?.detail ?? null;
    const approve = b.decision === 'approve';
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
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
      await auditCtx(c, db, { action: approve ? 'media.scan_review.approve' : 'media.scan_review.reject', objectType: 'creative', objectId: id, customerId: m.customer_id, diff: { scan_state: { from: NEEDS_MANUAL_REVIEW, to: approve ? 'clean' : 'failed' }, note: b.note, validation: prev } });
    });
    await bumpManifest(rt);
    return c.json({ id, scan_state: approve ? 'clean' : 'failed' });
  });

  return r;
}
