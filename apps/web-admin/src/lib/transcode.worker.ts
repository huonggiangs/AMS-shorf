// Web Worker chay chuyen ma de khong treo giao dien. Giao thuc: {type:'start', file, settings} -> {type:'progress', fraction, processedSec} ... -> {type:'done', buffer} | {type:'error', code}; {type:'cancel'} huy.
import { convertFile } from './transcode-core';
import { TranscodeError, type TranscodeSettings } from './transcode-plan';

interface Ctx {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: { type: string; file?: File; settings?: TranscodeSettings } }) => void) | null;
}
const ctx = self as unknown as Ctx;
let ctl: AbortController | null = null;

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'cancel') {
    ctl?.abort();
    return;
  }
  if (m.type !== 'start' || !m.file || !m.settings) return;
  ctl = new AbortController();
  void convertFile(m.file, m.settings, { signal: ctl.signal, onProgress: (fraction, processedSec) => ctx.postMessage({ type: 'progress', fraction, processedSec }) })
    .then((buffer) => ctx.postMessage({ type: 'done', buffer }, [buffer]))
    .catch((err) => ctx.postMessage({ type: 'error', code: err instanceof TranscodeError ? err.code : 'failed' }));
};
