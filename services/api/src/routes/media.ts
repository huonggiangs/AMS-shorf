import { Hono } from 'hono';
import { z } from 'zod';
import type { Runtime } from '@ams/runtime';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { esc, trySend } from '../lib/mail.js';
import { HttpError, conflict, forbidden, notFound, tooMany, unprocessable } from '../lib/errors.js';
import { eq, getRt, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { mediaScope } from '../lib/scope.js';
import {
  ALLOWED_MIME, DURATION_RANGE, LIBRARY_IMAGE_MAX_BYTES, LIBRARY_VIDEO_MAX_BYTES, libraryMime, libraryNeedsTranscode, MULTIPART_SESSION_MS, MULTIPART_THRESHOLD_BYTES, PROXY_UPLOAD_MAX_BYTES, multipartPartSize, videoSpecProblem, videoSpecWarnings, GB, MB, apiTarget, checkImportUrl, dbTarget, fitsTarget, inferTarget, isVideoMime, probeImage, sizeLimitBytes, type LinkSource, type Px, type TargetType,
} from '../lib/creative.js';
import { todayVn } from '../lib/dates.js';
import { bumpManifest } from '../lib/manifest.js';
import { enqueueMediaImport, enqueueMediaUploaded, runOutbox } from '../outbox.js';
import { ImportError, YOUTUBE_MSG, planImport } from '../lib/media-import.js';
import { abortOpenMultipart, getTransfer, lazySweepStaleUploads, partsOf } from '../lib/transfers.js';
import { mediaMultipartRoutes } from './media-multipart.js';
import { assertContentVersion, assertLockPolicy, bumpContentVersion, recordApproval, syncKidFlags } from '../lib/creative-security.js';
import { NEEDS_MANUAL_REVIEW, mediaScanReviewRoutes } from './media-scan-review.js';
import { allowUnscannedCreatives, assertScanOk, scanVerdict } from './creatives-scan.js';
import { probeMp4, rangeReaderFor } from '../lib/mp4-probe.js';
import { probeWebm } from '../lib/webm-probe.js';
import { parseDiag, saveDiag } from '../lib/creative-diag.js';
import { requirePerm } from '../auth/middleware.js';
import { can } from '@ams/config';
import { autoApprovePrivileged } from '../lib/auto-approve.js';
import { AD_FORMATS, STREAM_KINDS, STREAM_MIME, isAdFormat, parseOverlay, sha256Hex, validateStreamUrl, type CreativeOverlay } from '@ams/shared';
import { ProbeError, probeStreamUrl, streamBinding, type StreamProbe } from '../lib/stream-probe.js';
import { REASON_UNSCANNED, adoptProbe, assertStreamApprovable, detailOf, loadStream, markStreamApproved, presentStream, type StreamRow } from '../lib/video-link.js';
import { writeAudit } from '../lib/audit.js';
import type { FinancePort } from '../ports.js';
import type { AppEnv, AuthUser } from '../types.js';

const M_SELECT = `m.id, m.campaign_id, m.customer_id, m.name, m.target_type, m.px_w, m.px_h, m.kind, m.source, m.source_url, m.storage_key, m.mime, m.size_bytes, m.duration_s,
  m.uploaded_by, m.uploader_kind, m.scan_state, m.review_state, m.review_note, m.state, m.created_at, m.sha256, m.format, m.overlay, cu.short_name AS owner_name, cu.payment_code AS customer_code, COALESCE(sec.content_version, 1) AS content_version, cv.detail AS scan_detail, th.created_at AS thumb_at,
  st.stream_url AS st_url, st.stream_kind AS st_kind, st.declared_duration_s AS st_dur, st.probe_status AS st_status, st.needs_review AS st_review, st.content_type AS st_ct, st.content_length AS st_len,
  st.etag AS st_etag, st.last_modified AS st_lm, st.checked_at AS st_checked, st.probe_detail AS st_detail, st.full_view_at AS st_fv, st.approved_at AS st_appr,
  tr.kind AS tr_kind, tr.status AS tr_status, tr.bytes_done AS tr_done, tr.bytes_total AS tr_total, tr.error_code AS tr_error_code, tr.error_message AS tr_error, tr.total_parts AS tr_total_parts, tr.parts AS tr_parts, dg.diag AS diag_json`;
const M_FROM = 'FROM creatives m JOIN customers cu ON cu.id = m.customer_id LEFT JOIN creative_security sec ON sec.creative_id = m.id LEFT JOIN creative_validation cv ON cv.creative_id = m.id LEFT JOIN creative_thumbnails th ON th.creative_id = m.id LEFT JOIN creative_transfers tr ON tr.creative_id = m.id LEFT JOIN creative_diag dg ON dg.creative_id = m.id LEFT JOIN creative_stream st ON st.creative_id = m.id';

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
  content_version: number;
  scan_detail: string | null;
  thumb_at?: string | null;
  tr_kind?: string | null;
  tr_status?: string | null;
  tr_done?: number | string | null;
  tr_total?: number | string | null;
  tr_error_code?: string | null;
  tr_error?: string | null;
  tr_total_parts?: number | null;
  tr_parts?: string | null;
  diag_json?: string | null;
  st_url?: string | null;
  st_kind?: string | null;
  st_dur?: number | null;
  st_status?: string | null;
  st_review?: number | null;
  st_ct?: string | null;
  st_len?: number | null;
  st_etag?: string | null;
  st_lm?: string | null;
  st_checked?: string | null;
  st_detail?: string | null;
  st_fv?: string | null;
  st_appr?: string | null;
}

