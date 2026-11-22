// Creative "dan link" (stream): bang phu creative_stream (migration 0023). Logic DB dung chung cho route (media.ts, media-scan-review.ts), job kiem tra lai va manifest.
// Nguyen tac: may chu KHONG tai video; moi noi dung xa deu o 'needs_manual_review' (remote_stream_unscanned) cho toi khi nguoi co quyen XEM THAT roi xac nhan.
import type { Db, Runtime } from '@ams/runtime';
import type { StreamKind } from '@ams/shared';
import { writeAudit } from './audit.js';
import { bumpContentVersion } from './creative-security.js';
import { conflict, unprocessable } from './errors.js';
import { bumpManifest } from './manifest.js';
import { ProbeError, probeStreamUrl, streamBinding, warningText, type ProbeDeps, type StreamProbe } from './stream-probe.js';

export const REASON_UNSCANNED = 'remote_stream_unscanned';
export const RECHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Loi mang/5xx can that bai lien tiep >= so nay moi gan co (tranh bat nguoi duyet vi mot lan chap chon); 4xx/doi noi dung gan co ngay. */
export const TRANSIENT_FAILS_TO_FLAG = 2;

export interface StreamRow {
  creative_id: string;
  stream_url: string;
  stream_kind: StreamKind;
  declared_duration_s: number;
  content_type: string | null;
  content_length: number | null;
  etag: string | null;
  last_modified: string | null;
  body_hash: string | null;
  binding: string;
  probe_status: 'ok' | 'changed' | 'unreachable' | 'http_error';
  probe_detail: string | null;
  fail_count: number;
  needs_review: number;
  checked_at: string;
  full_view_by: string | null;
  full_view_at: string | null;
  approved_binding: string | null;
  approved_at: string | null;
}

export async function loadStream(db: Db, id: string): Promise<StreamRow | null> {
  const r = (await db.query<StreamRow>('SELECT * FROM creative_stream WHERE creative_id = ?', [id]))[0];
  return r ? { ...r, content_length: r.content_length === null ? null : Number(r.content_length), declared_duration_s: Number(r.declared_duration_s), fail_count: Number(r.fail_count), needs_review: Number(r.needs_review) } : null;
}

export interface ProbeDetail {
  info?: StreamProbe['info'];
  warnings: string[];
  final_host?: string;
  redirects?: number;
  reason?: string;
  http_status?: number | null;
}
export const detailOf = (p: StreamProbe): ProbeDetail => ({ info: p.info, warnings: p.warnings, final_host: p.final_host, redirects: p.redirects, http_status: p.http_status });
export function parseDetail(raw: string | null | undefined): ProbeDetail {
  try {
    const d = JSON.parse(raw ?? '{}') as Partial<ProbeDetail>;
    return { ...d, warnings: Array.isArray(d.warnings) ? d.warnings.filter((x): x is string => typeof x === 'string') : [] };
  } catch {
    return { warnings: [] };
  }
}

/** Thong tin gui ra UI (list/detail/queue). */
export type StreamView = Pick<StreamRow, 'stream_url' | 'stream_kind' | 'declared_duration_s' | 'probe_status' | 'needs_review' | 'content_type' | 'content_length' | 'etag' | 'last_modified' | 'checked_at' | 'probe_detail' | 'full_view_at' | 'approved_at'>;
export function presentStream(s: StreamView | null): Record<string, unknown> | null {
  if (!s) return null;
  const d = parseDetail(s.probe_detail);
  let host = '';
  try { host = new URL(s.stream_url).hostname; } catch { /* url hong: de trong */ }
  return {
    delivery: 'stream',
    stream_url: s.stream_url,
    stream_host: host,
    stream_kind: s.stream_kind,
    declared_duration_s: s.declared_duration_s,
    probe_status: s.probe_status,
    needs_review: s.needs_review === 1,
    content_type: s.content_type,
    content_length: s.content_length,
    etag: s.etag,
    last_modified: s.last_modified,
    checked_at: s.checked_at,
    info: d.info ?? null,
    warnings: d.warnings.map((w) => ({ code: w.split(':')[0], message: warningText(w) })),
    reason: d.reason ?? null,
    full_view_at: s.full_view_at,
    approved_at: s.approved_at,
  };
}

export const probeErrorBody = (e: ProbeError): { code: string; message: string } => ({ code: e.code, message: e.message });

