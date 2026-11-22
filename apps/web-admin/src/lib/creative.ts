/** Client-side creative size check per screen type (server re-validates). */
export type ScreenType = 'tv' | 'elevator' | 'led';
export interface Dim { width?: number | null; height?: number | null }
export interface CreativeTarget { type: ScreenType; /** required exact px for led / elevator */ px?: { w: number; h: number } | null }

/** Man thang may: moi do phan giai doc 9:16 tu HD (720x1280) den 4K (2160x3840). Khoa = cach goi man (inch hoac bac). */
export const ELEVATOR_SIZES: Record<string, { w: number; h: number }> = {
  hd: { w: 720, h: 1280 }, '18.5': { w: 768, h: 1366 }, '21.5': { w: 1080, h: 1920 }, '23.8': { w: 1080, h: 1920 }, '2k': { w: 1440, h: 2560 }, '4k': { w: 2160, h: 3840 },
};
export const ELEVATOR_SIZE_LABEL: Record<string, string> = { hd: 'HD', '18.5': '18,5"', '21.5': '21,5"', '23.8': '23,8"', '2k': '2K', '4k': '4K' };
export const ELEVATOR_MIN = { w: 720, h: 1280 };
export const ELEVATOR_MAX = { w: 2160, h: 3840 };

export function checkCreative(target: CreativeTarget, m: Dim): { ok: boolean; message: string } {
  const w = m.width ?? 0, h = m.height ?? 0;
  if (!w || !h) return { ok: false, message: 'Chưa đọc được kích thước tệp. Chờ hệ thống xử lý hoặc chọn tệp khác.' };
  const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) / b <= tol;
  if (target.type === 'tv') {
    return near(w / h, 16 / 9) ? { ok: true, message: 'Tệp 16:9, tự co giãn từ HD đến 8K.' } : { ok: false, message: `Màn hình TV cần tỷ lệ 16:9, tệp là ${w}×${h}.` };
  }
  if (target.type === 'elevator') {
    if (!near(w / h, 9 / 16)) return { ok: false, message: `Màn hình thang máy đặt dọc 9:16, tệp là ${w}×${h}. Không dùng lại video ngang 16:9.` };
    if (w < ELEVATOR_MIN.w || h < ELEVATOR_MIN.h || w > ELEVATOR_MAX.w || h > ELEVATOR_MAX.h) return { ok: false, message: `Màn hình thang máy nhận từ HD ${ELEVATOR_MIN.w}×${ELEVATOR_MIN.h} đến 4K ${ELEVATOR_MAX.w}×${ELEVATOR_MAX.h}, tệp là ${w}×${h}.` };
    if (target.px && w > target.px.w * 1.02) return { ok: false, message: `Màn đã chọn (${target.px.w}×${target.px.h}) không nhận tệp lớn hơn độ phân giải của nó; tệp là ${w}×${h}. Hệ thống chỉ gửi bản bằng hoặc thấp hơn gần nhất.` };
    if (target.px && w < target.px.w * 0.98) return { ok: true, message: `Tệp ${w}×${h} thấp hơn màn ${target.px.w}×${target.px.h}: hiển thị vừa khung (giữ tỷ lệ, có thể có viền đen).` };
    return { ok: true, message: 'Tệp đúng tỷ lệ dọc 9:16 (HD–4K).' };
  }
  if (!target.px) return { ok: false, message: 'Chọn bảng LED để biết kích thước yêu cầu.' };
  return w === target.px.w && h === target.px.h ? { ok: true, message: `Đúng ${w}×${h} px.` } : { ok: false, message: `Bảng LED không co giãn tự động: cần đúng ${target.px.w}×${target.px.h} px, tệp là ${w}×${h}.` };
}

export const parsePx = (s?: string | null): { w: number; h: number } | null => {
  const m = String(s ?? '').match(/(\d+)\s*[×x]\s*(\d+)/i);
  return m ? { w: +m[1]!, h: +m[2]! } : null;
};

/** Video 9:16 (sai so 2%) trong khoang HD 720x1280 .. 4K 2160x3840 = video man thang may. */
export function isElevatorDims(w?: number | null, h?: number | null): boolean {
  if (!w || !h) return false;
  const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) / b <= tol;
  return near(w / h, 9 / 16) && w >= 720 * 0.98 && w <= 2160 * 1.02 && h >= 1280 * 0.98 && h <= 3840 * 1.02;
}
/** Tran dung luong VIDEO (MB): thang may (HD-4K) 200 MB; TV/LED 100 MB. Khop videoMaxBytes() cua API. */
export const VIDEO_LIMIT_MB = { elevator: 200, other: 100 } as const;
export const videoLimitMb = (w?: number | null, h?: number | null): number => (isElevatorDims(w, h) ? VIDEO_LIMIT_MB.elevator : VIDEO_LIMIT_MB.other);