function streamOf(m: MediaRow): Record<string, unknown> | null {
  if (!m.st_url) return null;
  return presentStream({
    stream_url: m.st_url, stream_kind: m.st_kind as StreamRow['stream_kind'], declared_duration_s: num(m.st_dur), probe_status: (m.st_status ?? 'ok') as StreamRow['probe_status'], needs_review: num(m.st_review),
    content_type: m.st_ct ?? null, content_length: m.st_len == null ? null : num(m.st_len), etag: m.st_etag ?? null, last_modified: m.st_lm ?? null, checked_at: m.st_checked ?? '', probe_detail: m.st_detail ?? null, full_view_at: m.st_fv ?? null, approved_at: m.st_appr ?? null,
  });
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
/** Anh dai dien toi da 150 KB (trinh duyet nen JPEG 320 px ~ 10-30 KB). */
export const THUMB_MAX_BYTES = 150 * 1024;
/** Magic bytes: JPEG (FFD8FF) hoac WebP (RIFF....WEBP). Tra ve MIME hoac null. */
export function sniffThumb(b: Uint8Array): 'image/jpeg' | 'image/webp' | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
const SHA_MAX_BYTES = 32 * MB;
/** So tep toi da cho mot lan POST /media/bulk-delete. */
export const BULK_DELETE_MAX = 200;
/** Gioi han ghi trong docs/CLOUDFLARE-MEDIA-LIMITS.md: tep > ngay tren khong bi doc vao bo nho Worker (128 MB) o buoc confirm. */
export const SHA_INLINE_MAX_BYTES = SHA_MAX_BYTES;

/** Vi sao tep chua duyet duoc + nguoi dung lam gi tiep (UI hien thi cho moi trang thai khong the duyet). */
export interface Blocker {
  code: string;
  message: string;
  /** confirm: xac nhan lai tai len | recheck: kiem tra lai tu dong | manual_review: nguoi co quyen xem va duyet tay | reupload: tai lai tep | wait: cho | none */
  action: 'confirm' | 'recheck' | 'manual_review' | 'reupload' | 'wait' | 'retry' | 'none';
}
export function blockerOf(m: Pick<MediaRow, 'state' | 'review_state' | 'scan_state' | 'source'> & { tr_kind?: string | null; tr_status?: string | null; tr_error?: string | null; storage_key?: string | null; st_url?: string | null; st_status?: string | null }): Blocker | null {
  if (m.review_state === 'approved') return null;
  if (m.st_url) {
    if (m.review_state === 'rejected' || m.review_state === 'returned' || m.state === 'rejected') return { code: 'rejected', message: 'Video đã bị trả lại. Dán liên kết khác.', action: 'reupload' };
    if (m.st_status && m.st_status !== 'ok') return { code: 'stream_changed', message: m.st_status === 'changed' ? 'Nội dung ở liên kết đã thay đổi so với lúc duyệt. Bấm "Kiểm tra lại", xem lại toàn bộ video rồi duyệt lại.' : 'Liên kết video không truy cập được. Kiểm tra liên kết hoặc dán liên kết khác.', action: 'manual_review' };
    if (m.scan_state === 'needs_manual_review') return { code: 'creative_needs_manual_review', message: 'Video từ liên kết không được quét mã độc. Người có quyền cần xem trước TOÀN BỘ video và xác nhận "Tôi đã xem toàn bộ nội dung" mới duyệt được.', action: 'manual_review' };
  }
  if (m.state === 'importing') return { code: 'importing', message: 'Hệ thống đang tải tệp từ liên kết về kho lưu trữ. Vui lòng đợi, trạng thái tự cập nhật.', action: 'wait' };
  if (m.tr_kind === 'import' && m.tr_status === 'failed') return { code: 'import_failed', message: m.tr_error ?? 'Tải tệp từ liên kết thất bại. Bấm "Thử lại" hoặc dùng tệp tải lên.', action: 'retry' };
  if (m.state === 'uploading') return { code: 'upload_incomplete', message: 'Tệp chưa tải xong hoặc chưa được xác nhận. Bấm "Xác nhận lại" sau khi tệp đã tải lên; nếu vẫn lỗi, hãy tải lại tệp.', action: 'confirm' };
  if (m.state === 'invalid') return { code: 'invalid', message: 'Tệp không hợp lệ (đã bị từ chối khi xác nhận). Hãy tải lại tệp đúng định dạng.', action: 'reupload' };
  if (m.review_state === 'rejected' || m.review_state === 'returned' || m.state === 'rejected') return { code: 'rejected', message: 'Tệp đã bị trả lại. Chỉnh sửa và tải lại tệp mới.', action: 'reupload' };
  const v = scanVerdict(m, false);
  if (v.ok) return null;
  const action = v.code === 'creative_needs_manual_review' ? 'manual_review' : v.code === 'creative_scan_pending' || v.code === 'creative_not_scanned' ? 'recheck' : v.code === 'creative_link_not_ingested' ? 'none' : 'reupload';
  return { code: v.code!, message: v.message!, action };
}
function reasonsOf(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const r = (JSON.parse(raw) as { reasons?: unknown }).reasons;
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const statusOf = (m: Pick<MediaRow, 'state' | 'review_state'>): string => (m.state === 'uploading' || m.state === 'importing' ? 'processing' : m.review_state === 'returned' ? 'rejected' : m.review_state);

/** Anh dai dien: duong dan API co xac thuc (cookie phien, cung origin voi /api); `v` = thoi diem tao de trinh duyet nap lai khi doi anh. */
export const thumbUrlOf = (m: Pick<MediaRow, 'id' | 'thumb_at'>, external: boolean): string | null =>
  m.thumb_at ? `/api/${external ? 'portal' : 'admin'}/v1/media/${m.id}/thumbnail?v=${encodeURIComponent(m.thumb_at)}` : null;

/** Tien do tai len tung phan / nhap tu lien ket (hien o trang Media: "Dang tai tu Drive... X%"). */
function transferView(m: MediaRow): Record<string, unknown> {
  const done = num(m.tr_done ?? 0);
  const total = m.tr_total === null || m.tr_total === undefined ? null : num(m.tr_total);
  return {
    kind: m.tr_kind,
    status: m.tr_status,
    bytes_done: done,
    bytes_total: total,
    percent: total && total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : null,
    parts_done: partsOf(m.tr_parts).length,
    total_parts: m.tr_total_parts ?? null,
    error_code: m.tr_error_code ?? null,
    error_message: m.tr_error ?? null,
  };
}

/** `warnings`: cau tieng Viet don gian cho moi nguoi dung (codec chap nhan nhung khong toi uu). `diag`: chi tiet ky thuat, CHI tai khoan noi bo (admin). */
function diagFields(m: MediaRow, external: boolean): Record<string, unknown> {
  const d = parseDiag(m.diag_json);
  const warnings = d?.warnings ?? [];
  if (external || !d) return { warnings };
  const { warnings: _w, ...tech } = d;
  return { warnings, ...(d.code === 'warning' ? {} : { diag: tech }) };
}

export const present = (m: MediaRow, external = false): Record<string, unknown> => ({
  ...diagFields(m, external),
  id: m.id,
  name: m.name ?? m.id,
  kind: m.st_url ? 'stream' : m.source !== 'upload' ? 'link' : (m.kind ?? (m.mime?.startsWith('image/') ? 'image' : 'video')),
  delivery: m.st_url ? 'stream' : 'upload',
  stream: streamOf(m),
  mime: m.mime,
  width: m.px_w,
  height: m.px_h,
  duration_sec: m.duration_s,
  size_bytes: m.st_url ? (m.st_len == null ? null : num(m.st_len)) : m.size_bytes === null ? null : num(m.size_bytes),
  status: statusOf(m),
  owner_name: m.owner_name,
  customer_id: m.customer_id,
  customer_code: m.customer_code,
  source: m.source,
  source_url: m.source_url,
  thumb_url: thumbUrlOf(m, external),
  reject_reason: m.review_note,
  campaign_id: m.campaign_id,
  target_type: apiTarget(m.target_type),
  transfer: m.tr_kind ? transferView(m) : null,
  scan_state: m.scan_state,
  scan_reasons: reasonsOf(m.scan_detail),
  blocker: blockerOf(m),
  scan_warning: m.st_url ? 'Nội dung từ liên kết không được quét mã độc: cần xem thủ công toàn bộ' : m.scan_state === 'needs_manual_review' ? 'Chờ kiểm tra thủ công (định dạng bất thường)' : null,
  format: isAdFormat(m.format) ? m.format : 'fullscreen',
  overlay: overlayOf(m.overlay),
  sha256: m.sha256,
  content_version: num(m.content_version ?? 1), // R1-14: gui kem khi duyet; doi noi dung => 409
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
        if (v === 'processing') return { sql: "m.state IN ('uploading','importing')", params: [] };
        if (v === 'rejected') return { sql: "m.review_state IN ('rejected','returned') AND m.state NOT IN ('uploading','importing')", params: [] };
        return { sql: "m.review_state = ? AND m.state NOT IN ('uploading','importing')", params: [v] };
      },
      customer_id: eq('m.customer_id'),
      campaign_id: eq('m.campaign_id'),
      delivery: (v) => (v === 'stream' ? { sql: 'st.creative_id IS NOT NULL', params: [] } : v === 'upload' ? { sql: 'st.creative_id IS NULL', params: [] } : null),
      kind: (v) => (v === 'stream' ? { sql: 'st.creative_id IS NOT NULL', params: [] } : v === 'link' ? { sql: "m.source <> 'upload'", params: [] } : { sql: "m.source = 'upload' AND m.kind = ?", params: [v] }),
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

/** Doc mot creative khong theo pham vi nguoi dung (dung cho tac vu nen: nhap tu lien ket, don dep). KHONG dung trong route. */
export async function loadMediaUnscoped(rt: Runtime, id: string): Promise<MediaRow | null> {
  return (await rt.db.query<MediaRow>(`SELECT ${M_SELECT} ${M_FROM} WHERE m.id = ?`, [id]))[0] ?? null;
}

export const safeFileName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 100) || 'file';

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

/** Kho chung: khach hang he thong 'Kho chung' (khong thanh toan, an khoi danh sach khach) de tep noi bo khong gan khach hang van thoa rang buoc DB. */
export const SHARED_POOL_ID = 'cu_shared_pool';
export async function ensureSharedPool(rt: Runtime): Promise<string> {
  if ((await rt.db.query('SELECT id FROM customers WHERE id = ?', [SHARED_POOL_ID]))[0]) return SHARED_POOL_ID;
  const tenant = (await rt.db.query<{ id: string }>('SELECT id FROM tenants ORDER BY created_at LIMIT 1'))[0];
  if (!tenant) throw unprocessable('Chưa có tenant để tạo kho chung.', 'customer_required');
  await rt.db.run(
    "INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, credit_limit_vnd, created_at) VALUES (?,?,?,?,?,'active',0,?) ON CONFLICT (id) DO NOTHING",
    [SHARED_POOL_ID, tenant.id, 'Kho chung (nội bộ)', 'Kho chung', 'KHOCHUNG', rt.clock.now().toISOString()],
  );
  return SHARED_POOL_ID;
}

async function resolveOwner(c: Ctx, bodyCustomerId: string | null | undefined): Promise<string> {
  const rt = getRt(c);
  const u = c.get('user');
  const customerId = u.kind === 'internal' ? (bodyCustomerId || (await ensureSharedPool(rt))) : u.customerId;
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
  // mo ta hien thi (giong tai len tu may): dinh dang + lop phu (chu/QR/hotline)
  format: z.string().max(20).optional(),
  overlay: overlayInput,
});

const linkBody = z.object({
  url: z.string().trim().min(1, 'Nhập liên kết video').max(2048),
  name: z.string().trim().max(200).optional(),
  duration_sec: z.coerce.number().int('Thời lượng phải là số giây nguyên').min(1, 'Nhập thời lượng video (giây)').max(36000),
  kind: z.enum(STREAM_KINDS).optional(),
  target_type: z.enum(['tv', 'elevator', 'led']).optional(),
  width: z.coerce.number().int().min(1).max(20000).optional(),
  height: z.coerce.number().int().min(1).max(20000).optional(),
  customer_id: z.string().max(64).optional().nullable(),
  format: z.string().max(20).optional(),
  overlay: overlayInput,
});

/** Gioi han toc do theo nguoi dung (cua so 60 giay): moi lan kiem tra link la mot yeu cau ra ngoai. */
async function limitProbe(rt: Runtime, userId: string, what: string, max = 12): Promise<void> {
  const win = Math.floor(rt.clock.now().getTime() / 60_000);
  const n = await rt.kv.incr(`rl:media-link:${what}:${userId}:${win}`, 120);
  if (n > max) throw tooMany('Bạn thao tác quá nhanh, hãy thử lại sau ít phút.', 60, 'rate_limited');
}

/** Loi tu probe -> 422 tieng Viet voi ma ro rang. */
function probeToHttp(e: unknown): never {
  if (e instanceof ProbeError) throw unprocessable(e.message, e.status === 'invalid' ? e.code : e.status === 'unreachable' ? 'stream_unreachable' : 'stream_http_error', { reason: e.code });
  throw e;
}

async function emailOwner(rt: Runtime, customerId: string, subject: string, html: string): Promise<void> {
  const to = (await rt.db.query<{ email: string | null }>('SELECT email FROM customers WHERE id = ?', [customerId]))[0]?.email;
  if (to && /@/.test(to)) await trySend(rt, { to, subject, html, text: html.replace(/<[^>]+>/g, '') });
}

export interface FinalizeOpts {
  rt: Runtime;
  m: MediaRow;
  hints: { width?: number | undefined; height?: number | undefined; duration_sec?: number | undefined };
  actor: { id: string | null; kind: string | null; ip: string };
  /** 'uploading' (tai len) hoac 'importing' (nhap tu lien ket): trang thai tep phai dang o do thi moi chuyen sang pending_review. */
  fromState: 'uploading' | 'importing';
  finance?: (() => Promise<FinancePort>) | undefined;
  /** true: sau khi xong thu tu duyet cho nguoi co quyen media:approve (autoApprovePrivileged tu kiem tra lai nguoi tai len) */
  autoApprove: boolean;
}

/**
 * Buoc "xac nhan" dung chung cho tai len (POST /:id/confirm) va nhap tu lien ket (media-import): doc header tu chinh tep (range read, KHONG nap ca tep vao bo nho Worker),
 * kiem tra spec/dung luong/thoi luong theo loai man, bam SHA-256 (CHI tep <= SHA_MAX_BYTES = 32 MB; tep lon hon de sha256 = NULL, gateway/thiet bi doi chieu khi tai),
 * chep sang khoa cuoi (cung gioi han 32 MB), ghi outbox `media.uploaded`, audit, tu duyet. Spec sai: danh dau 'invalid', xoa tep, nem 422 (tieng Viet).
 */
export async function finalizeUpload(o: FinalizeOpts): Promise<{ warnings: string[] }> {
  const { rt, m, hints } = o;
  const actx = { rt, ip: o.actor.ip, actorId: o.actor.id };
  if (!m.storage_key) throw conflict('Tệp chưa có nội dung trên kho lưu trữ.', 'upload_missing');
  const head = await rt.objects.head(m.storage_key!);
  if (!head) throw conflict('Chưa thấy tệp trên kho lưu trữ. Hãy tải lên bằng đường dẫn đã cấp rồi xác nhận lại.', 'upload_missing');

  const reject = async (code: string, message: string) => {
    await rt.db.tx(async (db) => {
      await db.run("UPDATE creatives SET review_state = 'rejected', review_note = ?, state = 'invalid' WHERE id = ? AND state = ?", [message, m.id, o.fromState]);
      await writeAudit(db, actx, { action: 'media.rejected_on_confirm', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { code, size: head.size } });
    });
    // R1-10: khong de lai tep bi tu choi (chi phi luu tru, tai su dung URL ky)
    try { await rt.objects.delete?.(m.storage_key!); } catch { /* khong chan phan hoi loi */ }
    throw unprocessable(message, code);
  };

  const library = m.uploader_kind === 'internal' && m.customer_id === SHARED_POOL_ID; // kho chung: khong rang buoc loai man/codec/thoi luong; may chu/worker chuyen ma
  const declared = (m.mime ?? '').toLowerCase();
  const got = head.contentType.toLowerCase().split(';')[0]!.trim();
  if (declared && got && got !== declared && got !== 'application/octet-stream') await reject('content_type_mismatch', `Loại tệp tải lên (${got}) khác loại đã khai báo (${declared}).`);

  let w = hints.width ?? (m.px_w ? num(m.px_w) : undefined);
  let h = hints.height ?? (m.px_h ? num(m.px_h) : undefined);
  if (declared.startsWith('image/') && (!library || declared === 'image/png' || declared === 'image/jpeg')) {
    if (head.size <= 25 * MB) {
      const bytes = await rt.objects.get(m.storage_key);
      const px = bytes ? probeImage(bytes) : null;
      if (!px) await reject('invalid_image', 'Không đọc được ảnh (tệp hỏng hoặc không phải PNG/JPG).');
      w = px!.w; // dung kich thuoc doc tu dau tep, khong tin khai bao cua client
      h = px!.h;
    }
  }
  let probedDuration: number | undefined;
  let probedCodec: string | null | undefined;
  if (declared === 'video/webm') {
    // WebM (Matroska): doc codec/kich thuoc/thoi luong tu EBML dau tep (vd AV1/VP9 4K) de bao DUNG ly do thay vi bo qua kiem tra
    try {
      const p = await probeWebm(rangeReaderFor(rt.objects, m.storage_key), head.size);
      if (p.recognized && p.w && p.h) {
        w = p.w;
        h = p.h;
      }
      if (p.recognized && p.durationS !== null && p.durationS > 0) probedDuration = p.durationS;
      if (p.recognized) probedCodec = p.videoCodec;
    } catch (e) {
      console.error('[media] doc header webm loi:', (e as Error).name);
    }
  }
  if (declared === 'video/mp4' || declared === 'video/quicktime') {
    // doc header MP4/MOV (range read, khong doc ca tep): dung thoi luong/kich thuoc doc tu chinh tep, khong tin khai bao cua client
    try {
      const p = await probeMp4(rangeReaderFor(rt.objects, m.storage_key), head.size);
      if (p.recognized && p.w && p.h) {
        w = p.w;
        h = p.h;
      }
      if (p.recognized && p.durationS !== null && p.durationS > 0) probedDuration = p.durationS;
      if (p.recognized) probedCodec = p.videoCodec;
    } catch (e) {
      console.error('[media] doc header mp4 loi:', (e as Error).name);
    }
  }
  const led = await knownLedPx(rt);
  const target: TargetType | null = m.target_type ? dbTarget(m.target_type) : !library && w && h ? inferTarget(w, h, led) : null;
  let warnings: string[] = [];
  let durationSec = probedDuration ?? hints.duration_sec ?? (m.duration_s === null ? undefined : num(m.duration_s));
  if (library) {
    // Kho chung: nhan moi dinh dang/codec. Khong doc duoc kich thuoc (AVI/FLV/MKV/HEVC...) thi de NULL: media-worker (ffprobe) bo sung khi chuyen ma.
    if (declared.startsWith('video/') && libraryNeedsTranscode(declared, probedCodec)) {
      warnings = [`Video ${probedCodec ? `codec ${probedCodec}` : 'định dạng này'} sẽ được tự động chuyển sang MP4 H.264/AAC để thiết bị phát được (cần media-worker; hệ thống không có ffmpeg thì tệp chờ duyệt thủ công).`];
    }
    const limitLib = declared.startsWith('video/') ? LIBRARY_VIDEO_MAX_BYTES : LIBRARY_IMAGE_MAX_BYTES;
    if (head.size > limitLib) await reject('file_too_large', `Tệp ${(head.size / MB).toFixed(1)} MB vượt giới hạn ${Math.floor(limitLib / MB)} MB.`);
  } else {
    if (declared.startsWith('video/')) {
      // codec/độ phân giải màn không phát được: từ chối ngay, xóa tệp (thang máy được H.265 và tới 4K, loại khác H.264 <= Full HD)
      const specProblem = videoSpecProblem({ w, h, codec: probedCodec }, target);
      if (specProblem) await reject(specProblem.code, specProblem.message);
    }
    warnings = declared.startsWith('video/') ? videoSpecWarnings({ codec: probedCodec }, target) : [];
    if (!w || !h) throw unprocessable('Chưa đọc được kích thước video. Hãy dùng tệp MP4 (H.264) chuẩn hoặc gửi width/height khi xác nhận.', 'dimensions_required');

    if (!target) await reject('unsupported_resolution', `Độ phân giải ${w}×${h} không khớp loại màn hình nào.`);
    const fit = fitsTarget(target!, w, h, { knownLed: led });
    if (!fit.ok) await reject('creative_size_mismatch', fit.message);
    const quota = await quotaOf(rt, m.customer_id);
    const limit = sizeLimitBytes(target!, m.uploader_kind === 'internal' ? null : quota.max_mb_per_file, w, declared.startsWith('video/'));
    if (head.size > limit) await reject('file_too_large', `Tệp ${(head.size / MB).toFixed(1)} MB vượt giới hạn ${Math.floor(limit / MB)} MB cho loại màn này.`);
    const dur = DURATION_RANGE[target!];
    if (dur && durationSec !== undefined && declared.startsWith('video/') && (durationSec < dur[0] || durationSec > dur[1])) {
      await reject('duration_out_of_range', `Thời lượng phải từ ${dur[0]} đến ${dur[1]} giây cho loại màn này.`);
    }
  }

  let sha: string | null = null;
  let finalKey: string = m.storage_key;
  if (head.size <= SHA_MAX_BYTES) {
    const bytes = await rt.objects.get(m.storage_key);
    if (!bytes) throw conflict('Chưa đọc được tệp trên kho lưu trữ để xác minh. Thử xác nhận lại.', 'upload_missing');
    sha = await sha256Hex(bytes);
    // R1-10: URL tai len con hieu luc 900 s va dung lai duoc => sau khi bam xong, chep sang khoa MOI (khong ai co URL ky) va xoa khoa cu;
    // tep da bam khong the bi doi tu duoi sau khi duyet. Tep > 128 MB giu khoa cu (khong doc het vao bo nho), thiet bi van doi chieu sha256 khi tai.
    const frozenKey = `media/${m.customer_id}/${m.id}/v1-${safeName(m.name ?? 'file')}`;
    if (frozenKey !== m.storage_key) {
      await rt.objects.put(frozenKey, bytes, m.mime ?? head.contentType);
      try { await rt.objects.delete?.(m.storage_key); } catch { /* khoa cu mo coi: khong anh huong noi dung da duyet */ }
      finalKey = frozenKey;
    }
  }
  await rt.db.tx(async (db) => {
    const res = await db.run(
      `UPDATE creatives SET px_w = ?, px_h = ?, orientation = ?, target_type = ?, size_bytes = ?, duration_s = ?, sha256 = ?, storage_key = ?, state = 'pending_review', source = 'upload' WHERE id = ? AND state = ?`,
      [w ?? null, h ?? null, w && h ? (w >= h ? 'landscape' : 'portrait') : null, target, head.size, durationSec === undefined ? null : Math.round(durationSec), sha, finalKey, m.id, o.fromState],
    );
    if (res.changes === 0) throw conflict('Tệp vừa được xác nhận ở nơi khác.', 'invalid_state');
    await enqueueMediaUploaded(db, rt, m.id); // cung giao dich: xac nhan xong thi chac chan co viec quet (media-worker)
    await writeAudit(db, actx, { action: 'media.confirm', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { px: `${w}x${h}`, size_bytes: head.size, target_type: target, sha256: sha } });
  });
  if (o.finance) {
    try {
      await runOutbox(rt, o.finance); // day ngay cho media-worker; loi thi worker outbox thu lai
    } catch (e) {
      console.error('[media] xu ly outbox loi:', (e as Error).name);
    }
  }
  if (o.autoApprove) await autoApprovePrivileged(rt, m.id, o.actor.ip);
  return { warnings };
}

/** Kiem tra lai video dan link theo yeu cau: nhan binding MOI (neu doi => content_version tang, nguoi duyet phai xem lai), khong tu duyet. */
async function recheckLink(c: Ctx, m: MediaRow, external: boolean): Promise<Record<string, unknown>> {
  const rt = getRt(c);
  if (m.state === 'invalid' || m.review_state === 'approved') throw conflict('Tệp ở trạng thái này không cần kiểm tra lại.', 'invalid_state');
  await limitProbe(rt, c.get('user').id, 'recheck');
  const s = await loadStream(rt.db, m.id);
  if (!s) throw conflict('Không phải video dán link.', 'invalid_state');
  const nowIso = rt.clock.now().toISOString();
  let p: StreamProbe;
  try {
    p = await probeStreamUrl(s.stream_url, { kind: s.stream_kind });
  } catch (e) {
    if (e instanceof ProbeError && e.status !== 'invalid') {
      await rt.db.run("UPDATE creative_stream SET probe_status = ?, needs_review = 1, checked_at = ?, probe_detail = ? WHERE creative_id = ?", [e.status === 'http_error' ? 'http_error' : 'unreachable', nowIso, JSON.stringify({ warnings: [], reason: e.code }), m.id]);
      await bumpManifest(rt);
    }
    return probeToHttp(e);
  }
  if (p.status !== 'ok') {
    await rt.db.run("UPDATE creative_stream SET probe_status = ?, needs_review = 1, checked_at = ?, probe_detail = ? WHERE creative_id = ?", [p.status, nowIso, JSON.stringify({ warnings: p.warnings, reason: `http_${p.http_status}` }), m.id]);
    throw unprocessable(`Máy chủ video trả lỗi HTTP ${p.http_status ?? '?'}.`, 'stream_http_error', { http_status: p.http_status });
  }
  const binding = await streamBinding(s.stream_url, p);
  await rt.db.tx(async (db) => {
    await adoptProbe(db, m.id, s.stream_url, p, nowIso);
    if (binding !== s.binding) await bumpContentVersion(db, m.id, nowIso);
    await db.run("UPDATE creative_stream SET needs_review = CASE WHEN ? = 1 THEN 1 ELSE needs_review END WHERE creative_id = ?", [binding !== s.binding ? 1 : 0, m.id]);
    await auditCtx(c, db, { action: 'media.link_recheck', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { changed: binding !== s.binding, etag: { from: s.etag, to: p.etag }, content_length: { from: s.content_length, to: p.content_length } } });
  });
  if (binding !== s.binding) await bumpManifest(rt);
  return present(await loadMedia(c, m.id), external);
}

export function mediaRoutes(external: boolean): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('media', 'view'), async (c) => {
    const rt = getRt(c);
    await lazySweepStaleUploads(rt); // tep 'uploading' qua 1 gio (loi cu) -> "can chinh sua", khong con the "Dang xu ly" vinh vien
    const res = await runList<MediaRow>(c, mediaSpec(c.get('user'), rt.clock.now().toISOString()));
    return c.json({ ...res, items: res.items.map((x) => present(x, external)) });
  });

  r.get('/:id', requirePerm('media', 'view'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    const out = present(m, external);
    // Tep da nam trong kho (tai len HOAC nhap tu Drive/link da tai ve) deu xem truoc duoc; link truc tiep chua tai ve thi dung chinh URL do.
    if (m.st_url) out['preview_url'] = m.st_url; // video dan link: trinh duyet nguoi duyet phat truc tiep tu URL
    else if (m.storage_key && m.state !== 'uploading' && m.state !== 'invalid') out['preview_url'] = await rt.objects.getSigned(m.storage_key, 900);
    else if (m.source === 'url' && m.source_url && /^https?:\/\//i.test(m.source_url)) out['preview_url'] = m.source_url;
    return c.json(out);
  });

  r.post('/upload-url', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, uploadBody);
    const customerId = await resolveOwner(c, b.customer_id);
    const library = u.kind === 'internal' && customerId === SHARED_POOL_ID; // kho chung: nguoi noi bo, nhan moi dinh dang/codec, chuyen ma sau
    let mime = b.content_type.toLowerCase().split(';')[0]!.trim();
    if (library) {
      const lm = libraryMime(b.name, mime);
      if (!lm) throw unprocessable('Chỉ nhận tệp video hoặc ảnh (MP4, MOV, AVI, FLV, RMVB, MKV, WebM, PNG, JPG, GIF, WebP…).', 'unsupported_type');
      mime = lm.mime;
    } else if (!(ALLOWED_MIME as readonly string[]).includes(mime)) throw unprocessable('Chỉ nhận MP4, MOV, WebM, PNG hoặc JPG.', 'unsupported_type');
    const quota = await quotaOf(rt, customerId);
    const extQuotaMb = u.kind === 'internal' ? null : quota.max_mb_per_file;

    let target: TargetType | null = b.target_type ? dbTarget(b.target_type) : null;
    if (library) {
      // kho chung: KHONG ep loai man (target_type chi co khi nguoi dung chon): tep dung duoc cho moi chuong trinh, kiem khop khi xuat ban
    } else if (b.width && b.height) {
      const led = await knownLedPx(rt);
      target ??= inferTarget(b.width, b.height, led);
      if (!target) throw unprocessable(`Độ phân giải ${b.width}×${b.height} không khớp loại màn hình nào (TV 16:9, thang máy dọc 9:16 từ 720×1280 đến 2160×3840, LED P5 đúng kích thước bảng).`, 'unsupported_resolution');
      const fit = fitsTarget(target, b.width, b.height, { knownLed: led });
      if (!fit.ok) throw unprocessable(fit.message, 'creative_size_mismatch');
    }
    if (!library && isVideoMime(mime)) {
      const vp = videoSpecProblem({ w: b.width, h: b.height }, target);
      if (vp) throw unprocessable(vp.message, vp.code);
    }
    // Kho khong ky duoc URL (Cloudflare thieu khoa S3): tep <= 90 MB di qua Worker bang MOT PUT (body Worker toi da 100 MB, tran 95 MB);
    // tep lon hon tai TUNG PHAN (multipart qua binding R2, moi phan 32 MiB) neu kho ho tro, khong thi bao nen lai.
    const viaProxy = rt.objects.signedPut === false && typeof rt.objects.putStream === 'function';
    const canMultipart = typeof rt.objects.multipartCreate === 'function' && typeof rt.objects.multipartUploadPart === 'function' && typeof rt.objects.multipartComplete === 'function';
    const viaMultipart = viaProxy && canMultipart && b.size_bytes > MULTIPART_THRESHOLD_BYTES;
    if (viaProxy && !viaMultipart && b.size_bytes > PROXY_UPLOAD_MAX_BYTES) throw unprocessable(`Tệp ${(b.size_bytes / MB).toFixed(1)} MB vượt 95 MB: nén lại (H.264) rồi tải lại.`, 'file_too_large', { limit_bytes: PROXY_UPLOAD_MAX_BYTES });
    const limit = library ? (isVideoMime(mime) ? LIBRARY_VIDEO_MAX_BYTES : LIBRARY_IMAGE_MAX_BYTES) : sizeLimitBytes(target ?? 'tv', extQuotaMb, b.width, isVideoMime(mime));
    if (b.size_bytes > limit) throw unprocessable(`Tệp ${(b.size_bytes / MB).toFixed(1)} MB vượt giới hạn ${Math.floor(limit / MB)} MB${target && !library ? ` cho loại màn này` : ''}.`, 'file_too_large', { limit_bytes: limit });
    const dur = target && !library ? DURATION_RANGE[target] : undefined;
    if (dur && b.duration_sec !== undefined && isVideoMime(mime) && (b.duration_sec < dur[0] || b.duration_sec > dur[1])) {
      throw unprocessable(`Thời lượng phải từ ${dur[0]} đến ${dur[1]} giây cho loại màn này, tệp dài ${Math.round(b.duration_sec)} giây.`, 'duration_out_of_range');
    }
    if (!library) await checkQuotas(rt, customerId, b.size_bytes, quota);
    const fo = checkFormatOverlay(b.format, b.overlay, external);

    const id = rt.id();
    const key = `media/${customerId}/${id}/${safeName(b.name)}`;
    const nowIso = rt.clock.now().toISOString();
    const apiBase = `/api/${external ? 'portal' : 'admin'}/v1/media/${id}`;
    const partSize = multipartPartSize(rt);
    const signed = viaMultipart ? { url: `${apiBase}/multipart`, headers: { 'Content-Type': mime } } : viaProxy ? { url: `${apiBase}/content`, headers: { 'Content-Type': mime } } : await rt.objects.putSigned(key, mime, 900, { maxBytes: b.size_bytes });
    await rt.db.tx(async (db) => {
      await db.run(
        `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, source_url, storage_key, mime, size_bytes, duration_s, uploaded_by, uploader_kind, scan_state, review_state, state, format, overlay, created_at)
         VALUES (?,NULL,?,?,?,?,?,?,?,'upload',NULL,?,?,?,?,?,?,'pending','pending','uploading',?,?,?)`,
        [id, customerId, b.name, target, b.width ?? null, b.height ?? null, b.width && b.height ? (b.width >= b.height ? 'landscape' : 'portrait') : null, isVideoMime(mime) ? 'video' : 'image', key, mime, b.size_bytes, b.duration_sec === undefined ? null : Math.round(b.duration_sec), u.id, u.kind, fo.format ?? 'fullscreen', fo.overlay ?? null, nowIso],
      );
      await auditCtx(c, db, { action: 'media.upload_url', objectType: 'creative', objectId: id, customerId, diff: { name: b.name, size_bytes: b.size_bytes, mime } });
    });
    return c.json(
      viaMultipart
        // multipart: client goi POST url (khoi tao) roi PUT {apiBase}/parts/:n tuan tu, POST {apiBase}/multipart/complete, roi /confirm
        ? { id, url: signed.url, method: 'POST', headers: signed.headers, key, expires_in: MULTIPART_SESSION_MS / 1000, via: 'multipart', multipart: { part_size: partSize, total_parts: Math.ceil(b.size_bytes / partSize), parts_url: `${apiBase}/parts/{n}`, complete_url: `${apiBase}/multipart/complete`, abort_url: `${apiBase}/multipart/abort` } }
        : { id, url: signed.url, method: 'PUT', headers: signed.headers, key, expires_in: 900, via: viaProxy ? 'proxy' : 'direct' },
      201,
    );
  });

  /**
   * Nhan tep qua Worker khi kho khong ky duoc URL (R2 thieu khoa S3). Chi chu tep (nguoi tao) khi tep con `uploading`; Content-Length phai bang size_bytes da khai,
   * Content-Type phai khop; ghi thang luong vao kho (khong doc ca tep vao bo nho); sau do client goi /confirm nhu thuong.
   */
  r.put('/:id/content', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const m = await loadMedia(c, c.req.param('id'));
    if (rt.objects.signedPut !== false || typeof rt.objects.putStream !== 'function') throw conflict('Kho lưu trữ cho phép tải lên trực tiếp bằng đường dẫn đã ký; không dùng đường này.', 'direct_upload_available');
    if (m.uploaded_by !== u.id) throw forbidden('Chỉ người tạo tệp mới được tải nội dung lên.', 'not_uploader');
    if (m.source !== 'upload' || m.state !== 'uploading' || !m.storage_key) throw conflict('Tệp không ở trạng thái chờ tải lên.', 'invalid_state');
    if (rt.clock.now().getTime() - new Date(m.created_at).getTime() > 3600_000) throw conflict('Phiên tải lên đã hết hạn. Hãy chọn tệp và tải lại.', 'upload_expired');
    const n = await rt.kv.incr(`rl:media-put:${u.id}`, 3600);
    if (n > 60) throw tooMany('Tải lên quá nhiều lần. Vui lòng thử lại sau.', 3600);
    const want = num(m.size_bytes);
    const ct = (c.req.header('content-type') ?? '').toLowerCase().split(';')[0]!.trim();
    if (!ct || ct !== (m.mime ?? '').toLowerCase()) throw unprocessable(`Loại tệp tải lên (${ct || 'không có'}) khác loại đã khai báo (${m.mime ?? ''}).`, 'content_type_mismatch');
    const lenRaw = c.req.header('content-length');
    const len = lenRaw === undefined ? NaN : Number(lenRaw);
    if (!Number.isInteger(len)) throw new HttpError(400, 'length_required', 'Thiếu Content-Length.');
    if (len > PROXY_UPLOAD_MAX_BYTES || want > PROXY_UPLOAD_MAX_BYTES) throw new HttpError(413, 'file_too_large', 'Tệp vượt 95 MB: nén lại (H.264) rồi tải lại.', { limit_bytes: PROXY_UPLOAD_MAX_BYTES });
    if (len !== want) throw new HttpError(400, 'length_mismatch', `Dung lượng gửi lên (${len} byte) khác dung lượng đã khai báo (${want} byte).`);
    const body = c.req.raw.body;
    if (!body) throw new HttpError(400, 'empty_body', 'Thiếu nội dung tệp.');
    // dem byte thuc te: neu gui nhieu hon khai bao thi cat va tu choi (Content-Length co the noi doi)
    let seen = 0;
    const guard = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        seen += chunk.length;
        if (seen > want) ctl.error(new Error('over_declared'));
        else ctl.enqueue(chunk);
      },
    });
    try {
      await rt.objects.putStream(m.storage_key, body.pipeThrough(guard), ct, want);
    } catch {
      try { await rt.objects.delete?.(m.storage_key); } catch { /* khong chan */ }
      throw new HttpError(400, 'upload_failed', 'Không nhận trọn vẹn tệp (mất kết nối hoặc dung lượng sai). Hãy tải lại.');
    }
    const head = await rt.objects.head(m.storage_key);
    if (!head || head.size !== want) {
      try { await rt.objects.delete?.(m.storage_key); } catch { /* khong chan */ }
      throw new HttpError(400, 'length_mismatch', 'Dung lượng tệp nhận được không khớp khai báo. Hãy tải lại.');
    }
    await rt.db.tx(async (db) => {
      await auditCtx(c, db, { action: 'media.upload_proxy', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { size_bytes: want, mime: ct } });
    });
    return c.json({ ok: true, size_bytes: want });
  });

  r.route('/', mediaMultipartRoutes<MediaRow>({ external, loadMedia }));

  r.post('/:id/confirm', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ width: z.coerce.number().int().min(1).max(20000).optional(), height: z.coerce.number().int().min(1).max(20000).optional(), duration_sec: z.coerce.number().min(0).max(36000).optional() }));
    if (m.source !== 'upload' || !m.storage_key) throw conflict('Tệp này không phải tệp tải lên.', 'invalid_state');
    if (m.state !== 'uploading') return c.json(present(m, external)); // idempotent
    const u = c.get('user');
    const fin = await finalizeUpload({
      rt, m, hints: { width: b.width, height: b.height, duration_sec: b.duration_sec }, fromState: 'uploading',
      actor: { id: u.id, kind: u.kind, ip: c.get('ip') }, finance: c.get('finance'),
      // Nguoi noi bo co quyen media:approve tu tai len: tu duyet (sau khi da qua kiem tra spec). Duong Cloudflare: validator da chay trong runOutbox.
      // Duong VPS: media-worker quet bat dong bo -> sweepAutoApprove (worker outbox) duyet khi scan_state xong. Khach/doi tac: van cho duyet.
      autoApprove: !external && u.kind === 'internal' && can(u.perms, u.role, 'media', 'approve'),
    });
    if (fin.warnings.length) await rt.db.tx(async (db) => { await saveDiag(db, m.id, { kind: 'import', code: 'warning', http: null, content_type: null, title: null, snippet: null, final_url: null, steps: [], warnings: fin.warnings }, rt.clock.now().toISOString()); });
    return c.json(present(await loadMedia(c, m.id), external));
  });

  /**
   * Nhap tu lien ket: Google Drive (cong khai) / Dropbox / URL truc tiep. Chi LUU tham chieu + xep viec; Worker (Queue consumer, lib/media-import.ts) tai ve R2 bang multipart,
   * roi chay dung luong xac nhan nhu tep tai len. Tien do o `transfer` (percent/bytes/error); that bai -> nut "Thu lai" (POST /:id/import/retry). YouTube: chua ho tro (422).
   */
  r.post('/import', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, importBody);
    const customerId = await resolveOwner(c, b.customer_id);
    const fo = checkFormatOverlay(b.format, b.overlay, external);
    if (b.source === 'youtube') throw unprocessable(YOUTUBE_MSG, 'youtube_unsupported');
    const chk = checkImportUrl(b.source as LinkSource, b.url);
    if (!chk.ok) throw unprocessable(chk.message, 'bad_media_url');
    let plan;
    try {
      plan = planImport(b.source, chk.url.toString(), rt.config.runtime === 'cloudflare' || rt.config.runtime === 'test');
    } catch (e) {
      if (e instanceof ImportError) throw unprocessable(e.message, e.code);
      throw e;
    }
    const quota = await quotaOf(rt, customerId);
    await checkQuotas(rt, customerId, 0, quota);
    const id = rt.id();
    const url = chk.url.toString();
    const fromUrl = decodeURIComponent(chk.url.pathname.split('/').filter(Boolean).pop() ?? '');
    const name = b.name || (plan.source === 'url' ? fromUrl || chk.url.hostname : `Tệp từ ${plan.label}`);
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run(
        `INSERT INTO creatives (id, campaign_id, customer_id, name, kind, source, source_url, uploaded_by, uploader_kind, scan_state, review_state, state, format, overlay, created_at)
         VALUES (?,NULL,?,?,'link',?,?,?,?,'pending','pending','importing',?,?,?)`,
        [id, customerId, name.slice(0, 200), plan.source, url, u.id, u.kind, fo.format ?? 'fullscreen', fo.overlay ?? null, nowIso],
      );
      await syncKidFlags(db, id, fo.overlay ?? null, nowIso); // cot kid_safe/lock_context dong bo nhu route /overlay
      await db.run("INSERT INTO creative_transfers (creative_id, kind, status, parts, bytes_done, attempts, started_at, updated_at) VALUES (?,'import','queued','[]',0,0,?,?)", [id, nowIso, nowIso]);
      await enqueueMediaImport(db, rt, id, '1');
      await auditCtx(c, db, { action: 'media.import', objectType: 'creative', objectId: id, customerId, diff: { source: plan.source, host: chk.url.hostname, format: fo.format ?? 'fullscreen', overlay: fo.overlay ? 'set' : 'none' } });
    });
    try {
      await runOutbox(rt, c.get('finance')); // day ngay cho consumer; loi thi cron thu lai
    } catch (e) {
      console.error('[media] xu ly outbox loi:', (e as Error).name);
    }
    return c.json(present(await loadMedia(c, id), external), 201);
  });

  // "Thu lai" nhap tu lien ket da that bai (vd Drive chua chia se cong khai, vuot han muc tai): dat lai tien trinh va xep viec moi.
  r.post('/:id/import/retry', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const m = await loadMedia(c, c.req.param('id'));
    if (m.uploaded_by !== u.id && !(!external && u.kind === 'internal' && can(u.perms, u.role, 'media', 'approve'))) throw forbidden('Chỉ người tạo tệp hoặc người có quyền duyệt mới được thử lại.', 'not_uploader');
    const t = await getTransfer(rt.db, m.id);
    if (!t || t.kind !== 'import' || t.status !== 'failed') throw conflict('Tệp này không có lần nhập nào thất bại để thử lại.', 'invalid_state', { status: t?.status ?? null });
    if (!m.source_url) throw conflict('Tệp không còn liên kết nguồn.', 'invalid_state');
    if ((await rt.kv.incr(`rl:media-import-retry:${u.id}`, 3600)) > 20) throw tooMany('Thử lại quá nhiều lần. Vui lòng thử lại sau.', 3600);
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run("UPDATE creative_transfers SET status = 'queued', attempts = 0, upload_id = NULL, parts = '[]', bytes_done = 0, bytes_total = NULL, error_code = NULL, error_message = NULL, started_at = ?, updated_at = ? WHERE creative_id = ? AND status = 'failed'", [nowIso, nowIso, m.id]);
      await db.run("UPDATE creatives SET review_state = 'pending', review_note = NULL, state = 'importing', storage_key = NULL, size_bytes = NULL, scan_state = 'pending' WHERE id = ? AND state IN ('importing','invalid')", [m.id]);
      await enqueueMediaImport(db, rt, m.id, rt.id());
      await auditCtx(c, db, { action: 'media.import_retry', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { previous_error: t.error_code } });
    });
    try {
      await runOutbox(rt, c.get('finance'));
    } catch (e) {
      console.error('[media] xu ly outbox loi:', (e as Error).name);
    }
    return c.json(present(await loadMedia(c, m.id), external));
  });

  // Dan link video (stream): TV phat truc tiep tu URL, may chu KHONG tai/chuyen ma/luu video; khong gioi han do phan giai/bitrate/fps.
  // Chi HEAD + Range <= 64 KB qua chot SSRF (lib/stream-probe.ts). Moi creative nay vao 'needs_manual_review' (remote_stream_unscanned): phai co nguoi XEM THAT roi duyet.
  r.post('/link', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, linkBody);
    const customerId = await resolveOwner(c, b.customer_id);
    await limitProbe(rt, u.id, 'create');
    const chk = validateStreamUrl(b.url);
    if (!chk.ok) throw unprocessable(chk.message, chk.code);
    const target: TargetType = b.target_type ? dbTarget(b.target_type) : 'tv';
    const range = DURATION_RANGE[target];
    if (range && (b.duration_sec < range[0] || b.duration_sec > range[1])) throw unprocessable(`Thời lượng phải từ ${range[0]} đến ${range[1]} giây cho loại màn này.`, 'duration_out_of_range');
    if (target !== 'tv') {
      // thang may/LED khong tu co gian: can do phan giai dung de manifest chon dung nhom (TV thi KHONG kiem tra do phan giai: 2K-8K deu nhan)
      if (!b.width || !b.height) throw unprocessable('Màn thang máy/LED cần khai báo đúng độ phân giải video (rộng × cao).', 'dimensions_required');
      const fit = fitsTarget(target, b.width, b.height, { knownLed: await knownLedPx(rt) });
      if (!fit.ok) throw unprocessable(fit.message, 'creative_size_mismatch');
    }
    const fo = checkFormatOverlay(b.format, b.overlay, external);
    const quota = await quotaOf(rt, customerId);
    await checkQuotas(rt, customerId, 0, quota);

    let p: StreamProbe;
    try {
      p = await probeStreamUrl(chk.url.toString(), { kind: b.kind ?? null });
    } catch (e) {
      probeToHttp(e);
    }
    if (p!.status !== 'ok') throw unprocessable(`Máy chủ video trả lỗi HTTP ${p!.http_status ?? '?'}. Kiểm tra liên kết có mở công khai (không cần đăng nhập) được không.`, 'stream_http_error', { http_status: p!.http_status });
    const probe = p!;
    const d = probe.info.duration_s;
    if (d && Math.abs(d - b.duration_sec) > Math.max(2, b.duration_sec * 0.1)) probe.warnings.push(`duration_mismatch:khai báo ${b.duration_sec} giây, video ${d} giây`);

    const id = rt.id();
    const url = chk.url.toString();
    const nowIso = rt.clock.now().toISOString();
    const binding = await streamBinding(url, probe);
    const name = (b.name || decodeURIComponent(chk.url.pathname.split('/').filter(Boolean).pop() ?? '') || chk.host).slice(0, 200);
    await rt.db.tx(async (db) => {
      await db.run(
        `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, source_url, storage_key, mime, size_bytes, duration_s, uploaded_by, uploader_kind, scan_state, review_state, state, format, overlay, created_at)
         VALUES (?,NULL,?,?,?,?,?,?,'video','url',?,NULL,?,NULL,?,?,?,'needs_manual_review','pending','pending_review',?,?,?)`,
        [id, customerId, name, target, b.width ?? probe.info.width ?? null, b.height ?? probe.info.height ?? null, (b.width ?? probe.info.width ?? 0) && (b.height ?? probe.info.height ?? 0) ? ((b.width ?? probe.info.width!) >= (b.height ?? probe.info.height!) ? 'landscape' : 'portrait') : null, url, STREAM_MIME[probe.kind], b.duration_sec, u.id, u.kind, fo.format ?? 'fullscreen', fo.overlay ?? null, nowIso],
      );
      await db.run(
        `INSERT INTO creative_stream (creative_id, delivery, stream_url, stream_kind, declared_duration_s, content_type, content_length, etag, last_modified, body_hash, binding, probe_status, probe_detail, fail_count, needs_review, checked_at, created_at)
         VALUES (?,'stream',?,?,?,?,?,?,?,?,?,'ok',?,0,0,?,?)`,
        [id, url, probe.kind, b.duration_sec, probe.content_type, probe.content_length, probe.etag, probe.last_modified, probe.body_hash, binding, JSON.stringify(detailOf(probe)), nowIso, nowIso],
      );
      await db.run(
        `INSERT INTO creative_validation (creative_id, engine, verdict, detail, sha256, checked_at) VALUES (?,?,?,?,NULL,?)`,
        [id, 'remote_stream', 'needs_manual_review', JSON.stringify({ reasons: [REASON_UNSCANNED] }), nowIso],
      );
      await syncKidFlags(db, id, fo.overlay ?? null, nowIso);
      await auditCtx(c, db, { action: 'media.link_create', objectType: 'creative', objectId: id, customerId, diff: { delivery: 'stream', host: chk.host, kind: probe.kind, duration_sec: b.duration_sec, target_type: target, etag: probe.etag, content_length: probe.content_length } });
    });
    return c.json(present(await loadMedia(c, id), external), 201);
  });

  // Kiem tra lai tu dong (tep 'pending' bi ket do mat tin nhan/queue, hoac 'needs_manual_review' muon chay lai kiem tra): dat lai 'pending' + day lai viec quet.
  // Khong bao gio ghi 'clean' o day: chi bo quet (media-worker/ClamAV tren VPS, validator tren Cloudflare) moi quyet dinh.
  r.post('/:id/recheck', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    if (m.st_url) return c.json(await recheckLink(c, m, external)); // video dan link: kiem tra lai URL (HEAD/Range)
    if (m.source !== 'upload' || !m.storage_key) throw conflict('Tệp lấy từ liên kết không kiểm tra lại được.', 'invalid_state');
    if (m.state === 'uploading') throw conflict('Tệp chưa được xác nhận tải lên. Hãy xác nhận lại trước.', 'invalid_state');
    if (m.state === 'invalid' || m.review_state === 'approved') throw conflict('Tệp ở trạng thái này không cần kiểm tra lại.', 'invalid_state');
    if (!['pending', NEEDS_MANUAL_REVIEW, 'unscanned', 'skipped'].includes(m.scan_state)) throw conflict('Tệp đã có kết quả quét cuối cùng, không kiểm tra lại được.', 'invalid_state', { scan_state: m.scan_state });
    await rt.db.tx(async (db) => {
      await db.run("UPDATE creatives SET scan_state = 'pending' WHERE id = ? AND scan_state IN ('pending','needs_manual_review','unscanned','skipped')", [m.id]);
      await db.run("DELETE FROM outbox WHERE dedupe_key = ? AND status <> 'pending'", [`media.uploaded:${m.id}`]); // cho phep dat viec moi (khoa khu trung)
      await enqueueMediaUploaded(db, rt, m.id);
      await auditCtx(c, db, { action: 'media.recheck', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { scan_state: { from: m.scan_state, to: 'pending' } } });
    });
    try {
      await runOutbox(rt, c.get('finance'));
    } catch (e) {
      console.error('[media] xu ly outbox loi:', (e as Error).name);
    }
    return c.json(present(await loadMedia(c, m.id), external));
  });

  // Anh dai dien do trinh duyet tao (canvas) luc tai len: PUT thang byte anh (JPEG/WebP <= 150 KB), kiem tra magic bytes, luu o kho tep.
  r.put('/:id/thumbnail', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    if (m.source !== 'upload' || m.state === 'invalid') throw conflict('Tệp này không có ảnh đại diện.', 'invalid_state');
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > THUMB_MAX_BYTES) throw new HttpError(413, 'thumbnail_too_large', `Ảnh đại diện tối đa ${THUMB_MAX_BYTES / 1024} KB.`, { limit_bytes: THUMB_MAX_BYTES });
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) throw unprocessable('Ảnh đại diện rỗng.', 'thumbnail_empty');
    if (bytes.length > THUMB_MAX_BYTES) throw new HttpError(413, 'thumbnail_too_large', `Ảnh đại diện tối đa ${THUMB_MAX_BYTES / 1024} KB.`, { limit_bytes: THUMB_MAX_BYTES });
    const type = sniffThumb(bytes);
    if (!type) throw unprocessable('Ảnh đại diện phải là JPEG hoặc WebP hợp lệ.', 'thumbnail_bad_type');
    const key = `media/${m.customer_id}/${m.id}/thumb.jpg`;
    const nowIso = rt.clock.now().toISOString();
    await rt.objects.put(key, bytes, type);
    await rt.db.tx(async (db) => {
      await db.run(
        `INSERT INTO creative_thumbnails (creative_id, thumb_key, content_type, size_bytes, created_at) VALUES (?,?,?,?,?)
         ON CONFLICT (creative_id) DO UPDATE SET thumb_key = excluded.thumb_key, content_type = excluded.content_type, size_bytes = excluded.size_bytes, created_at = excluded.created_at`,
        [m.id, key, type, bytes.length, nowIso],
      );
      await auditCtx(c, db, { action: 'media.thumbnail', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { size_bytes: bytes.length, content_type: type } });
    });
    return c.json({ ok: true, thumb_url: thumbUrlOf({ id: m.id, thumb_at: nowIso }, external) });
  });

  r.get('/:id/thumbnail', requirePerm('media', 'view'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id')); // kiem tra pham vi khach hang nhu moi route media
    const t = (await rt.db.query<{ thumb_key: string; content_type: string }>('SELECT thumb_key, content_type FROM creative_thumbnails WHERE creative_id = ?', [m.id]))[0];
    const body = t ? await rt.objects.get(t.thumb_key) : null;
    if (!t || !body) throw notFound('Tệp chưa có ảnh đại diện.');
    return new Response(body, { status: 200, headers: { 'Content-Type': t.content_type, 'Content-Length': String(body.length), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
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
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run(
        `UPDATE creatives SET format = COALESCE(?, format), overlay = CASE WHEN ? = 1 THEN ? ELSE overlay END${resetReview ? ", review_state = 'pending', state = 'pending_review'" : ''} WHERE id = ?`,
        [fo.format ?? null, fo.overlay === undefined ? 0 : 1, fo.overlay ?? null, m.id],
      );
      // R1-14: moi lan doi noi dung tang phien ban (hang cho duyet phai gui kem phien ban da xem); kid_safe/lock dong bo thanh cot
      const ver = await bumpContentVersion(db, m.id, nowIso);
      const after = (await db.query<{ overlay: string | null; format: string | null; sha256: string | null; storage_key: string | null; size_bytes: unknown; source_url: string | null }>('SELECT overlay, format, sha256, storage_key, size_bytes, source_url FROM creatives WHERE id = ?', [m.id]))[0]!;
      await syncKidFlags(db, m.id, after.overlay, nowIso);
      // noi bo sua tep da duyet: coi la duyet lai co kiem toan (giu approved); khach sua: da quay ve cho duyet o tren
      if (!resetReview && m.review_state === 'approved') await recordApproval(db, { id: m.id, ...after }, nowIso);
      await auditCtx(c, db, { action: 'media.overlay', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { content_version: ver, format: fo.format ?? null, overlay: fo.overlay === undefined ? 'unchanged' : fo.overlay, review_reset: resetReview } });
    });
    if (m.campaign_id) await bumpManifest(rt);
    return c.json(present(await loadMedia(c, m.id), external));
  });

  if (external) return r;
  r.route('/', mediaScanReviewRoutes()); // creative 'needs_manual_review' (duong Cloudflare)

  r.post('/:id/approve', requirePerm('media', 'approve'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const m = await loadMedia(c, c.req.param('id'));
    const body = await parseBody(c, z.object({ content_version: z.coerce.number().int().min(1).optional(), manual_review_note: z.string().trim().min(3, 'Nhập ghi chú kiểm tra thủ công (tối thiểu 3 ký tự)').max(500).optional(), confirm_full_view: z.boolean().optional() }));
    if (m.state === 'uploading' || m.state === 'importing' || m.state === 'invalid') throw conflict('Tệp chưa tải xong hoặc không hợp lệ.', 'invalid_state');
    if (m.review_state === 'approved') return c.json(present(m, external));
    // Cloudflare (khong co ClamAV): nguoi co quyen media:approve xem tep roi duyet MOT BUOC; ghi chu bat buoc, ghi audit + creative_validation.engine='manual'.
    const manual = m.scan_state === NEEDS_MANUAL_REVIEW && body.manual_review_note !== undefined;
    assertScanOk(manual ? { ...m, scan_state: 'clean' } : m, await allowUnscannedCreatives(rt), { creative_id: m.id, scan_state: m.scan_state });
    await assertContentVersion(rt.db, m.id, body.content_version); // R1-14: nguoi duyet phai duyet dung phien ban da xem
    // video dan link: bat buoc xac nhan da xem toan bo + noi dung xa khong doi ke tu luc xem
    const isStream = await assertStreamApprovable(rt, m.id, body.confirm_full_view);
    await assertLockPolicy(rt.db, m.overlay, { creative_id: m.id }); // chinh sach tre em: man khoa tat thi khong duyet creative co ngu canh 'lock'
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      // buoc phien ban + noi dung nam TRONG giao dich: doi noi dung giua luc kiem va luc duyet lam UPDATE khong khop
      const cur = (await db.query<{ sha256: string | null; storage_key: string | null; size_bytes: unknown; source_url: string | null; format: string | null; overlay: string | null }>('SELECT sha256, storage_key, size_bytes, source_url, format, overlay FROM creatives WHERE id = ?', [m.id]))[0];
      if (!cur || cur.overlay !== m.overlay || cur.format !== m.format || cur.sha256 !== m.sha256) throw conflict('Nội dung tệp vừa thay đổi, hãy tải lại và xem lại trước khi duyệt.', 'content_changed');
      await assertContentVersion(db, m.id, body.content_version);
      if (manual) {
        const mr = await db.run("UPDATE creatives SET scan_state = 'clean' WHERE id = ? AND scan_state = ?", [m.id, NEEDS_MANUAL_REVIEW]);
        if (mr.changes === 0) throw conflict('Tệp vừa được người khác xử lý.', 'invalid_state');
        await db.run(
          `INSERT INTO creative_validation (creative_id, engine, verdict, detail, sha256, checked_at) VALUES (?,?,?,?,NULL,?)
           ON CONFLICT (creative_id) DO UPDATE SET engine = excluded.engine, verdict = excluded.verdict, detail = excluded.detail, checked_at = excluded.checked_at`,
          [m.id, 'manual', 'clean', JSON.stringify({ by: u.id, note: body.manual_review_note, previous: m.scan_detail }), nowIso],
        );
        await auditCtx(c, db, { action: 'media.scan_review.approve', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { content_version: body.content_version ?? null, scan_state: { from: NEEDS_MANUAL_REVIEW, to: 'clean' }, note: body.manual_review_note, via: 'media.approve' } });
      }
      const res = await db.run("UPDATE creatives SET review_state = 'approved', review_note = NULL, state = 'ready' WHERE id = ? AND state NOT IN ('uploading','importing','invalid') AND scan_state = ?", [m.id, manual ? 'clean' : m.scan_state]);
      if (res.changes === 0) throw conflict('Tệp vừa đổi trạng thái.', 'invalid_state');
      const ap = await recordApproval(db, { id: m.id, ...cur }, nowIso);
      if (isStream) await markStreamApproved(db, m.id, u.id, nowIso);
      await auditCtx(c, db, { action: 'media.approve', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { review_state: { from: m.review_state, to: 'approved' }, scan_state: m.scan_state, content_version: ap.version, content_hash: ap.hash, version_bound: body.content_version !== undefined, delivery: isStream ? 'stream' : 'upload', full_view_confirmed: isStream ? true : undefined } });
    });
    await bumpManifest(rt);
    await emailOwner(rt, m.customer_id, `Tệp "${m.name ?? ''}" đã được duyệt`, `<p>Tệp <b>${esc(m.name)}</b> đã được duyệt và có thể dùng cho chiến dịch.</p>`);
    return c.json(present(await loadMedia(c, m.id), external));
  });

  r.post('/:id/reject', requirePerm('media', 'approve'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ reason: z.string().trim().min(3, 'Nhập lý do (tối thiểu 3 ký tự)').max(500) }));
    if (m.state === 'uploading' || m.state === 'importing') throw conflict('Tệp chưa tải xong.', 'invalid_state');
    await rt.db.tx(async (db) => {
      await db.run("UPDATE creatives SET review_state = 'rejected', review_note = ?, state = 'rejected' WHERE id = ?", [b.reason, m.id]);
      await auditCtx(c, db, { action: 'media.reject', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { review_state: { from: m.review_state, to: 'rejected' }, reason: b.reason } });
    });
    await bumpManifest(rt);
    await emailOwner(rt, m.customer_id, `Tệp "${m.name ?? ''}" cần chỉnh sửa`, `<p>Tệp <b>${esc(m.name)}</b> được trả lại.</p><p>Lý do: ${esc(b.reason)}</p>`);
    return c.json(present(await loadMedia(c, m.id), external));
  });

  /**
   * Xoa hang loat (toi da 200 tep/lan). Moi tep di dung quy tac cua DELETE /:id: quyen media:delete (cua tuyen), pham vi khach hang (mediaScope: tep ngoai pham vi
   * bao "khong tim thay", khong lo su ton tai), tep thuoc chien dich da gui duyet/dang chay/da len lich thi BO QUA (khong xoa ngam).
   * Tep xoa duoc: bo hang creatives + creative_thumbnails (cascade) VA xoa khoa tep goc, anh dai dien va ban chuyen ma trong objects. Audit: media.delete tung tep + media.bulk_delete.
   */
  r.post('/bulk-delete', requirePerm('media', 'delete'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(1, 'Chọn ít nhất 1 tệp').max(BULK_DELETE_MAX, `Tối đa ${BULK_DELETE_MAX} tệp mỗi lần`) }));
    const ids = [...new Set(b.ids)];
    const nowIso = rt.clock.now().toISOString();
    const scope = mediaScope(c.get('user'), 'm', nowIso);
    const deleted: { id: string; name: string | null; size_bytes: number }[] = [];
    const skipped: { id: string; name: string | null; code: 'not_found' | 'in_use' | 'busy'; reason: string }[] = [];
    const orphanKeys: string[] = [];
    const rendPrefixes: string[] = [];
    for (const id of ids) {
      const m = (await rt.db.query<MediaRow>(`SELECT ${M_SELECT} ${M_FROM} WHERE m.id = ?${scope ? ` AND (${scope.sql})` : ''}`, [id, ...(scope?.params ?? [])]))[0];
      if (!m) {
        skipped.push({ id, name: null, code: 'not_found', reason: 'Không tìm thấy tệp.' });
        continue;
      }
      if (m.campaign_id) {
        const camp = (await rt.db.query<{ name: string; state: string }>('SELECT name, state FROM campaigns WHERE id = ?', [m.campaign_id]))[0];
        if (camp && !['draft', 'rejected'].includes(camp.state)) {
          skipped.push({ id, name: m.name, code: 'in_use', reason: `Đang dùng trong chiến dịch ${camp.name}` });
          continue;
        }
      }
      const th = (await rt.db.query<{ thumb_key: string }>('SELECT thumb_key FROM creative_thumbnails WHERE creative_id = ?', [m.id]))[0];
      await abortOpenMultipart(rt, m.id, m.storage_key, 'aborted', { actorId: c.get('user').id, ip: c.get('ip'), customerId: m.customer_id, reason: 'tệp bị xóa hàng loạt' });
      const res = await rt.db.tx(async (db) => {
        // dieu kien trang thai chien dich kiem lai ngay trong lenh xoa: chien dich vua duoc gui/chay thi khong xoa (tx tren D1 khong hoan tac => xoa creatives truoc, anh dai dien sau)
        const del = await db.run(
          `DELETE FROM creatives WHERE id = ? AND (campaign_id IS NULL OR campaign_id IN (SELECT id FROM campaigns WHERE state IN ('draft','rejected')) OR NOT EXISTS (SELECT 1 FROM campaigns WHERE id = creatives.campaign_id))`,
          [m.id],
        );
        if (del.changes === 0) return false;
        await db.run('DELETE FROM creative_thumbnails WHERE creative_id = ?', [m.id]);
        await db.run('DELETE FROM creative_transfers WHERE creative_id = ?', [m.id]);
        await db.run('DELETE FROM creative_diag WHERE creative_id = ?', [m.id]);
        await db.run('DELETE FROM creative_stream WHERE creative_id = ?', [m.id]);
        await auditCtx(c, db, { action: 'media.delete', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { name: m.name, size_bytes: m.size_bytes === null ? null : num(m.size_bytes), bulk: true } });
        return true;
      });
      if (!res) {
        skipped.push({ id, name: m.name, code: 'busy', reason: 'Tệp vừa được dùng trong chiến dịch, đã bỏ qua.' });
        continue;
      }
      deleted.push({ id, name: m.name, size_bytes: m.size_bytes === null ? 0 : num(m.size_bytes) });
      if (m.storage_key) orphanKeys.push(m.storage_key);
      if (th) orphanKeys.push(th.thumb_key);
      rendPrefixes.push(`renditions/${m.customer_id}/${m.id}/`);
    }
    // xoa tep that trong kho (sau khi hang CSDL da mat): loi kho khong lam hong ket qua, chi con tep mo coi (khong ai tro toi)
    let objectsDeleted = 0;
    for (const k of orphanKeys) {
      try {
        await rt.objects.delete?.(k);
        objectsDeleted++;
      } catch { /* mo coi: khong anh huong */ }
    }
    for (const pre of rendPrefixes) {
      try {
        for (const o of (await rt.objects.list?.(pre, 200)) ?? []) {
          await rt.objects.delete?.(o.key);
          objectsDeleted++;
        }
      } catch { /* mo coi: khong anh huong */ }
    }
    const freed = deleted.reduce((a, x) => a + x.size_bytes, 0);
    await rt.db.tx(async (db) => {
      await auditCtx(c, db, {
        action: 'media.bulk_delete',
        objectType: 'creative',
        objectId: null,
        diff: { requested: ids.length, deleted_count: deleted.length, skipped_count: skipped.length, freed_bytes: freed, deleted_ids: deleted.map((x) => x.id), skipped: skipped.map((x) => ({ id: x.id, code: x.code })) },
      });
    });
    if (deleted.length) await bumpManifest(rt);
    return c.json({ requested: ids.length, deleted_count: deleted.length, skipped_count: skipped.length, freed_bytes: freed, objects_deleted: objectsDeleted, deleted, skipped });
  });

  r.delete('/:id', requirePerm('media', 'delete'), async (c) => {
    const rt = getRt(c);
    const m = await loadMedia(c, c.req.param('id'));
    if (m.campaign_id) {
      const camp = (await rt.db.query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [m.campaign_id]))[0];
      if (camp && !['draft', 'rejected'].includes(camp.state)) throw conflict('Tệp đang dùng trong chiến dịch đã gửi duyệt/đang chạy, không thể xóa.', 'in_use');
    }
    const th = (await rt.db.query<{ thumb_key: string }>('SELECT thumb_key FROM creative_thumbnails WHERE creative_id = ?', [m.id]))[0];
    await abortOpenMultipart(rt, m.id, m.storage_key, 'aborted', { actorId: c.get('user').id, ip: c.get('ip'), customerId: m.customer_id, reason: 'tệp bị xóa' }); // khong de phan multipart mo coi tren kho
    await rt.db.tx(async (db) => {
      await db.run('DELETE FROM creative_thumbnails WHERE creative_id = ?', [m.id]);
      await db.run('DELETE FROM creative_transfers WHERE creative_id = ?', [m.id]);
      await db.run('DELETE FROM creative_diag WHERE creative_id = ?', [m.id]);
      await db.run('DELETE FROM creative_stream WHERE creative_id = ?', [m.id]);
      await db.run('DELETE FROM creatives WHERE id = ?', [m.id]);
      await auditCtx(c, db, { action: 'media.delete', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { name: m.name } });
    });
    if (th) { try { await rt.objects.delete?.(th.thumb_key); } catch { /* mo coi: khong anh huong */ } }
    await bumpManifest(rt);
    return c.json({ ok: true });
  });

  return r;
}