/** Ghi lai ket qua kiem tra o thoi diem tao / nguoi dung bam "Kiem tra lai": chap nhan binding MOI (nguoi duyet se thay noi dung moi). */
export async function adoptProbe(db: Db, id: string, url: string, p: StreamProbe, nowIso: string): Promise<string> {
  const binding = await streamBinding(url, p);
  await db.run(
    `UPDATE creative_stream SET content_type = ?, content_length = ?, etag = ?, last_modified = ?, body_hash = ?, binding = ?, probe_status = 'ok', probe_detail = ?, fail_count = 0, checked_at = ?, full_view_by = NULL, full_view_at = NULL WHERE creative_id = ?`,
    [p.content_type, p.content_length, p.etag, p.last_modified, p.body_hash, binding, JSON.stringify(detailOf(p)), nowIso, id],
  );
  return binding;
}

/** Dua creative ve "cho kiem tra thu cong" + loai khoi manifest + huy hieu luc duyet (tang content_version). Idempotent. */
async function flagForReview(rt: Runtime, id: string, status: StreamRow['probe_status'], reason: string, detail: ProbeDetail, failCount: number, nowIso: string, extra?: Record<string, unknown>): Promise<void> {
  await rt.db.tx(async (db) => {
    const cur = (await db.query<{ customer_id: string; review_state: string; scan_state: string }>('SELECT customer_id, review_state, scan_state FROM creatives WHERE id = ?', [id]))[0];
    if (!cur) return;
    await db.run('UPDATE creative_stream SET probe_status = ?, needs_review = 1, probe_detail = ?, fail_count = ?, checked_at = ?, full_view_by = NULL, full_view_at = NULL WHERE creative_id = ?', [status, JSON.stringify({ ...detail, reason }), failCount, nowIso, id]);
    if (cur.review_state === 'approved' || cur.scan_state === 'clean') {
      await db.run("UPDATE creatives SET scan_state = 'needs_manual_review', review_state = CASE WHEN review_state = 'approved' THEN 'pending' ELSE review_state END, state = CASE WHEN state = 'ready' THEN 'pending_review' ELSE state END WHERE id = ?", [id]);
    }
    await bumpContentVersion(db, id, nowIso);
    await db.run(
      `INSERT INTO creative_validation (creative_id, engine, verdict, detail, sha256, checked_at) VALUES (?,?,?,?,NULL,?)
       ON CONFLICT (creative_id) DO UPDATE SET engine = excluded.engine, verdict = excluded.verdict, detail = excluded.detail, checked_at = excluded.checked_at`,
      [id, 'remote_stream', 'needs_manual_review', JSON.stringify({ reasons: [reason, REASON_UNSCANNED] }), nowIso],
    );
    await writeAudit(db, { rt, ip: 'job', actorId: null }, { action: 'media.stream_flagged', objectType: 'creative', objectId: id, customerId: cur.customer_id, diff: { status, reason, ...extra } });
  });
  await bumpManifest(rt);
}

export type RecheckOutcome = 'unchanged' | 'flagged' | 'pending_retry' | 'skipped';

/** Kiem tra lai MOT creative stream (job moi gio). Chi so sanh voi binding da luu; khong tu "chap nhan" noi dung moi. */
export async function recheckStream(rt: Runtime, id: string, deps?: ProbeDeps): Promise<RecheckOutcome> {
  const s = await loadStream(rt.db, id);
  if (!s) return 'skipped';
  const nowIso = rt.clock.now().toISOString();
  let p: StreamProbe;
  try {
    p = await probeStreamUrl(s.stream_url, { kind: s.stream_kind, ...(deps ? { deps } : {}) });
  } catch (e) {
    if (!(e instanceof ProbeError)) throw e;
    if (e.status === 'invalid') {
      await flagForReview(rt, id, 'changed', e.code, { warnings: [] }, s.fail_count, nowIso, { message: e.message });
      return 'flagged';
    }
    return failed(rt, s, e.status === 'http_error' ? 'http_error' : 'unreachable', e.code, e.httpStatus, nowIso);
  }
  if (p.status !== 'ok') return failed(rt, s, p.status, `http_${p.http_status ?? 0}`, p.http_status, nowIso);
  const binding = await streamBinding(s.stream_url, p);
  if (binding !== s.binding) {
    const what: string[] = [];
    if ((p.etag ?? null) !== s.etag) what.push('etag');
    if ((p.content_length ?? null) !== s.content_length) what.push('content_length');
    if ((p.last_modified ?? null) !== s.last_modified) what.push('last_modified');
    if (!what.length) what.push('content');
    await flagForReview(rt, id, 'changed', 'remote_stream_changed', detailOf(p), 0, nowIso, { changed: what, etag: { from: s.etag, to: p.etag }, content_length: { from: s.content_length, to: p.content_length } });
    return 'flagged';
  }
  await rt.db.run('UPDATE creative_stream SET checked_at = ?, fail_count = 0, probe_detail = CASE WHEN needs_review = 1 THEN probe_detail ELSE ? END WHERE creative_id = ?', [nowIso, JSON.stringify(detailOf(p)), id]);
  return 'unchanged';
}

