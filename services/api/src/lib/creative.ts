// Quy tac kich thuoc creative theo loai man hinh (DAC-TA muc 6). May chu kiem lai du client da kiem.
export type TargetType = 'tv' | 'elevator' | 'led_p5';

export const ELEVATOR_PX = [
  { w: 768, h: 1366 }, // 18,5"
  { w: 1080, h: 1920 }, // 21,5" va 23,8"
];
/** Mo-dun LED P5 tieu chuan: chieu mm / 5. 1,28x0,64 | 2,56x1,28 | 3,84x1,92 | 0,96x1,92 (doc) */
export const LED_MODULE_PX = [
  { w: 256, h: 128 },
  { w: 512, h: 256 },
  { w: 768, h: 384 },
  { w: 192, h: 384 },
];

export const MB = 1024 * 1024;
export const GB = 1024 * MB;
/** Gioi han dung luong tep toi da theo loai man hinh (MB). */
export const SIZE_LIMIT_MB: Record<TargetType, number> = { tv: 500, elevator: 30, led_p5: 50 };
/** Thoi luong cho phep (giay), neu biet. */
export const DURATION_RANGE: Partial<Record<TargetType, [number, number]>> = { tv: [5, 60], elevator: [10, 30], led_p5: [5, 15] };

/**
 * Quy tac VIDEO quang cao (Cloudflare khong co ffmpeg => khong chuyen ma duoc; TV phai phat truc tiep tep tai len):
 * H.264 (avc1/avc3) + AAC, canh dai <= 1920 va canh ngan <= 1080 (Full HD), toi da 100 MB/tep.
 * AV1/H.265/VP9 4K khong phat duoc tren da so TV box => tu choi som voi thong bao ro.
 */
export const VIDEO_RULES = { maxBytes: 100 * MB, maxLongSide: 1920, maxShortSide: 1080, codecs: ['avc1', 'avc3'] as readonly string[] };
const CODEC_NAME: Record<string, string> = { av01: 'AV1', hvc1: 'H.265/HEVC', hev1: 'H.265/HEVC', vp09: 'VP9', vp08: 'VP8', mp4v: 'MPEG-4 Part 2', avc1: 'H.264', avc3: 'H.264' };
export const codecLabel = (fcc: string): string => CODEC_NAME[fcc] ?? fcc.trim();
/** Tra thong bao loi tieng Viet neu video khong dat quy tac; null neu dat. */
export function videoSpecProblem(p: { w?: number | null; h?: number | null; codec?: string | null }): { code: string; message: string } | null {
  if (p.codec && !VIDEO_RULES.codecs.includes(p.codec)) {
    return { code: 'unsupported_codec', message: `Video dùng codec ${codecLabel(p.codec)} mà TV không phát được ổn định. Hãy xuất lại video H.264 (AVC) + AAC, tối đa 1920×1080, rồi tải lên.` };
  }
  if (p.w && p.h && (Math.max(p.w, p.h) > VIDEO_RULES.maxLongSide || Math.min(p.w, p.h) > VIDEO_RULES.maxShortSide)) {
    return { code: 'video_resolution_too_high', message: `Video ${p.w}×${p.h} vượt độ phân giải tối đa ${VIDEO_RULES.maxLongSide}×${VIDEO_RULES.maxShortSide} (Full HD). Hãy xuất lại ở 1080p (H.264) rồi tải lên.` };
  }
  return null;
}

export const ALLOWED_MIME = ['video/mp4', 'video/quicktime', 'video/webm', 'image/png', 'image/jpeg'] as const;
export const isVideoMime = (m: string) => m.startsWith('video/');

const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) / b <= tol;

export interface Px {
  w: number;
  h: number;
}
export interface FitResult {
  ok: boolean;
  message: string;
}

export const apiTarget = (t: string | null | undefined): 'tv' | 'elevator' | 'led' | null => (t === 'led_p5' || t === 'led' ? 'led' : t === 'elevator' ? 'elevator' : t === 'tv' ? 'tv' : null);
export const dbTarget = (t: string): TargetType => (t === 'led' || t === 'led_p5' ? 'led_p5' : t === 'elevator' ? 'elevator' : 'tv');

