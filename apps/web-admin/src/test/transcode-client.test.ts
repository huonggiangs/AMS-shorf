// Client chuyen ma: Worker gia lap (jsdom khong co WebCodecs): tien do, hoan tat, loi, huy, trinh duyet khong ho tro.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcodeVideo, outputName, type WorkerLike } from '../lib/transcode';
import { TRANSCODE_MESSAGES, TranscodeError, pickSettings, type SourceInfo } from '../lib/transcode-plan';

const info: SourceInfo = { width: 2160, height: 3840, durationSec: 20, codec: 'av1', container: 'webm', fps: 30, bitrateBps: 9e6, sizeBytes: 20e6, hasAudio: true };
const settings = pickSettings(info, 'elevator').settings;
const file = new File([new Uint8Array(10)], 'Silhouette of Vietnam 4K.webm', { type: 'video/webm' });

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  sent: unknown[] = [];
  terminated = false;
  postMessage(m: unknown) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  emit(data: unknown) { this.onmessage?.({ data }); }
}
afterEach(() => vi.unstubAllGlobals());

describe('transcodeVideo', () => {
  it('gui cau hinh toi worker, nhan tien do, tra ve tep MP4 H.264 ten moi, dong worker', async () => {
    const w = new FakeWorker();
    const prog: number[] = [];
    let t = 1000;
    const p = transcodeVideo(file, settings, { workerFactory: () => w, onProgress: (x) => prog.push(Math.round(x.fraction * 100)), now: () => (t += 1000) });
    expect(w.sent[0]).toMatchObject({ type: 'start', settings: { width: 1080, height: 1920, fit: 'contain', fps: 30 } });
    w.emit({ type: 'progress', fraction: 0.25, processedSec: 5 });
    w.emit({ type: 'progress', fraction: 0.75, processedSec: 15 });
    w.emit({ type: 'done', buffer: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]).buffer });
    const out = await p;
    expect(prog).toEqual([25, 75]);
    expect(out.name).toBe('Silhouette of Vietnam 4K-h264.mp4');
    expect(out.type).toBe('video/mp4');
    expect(out.size).toBe(8);
    expect(w.terminated).toBe(true);
    expect(outputName('a.b.mov')).toBe('a.b-h264.mp4');
  });
  it('loi tu worker: thong bao tieng Viet + huong dan Chrome/Edge', async () => {
    const w = new FakeWorker();
    const p = transcodeVideo(file, settings, { workerFactory: () => w });
    w.emit({ type: 'error', code: 'decode_unsupported' });
    await expect(p).rejects.toMatchObject({ name: 'TranscodeError', code: 'decode_unsupported', message: TRANSCODE_MESSAGES.decode_unsupported });
    expect(TRANSCODE_MESSAGES.decode_unsupported).toMatch(/Chrome hoặc Edge mới nhất trên máy tính/);
    expect(w.terminated).toBe(true);
  });
  it('huy: bao worker huy, dung ngay voi ma canceled; huy truoc khi bat dau cung vay', async () => {
    const w = new FakeWorker();
    const ctl = new AbortController();
    const p = transcodeVideo(file, settings, { workerFactory: () => w, signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: 'canceled' });
    expect(w.sent).toContainEqual({ type: 'cancel' });
    expect(w.terminated).toBe(true);
    w.emit({ type: 'done', buffer: new ArrayBuffer(4) }); // tin tre sau khi huy: bo qua
    const w2 = new FakeWorker();
    const c2 = new AbortController();
    c2.abort();
    await expect(transcodeVideo(file, settings, { workerFactory: () => w2, signal: c2.signal })).rejects.toBeInstanceOf(TranscodeError);
  });
  it('worker bi loi / khong tao duoc: bao loi than thien', async () => {
    const w = new FakeWorker();
    const p = transcodeVideo(file, settings, { workerFactory: () => w });
    w.onerror?.({});
    await expect(p).rejects.toMatchObject({ code: 'failed' });
    await expect(transcodeVideo(file, settings, { workerFactory: () => { throw new Error('no worker'); } })).rejects.toMatchObject({ code: 'unsupported_browser' });
  });
  it('trinh duyet khong co WebCodecs (jsdom) va khong co worker gia lap: bao khong ho tro + huong dan 1 dong', async () => {
    await expect(transcodeVideo(file, settings)).rejects.toMatchObject({ code: 'unsupported_browser', message: expect.stringMatching(/Chrome hoặc Edge mới nhất trên máy tính/) });
  });
});
