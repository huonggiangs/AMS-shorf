// Tu duyet cho nguoi noi bo CO QUYEN media:approve (vd Super admin) khi chinh ho tai tep len.
// Khong hard-code vai tro: dung dung ham phan quyen `can()` (packages/config) voi perms + vai tro hien tai cua nguoi tai len.
// Khach/doi tac khong bao gio vao day. Tep 'infected'/'failed'/'pending'/chua quet khong tu duyet.
// Goi o hai cho: cuoi POST /media/:id/confirm (duong Cloudflare dong bo) va sweepAutoApprove() (sau khi media-worker/validator quet xong).
import type { Runtime } from '@ams/runtime';
import { can } from '@ams/config';
import { loadPerms } from '../auth/session.js';
import { writeAudit } from './audit.js';
import { bumpManifest } from './manifest.js';
import { assertLockPolicy, recordApproval } from './creative-security.js';

export const AUTO_APPROVE_ENGINE = 'auto-privileged';
export const AUTO_APPROVE_SETTING = 'auto_approve_privileged_uploads';
export const AUTO_APPROVE_REASON = 'tải lên bởi người có quyền duyệt';
const AUTO_SCAN_STATES = ['clean', 'needs_manual_review'];
/** Ly do cua validator cho thay tep vi pham spec (khong tu duyet du la nguoi co quyen). */
const SPEC_FAIL = /^(unsupported_codec|video_resolution_too_high|duration_out_of_range|file_too_large|dimensions_out_of_range|dimensions_mismatch|duration_mismatch|mp4_zero_duration)/;

interface Row {
  id: string; customer_id: string; name: string | null; uploaded_by: string | null; uploader_kind: string | null; source: string;
  scan_state: string; review_state: string; state: string; sha256: string | null; storage_key: string | null; size_bytes: unknown;
  source_url: string | null; format: string | null; overlay: string | null; detail: string | null;
}

async function uploaderMayApprove(rt: Runtime, row: Row): Promise<boolean> {
  if (row.uploader_kind !== 'internal' || !row.uploaded_by) return false;
  const a = (await rt.db.query<{ role: string; status: string; account_kind: string; expires_at: string | null }>(
    'SELECT role, status, account_kind, expires_at FROM admins WHERE id = ?', [row.uploaded_by]))[0];
  if (!a || a.status !== 'active' || a.account_kind !== 'internal') return false;
  if (a.expires_at && a.expires_at <= rt.clock.now().toISOString()) return false;
  return can(await loadPerms(rt, row.uploaded_by), a.role, 'media', 'approve');
}

/** Cong tac: settings.auto_approve_privileged_uploads = '0'|'false' tat tinh nang (mac dinh bat). */
export async function autoApproveEnabled(rt: Runtime): Promise<boolean> {
  const v = (await rt.db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [AUTO_APPROVE_SETTING]))[0]?.value;
  return !(v === '0' || v?.toLowerCase() === 'false');
}

/** Tra true neu da tu duyet. Khong nem loi (an toan khi goi sau confirm/cron). */
export async function autoApprovePrivileged(rt: Runtime, creativeId: string, ip = 'system'): Promise<boolean> {
  try {
    if (!(await autoApproveEnabled(rt))) return false;
    const row = (await rt.db.query<Row>(
      `SELECT m.id, m.customer_id, m.name, m.uploaded_by, m.uploader_kind, m.source, m.scan_state, m.review_state, m.state, m.sha256, m.storage_key, m.size_bytes, m.source_url, m.format, m.overlay, cv.detail
         FROM creatives m LEFT JOIN creative_validation cv ON cv.creative_id = m.id WHERE m.id = ?`, [creativeId]))[0];
    if (!row || row.source !== 'upload' || row.state !== 'pending_review' || row.review_state !== 'pending') return false;
    if (!AUTO_SCAN_STATES.includes(row.scan_state)) return false; // infected/failed/pending/unscanned: khong tu duyet
    if (!(await uploaderMayApprove(rt, row))) return false;
    let reasons: string[] = [];
    try {
      const r = (JSON.parse(row.detail ?? '{}') as { reasons?: unknown }).reasons;
      if (Array.isArray(r)) reasons = r.filter((x): x is string => typeof x === 'string');
    } catch { /* detail khong phai JSON */ }
    if (reasons.some((x) => SPEC_FAIL.test(x))) return false;
    try { await assertLockPolicy(rt.db, row.overlay, { creative_id: row.id }); } catch { return false; }

    const nowIso = rt.clock.now().toISOString();
    const wasManual = row.scan_state === 'needs_manual_review';
    const done = await rt.db.tx(async (db) => {
      const res = await db.run(
        "UPDATE creatives SET review_state = 'approved', review_note = NULL, state = 'ready', scan_state = 'clean' WHERE id = ? AND state = 'pending_review' AND review_state = 'pending' AND scan_state = ?",
        [row.id, row.scan_state],
      );
      if (res.changes === 0) return false;
      if (wasManual) {
        await db.run(
          `INSERT INTO creative_validation (creative_id, engine, verdict, detail, sha256, checked_at) VALUES (?,?,?,?,NULL,?)
           ON CONFLICT (creative_id) DO UPDATE SET engine = excluded.engine, verdict = excluded.verdict, detail = excluded.detail, checked_at = excluded.checked_at`,
          [row.id, AUTO_APPROVE_ENGINE, 'clean', JSON.stringify({ by: row.uploaded_by, note: AUTO_APPROVE_REASON, previous: row.detail }), nowIso],
        );
      }
      const ap = await recordApproval(db, row, nowIso);
      const ctx = { rt, ip, actorId: row.uploaded_by };
      await writeAudit(db, ctx, { action: 'media.auto_approve', objectType: 'creative', objectId: row.id, customerId: row.customer_id, diff: { reason: AUTO_APPROVE_REASON, scan_state: { from: row.scan_state, to: 'clean' }, engine: wasManual ? AUTO_APPROVE_ENGINE : undefined, content_version: ap.version, content_hash: ap.hash } });
      return true;
    });
    if (done) await bumpManifest(rt);
    return done;
  } catch (e) {
    console.error('[media] tu duyet loi:', (e as Error).name);
    return false;
  }
}

/** Cron/worker: tep noi bo dang cho duyet da qua quet (media-worker VPS ghi scan_state sau khi confirm) -> tu duyet. */
export async function sweepAutoApprove(rt: Runtime, limit = 20): Promise<number> {
  const rows = await rt.db.query<{ id: string }>(
    "SELECT id FROM creatives WHERE uploader_kind = 'internal' AND source = 'upload' AND state = 'pending_review' AND review_state = 'pending' AND scan_state IN ('clean','needs_manual_review') ORDER BY created_at LIMIT ?",
    [limit],
  );
  let n = 0;
  for (const r of rows) if (await autoApprovePrivileged(rt, r.id)) n++;
  return n;
}
