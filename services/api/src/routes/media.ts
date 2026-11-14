import { Hono } from 'hono';
import { z } from 'zod';
import type { Runtime } from '@ams/runtime';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { esc, trySend } from '../lib/mail.js';
import { HttpError, conflict, notFound, unprocessable } from '../lib/errors.js';
import { eq, getRt, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { mediaScope } from '../lib/scope.js';
import {
  ALLOWED_MIME, DURATION_RANGE, GB, MB, apiTarget, checkImportUrl, dbTarget, fitsTarget, inferTarget, isVideoMime, probeImage, sizeLimitBytes, type LinkSource, type Px, type TargetType,
} from '../lib/creative.js';
import { todayVn } from '../lib/dates.js';
import { bumpManifest } from '../lib/manifest.js';
import { enqueueMediaUploaded, runOutbox } from '../outbox.js';
import { mediaScanReviewRoutes } from './media-scan-review.js';
import { UNSCANNED_STATES, allowUnscannedCreatives, assertScanOk } from './creatives-scan.js';
import { requirePerm } from '../auth/middleware.js';
import { AD_FORMATS, isAdFormat, parseOverlay, sha256Hex, type CreativeOverlay } from '@ams/shared';
import type { AppEnv, AuthUser } from '../types.js';

const M_SELECT = `m.id, m.campaign_id, m.customer_id, m.name, m.target_type, m.px_w, m.px_h, m.kind, m.source, m.source_url, m.storage_key, m.mime, m.size_bytes, m.duration_s,
  m.uploaded_by, m.uploader_kind, m.scan_state, m.review_state, m.review_note, m.state, m.created_at, m.sha256, m.format, m.overlay, cu.short_name AS owner_name, cu.payment_code AS customer_code`;
const M_FROM = 'FROM creatives m JOIN customers cu ON cu.id = m.customer_id';

interface MediaRow {
  id: string;
  campaign_id: string | null;
  customer_id: string;
  name: string | null;
  target_type: string | null;
  px_w: number | null;
  px_h: number | null;
  kind: string | null;
  source: string;
  source_url: string | null;
  storage_key: string | null;
  mime: string | null;
  size_bytes: number | null;
  duration_s: number | null;
  uploaded_by: string | null;
  uploader_kind: string | null;
  scan_state: string;
  review_state: string;
  review_note: string | null;
  state: string;
  created_at: string;
  sha256: string | null;
  format: string | null;
  overlay: string | null;
  owner_name: string;
  customer_code: string;
}

function overlayOf(raw: string | null | undefined): CreativeOverlay | null {
  if (!raw) return null;
  try {
    const r = parseOverlay(JSON.parse(raw));
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

const overlayInput = z.any().optional().nullable();
/** Kiem tra dinh dang + overlay (422 neu sai); tra ve JSON chuan hoa de luu. */
function checkFormatOverlay(format: string | undefined, overlay: unknown, external = false): { format: string | undefined; overlay: string | null | undefined } {
  if (format !== undefined && !isAdFormat(format)) throw unprocessable(`Định dạng phải là một trong: ${AD_FORMATS.join(', ')}.`, 'bad_format');
  if (overlay === undefined) return { format, overlay: undefined };
  // khach (tai khoan ngoai) khong tu dat kid_safe=true / ngu canh 'lock': 422 ro rang; noi bo giu che do 'strip' (route nguoi duyet: tv-experience)
  const r = parseOverlay(overlay, { reviewerFields: external ? 'reject' : 'strip' });
  if (!r.ok) throw unprocessable(`Lớp phủ không hợp lệ: ${r.errors.map((e) => `${e.path || 'overlay'} ${e.message}`).join('; ')}`, 'bad_overlay', r.errors);
  return { format, overlay: r.value ? JSON.stringify(r.value) : null };
}

/** Tep <= 128 MB: bam SHA-256 luc xac nhan (manifest chi phat tep da xac minh). Lon hon: de null, gateway/transcoder bam sau. */
const SHA_MAX_BYTES = 128 * MB;

const statusOf = (m: Pick<MediaRow, 'state' | 'review_state'>): string => (m.state === 'uploading' ? 'processing' : m.review_state === 'returned' ? 'rejected' : m.review_state);

export const present = (m: MediaRow): Record<string, unknown> => ({
  id: m.id,
  name: m.name ?? m.id,
  kind: m.source !== 'upload' ? 'link' : (m.kind ?? (m.mime?.startsWith('image/') ? 'image' : 'video')),
  mime: m.mime,
  width: m.px_w,
  height: m.px_h,
  duration_sec: m.duration_s,
  size_bytes: m.size_bytes === null ? null : num(m.size_bytes),
  status: statusOf(m),
  owner_name: m.owner_name,
  customer_id: m.customer_id,
  customer_code: m.customer_code,
  source: m.source,
  source_url: m.source_url,
  thumb_url: null,
  reject_reason: m.review_note,
  campaign_id: m.campaign_id,
  target_type: apiTarget(m.target_type),
  scan_state: m.scan_state,
  scan_warning: (UNSCANNED_STATES as readonly string[]).includes(m.scan_state) ? 'Chưa quét mã độc' : m.scan_state === 'needs_manual_review' ? 'Chờ kiểm tra thủ công (không có quét mã độc)' : null,
  format: isAdFormat(m.format) ? m.format : 'fullscreen',
  overlay: overlayOf(m.overlay),
  sha256: m.sha256,
  created_at: m.created_at,
});

function mediaSpec(u: AuthUser, nowIso: string): ListSpec {
  const scope = mediaScope(u, 'm', nowIso);
  return {
    from: M_FROM,
    select: M_SELECT,
    where: scope ? [scope] : [],
    search: ['m.name', 'cu.short_name', 'm.source_url'],
    sorts: { name: 'm.name', created_at: 'm.created_at', size_bytes: 'm.size_bytes', status: 'm.review_state', owner_name: 'cu.short_name' },
    defaultSort: 'created_at:desc',
    tiebreak: 'm.id',
    filters: {
      status: (v) => {
        if (v === 'processing') return { sql: "m.state = 'uploading'", params: [] };
        if (v === 'rejected') return { sql: "m.review_state IN ('rejected','returned') AND m.state <> 'uploading'", params: [] };
        return { sql: "m.review_state = ? AND m.state <> 'uploading'", params: [v] };
      },
      customer_id: eq('m.customer_id'),
      campaign_id: eq('m.campaign_id'),
      kind: (v) => (v === 'link' ? { sql: "m.source <> 'upload'", params: [] } : { sql: "m.source = 'upload' AND m.kind = ?", params: [v] }),
    },
  };
}

async function loadMedia(c: Ctx, id: string): Promise<MediaRow> {
  const rt = getRt(c);
  const scope = mediaScope(c.get('user'), 'm', rt.clock.now().toISOString());
  const r = (await rt.db.query<MediaRow>(`SELECT ${M_SELECT} ${M_FROM} WHERE m.id = ?${scope ? ` AND (${scope.sql})` : ''}`, [id, ...(scope?.params ?? [])]))[0];
  if (!r) throw notFound('Không tìm thấy tệp media.');
  return r;
}

interface Quota {
  max_files_per_day: number;
  max_mb_per_file: number;
  max_total_gb: number;
}
async function quotaOf(rt: Runtime, customerId: string): Promise<Quota> {
  const q = (await rt.db.query<Quota>('SELECT max_files_per_day, max_mb_per_file, max_total_gb FROM upload_quotas WHERE customer_id = ?', [customerId]))[0];
  return q ? { max_files_per_day: num(q.max_files_per_day), max_mb_per_file: num(q.max_mb_per_file), max_total_gb: num(q.max_total_gb) } : { max_files_per_day: 20, max_mb_per_file: 30, max_total_gb: 5 };
}

async function knownLedPx(rt: Runtime): Promise<Px[]> {
  const rows = await rt.db.query<{ px_w: number; px_h: number }>("SELECT DISTINCT px_w, px_h FROM screens WHERE type = 'led_p5' AND px_w IS NOT NULL AND px_h IS NOT NULL");
  return rows.map((r) => ({ w: num(r.px_w), h: num(r.px_h) }));
}

async function resolveOwner(c: Ctx, bodyCustomerId: string | null | undefined): Promise<string> {
  const rt = getRt(c);
  const u = c.get('user');
  const customerId = u.kind === 'internal' ? bodyCustomerId : u.customerId;
  if (!customerId) throw unprocessable('Chọn khách hàng sở hữu tệp.', 'customer_required');
  const cu = (await rt.db.query<{ state: string }>('SELECT state FROM customers WHERE id = ?', [customerId]))[0];
  if (!cu) throw u.kind === 'internal' ? unprocessable('Khách hàng không tồn tại.', 'customer_not_found') : notFound();
  if (cu.state === 'terminated') throw conflict('Khách hàng đã chấm dứt hợp tác.', 'customer_inactive');
  return customerId;
}

/** Han muc theo ngay/tong dung luong (ap dung cho moi tai len cua khach). */
async function checkQuotas(rt: Runtime, customerId: string, addBytes: number, q: Quota): Promise<void> {
  const dayStartUtc = new Date(`${todayVn(rt)}T00:00:00+07:00`).toISOString();
  const today = num((await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM creatives WHERE customer_id = ? AND created_at >= ?', [customerId, dayStartUtc]))[0]?.n);
  if (today >= q.max_files_per_day) throw new HttpError(429, 'quota_files_per_day', `Đã đạt giới hạn ${q.max_files_per_day} tệp/ngày. Thử lại vào ngày mai.`, { limit: q.max_files_per_day });
  const total = num((await rt.db.query<{ s: number | null }>('SELECT COALESCE(SUM(size_bytes), 0) AS s FROM creatives WHERE customer_id = ?', [customerId]))[0]?.s);
  if (total + addBytes > q.max_total_gb * GB) throw unprocessable(`Vượt tổng dung lượng cho phép ${q.max_total_gb} GB. Hãy xóa bớt tệp cũ.`, 'quota_total_size', { limit_gb: q.max_total_gb });
}

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 100) || 'file';

const uploadBody = z.object({
  name: z.string().trim().min(1, 'Nhập tên tệp').max(200),
  content_type: z.string().trim().max(100),
  size_bytes: z.coerce.number().int().min(1, 'Tệp rỗng').max(10 * GB),
  width: z.coerce.number().int().min(1).max(20000).optional(),
  height: z.coerce.number().int().min(1).max(20000).optional(),
  duration_sec: z.coerce.number().min(0).max(36000).optional(),
  target_type: z.enum(['tv', 'elevator', 'led']).optional(),
  customer_id: z.string().max(64).optional().nullable(),
  format: z.string().max(20).optional(),
  overlay: overlayInput,
});

const importBody = z.object({
  source: z.enum(['youtube', 'drive', 'dropbox', 'url']),
  url: z.string().trim().min(8).max(2048),
  name: z.string().trim().max(200).optional(),
  customer_id: z.string().max(64).optional().nullable(),
});

async function emailOwner(rt: Runtime, customerId: string, subject: string, html: string): Promise<void> {
  const to = (await rt.db.query<{ email: string | null }>('SELECT email FROM customers WHERE id = ?', [customerId]))[0]?.email;
  if (to && /@/.test(to)) await trySend(rt, { to, subject, html, text: html.replace(/<[^>]+>/g, '') });
}

export function mediaRoutes(external: boolean): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('media', 'view'), async (c) => {
    const rt = getRt(c);
    const res = await runList<MediaRow>(c, mediaSpec(c.get('user'), rt.clock.now().toISOString()));
    return c.json({ ...res, items: res.items.map(present) });
  });

  r.get('/:id', requirePerm('media', 'view'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    const out = present(m);
    if (m.source === 'upload' && m.storage_key && m.state !== 'uploading' && m.state !== 'invalid') out['preview_url'] = await rt.objects.getSigned(m.storage_key, 300);
    return c.json(out);
  });

  r.post('/upload-url', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, uploadBody);
    const customerId = await resolveOwner(c, b.customer_id);
    const mime = b.content_type.toLowerCase().split(';')[0]!.trim();
    if (!(ALLOWED_MIME as readonly string[]).includes(mime)) throw unprocessable('Chỉ nhận MP4, MOV, WebM, PNG hoặc JPG.', 'unsupported_type');
    const quota = await quotaOf(rt, customerId);
    const extQuotaMb = u.kind === 'internal' ? null : quota.max_mb_per_file;

    let target: TargetType | null = b.target_type ? dbTarget(b.target_type) : null;
    if (b.width && b.height) {
      const led = await knownLedPx(rt);
      target ??= inferTarget(b.width, b.height, led);
      if (!target) throw unprocessable(`Độ phân giải ${b.width}×${b.height} không khớp loại màn hình nào (TV 16:9, thang máy 768×1366 / 1080×1920, LED P5 đúng kích thước bảng).`, 'unsupported_resolution');
      const fit = fitsTarget(target, b.width, b.height, { knownLed: led });
      if (!fit.ok) throw unprocessable(fit.message, 'creative_size_mismatch');
    }
    const limit = sizeLimitBytes(target ?? 'tv', extQuotaMb);
    if (b.size_bytes > limit) throw unprocessable(`Tệp ${(b.size_bytes / MB).toFixed(1)} MB vượt giới hạn ${Math.floor(limit / MB)} MB${target ? ` cho loại màn này` : ''}.`, 'file_too_large', { limit_bytes: limit });
    const dur = target ? DURATION_RANGE[target] : undefined;
    if (dur && b.duration_sec !== undefined && isVideoMime(mime) && (b.duration_sec < dur[0] || b.duration_sec > dur[1])) {
      throw unprocessable(`Thời lượng phải từ ${dur[0]} đến ${dur[1]} giây cho loại màn này, tệp dài ${Math.round(b.duration_sec)} giây.`, 'duration_out_of_range');
    }
    await checkQuotas(rt, customerId, b.size_bytes, quota);
    const fo = checkFormatOverlay(b.format, b.overlay, external);

    const id = rt.id();
    const key = `media/${customerId}/${id}/${safeName(b.name)}`;
    const nowIso = rt.clock.now().toISOString();
    const signed = await rt.objects.putSigned(key, mime, 900, { maxBytes: b.size_bytes });
    await rt.db.tx(async (db) => {
      await db.run(
        `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, source_url, storage_key, mime, size_bytes, duration_s, uploaded_by, uploader_kind, scan_state, review_state, state, format, overlay, created_at)
         VALUES (?,NULL,?,?,?,?,?,?,?,'upload',NULL,?,?,?,?,?,?,'pending','pending','uploading',?,?,?)`,
        [id, customerId, b.name, target, b.width ?? null, b.height ?? null, b.width && b.height ? (b.width >= b.height ? 'landscape' : 'portrait') : null, isVideoMime(mime) ? 'video' : 'image', key, mime, b.size_bytes, b.duration_sec === undefined ? null : Math.round(b.duration_sec), u.id, u.kind, fo.format ?? 'fullscreen', fo.overlay ?? null, nowIso],
      );
      await auditCtx(c, db, { action: 'media.upload_url', objectType: 'creative', objectId: id, customerId, diff: { name: b.name, size_bytes: b.size_bytes, mime } });
    });
    return c.json({ id, url: signed.url, method: 'PUT', headers: signed.headers, key, expires_in: 900 }, 201);
  });

  r.post('/:id/confirm', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ width: z.coerce.number().int().min(1).max(20000).optional(), height: z.coerce.number().int().min(1).max(20000).optional(), duration_sec: z.coerce.number().min(0).max(36000).optional() }));
    if (m.source !== 'upload' || !m.storage_key) throw conflict('Tệp này không phải tệp tải lên.', 'invalid_state');
    if (m.state !== 'uploading') return c.json(present(m)); // idempotent
    const head = await rt.objects.head(m.storage_key);
    if (!head) throw conflict('Chưa thấy tệp trên kho lưu trữ. Hãy tải lên bằng đường dẫn đã cấp rồi xác nhận lại.', 'upload_missing');

    const reject = async (code: string, message: string) => {
      await rt.db.tx(async (db) => {
        await db.run("UPDATE creatives SET review_state = 'rejected', review_note = ?, state = 'invalid' WHERE id = ? AND state = 'uploading'", [message, m.id]);
        await auditCtx(c, db, { action: 'media.rejected_on_confirm', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { code, size: head.size } });
      });
      throw unprocessable(message, code);
    };

    const declared = (m.mime ?? '').toLowerCase();
    const got = head.contentType.toLowerCase().split(';')[0]!.trim();
    if (declared && got && got !== declared && got !== 'application/octet-stream') await reject('content_type_mismatch', `Loại tệp tải lên (${got}) khác loại đã khai báo (${declared}).`);

    let w = b.width ?? (m.px_w ? num(m.px_w) : undefined);
    let h = b.height ?? (m.px_h ? num(m.px_h) : undefined);
    if (declared.startsWith('image/')) {
      if (head.size <= 25 * MB) {
        const bytes = await rt.objects.get(m.storage_key);
        const px = bytes ? probeImage(bytes) : null;
        if (!px) await reject('invalid_image', 'Không đọc được ảnh (tệp hỏng hoặc không phải PNG/JPG).');
        w = px!.w; // dung kich thuoc doc tu dau tep, khong tin khai bao cua client
        h = px!.h;
      }
    }
    if (!w || !h) throw unprocessable('Chưa đọc được kích thước tệp. Hãy gửi width/height khi xác nhận.', 'dimensions_required');

    const led = await knownLedPx(rt);
    const target: TargetType | null = m.target_type ? dbTarget(m.target_type) : inferTarget(w, h, led);
    if (!target) await reject('unsupported_resolution', `Độ phân giải ${w}×${h} không khớp loại màn hình nào.`);
    const fit = fitsTarget(target!, w, h, { knownLed: led });
    if (!fit.ok) await reject('creative_size_mismatch', fit.message);
    const quota = await quotaOf(rt, m.customer_id);
    const limit = sizeLimitBytes(target!, c.get('user').kind === 'internal' ? null : quota.max_mb_per_file);
    if (head.size > limit) await reject('file_too_large', `Tệp ${(head.size / MB).toFixed(1)} MB vượt giới hạn ${Math.floor(limit / MB)} MB cho loại màn này.`);
    const dur = DURATION_RANGE[target!];
    const durationSec = b.duration_sec ?? (m.duration_s === null ? undefined : num(m.duration_s));
    if (dur && durationSec !== undefined && declared.startsWith('video/') && (durationSec < dur[0] || durationSec > dur[1])) {
      await reject('duration_out_of_range', `Thời lượng phải từ ${dur[0]} đến ${dur[1]} giây cho loại màn này.`);
    }

    let sha: string | null = null;
    if (head.size <= SHA_MAX_BYTES) {
      const bytes = await rt.objects.get(m.storage_key);
      if (!bytes) throw conflict('Chưa đọc được tệp trên kho lưu trữ để xác minh. Thử xác nhận lại.', 'upload_missing');
      sha = await sha256Hex(bytes);
    }
    await rt.db.tx(async (db) => {
      const res = await db.run(
        `UPDATE creatives SET px_w = ?, px_h = ?, orientation = ?, target_type = ?, size_bytes = ?, duration_s = ?, sha256 = ?, state = 'pending_review' WHERE id = ? AND state = 'uploading'`,
        [w, h, w >= h ? 'landscape' : 'portrait', target, head.size, durationSec === undefined ? null : Math.round(durationSec), sha, m.id],
      );
      if (res.changes === 0) throw conflict('Tệp vừa được xác nhận ở nơi khác.', 'invalid_state');
      await enqueueMediaUploaded(db, rt, m.id); // cung giao dich: xac nhan xong thi chac chan co viec quet (media-worker)
      await auditCtx(c, db, { action: 'media.confirm', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { px: `${w}x${h}`, size_bytes: head.size, target_type: target, sha256: sha } });
    });
    try {
      await runOutbox(rt, c.get('finance')); // day ngay cho media-worker; loi thi worker outbox thu lai
    } catch (e) {
      console.error('[media] xu ly outbox loi:', (e as Error).name);
    }
    return c.json(present(await loadMedia(c, m.id)));
  });

  r.post('/import', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, importBody);
    const customerId = await resolveOwner(c, b.customer_id);
    const chk = checkImportUrl(b.source as LinkSource, b.url);
    if (!chk.ok) throw unprocessable(chk.message, 'bad_media_url');
    const quota = await quotaOf(rt, customerId);
    await checkQuotas(rt, customerId, 0, quota);
    const id = rt.id();
    const url = chk.url.toString();
    const name = b.name || decodeURIComponent(chk.url.pathname.split('/').filter(Boolean).pop() ?? '') || chk.url.hostname;
    const source = b.source === 'drive' ? 'gdrive' : b.source;
    await rt.db.tx(async (db) => {
      // chi luu tham chieu; viec tai ve/chuyen ma/quet ma doc do dich vu transcoder dam nhan (scan_state='pending')
      await db.run(
        `INSERT INTO creatives (id, campaign_id, customer_id, name, kind, source, source_url, uploaded_by, uploader_kind, scan_state, review_state, state, created_at)
         VALUES (?,NULL,?,?,'link',?,?,?,?,'pending','pending','pending_review',?)`,
        [id, customerId, name.slice(0, 200), source, url, u.id, u.kind, rt.clock.now().toISOString()],
      );
      await auditCtx(c, db, { action: 'media.import', objectType: 'creative', objectId: id, customerId, diff: { source, host: chk.url.hostname } });
    });
    return c.json(present(await loadMedia(c, id)), 201);
  });

  // Doi dinh dang/lop phu. Khach sua tep da duyet => quay lai cho duyet (QR/hotline la noi dung nhay cam); noi bo giu nguyen trang thai.
  r.put('/:id/overlay', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const m = await loadMedia(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ format: z.string().max(20).optional(), overlay: overlayInput }));
    if (b.format === undefined && b.overlay === undefined) throw unprocessable('Nhập định dạng hoặc lớp phủ cần đổi.', 'nothing_to_update');
    if (m.state === 'invalid') throw conflict('Tệp không hợp lệ.', 'invalid_state');
    const fo = checkFormatOverlay(b.format, b.overlay, external);
    const resetReview = u.kind !== 'internal' && m.review_state === 'approved';
    await rt.db.tx(async (db) => {
      await db.run(
        `UPDATE creatives SET format = COALESCE(?, format), overlay = CASE WHEN ? = 1 THEN ? ELSE overlay END${resetReview ? ", review_state = 'pending', state = 'pending_review'" : ''} WHERE id = ?`,
        [fo.format ?? null, fo.overlay === undefined ? 0 : 1, fo.overlay ?? null, m.id],
      );
      await auditCtx(c, db, { action: 'media.overlay', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { format: fo.format ?? null, overlay: fo.overlay === undefined ? 'unchanged' : fo.overlay, review_reset: resetReview } });
    });
    if (m.campaign_id) await bumpManifest(rt);
    return c.json(present(await loadMedia(c, m.id)));
  });

  if (external) return r;

  r.post('/:id/approve', requirePerm('media', 'approve'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    if (m.state === 'uploading' || m.state === 'invalid') throw conflict('Tệp chưa tải xong hoặc không hợp lệ.', 'invalid_state');
    if (m.review_state === 'approved') return c.json(present(m));
    assertScanOk(m, await allowUnscannedCreatives(rt), { creative_id: m.id, scan_state: m.scan_state });
    await rt.db.tx(async (db) => {
      const res = await db.run("UPDATE creatives SET review_state = 'approved', review_note = NULL, state = 'ready' WHERE id = ? AND state NOT IN ('uploading','invalid') AND scan_state = ?", [m.id, m.scan_state]);
      if (res.changes === 0) throw conflict('Tệp vừa đổi trạng thái.', 'invalid_state');
      await auditCtx(c, db, { action: 'media.approve', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { review_state: { from: m.review_state, to: 'approved' }, scan_state: m.scan_state } });
    });
    await bumpManifest(rt);
    await emailOwner(rt, m.customer_id, `Tệp "${m.name ?? ''}" đã được duyệt`, `<p>Tệp <b>${esc(m.name)}</b> đã được duyệt và có thể dùng cho chiến dịch.</p>`);
    return c.json(present(await loadMedia(c, m.id)));
  });

  r.post('/:id/reject', requirePerm('media', 'approve'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ reason: z.string().trim().min(3, 'Nhập lý do (tối thiểu 3 ký tự)').max(500) }));
  r.route('/', mediaScanReviewRoutes()); // creative 'needs_manual_review' (duong Cloudflare)
    if (m.state === 'uploading') throw conflict('Tệp chưa tải xong.', 'invalid_state');
    await rt.db.tx(async (db) => {
      await db.run("UPDATE creatives SET review_state = 'rejected', review_note = ?, state = 'rejected' WHERE id = ?", [b.reason, m.id]);
      await auditCtx(c, db, { action: 'media.reject', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { review_state: { from: m.review_state, to: 'rejected' }, reason: b.reason } });
    });
    await bumpManifest(rt);
    await emailOwner(rt, m.customer_id, `Tệp "${m.name ?? ''}" cần chỉnh sửa`, `<p>Tệp <b>${esc(m.name)}</b> được trả lại.</p><p>Lý do: ${esc(b.reason)}</p>`);
    return c.json(present(await loadMedia(c, m.id)));
  });

  r.delete('/:id', requirePerm('media', 'delete'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    if (m.campaign_id) {
      const camp = (await rt.db.query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [m.campaign_id]))[0];
      if (camp && !['draft', 'rejected'].includes(camp.state)) throw conflict('Tệp đang dùng trong chiến dịch đã gửi duyệt/đang chạy, không thể xóa.', 'in_use');
    }
    await rt.db.tx(async (db) => {
      await db.run('DELETE FROM creatives WHERE id = ?', [m.id]);
      await auditCtx(c, db, { action: 'media.delete', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { name: m.name } });
    });
    await bumpManifest(rt);
    return c.json({ ok: true });
  });

  return r;
}
