// Anh dai dien (thumbnail) tao O TRINH DUYET: Cloudflare Worker khong co ffmpeg/transcoder (docs/CLOUDFLARE-MEDIA-LIMITS.md).
// Phan thuan (tinh kich thuoc, thoi diem lay khung, chon tep can tao, URL) tach rieng de test; phan DOM (video/canvas) o cuoi tep.
export const THUMB_WIDTH = 320;
export const THUMB_MAX_BYTES = 150 * 1024; // khop THUMB_MAX_BYTES o services/api/src/routes/media.ts
export const THUMB_QUALITIES = [0.7, 0.55, 0.4, 0.28] as const;
/** Tep anh lon hon muc nay khong tu tao anh dai dien o che do nen (tranh ton RAM/bang thong). */
export const BACKFILL_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const BACKFILL_MAX_PER_LOAD = 3;

/** Co ve chieu rong 320 px, giu ti le, khong phong to; toi thieu 1 px. */
export function thumbSize(srcW: number, srcH: number, maxW = THUMB_WIDTH): { w: number; h: number } {
  if (!(srcW > 0) || !(srcH > 0)) return { w: 0, h: 0 };
  const w = Math.min(maxW, Math.round(srcW));
  return { w, h: Math.max(1, Math.round((srcH * w) / srcW)) };
}

/** Thoi diem lay khung: ~1 s, hoac 10% thoi luong neu video ngan hon 10 s (video 5 s => 0,5 s). Chua biet thoi luong => 0. */
export function seekTime(durationSec: number | null | undefined): number {
  if (!(typeof durationSec === 'number') || !Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.min(1, Math.round(durationSec * 0.1 * 1000) / 1000);
}

/** Chat luong JPEG thu lan luot den khi anh <= 150 KB. `encode` tra ve kich thuoc (byte) hoac null neu loi. */
export async function encodeUnderLimit<T extends { size: number }>(encode: (q: number) => Promise<T | null>, maxBytes = THUMB_MAX_BYTES): Promise<T | null> {
  for (const q of THUMB_QUALITIES) {
    const b = await encode(q);
    if (b && b.size > 0 && b.size <= maxBytes) return b;
  }
  return null;
}

export interface ThumbCandidate {
  id: string;
  kind?: string | null;
  mime?: string | null;
  status: string;
  source?: string | null;
  thumb_url?: string | null;
  size_bytes?: number | null;
}

/** Tep tai len, da xong tai (khong 'processing'), chua co anh, la video hoac anh vua phai. Tep lien ket (link) khong co. */
export function needsThumbnail(m: ThumbCandidate): boolean {
  if (m.thumb_url) return false;
  if (m.status === 'processing') return false;
  if (m.source && m.source !== 'upload') return false;
  const mime = (m.mime ?? '').toLowerCase();
  if (m.kind === 'link' || !mime) return false;
  if (mime.startsWith('video/')) return true;
  if (mime.startsWith('image/')) return (m.size_bytes ?? 0) <= BACKFILL_MAX_IMAGE_BYTES;
  return false;
}

/** Chon toi da `max` tep chua co anh va chua thu (de lam tuan tu, khong chan giao dien). */
export function pickBackfill<T extends ThumbCandidate>(items: readonly T[], tried: ReadonlySet<string>, max = BACKFILL_MAX_PER_LOAD): T[] {
  const out: T[] = [];
  for (const m of items) {
    if (out.length >= max) break;
    if (!tried.has(m.id) && needsThumbnail(m)) out.push(m);
  }
  return out;
}

/** thumb_url tu API la duong dan API tuong doi (`/api/...` hoac khong co tien to); giu nguyen URL tuyet doi. */
export function resolveThumbUrl(url: string | null | undefined, apiBase = '/api'): string | null {
  if (!url) return null;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith(`${apiBase}/`) || url === apiBase) return url;
  if (url.startsWith('/admin/') || url.startsWith('/portal/')) return `${apiBase}${url}`;
  return url;
}

/** Phan hoi duyet de nguoi dung biet tep co can cho duyet khong. */
export function uploadDoneMessage(status: string | null | undefined): string {
  return status === 'approved'
    ? 'Đã tải lên và tự động duyệt (tài khoản của bạn có quyền duyệt). Tệp dùng được ngay.'
    : 'Đã tải lên. Hệ thống kiểm tra cơ bản rồi chuyển tệp vào hàng chờ duyệt; xem trạng thái ở thẻ tệp.';
}

/* ------------------------------------------------------------------ DOM (khong chay trong jsdom) */

/** Trinh duyet that co canvas.toBlob + video; jsdom (test) thi khong tu tao anh nen. */
export function thumbSupported(): boolean {
  try {
    if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.toBlob !== 'function') return false;
    return !/jsdom/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e as Error); });
  });

async function drawToJpeg(src: CanvasImageSource, sw: number, sh: number): Promise<Blob | null> {
  const { w, h } = thumbSize(sw, sh);
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  return encodeUnderLimit((q) => new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/jpeg', q)));
}

/** Tao anh dai dien tu tep (File) hoac URL (video/anh). null neu khong lam duoc (loi codec, CORS lam canvas bi 'tainted', het gio...). Khong nem loi. */
export async function captureThumbnail(source: File | string, mime: string, opts: { durationSec?: number | null; timeoutMs?: number } = {}): Promise<Blob | null> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const isFile = typeof source !== 'string';
  const url = isFile ? URL.createObjectURL(source) : source;
  try {
    if (mime.toLowerCase().startsWith('image/')) {
      return await withTimeout(
        new Promise<Blob | null>((res) => {
          const i = new Image();
          if (!isFile) i.crossOrigin = 'anonymous';
          i.onload = () => { drawToJpeg(i, i.naturalWidth, i.naturalHeight).then(res, () => res(null)); };
          i.onerror = () => res(null);
          i.src = url;
        }),
        timeoutMs,
      );
    }
    return await withTimeout(
      new Promise<Blob | null>((res) => {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        if (!isFile) v.crossOrigin = 'anonymous'; // can CORS GET tren R2 (docs/CLOUDFLARE-MEDIA-LIMITS.md), neu khong canvas bi tainted
        let seeked = false;
        v.onerror = () => res(null);
        v.onloadedmetadata = () => {
          const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : opts.durationSec ?? null;
          v.currentTime = Math.min(seekTime(d), Math.max(0, (Number.isFinite(v.duration) ? v.duration : 1) - 0.05));
        };
        v.onseeked = () => {
          if (seeked) return;
          seeked = true;
          drawToJpeg(v, v.videoWidth, v.videoHeight).then(res, () => res(null));
        };
        v.src = url;
      }),
      timeoutMs,
    );
  } catch {
    return null;
  } finally {
    if (isFile) URL.revokeObjectURL(url);
  }
}
