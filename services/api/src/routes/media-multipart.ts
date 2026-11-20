// Tai tep lon TUNG PHAN qua Worker (khong can khoa S3, khong CORS): R2 multipart qua binding.
//   POST /media/:id/multipart            khoi tao (hoac TIEP TUC phien dang mo): tra upload_id, part_size, total_parts, cac phan da co
//   PUT  /media/:id/parts/:n             body = mot phan (Content-Length bat buoc, dung kich thuoc phan) -> ghi thang luong vao kho, tra etag
//   POST /media/:id/multipart/complete   {parts:[{n,etag}]}: du phan + etag dung + tong = size_bytes khai bao -> noi tep; sau do client goi /confirm (luong hien co)
//   POST /media/:id/multipart/abort      huy phien (tep -> 'invalid')
// Quyen media:write, dung pham vi khach hang (loadMedia), CHI nguoi tao tep, tep con 'uploading' va phien <= 3 gio. Moi ghi co audit. Han muc: 30 khoi tao/gio, 150 phan/gio/nguoi.
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePerm } from '../auth/middleware.js';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { HttpError, conflict, forbidden, tooMany, unprocessable } from '../lib/errors.js';
import { getRt, num, parseBody } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';
import { MULTIPART_SESSION_MS, multipartPartSize } from '../lib/creative.js';
import { abortOpenMultipart, getTransfer, partsOf, type TransferPart } from '../lib/transfers.js';
import type { AppEnv } from '../types.js';

interface UploadingMedia {
  id: string;
  customer_id: string;
  uploaded_by: string | null;
  source: string;
  state: string;
  storage_key: string | null;
  size_bytes: number | string | null;
  mime: string | null;
  created_at: string;
}

export interface MultipartDeps<M extends UploadingMedia> {
  external: boolean;
  loadMedia(c: Ctx, id: string): Promise<M>;
}

/** Kich thuoc ky vong cua phan n (1..total): moi phan = partSize, phan cuoi la phan du. */
export const expectedPartLen = (n: number, size: number, partSize: number): number => {
  const total = Math.ceil(size / partSize);
  return n < total ? partSize : size - (total - 1) * partSize;
};