/** `ledPx`: do phan giai bang LED da cau hinh (neu chon dung mot bang). */
export function fitsTarget(target: TargetType, w: number, h: number, opts: { ledPx?: Px | null; knownLed?: Px[] } = {}): FitResult {
  if (!w || !h) return { ok: false, message: 'Chưa đọc được kích thước tệp.' };
  if (target === 'tv') {
    if (!near(w / h, 16 / 9)) return { ok: false, message: `Màn hình TV cần tỷ lệ 16:9, tệp là ${w}×${h}.` };
    if (w < 1280 || w > 7680) return { ok: false, message: `TV hỗ trợ từ HD 1280 px đến 8K 7680 px chiều ngang, tệp là ${w}×${h}.` };
    return { ok: true, message: 'Tệp 16:9, tự co giãn từ HD đến 8K.' };
  }
  if (target === 'elevator') {
    if (!ELEVATOR_PX.some((p) => p.w === w && p.h === h)) {
      return { ok: false, message: `Màn hình thang máy cần đúng 768×1366 (18,5") hoặc 1080×1920 (21,5"/23,8"), dọc 9:16; tệp là ${w}×${h}.` };
    }
    return { ok: true, message: 'Tệp đúng độ phân giải dọc.' };
  }
  const want = opts.ledPx ?? null;
  if (want) {
    return w === want.w && h === want.h ? { ok: true, message: `Đúng ${w}×${h} px.` } : { ok: false, message: `Bảng LED không co giãn tự động: cần đúng ${want.w}×${want.h} px, tệp là ${w}×${h}.` };
  }
  const known = [...LED_MODULE_PX, ...(opts.knownLed ?? [])];
  return known.some((p) => p.w === w && p.h === h)
    ? { ok: true, message: `Đúng ${w}×${h} px.` }
    : { ok: false, message: `Bảng LED không co giãn tự động: ${w}×${h} px không khớp bảng LED nào đã cấu hình.` };
}

/** Suy ra loai man hinh tu kich thuoc (thu vien media chua gan chien dich). */
export function inferTarget(w: number, h: number, knownLed: Px[] = []): TargetType | null {
  if (fitsTarget('elevator', w, h).ok) return 'elevator';
  if (fitsTarget('led_p5', w, h, { knownLed }).ok) return 'led_p5';
  if (fitsTarget('tv', w, h).ok) return 'tv';
  return null;
}

export function sizeLimitBytes(target: TargetType, quotaMbPerFile: number | null): number {
  const typeCap = SIZE_LIMIT_MB[target] * MB;
  return quotaMbPerFile && quotaMbPerFile > 0 ? Math.min(typeCap, quotaMbPerFile * MB) : typeCap;
}

export function parsePx(s?: string | null): Px | null {
  const m = String(s ?? '').match(/(\d{2,5})\s*[×x]\s*(\d{2,5})/i);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/** Doc kich thuoc anh tu dau tep (PNG IHDR / JPEG SOFn). Tra null neu khong nhan ra. */
export function probeImage(b: Uint8Array): Px | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (b[i + 5]! << 8) | b[i + 6]!, w: (b[i + 7]! << 8) | b[i + 8]! };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Kiem tra URL import: chi https, dung ten mien theo nguon, khong dia chi noi bo/IP/userinfo. */
export type LinkSource = 'youtube' | 'drive' | 'dropbox' | 'url';
export function checkImportUrl(source: LinkSource, raw: string): { ok: true; url: URL } | { ok: false; message: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, message: 'Liên kết không hợp lệ.' };
  }
  if (u.protocol !== 'https:') return { ok: false, message: 'Chỉ chấp nhận liên kết https.' };
  if (u.username || u.password) return { ok: false, message: 'Liên kết không được chứa thông tin đăng nhập.' };
  if (u.port && u.port !== '443') return { ok: false, message: 'Liên kết dùng cổng không hợp lệ.' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return { ok: false, message: 'Không chấp nhận địa chỉ IP hoặc tên máy nội bộ.' };
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, message: 'Không chấp nhận địa chỉ nội bộ.' };
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (source === 'youtube' && !(is('youtube.com') || host === 'youtu.be')) return { ok: false, message: 'Liên kết phải thuộc youtube.com hoặc youtu.be.' };
  if (source === 'drive' && !(host === 'drive.google.com' || host === 'docs.google.com')) return { ok: false, message: 'Liên kết phải thuộc drive.google.com.' };
  if (source === 'dropbox' && !(is('dropbox.com') || is('dl.dropboxusercontent.com'))) return { ok: false, message: 'Liên kết phải thuộc dropbox.com.' };
  if (source === 'url' && !/\.(mp4|mov|webm|png|jpe?g)$/i.test(u.pathname)) return { ok: false, message: 'Liên kết trực tiếp phải trỏ tới tệp .mp4, .mov, .webm, .png hoặc .jpg.' };
  u.hash = '';
  return { ok: true, url: u };
}
