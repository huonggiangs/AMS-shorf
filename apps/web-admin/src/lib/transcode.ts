// Chuyen ma video trong trinh duyet: giao dien cho hop thoai tai len. Nap LUOI (dynamic import / Worker) nen khong tang bundle chinh.
// Phan thuan (danh gia, chon thong so, tien do) o transcode-plan.ts; phan WebCodecs o transcode-core.ts chay trong transcode.worker.ts.
import { TRANSCODE_MESSAGES, TranscodeError, type SourceInfo, type TranscodeErrorCode, type TranscodeSettings } from './transcode-plan';

/** Trinh duyet co du WebCodecs (giai ma + ma hoa video) de thu chuyen ma. Chrome/Edge tren may tinh: co. */
export const webCodecsSupported = (): boolean => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';

/** Doc codec/kich thuoc/thoi luong cua tep (nap luoi mediabunny). null neu khong doc duoc. */
export async function probeVideo(file: File): Promise<SourceInfo | null> {
  try {
    return await (await import('./transcode-core')).probeSource(file);
  } catch {
    return null;
  }
}

export interface WorkerLike {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}
export type WorkerFactory = () => WorkerLike;
export const defaultWorkerFactory: WorkerFactory = () => new Worker(new URL('./transcode.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export interface TranscodeProgress {
  fraction: number;
  /** giay nguon da xu ly */
  processedSec: number;
  /** giay da troi tu luc bat dau */
  elapsedSec: number;
}
export interface TranscodeOptions {
  onProgress?: (p: TranscodeProgress) => void;
  signal?: AbortSignal | undefined;
  /** test: thay Worker that bang gia lap; khong co Worker (moi truong cu) thi chay tren luong chinh */
  workerFactory?: WorkerFactory | undefined;
  now?: () => number;
}

export const outputName = (name: string): string => `${name.replace(/\.[^.]+$/, '').slice(0, 120) || 'video'}-h264.mp4`;

/** Chuyen `file` sang MP4 H.264 theo `settings`. Nem TranscodeError (message tieng Viet). Huy bang `signal`. */
export function transcodeVideo(file: File, settings: TranscodeSettings, opts: TranscodeOptions = {}): Promise<File> {
  const now = opts.now ?? (() => Date.now());
  const t0 = now();
  const finish = (buf: ArrayBuffer) => new File([buf], outputName(file.name), { type: 'video/mp4', lastModified: now() });
  const fail = (code: TranscodeErrorCode) => new TranscodeError(code, TRANSCODE_MESSAGES[code] ?? TRANSCODE_MESSAGES.failed);
  if (!webCodecsSupported() && !opts.workerFactory) return Promise.reject(fail('unsupported_browser'));
  const canWorker = !!opts.workerFactory || typeof Worker !== 'undefined';
  if (!canWorker) {
    // khong co Web Worker: chay tren luong chinh (van khong chan hoan toan vi mediabunny bat dong bo)
    const ctl = new AbortController();
    opts.signal?.addEventListener('abort', () => ctl.abort(), { once: true });
    return import('./transcode-core')
      .then((c) => c.convertFile(file, settings, { signal: ctl.signal, onProgress: (fraction, processedSec) => opts.onProgress?.({ fraction, processedSec, elapsedSec: (now() - t0) / 1000 }) }))
      .then(finish)
      .catch((e) => { throw e instanceof TranscodeError ? fail(e.code) : fail('failed'); });
  }
  return new Promise<File>((resolve, reject) => {
    let w: WorkerLike;
    try {
      w = (opts.workerFactory ?? defaultWorkerFactory)();
    } catch {
      reject(fail('unsupported_browser'));
      return;
    }
    let settled = false;
    const end = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try { w.terminate(); } catch { /* bo qua */ }
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      try { w.postMessage({ type: 'cancel' }); } catch { /* bo qua */ }
      end(() => reject(fail('canceled'))); // dung ngay, khong doi worker
    };
    if (opts.signal?.aborted) return reject(fail('canceled'));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    w.onmessage = (e) => {
      const d = e.data as { type?: string; fraction?: number; processedSec?: number; buffer?: ArrayBuffer; code?: TranscodeErrorCode };
      if (d.type === 'progress') opts.onProgress?.({ fraction: d.fraction ?? 0, processedSec: d.processedSec ?? 0, elapsedSec: (now() - t0) / 1000 });
      else if (d.type === 'done' && d.buffer) end(() => resolve(finish(d.buffer!)));
      else if (d.type === 'error') end(() => reject(fail(d.code ?? 'failed')));
    };
    w.onerror = () => end(() => reject(fail('failed')));
    w.postMessage({ type: 'start', file, settings });
  });
}
