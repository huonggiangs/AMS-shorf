// Quy tac kich thuoc creative theo loai man hinh (DAC-TA muc 6). May chu kiem lai du client da kiem.
import { ELEVATOR_MAX, ELEVATOR_MIN, isElevatorResolution } from '@ams/shared';
export type TargetType = 'tv' | 'elevator' | 'led_p5';

/** Quy tac thang may: isElevatorResolution (moi do phan giai doc 9:16 trong khoang HD..4K); cac bac chuan: ELEVATOR_TIERS (@ams/shared). */
export const ELEVATOR_RES_TEXT = '720×1280 (HD), 768×1366 (18,5"), 1080×1920 (Full HD), 1440×2560 (2K), 2160×3840 (4K)';
/** Mo-dun LED P5 tieu chuan: chieu mm / 5. 1,28x0,64 | 2,56x1,28 | 3,84x1,92 | 0,96x1,92 (doc) */
export const LED_MODULE_PX = [
  { w: 256, h: 128 },
  { w: 512, h: 256 },
  { w: 768, h: 384 },
  { w: 192, h: 384 },
];

export const MB = 1024 * 1024;
export const GB = 1024 * MB;
/** Gioi han dung luong tep toi da theo loai man hinh (MB). Thang may: 30 MB tu Full HD tro xuong; tren Full HD (2K/4K) xem ELEVATOR_HIRES_LIMIT_MB. */
export const SIZE_LIMIT_MB: Record<TargetType, number> = { tv: 500, elevator: 30, led_p5: 50 };
/** Thang may 2K/4K (chieu rong > 1080): 30 MB khong du cho clip 10-30 giay 4K, nang tran len bang tran video 100 MB (VIDEO_RULES.maxBytes). */
export const ELEVATOR_HIRES_LIMIT_MB = 100;
export const ELEVATOR_HIRES_MIN_W = 1081;
/** Tran dung luong VIDEO man THANG MAY (HD-4K), tu 20/11/2026: 200 MB. TV/LED giu VIDEO_RULES.maxBytes (100 MB). Tep > 95 MB di qua Worker bang tai TUNG PHAN (multipart). */
export const ELEVATOR_VIDEO_LIMIT_MB = 200;
/** Tai tung phan qua Worker: moi phan 32 MiB (R2/S3: phan >= 5 MiB tru phan cuoi; <= 50 MiB de body Worker < 100 MB). */
export const MULTIPART_PART_BYTES = 32 * MB;
export const MULTIPART_MIN_PART_BYTES = 5 * MB;
export const MULTIPART_MAX_PART_BYTES = 50 * MB;
/** Tep lon hon nguong nay (va kho khong ky duoc URL) tai bang multipart; nho hon/bang: mot PUT qua Worker (PROXY_UPLOAD_MAX_BYTES). */
export const MULTIPART_THRESHOLD_BYTES = 90 * MB;
/** Phien tai tung phan song toi da 3 gio (tep thuong 1 gio). */
export const MULTIPART_SESSION_MS = 3 * 3600_000;
/** Kich thuoc phan multipart. Chi RUNTIME 'test' moi ghi de duoc (MEDIA_PART_SIZE_BYTES, >= 1 KiB) de test khong phai dung tep that hang tram MB. */
export function multipartPartSize(rt: { config: { runtime: string; env: Record<string, string | undefined> } }): number {
  const raw = Number(rt.config.env['MEDIA_PART_SIZE_BYTES']);
  if (rt.config.runtime === 'test' && Number.isInteger(raw) && raw >= 1024 && raw <= MULTIPART_MAX_PART_BYTES) return raw;
  return MULTIPART_PART_BYTES;
}
/** Tran dung luong khi tep di QUA Worker (Cloudflare chua co khoa S3 => PUT /media/:id/content): body Worker toi da 100 MB, de 5 MB du phong. */
export const PROXY_UPLOAD_MAX_BYTES = 95 * MB;
/** Thoi luong cho phep (giay), neu biet. */
export const DURATION_RANGE: Partial<Record<TargetType, [number, number]>> = { tv: [5, 60], elevator: [10, 30], led_p5: [5, 15] };

/**
 * Quy tac VIDEO quang cao (Cloudflare khong co ffmpeg => khong chuyen ma duoc; man phai phat truc tiep tep tai len):
 * - TV/LED: H.264 (avc1/avc3) + AAC, canh dai <= 1920 va canh ngan <= 1080 (Full HD), toi da 100 MB/tep.
 * - THANG MAY (tu 20/11/2026): H.264 hoac H.265/HEVC (hvc1/hev1) + AAC, den 4K 2160x3840; toi da 200 MB/tep (elevatorMaxBytes).
 *   Bitrate khuyen nghi <= 8 Mbps (Full HD) / <= 16 Mbps (2K/4K): clip 30 giay 4K @16 Mbps ~ 60 MB; tran 200 MB cho ban goc bitrate cao.
 * AV1/VP8/MPEG-4 Part 2 khong phat duoc on dinh tren da so box => tu choi som, thong bao dan nguoi dung toi nut "Tu dong chuyen sang chuan phat duoc" (chuyen ma o trinh duyet).
 * VP9 (thang may) va H.265: CHO PHEP kem canh bao (phat duoc tren da so Android moi, nhung khong toi uu bang H.264), khong chan.
 */