export function mediaMultipartRoutes<M extends UploadingMedia>(deps: MultipartDeps<M>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  async function guard(c: Ctx): Promise<{ m: M; size: number }> {
    const rt = getRt(c);
    const u = c.get('user');
    const m = await deps.loadMedia(c, c.req.param('id') ?? '');
    if (typeof rt.objects.multipartCreate !== 'function' || typeof rt.objects.multipartUploadPart !== 'function' || typeof rt.objects.multipartComplete !== 'function') {
      throw conflict('Kho lưu trữ này không hỗ trợ tải lên từng phần.', 'multipart_unsupported');
    }
    if (m.uploaded_by !== u.id) throw forbidden('Chỉ người tạo tệp mới được tải nội dung lên.', 'not_uploader');
    if (m.source !== 'upload' || m.state !== 'uploading' || !m.storage_key) throw conflict('Tệp không ở trạng thái chờ tải lên.', 'invalid_state');
    if (rt.clock.now().getTime() - new Date(m.created_at).getTime() > MULTIPART_SESSION_MS) throw conflict('Phiên tải lên đã hết hạn (quá 3 giờ). Hãy chọn tệp và tải lại.', 'upload_expired');
    const size = num(m.size_bytes);
    if (!(size > 0)) throw conflict('Tệp chưa khai báo dung lượng.', 'invalid_state');
    return { m, size };
  }

  const view = (t: { upload_id: string | null; part_size: number | null; total_parts: number | null; parts: string; status: string }, size: number, createdAt: string) => ({
    upload_id: t.upload_id,
    part_size: t.part_size,
    total_parts: t.total_parts,
    size_bytes: size,
    status: t.status,
    parts: partsOf(t.parts).sort((a, b) => a.n - b.n),
    expires_at: new Date(new Date(createdAt).getTime() + MULTIPART_SESSION_MS).toISOString(),
  });

  r.post('/:id/multipart', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const { m, size } = await guard(c);
    const existing = await getTransfer(rt.db, m.id);
    if (existing) {
      if (existing.kind === 'multipart' && existing.status === 'open') return c.json(view(existing, size, m.created_at)); // tiep tuc phien dang mo
      throw conflict('Phiên tải từng phần của tệp này đã kết thúc. Hãy tạo tệp mới.', 'invalid_state', { status: existing.status });
    }
    if ((await rt.kv.incr(`rl:media-mpinit:${u.id}`, 3600)) > 30) throw tooMany('Khởi tạo tải lên quá nhiều lần. Vui lòng thử lại sau.', 3600);
    const partSize = multipartPartSize(rt);
    const total = Math.ceil(size / partSize);
    if (total > 10000) throw unprocessable('Tệp quá lớn để chia phần.', 'file_too_large');
    let uploadId: string;
    try {
      uploadId = (await rt.objects.multipartCreate!(m.storage_key!, m.mime ?? 'application/octet-stream')).uploadId;
    } catch (e) {
      console.error('[media] khoi tao multipart loi:', (e as Error).name);
      throw new HttpError(502, 'multipart_init_failed', 'Không khởi tạo được tải lên từng phần. Vui lòng thử lại.');
    }
    const nowIso = rt.clock.now().toISOString();
    const won = await rt.db.tx(async (db) => {
      const res = await db.run(
        `INSERT INTO creative_transfers (creative_id, kind, status, upload_id, part_size, total_parts, parts, bytes_done, bytes_total, attempts, started_at, updated_at)
         VALUES (?,'multipart','open',?,?,?,'[]',0,?,0,?,?) ON CONFLICT (creative_id) DO NOTHING`,
        [m.id, uploadId, partSize, total, size, nowIso, nowIso],
      );
      if (res.changes === 0) return false;
      await auditCtx(c, db, { action: 'media.multipart_init', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { size_bytes: size, part_size: partSize, total_parts: total } });
      return true;
    });
    if (!won) {
      // hai khoi tao cung luc: giu phien thang, huy phien cua minh
      try { await rt.objects.multipartAbort?.(m.storage_key!, uploadId); } catch { /* khong chan */ }
      const t = (await getTransfer(rt.db, m.id))!;
      return c.json(view(t, size, m.created_at));
    }
    return c.json(view((await getTransfer(rt.db, m.id))!, size, m.created_at), 201);
  });

  r.put('/:id/parts/:n', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const { m, size } = await guard(c);
    const t = await getTransfer(rt.db, m.id);
    if (!t || t.kind !== 'multipart' || t.status !== 'open' || !t.upload_id || !t.part_size || !t.total_parts) throw conflict('Chưa khởi tạo tải lên từng phần cho tệp này.', 'invalid_state');
    const nRaw = c.req.param('n') ?? '';
    const n = /^\d{1,5}$/.test(nRaw) ? Number(nRaw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > t.total_parts) throw unprocessable(`Số thứ tự phần phải từ 1 đến ${t.total_parts}.`, 'bad_part_number', { total_parts: t.total_parts });
    if ((await rt.kv.incr(`rl:media-part:${u.id}`, 3600)) > 150) throw tooMany('Tải lên quá nhiều phần. Vui lòng thử lại sau.', 3600);
    const want = expectedPartLen(n, size, t.part_size);
    const lenRaw = c.req.header('content-length');
    const len = lenRaw === undefined ? NaN : Number(lenRaw);
    if (!Number.isInteger(len)) throw new HttpError(400, 'length_required', 'Thiếu Content-Length.');
    if (len !== want) throw new HttpError(400, 'length_mismatch', `Phần ${n} phải dài ${want} byte, nhận ${len} byte.`, { expected: want, got: len });
    const body = c.req.raw.body;
    if (!body) throw new HttpError(400, 'empty_body', 'Thiếu nội dung phần.');
    let seen = 0;
    const guardStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        seen += chunk.length;
        if (seen > want) ctl.error(new Error('over_declared'));
        else ctl.enqueue(chunk);
      },
    });
    let etag: string;
    try {
      etag = (await rt.objects.multipartUploadPart!(m.storage_key!, t.upload_id, n, body.pipeThrough(guardStream), want)).etag;
    } catch (e) {
      console.error('[media] tai phan loi:', (e as Error).name);
      throw new HttpError(502, 'part_failed', `Không nhận trọn vẹn phần ${n} (mất kết nối hoặc dung lượng sai). Hãy thử lại phần này.`, { part: n });
    }
    if (seen !== want) throw new HttpError(400, 'length_mismatch', `Dung lượng phần ${n} nhận được không khớp.`);
    const nowIso = rt.clock.now().toISOString();
    const parts = await rt.db.tx(async (db) => {
      const cur = (await getTransfer(db, m.id))!;
      if (cur.status !== 'open') throw conflict('Phiên tải lên đã đóng.', 'invalid_state');
      const list: TransferPart[] = partsOf(cur.parts).filter((p) => p.n !== n);
      list.push({ n, etag, size: want });
      list.sort((a, b) => a.n - b.n);
      const done = list.reduce((a, p) => a + p.size, 0);
      await db.run("UPDATE creative_transfers SET parts = ?, bytes_done = ?, updated_at = ? WHERE creative_id = ? AND status = 'open'", [JSON.stringify(list), done, nowIso, m.id]);
      await auditCtx(c, db, { action: 'media.multipart_part', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { n, size: want, parts_done: list.length, total_parts: t.total_parts } });
      return list;
    });
    return c.json({ ok: true, n, etag, size: want, parts_done: parts.length, total_parts: t.total_parts });
  });

  r.post('/:id/multipart/complete', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const { m, size } = await guard(c);
    const b = await parseBody(c, z.object({ parts: z.array(z.object({ n: z.coerce.number().int().min(1).max(10000), etag: z.string().min(1).max(200) })).min(1).max(10000) }));
    const t = await getTransfer(rt.db, m.id);
    if (!t || t.kind !== 'multipart' || !t.upload_id || !t.total_parts) throw conflict('Chưa khởi tạo tải lên từng phần cho tệp này.', 'invalid_state');
    if (t.status === 'completed') {
      const head = await rt.objects.head(m.storage_key!);
      if (head && head.size === size) return c.json({ ok: true, size_bytes: size }); // idempotent
    }
    if (t.status !== 'open') throw conflict('Phiên tải lên đã đóng.', 'invalid_state', { status: t.status });
    const recorded = new Map(partsOf(t.parts).map((p) => [p.n, p]));
    const missing: number[] = [];
    for (let n = 1; n <= t.total_parts; n++) if (!recorded.has(n)) missing.push(n);
    if (missing.length) throw unprocessable(`Còn thiếu ${missing.length} phần chưa tải lên: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}.`, 'parts_missing', { missing });
    const given = new Map<number, string>();
    for (const p of b.parts) {
      if (p.n > t.total_parts || given.has(p.n)) throw unprocessable('Danh sách phần không hợp lệ (trùng hoặc vượt quá số phần).', 'parts_invalid', { total_parts: t.total_parts });
      given.set(p.n, p.etag);
    }
    if (given.size !== t.total_parts) throw unprocessable(`Cần đủ ${t.total_parts} phần, nhận ${given.size}.`, 'parts_invalid', { total_parts: t.total_parts });
    for (const [n, et] of given) if (recorded.get(n)!.etag !== et) throw unprocessable(`Mã xác nhận (etag) của phần ${n} không khớp với phần đã tải lên. Hãy tải lại phần này.`, 'etag_mismatch', { part: n });
    const sum = [...recorded.values()].reduce((a, p) => a + p.size, 0);
    if (sum !== size) throw unprocessable(`Tổng dung lượng các phần (${sum} byte) khác dung lượng đã khai báo (${size} byte).`, 'size_mismatch', { expected: size, got: sum });
    try {
      await rt.objects.multipartComplete!(m.storage_key!, t.upload_id, [...recorded.values()].map((p) => ({ n: p.n, etag: p.etag })));
    } catch (e) {
      console.error('[media] noi cac phan loi:', (e as Error).name);
      throw new HttpError(502, 'complete_failed', 'Không ghép được các phần thành tệp. Vui lòng thử lại.');
    }
    const head = await rt.objects.head(m.storage_key!);
    const nowIso = rt.clock.now().toISOString();
    if (!head || head.size !== size) {
      try { await rt.objects.delete?.(m.storage_key!); } catch { /* khong chan */ }
      await rt.db.run("UPDATE creative_transfers SET status = 'failed', error_code = 'length_mismatch', updated_at = ? WHERE creative_id = ?", [nowIso, m.id]);
      throw new HttpError(400, 'length_mismatch', 'Dung lượng tệp ghép được không khớp khai báo. Hãy tải lại.');
    }
    await rt.db.tx(async (db) => {
      await db.run("UPDATE creative_transfers SET status = 'completed', bytes_done = ?, updated_at = ? WHERE creative_id = ? AND status = 'open'", [size, nowIso, m.id]);
      await auditCtx(c, db, { action: 'media.multipart_complete', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { size_bytes: size, parts: t.total_parts, mime: m.mime } });
    });
    return c.json({ ok: true, size_bytes: size });
  });

  r.post('/:id/multipart/abort', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const { m } = await guard(c);
    const done = await abortOpenMultipart(rt, m.id, m.storage_key, 'aborted', { actorId: u.id, ip: c.get('ip'), customerId: m.customer_id, reason: 'người dùng hủy' });
    if (done) await rt.db.run("UPDATE creatives SET review_state = 'rejected', review_note = ?, state = 'invalid' WHERE id = ? AND state = 'uploading'", ['Đã hủy tải lên.', m.id]);
    return c.json({ ok: true, aborted: done });
  });

  return r;
}