/** Allowed link sources for media import (domain check). */
export type LinkSource = 'youtube' | 'drive' | 'dropbox' | 'url';
export function checkMediaUrl(source: LinkSource, raw: string): { ok: boolean; message: string } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, message: 'Liên kết không hợp lệ.' }; }
  if (u.protocol !== 'https:') return { ok: false, message: 'Chỉ chấp nhận liên kết https.' };
  const host = u.hostname.toLowerCase();
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (source === 'youtube' && !(is('youtube.com') || host === 'youtu.be')) return { ok: false, message: 'Liên kết phải thuộc youtube.com hoặc youtu.be.' };
  if (source === 'youtube') return { ok: false, message: 'Chưa hỗ trợ tải từ YouTube. Hãy dùng tệp tải lên hoặc liên kết Google Drive.' };
  if (source === 'drive' && !(host === 'drive.google.com' || host === 'docs.google.com' || host === 'drive.usercontent.google.com')) return { ok: false, message: 'Liên kết phải thuộc drive.google.com.' };
  if (source === 'dropbox' && !(is('dropbox.com') || is('dl.dropboxusercontent.com'))) return { ok: false, message: 'Liên kết phải thuộc dropbox.com.' };
  if (source === 'url' && !/\.(mp4|mov|webm|png|jpe?g)$/i.test(u.pathname)) return { ok: false, message: 'Liên kết trực tiếp phải trỏ tới tệp .mp4, .mov, .webm, .png hoặc .jpg.' };
  if (/^(localhost|127\.|10\.|192\.168\.|0\.)/.test(host) || host.endsWith('.local')) return { ok: false, message: 'Không chấp nhận địa chỉ nội bộ.' };
  return { ok: true, message: source === 'drive' ? 'Tệp Drive phải chia sẻ "Bất kỳ ai có đường liên kết". Hệ thống tải về kho (tối đa 200 MB) rồi kiểm tra như tệp tải lên. Chỉ dùng nội dung bạn có quyền sử dụng.' : 'Hệ thống tải về kho (tối đa 200 MB) rồi kiểm tra như tệp tải lên. Chỉ dùng nội dung bạn có quyền sử dụng.' };
}

/** Kiểm tra sớm liên kết video "dán link" (server kiểm tra lại đầy đủ, gồm SSRF/DNS). Khớp validateStreamUrl của @ams/shared. */
const PAGE_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'facebook.com', 'fb.watch', 'tiktok.com', 'instagram.com', 'twitter.com', 'x.com', 'dailymotion.com', 'twitch.tv', 'drive.google.com', 'docs.google.com'];
export function checkStreamUrl(raw: string): { ok: boolean; message: string } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, message: 'Liên kết không hợp lệ. Hãy dán đầy đủ địa chỉ bắt đầu bằng https://' }; }
  if (u.protocol !== 'https:') return { ok: false, message: 'Chỉ chấp nhận liên kết https:// (không dùng http, ftp, file...).' };
  if (u.username || u.password) return { ok: false, message: 'Liên kết không được chứa tên đăng nhập/mật khẩu (user:pass@).' };
  if (u.port && u.port !== '443') return { ok: false, message: 'Chỉ chấp nhận cổng 443 (cổng mặc định của https).' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || /^[\d.]+$/.test(host) || !host.includes('.')) return { ok: false, message: 'Không chấp nhận địa chỉ IP hoặc tên máy nội bộ. Hãy dùng tên miền công khai.' };
  if (PAGE_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return { ok: false, message: 'Đây là trang xem video (YouTube/Vimeo/Facebook/Drive...), TV không phát trực tiếp được. Hãy dán liên kết tệp .mp4/.webm hoặc luồng .m3u8/.mpd.' };
  if (!/\.(mp4|m4v|webm|m3u8|mpd)$/i.test(u.pathname)) return { ok: true, message: 'Liên kết không có đuôi .mp4/.webm/.m3u8/.mpd: hệ thống sẽ nhận diện theo loại nội dung máy chủ trả về.' };
  return { ok: true, message: 'Liên kết hợp lệ. Hệ thống chỉ kiểm tra đầu liên kết (không tải video).' };
}
