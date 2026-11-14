// Chinh sach quet ma doc cho creative (m1-media-worker dat scan_state; API quyet dinh cho duyet).
//  - 'clean'                 : duoc duyet / duoc phat.
//  - 'unscanned' | 'skipped' : chua quet duoc (ClamAV tat/loi; 'skipped' la du lieu demo). CHI duoc duyet khi setting
//                              `allow_unscanned_creatives` = '1'|'true' (mac dinh: tat). Nguoi duyet thay canh bao o `scan_warning`.
//  - 'needs_manual_review'   : (Cloudflare) kiem tra tu dong khong du de danh dau 'clean'; chan cho toi khi admin duyet tay (media-scan-review.ts).
//  - 'pending'               : dang cho quet (hoac tep lien ket chua tai ve) -> chan.
//  - 'infected' | 'failed'   : chan.
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

export function scanVerdict(c: { scan_state: string; source?: string | null }, allowUnscanned: boolean): ScanVerdict {
  const s = c.scan_state;
  if (s === 'clean') return { ok: true };
  if ((UNSCANNED_STATES as readonly string[]).includes(s)) {
    return allowUnscanned
      ? { ok: true }
      : { ok: false, code: 'creative_not_scanned', message: 'Tệp chưa được quét mã độc (dịch vụ quét không khả dụng) nên chưa thể duyệt. Thử lại sau hoặc bật tùy chọn cho phép tệp chưa quét.' };
  }
  if (s === 'needs_manual_review') return { ok: false, code: 'creative_needs_manual_review', message: 'Tệp chưa qua kiểm tra tự động (định dạng ngoài danh sách an toàn hoặc có điểm bất thường) nên cần người có quyền kiểm tra thủ công trước khi duyệt.' };
  if (s === 'infected') return { ok: false, code: 'creative_infected', message: 'Tệp bị phát hiện mã độc, không thể duyệt.' };
  if (s === 'failed') return { ok: false, code: 'creative_scan_failed', message: 'Quét tệp thất bại, không thể duyệt. Hãy tải lại tệp.' };
  if (c.source && c.source !== 'upload') return { ok: false, code: 'creative_link_not_ingested', message: 'Tệp lấy từ liên kết chưa được tải về và quét mã độc nên chưa thể duyệt.' };
  return { ok: false, code: 'creative_scan_pending', message: 'Tệp đang chờ quét mã độc. Vui lòng thử lại sau ít phút.' };
}

/** Nem 409 (dang quet) / 422 (nhiem, loi, chua quet) neu creative chua du dieu kien duyet. */
export function assertScanOk(c: { scan_state: string; source?: string | null }, allowUnscanned: boolean, details?: unknown): void {
  const v = scanVerdict(c, allowUnscanned);
  if (v.ok) return;
  if (v.code === 'creative_scan_pending') throw conflict(v.message!, v.code, details);
  throw unprocessable(v.message!, v.code!, details);
}
