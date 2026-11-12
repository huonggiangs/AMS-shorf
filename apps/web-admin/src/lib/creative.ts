/** Client-side creative size check per screen type (server re-validates). */
export type ScreenType = 'tv' | 'elevator' | 'led';
export interface Dim { width?: number | null; height?: number | null }
export interface CreativeTarget { type: ScreenType; /** required exact px for led / elevator */ px?: { w: number; h: number } | null }

export const ELEVATOR_SIZES: Record<string, { w: number; h: number }> = {
  '18.5': { w: 768, h: 1366 }, '21.5': { w: 1080, h: 1920 }, '23.8': { w: 1080, h: 1920 },
};

export function checkCreative(target: CreativeTarget, m: Dim): { ok: boolean; message: string } {
  const w = m.width ?? 0, h = m.height ?? 0;
  if (!w || !h) return { ok: false, message: 'Chưa đọc được kích thước tệp. Chờ hệ thống xử lý hoặc chọn tệp khác.' };
  const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) / b <= tol;
  if (target.type === 'tv') {
    return near(w / h, 16 / 9) ? { ok: true, message: 'Tệp 16:9, tự co giãn từ HD đến 8K.' } : { ok: false, message: `Màn hình TV cần tỷ lệ 16:9, tệp là ${w}×${h}.` };
  }
  if (target.type === 'elevator') {
    if (!near(w / h, 9 / 16)) return { ok: false, message: `Màn hình thang máy đặt dọc 9:16, tệp là ${w}×${h}. Không dùng lại video ngang 16:9.` };
    if (target.px && (w !== target.px.w || h !== target.px.h)) return { ok: false, message: `Cần đúng ${target.px.w}×${target.px.h} px, tệp là ${w}×${h}.` };
    return { ok: true, message: 'Tệp đúng tỷ lệ dọc 9:16.' };
  }
  if (!target.px) return { ok: false, message: 'Chọn bảng LED để biết kích thước yêu cầu.' };
  return w === target.px.w && h === target.px.h ? { ok: true, message: `Đúng ${w}×${h} px.` } : { ok: false, message: `Bảng LED không co giãn tự động: cần đúng ${target.px.w}×${target.px.h} px, tệp là ${w}×${h}.` };
}

export const parsePx = (s?: string | null): { w: number; h: number } | null => {
  const m = String(s ?? '').match(/(\d+)\s*[×x]\s*(\d+)/i);
  return m ? { w: +m[1]!, h: +m[2]! } : null;
};

/** Allowed link sources for media import (domain check). */
export type LinkSource = 'youtube' | 'drive' | 'dropbox' | 'url';
export function checkMediaUrl(source: LinkSource, raw: string): { ok: boolean; message: string } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, message: 'Liên kết không hợp lệ.' }; }
  if (u.protocol !== 'https:') return { ok: false, message: 'Chỉ chấp nhận liên kết https.' };
  const host = u.hostname.toLowerCase();
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (source === 'youtube' && !(is('youtube.com') || host === 'youtu.be')) return { ok: false, message: 'Liên kết phải thuộc youtube.com hoặc youtu.be.' };
  if (source === 'drive' && !(host === 'drive.google.com' || host === 'docs.google.com')) return { ok: false, message: 'Liên kết phải thuộc drive.google.com.' };
  if (source === 'dropbox' && !(is('dropbox.com') || is('dl.dropboxusercontent.com'))) return { ok: false, message: 'Liên kết phải thuộc dropbox.com.' };
  if (source === 'url' && !/\.(mp4|mov|webm|png|jpe?g)$/i.test(u.pathname)) return { ok: false, message: 'Liên kết trực tiếp phải trỏ tới tệp .mp4, .mov, .webm, .png hoặc .jpg.' };
  if (/^(localhost|127\.|10\.|192\.168\.|0\.)/.test(host) || host.endsWith('.local')) return { ok: false, message: 'Không chấp nhận địa chỉ nội bộ.' };
  return { ok: true, message: 'Hệ thống sẽ tải về và chuyển mã trước khi phát. Chỉ dùng nội dung bạn có quyền sử dụng.' };
}