export const VIDEO_RULES = {
  maxBytes: 100 * MB,
  elevatorMaxBytes: ELEVATOR_VIDEO_LIMIT_MB * MB,
  maxLongSide: 1920,
  maxShortSide: 1080,
  codecs: ['avc1', 'avc3'] as readonly string[],
  elevatorCodecs: ['avc1', 'avc3', 'hvc1', 'hev1', 'vp09'] as readonly string[],
  /** Thang may: chap nhan nhung KHONG toi uu (canh bao, khong chan). H.264 la chuan an toan nhat; VP9 phu thuoc may giai ma phan cung cua box. */
  elevatorWarnCodecs: ['vp09'] as readonly string[],
  elevatorMaxLongSide: ELEVATOR_MAX.h,
  elevatorMaxShortSide: ELEVATOR_MAX.w,
};
const CODEC_NAME: Record<string, string> = { av01: 'AV1', hvc1: 'H.265/HEVC', hev1: 'H.265/HEVC', vp09: 'VP9', vp08: 'VP8', mp4v: 'MPEG-4 Part 2', avc1: 'H.264', avc3: 'H.264' };
/** Tran dung luong video theo loai man: thang may 200 MB, TV/LED 100 MB. */
export const videoMaxBytes = (target?: TargetType | null): number => (target === 'elevator' ? VIDEO_RULES.elevatorMaxBytes : VIDEO_RULES.maxBytes);
export const codecLabel = (fcc: string): string => CODEC_NAME[fcc] ?? fcc.trim();
/** Cau huong dan chung: nguoi dung co ban khong tu chuyen ma duoc, nen dan toi nut tu dong chuyen o hop thoai tai len. */
export const AUTO_CONVERT_SHORT = 'Cách dễ nhất: tải tệp từ máy tính (Chrome hoặc Edge mới nhất) và bấm "Tự động chuyển sang chuẩn phát được", hệ thống tự chuyển sang H.264.';
export const AUTO_CONVERT_HINT = `${AUTO_CONVERT_SHORT} Nếu tệp đến từ liên kết Drive, hãy tải tệp về máy rồi kéo vào ô tải lên.`;
/** Canh bao (khong chan) cho codec chap nhan duoc nhung khong toi uu. */
export function videoSpecWarnings(p: { codec?: string | null }, target?: TargetType | null): string[] {
  if (!p.codec) return [];
  if (target === 'elevator' && VIDEO_RULES.elevatorWarnCodecs.includes(p.codec)) {
    return [`Video dùng codec ${codecLabel(p.codec)}: màn thang máy phát được trên đa số máy mới nhưng H.264 ổn định hơn. Nếu màn bị giật hoặc đen hình, hãy tải lại bằng nút "Tự động chuyển sang chuẩn phát được".`];
  }
  return [];
}
/** Tra thong bao loi tieng Viet neu video khong dat quy tac; null neu dat. `target='elevator'`: cho phep H.265/VP9 va den 4K. */
export function videoSpecProblem(p: { w?: number | null; h?: number | null; codec?: string | null }, target?: TargetType | null): { code: string; message: string } | null {
  const el = target === 'elevator';
  const codecs = el ? VIDEO_RULES.elevatorCodecs : VIDEO_RULES.codecs;
  if (p.codec && !codecs.includes(p.codec)) {
    return {
      code: 'unsupported_codec',
      message: el
        ? `Video dùng codec ${codecLabel(p.codec)} mà màn thang máy không phát được ổn định. ${AUTO_CONVERT_HINT} (Hoặc tự xuất H.264 hoặc H.265 + AAC, tối đa 2160×3840, bitrate ≤ 16 Mbps, tệp ≤ ${VIDEO_RULES.elevatorMaxBytes / MB} MB.)`
        : `Video dùng codec ${codecLabel(p.codec)} mà TV không phát được ổn định. ${AUTO_CONVERT_HINT} (Hoặc tự xuất H.264 + AAC, tối đa 1920×1080.)`,
    };
  }
  if (p.w && p.h) {
    const long = Math.max(p.w, p.h);
    const short = Math.min(p.w, p.h);
    if (el) {
      if (long > VIDEO_RULES.elevatorMaxLongSide || short > VIDEO_RULES.elevatorMaxShortSide) {
        return { code: 'video_resolution_too_high', message: `Video ${p.w}×${p.h} vượt độ phân giải tối đa của màn thang máy ${ELEVATOR_MAX.w}×${ELEVATOR_MAX.h} (4K). ${AUTO_CONVERT_SHORT} (Hoặc xuất lại tối đa 4K dọc, bitrate ≤ 16 Mbps, tệp ≤ ${VIDEO_RULES.elevatorMaxBytes / MB} MB.)` };
      }
    } else if (long > VIDEO_RULES.maxLongSide || short > VIDEO_RULES.maxShortSide) {
      return { code: 'video_resolution_too_high', message: `Video ${p.w}×${p.h} vượt độ phân giải tối đa ${VIDEO_RULES.maxLongSide}×${VIDEO_RULES.maxShortSide} (Full HD). ${AUTO_CONVERT_SHORT} (Hoặc xuất lại ở 1080p H.264.)` };
    }
  }
  return null;
}

