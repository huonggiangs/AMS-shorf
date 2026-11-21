// Cong kiem tra scan_state truoc khi duyet/phat. He thong KHONG con quet virus (anh/video chuan khong chua ma thuc thi; kiem tra cau truc + chuyen ma lam sach tep).
//  - 'clean'                 : duoc duyet / duoc phat (qua kiem tra cau truc).
//  - 'unscanned' | 'skipped' : du lieu cu (truoc khi bo quet virus / demo): coi nhu hop le.
//  - 'needs_manual_review'   : kiem tra cau truc phat hien bat thuong; chan cho toi khi nguoi co quyen duyet tay (media-scan-review.ts).
//  - 'pending'               : dang cho kiem tra cau truc (hoac tep lien ket chua tai ve) -> chan.
//  - 'infected' | 'failed'   : du lieu cu / bi tu choi: chan.
import type { Runtime } from '@ams/runtime';
import { conflict, unprocessable } from '../lib/errors.js';

export const ALLOW_UNSCANNED_KEY = 'allow_unscanned_creatives';
export const UNSCANNED_STATES = ['unscanned', 'skipped'] as const;

export async function allowUnscannedCreatives(rt: Pick<Runtime, 'db'>): Promise<boolean> {
  const v = (await rt.db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [ALLOW_UNSCANNED_KEY]))[0]?.value;
  return v === '1' || v?.toLowerCase() === 'true';
}

export interface ScanVerdict {
  ok: boolean;
  code?: string;
  message?: string;
}

export function scanVerdict(c: { scan_state: string; source?: string | null }, _allowUnscanned = true): ScanVerdict {
  const s = c.scan_state;
  if (s === 'clean') return { ok: true };
  if ((UNSCANNED_STATES as readonly string[]).includes(s)) return { ok: true };
  if (s === 'needs_manual_review') return { ok: false, code: 'creative_needs_manual_review', message: 'Tệp chưa qua kiểm tra tự động (định dạng ngoài danh sách an toàn hoặc có điểm bất thường) nên cần người có quyền kiểm tra thủ công trước khi duyệt.' };
  if (s === 'infected') return { ok: false, code: 'creative_infected', message: 'Tệp bị từ chối trước đó, không thể duyệt.' };
  if (s === 'failed') return { ok: false, code: 'creative_scan_failed', message: 'Kiểm tra tệp thất bại, không thể duyệt. Hãy tải lại tệp.' };
  if (c.source && c.source !== 'upload') return { ok: false, code: 'creative_link_not_ingested', message: 'Tệp lấy từ liên kết chưa được tải về và kiểm tra nên chưa thể duyệt.' };
  return { ok: false, code: 'creative_scan_pending', message: 'Tệp đang chờ kiểm tra định dạng. Vui lòng thử lại sau ít phút.' };
}

/** Nem 409 (dang quet) / 422 (nhiem, loi, chua quet) neu creative chua du dieu kien duyet. */
export function assertScanOk(c: { scan_state: string; source?: string | null }, allowUnscanned: boolean | undefined, details?: unknown): void {
  const v = scanVerdict(c, allowUnscanned ?? true);
  if (v.ok) return;
  if (v.code === 'creative_scan_pending') throw conflict(v.message!, v.code, details);
  throw unprocessable(v.message!, v.code!, details);
}