async function failed(rt: Runtime, s: StreamRow, status: 'unreachable' | 'http_error', reason: string, http: number | null, nowIso: string): Promise<RecheckOutcome> {
  const fails = s.fail_count + 1;
  const hard = http !== null && http >= 400 && http < 500; // 403/404/410: tep bi go/doi quyen => gan co ngay
  if (hard || fails >= TRANSIENT_FAILS_TO_FLAG) {
    await flagForReview(rt, s.creative_id, status, reason, { warnings: [] }, fails, nowIso, { http_status: http });
    return 'flagged';
  }
  await rt.db.run('UPDATE creative_stream SET fail_count = ?, checked_at = ? WHERE creative_id = ?', [fails, nowIso, s.creative_id]);
  return 'pending_retry';
}

/**
 * Job (cron 10 phut / vong lap Node): moi creative stream dang dung (da duyet, hoac dang gan chien dich) toi da 1 lan/gio, `limit` creative moi luot.
 * Creative da bi gan co (needs_review = 1) khong kiem tra lai dinh ky (cho nguoi duyet bam "Kiem tra lai").
 */
export async function streamRecheckTick(rt: Runtime, opts: { limit?: number; deps?: ProbeDeps } = {}): Promise<{ checked: number; flagged: number }> {
  const cutoff = new Date(rt.clock.now().getTime() - RECHECK_INTERVAL_MS).toISOString();
  const rows = await rt.db.query<{ creative_id: string }>(
    `SELECT s.creative_id FROM creative_stream s JOIN creatives c ON c.id = s.creative_id
      WHERE s.needs_review = 0 AND s.checked_at <= ? AND (c.review_state = 'approved' OR c.campaign_id IS NOT NULL)
      ORDER BY s.checked_at, s.creative_id LIMIT ?`,
    [cutoff, opts.limit ?? 20],
  );
  let flagged = 0;
  for (const r of rows) {
    try {
      if ((await recheckStream(rt, r.creative_id, opts.deps)) === 'flagged') flagged++;
    } catch (e) {
      console.error('[video-link] kiem tra lai loi:', (e as Error).name);
    }
  }
  return { checked: rows.length, flagged };
}

/**
 * Cua duyet cho creative stream: nguoi duyet PHAI xac nhan da xem toan bo noi dung, va noi dung xa phai con dung nhu luc ho xem.
 * Tra true neu la creative stream. Goi TRUOC giao dich duyet (co truy cap mang, qua cac chot SSRF).
 */
export async function assertStreamApprovable(rt: Runtime, id: string, confirmFullView: boolean | undefined, deps?: ProbeDeps): Promise<boolean> {
  const s = await loadStream(rt.db, id);
  if (!s) return false;
  if (confirmFullView !== true) throw unprocessable('Hãy mở xem trước và xem toàn bộ video, rồi xác nhận "Tôi đã xem toàn bộ nội dung" trước khi duyệt (nội dung từ liên kết không được quét mã độc).', 'confirm_full_view_required');
  const nowIso = rt.clock.now().toISOString();
  let p: StreamProbe;
  try {
    p = await probeStreamUrl(s.stream_url, { kind: s.stream_kind, ...(deps ? { deps } : {}) });
  } catch (e) {
    if (e instanceof ProbeError) throw unprocessable(`Liên kết video không còn truy cập được: ${e.message}`, 'stream_unreachable');
    throw e;
  }
  if (p.status !== 'ok') throw unprocessable(`Liên kết video không còn truy cập được (HTTP ${p.http_status ?? '?'}).`, 'stream_unreachable');
  const binding = await streamBinding(s.stream_url, p);
  if (binding !== s.binding) {
    await rt.db.tx(async (db) => {
      await adoptProbe(db, id, s.stream_url, p, nowIso);
      await db.run('UPDATE creative_stream SET needs_review = 1 WHERE creative_id = ?', [id]);
      await bumpContentVersion(db, id, nowIso);
    });
    await bumpManifest(rt);
    throw conflict('Video ở liên kết đã thay đổi kể từ lần kiểm tra trước (ETag/độ dài/ngày sửa). Hãy tải lại, xem lại nội dung mới rồi duyệt.', 'content_changed');
  }
  return true;
}

/** Sau khi duyet thanh cong (trong giao dich): xoa co, ghi nguoi xac nhan + binding da duyet. */
export async function markStreamApproved(db: Db, id: string, userId: string | null, nowIso: string): Promise<void> {
  await db.run(
    "UPDATE creative_stream SET needs_review = 0, probe_status = 'ok', fail_count = 0, full_view_by = ?, full_view_at = ?, approved_binding = binding, approved_at = ? WHERE creative_id = ?",
    [userId, nowIso, nowIso, id],
  );
}
