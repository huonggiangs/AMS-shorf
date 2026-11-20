// Tai tep lon TUNG PHAN qua Worker (R2 multipart): POST /media/:id/multipart -> PUT /parts/:n (tuan tu) -> POST /multipart/complete; sau do goi /confirm nhu thuong.
// Mỗi phần ≤ 32 MiB (< giới hạn body 100 MB của Cloudflare). Thử lại 3 lần mỗi phần với lùi dần; hủy được; báo lỗi có mã UP-PART-<n>-<status>.
import { API_BASE, ApiError, api, csrfHeaders } from '../api/client';

export interface MultipartInit {
  upload_id: string | null;
  part_size: number;
  total_parts: number;
  size_bytes: number;
  parts: { n: number; etag: string; size: number }[];
}
export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  part: number;
  totalParts: number;
}
export type PartSender = (url: string, body: Blob, o: { signal?: AbortSignal | undefined; onBytes: (loaded: number) => void }) => Promise<{ status: number; json: unknown }>;
export interface MultipartOptions {
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
  sender?: PartSender;
  /** lui dan giua cac lan thu lai (ms); test dat 0 */
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

export const MULTIPART_RETRIES = 3;
export const MULTIPART_BACKOFF_MS = [1000, 2000, 4000];
/** Tệp lớn hơn ngưỡng này (và kho không ký được URL) tải từng phần; khớp MULTIPART_THRESHOLD_BYTES của API. */
export const MULTIPART_THRESHOLD = 90 * 1024 * 1024;

export class UploadError extends Error {
  constructor(message: string, public code: string, public part?: number, public status?: number) {
    super(message);
    this.name = 'UploadError';
  }
}

/** Gui mot phan bang XHR (co tien do trong phan). Cung origin => phien (cookie) + CSRF. */
export const xhrSender: PartSender = (url, body, o) =>
  new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.withCredentials = true;
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    for (const [k, v] of Object.entries(csrfHeaders())) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { if (e.lengthComputable) o.onBytes(e.loaded); };
    x.onload = () => {
      let json: unknown = null;
      try { json = JSON.parse(x.responseText); } catch { /* khong phai JSON */ }
      resolve({ status: x.status, json });
    };
    x.onerror = () => reject(new TypeError('network'));
    x.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (o.signal) {
      if (o.signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      o.signal.addEventListener('abort', () => x.abort(), { once: true });
    }
    x.send(body);
  });

const abortErr = () => new UploadError('Đã hủy tải lên.', 'UP-ABORT');
const retryable = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;

export async function uploadMultipart(mediaBase: string, id: string, file: Blob, opts: MultipartOptions = {}): Promise<void> {
  const sender = opts.sender ?? xhrSender;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const backoff = opts.backoffMs ?? MULTIPART_BACKOFF_MS;
  const { signal } = opts;
  const checkAbort = () => { if (signal?.aborted) throw abortErr(); };
  const base = `${mediaBase}/${id}`;
  let init: MultipartInit;
  try {
    checkAbort();
    init = (await api.post(`${base}/multipart`, { body: {}, ...(signal ? { signal } : {}) })) as MultipartInit;
  } catch (e) {
    if (e instanceof UploadError) throw e;
    if ((e as Error).name === 'AbortError') throw abortErr();
    throw new UploadError(`Không khởi tạo được tải lên từng phần: ${(e as Error).message} (mã UP-INIT-${e instanceof ApiError ? e.status : 'NET'})`, `UP-INIT-${e instanceof ApiError ? e.status : 'NET'}`, undefined, e instanceof ApiError ? e.status : undefined);
  }
  const { part_size: partSize, total_parts: total } = init;
  const done = new Map(init.parts.map((p) => [p.n, p]));
  let confirmed = [...done.values()].reduce((a, p) => a + p.size, 0); // tiep tuc phien: bo qua phan da co
  const emit = (loaded: number, part: number) => opts.onProgress?.({ loaded, total: file.size, percent: Math.min(100, Math.floor((loaded * 100) / file.size)), part, totalParts: total });
  emit(confirmed, Math.min(done.size + 1, total));

  const abortRemote = async () => { try { await api.post(`${base}/multipart/abort`, { body: {} }); } catch { /* best effort */ } };
  try {
    for (let n = 1; n <= total; n++) {
      if (done.has(n)) continue;
      const blob = file.slice((n - 1) * partSize, Math.min(file.size, n * partSize));
      let lastStatus = 0;
      let lastMsg = '';
      let ok = false;
      for (let attempt = 0; attempt <= MULTIPART_RETRIES && !ok; attempt++) {
        checkAbort();
        if (attempt > 0) await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
        checkAbort();
        try {
          const r = await sender(`${API_BASE}${base}/parts/${n}`, blob, { ...(signal ? { signal } : {}), onBytes: (l) => emit(confirmed + l, n) });
          lastStatus = r.status;
          if (r.status >= 200 && r.status < 300) {
            const etag = (r.json as { etag?: string } | null)?.etag;
            if (!etag) throw new UploadError(`Máy chủ không trả mã xác nhận cho phần ${n} (mã UP-PART-${n}-${r.status}).`, `UP-PART-${n}-${r.status}`, n, r.status);
            done.set(n, { n, etag, size: blob.size });
            confirmed += blob.size;
            emit(confirmed, n);
            ok = true;
          } else {
            lastMsg = (r.json as { error?: { message?: string } } | null)?.error?.message ?? '';
            if (!retryable(r.status)) break;
          }
        } catch (e) {
          if (e instanceof UploadError) throw e;
          if ((e as Error).name === 'AbortError') throw abortErr();
          lastStatus = 0; // mang
        }
      }
      if (!ok) {
        const st = lastStatus === 0 ? 'NET' : String(lastStatus);
        const code = `UP-PART-${n}-${st}`;
        throw new UploadError(`Không tải được phần ${n}/${total}${lastMsg ? `: ${lastMsg}` : lastStatus === 0 ? ' (mất kết nối)' : ''} (mã ${code}). Đã thử lại ${MULTIPART_RETRIES} lần; bấm Tải lên lại để tiếp tục từ phần này.`, code, n, lastStatus || undefined);
      }
    }
    checkAbort();
    try {
      await api.post(`${base}/multipart/complete`, { body: { parts: [...done.values()].sort((a, b) => a.n - b.n).map((p) => ({ n: p.n, etag: p.etag })) }, ...(signal ? { signal } : {}) });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw abortErr();
      const st = e instanceof ApiError ? e.status : 'NET';
      throw new UploadError(`Không ghép được các phần thành tệp: ${(e as Error).message} (mã UP-COMPLETE-${st})`, `UP-COMPLETE-${st}`, undefined, e instanceof ApiError ? e.status : undefined);
    }
    emit(file.size, total);
  } catch (e) {
    // Hủy thật sự (người dùng bấm hủy) -> xóa phần trên kho. Lỗi mạng/phần: giữ phiên 3 giờ để tải lại tiếp tục từ phần dở.
    if (e instanceof UploadError && e.code === 'UP-ABORT') await abortRemote();
    throw e;
  }
}