/** Kho chung (nguoi noi bo): nhan MOI container/codec video va anh pho bien; may chu/worker chuyen ma sang H.264/AAC MP4 de thiet bi phat duoc. */
export const LIBRARY_VIDEO_MAX_BYTES = 1600 * MB;
export const LIBRARY_IMAGE_MAX_BYTES = 25 * MB;
const LIB_VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', flv: 'video/x-flv', rmvb: 'video/vnd.rn-realvideo',
  rm: 'video/vnd.rn-realvideo', wmv: 'video/x-ms-wmv', asf: 'video/x-ms-asf', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', mpg: 'video/mpeg', mpeg: 'video/mpeg', ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t',
  vob: 'video/mpeg', ogv: 'video/ogg', f4v: 'video/x-f4v', divx: 'video/x-msvideo',
};
const LIB_IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff' };
/** Xac dinh loai tep kho chung tu duoi tep (uu tien) hoac Content-Type (khong nhan SVG/HTML: co the chua ma). null = khong phai anh/video. */
export function libraryMime(name: string, contentType: string): { mime: string; kind: 'video' | 'image'; ext: string } | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const ct = contentType.toLowerCase().split(';')[0]!.trim();
  if (LIB_VIDEO_MIME[ext]) return { mime: LIB_VIDEO_MIME[ext]!, kind: 'video', ext };
  if (LIB_IMAGE_MIME[ext]) return { mime: LIB_IMAGE_MIME[ext]!, kind: 'image', ext };
  if (ct.startsWith('video/')) return { mime: ct, kind: 'video', ext: ext || 'bin' };
  if (ct.startsWith('image/') && !ct.includes('svg')) return { mime: ct, kind: 'image', ext: ext || 'bin' };
  return null;
}
/** Video can chuyen ma truoc khi len thiet bi? (khong phai MP4/MOV/WebM H.264 sach) */
export const libraryNeedsTranscode = (mime: string, codec?: string | null): boolean => !(mime === 'video/mp4' || mime === 'video/quicktime') || (!!codec && !['avc1', 'avc3', 'h264'].includes(codec));
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
    if (!isElevatorResolution(w, h)) {
      return { ok: false, message: `Màn hình thang máy cần video/ảnh dọc 9:16, độ phân giải từ HD ${ELEVATOR_MIN.w}×${ELEVATOR_MIN.h} đến 4K ${ELEVATOR_MAX.w}×${ELEVATOR_MAX.h}, ví dụ ${ELEVATOR_RES_TEXT}; tệp là ${w}×${h}.` };
    }
    return { ok: true, message: 'Tệp đúng độ phân giải dọc 9:16 (HD–4K).' };
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

/** `video`: tep video (thang may 200 MB; TV/LED = min(tran loai man, 100 MB)). Anh giu tran theo loai man (thang may 30 MB, 100 MB tu 2K). */
export function sizeLimitBytes(target: TargetType, quotaMbPerFile: number | null, width?: number | null, video = false): number {
  const base = (target === 'elevator' && width && width >= ELEVATOR_HIRES_MIN_W ? ELEVATOR_HIRES_LIMIT_MB : SIZE_LIMIT_MB[target]) * MB;
  const typeCap = video ? (target === 'elevator' ? videoMaxBytes('elevator') : Math.min(base, videoMaxBytes(target))) : base;
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
  if (source === 'drive' && !(host === 'drive.google.com' || host === 'docs.google.com' || host === 'drive.usercontent.google.com')) return { ok: false, message: 'Liên kết phải thuộc drive.google.com.' };
  if (source === 'dropbox' && !(is('dropbox.com') || is('dl.dropboxusercontent.com'))) return { ok: false, message: 'Liên kết phải thuộc dropbox.com.' };
  if (source === 'url' && !/\.(mp4|mov|webm|png|jpe?g)$/i.test(u.pathname)) return { ok: false, message: 'Liên kết trực tiếp phải trỏ tới tệp .mp4, .mov, .webm, .png hoặc .jpg.' };
  u.hash = '';
  return { ok: true, url: u };
}
