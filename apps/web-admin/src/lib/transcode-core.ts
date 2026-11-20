// Phan CHAY THAT cua chuyen ma trinh duyet: doc tep (mediabunny: MP4/MOV/WebM/MKV) -> giai ma (WebCodecs VideoDecoder) -> ma hoa H.264 (VideoEncoder 'avc1.*')
// + AAC (AudioEncoder) -> ghi MP4 co moov o dau tep (faststart) trong bo nho. Chay trong Web Worker (transcode.worker.ts); khong chay duoc trong jsdom (test dung gia lap).
// Giay phep thu vien: mediabunny MPL-2.0 (dung nhu phu thuoc, khong sua ma nguon) - xem docs/HUONG-DAN-TAI-VIDEO.md.
import { TranscodeError, type SourceInfo, type TranscodeSettings } from './transcode-plan';

export const hasWebCodecs = (): boolean => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';

const FORMAT_NAME: Record<string, string> = { mp4: 'mp4', isobmff: 'mp4', 'quicktime': 'mov', mov: 'mov', webm: 'webm', matroska: 'mkv', mkv: 'mkv' };
const containerOf = (name: string, fileName: string, mime: string): string => {
  const n = name.toLowerCase();
  for (const [k, v] of Object.entries(FORMAT_NAME)) if (n.includes(k)) return v;
  if (/webm/.test(mime) || /\.webm$/i.test(fileName)) return 'webm';
  if (/quicktime/.test(mime) || /\.mov$/i.test(fileName)) return 'mov';
  return /\.mp4$/i.test(fileName) ? 'mp4' : n || 'other';
};

/** Doc thong tin tep nguon (codec, kich thuoc hien thi, thoi luong, fps, bitrate) bang mediabunny. null: khong doc duoc (nguoi dung van tai len binh thuong, may chu kiem tra). */
export async function probeSource(file: File): Promise<SourceInfo | null> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) return null;
    const [width, height, durationSec, audio, fmt] = await Promise.all([vt.getDisplayWidth(), vt.getDisplayHeight(), input.computeDuration(), input.getPrimaryAudioTrack(), input.getFormat()]);
    let fps: number | null = null;
    let bitrateBps: number | null = null;
    try {
      const st = await vt.computePacketStats(200);
      fps = Number.isFinite(st.averagePacketRate) ? st.averagePacketRate : null;
      bitrateBps = Number.isFinite(st.averageBitrate) ? st.averageBitrate : null;
    } catch {
      /* bo qua: chi de dung bitrate/fps goi y */
    }
    if (!bitrateBps && durationSec > 0) bitrateBps = Math.round((file.size * 8) / durationSec);
    return { width, height, durationSec, codec: vt.codec, container: containerOf(fmt.name, file.name, file.type), fps, bitrateBps, sizeBytes: file.size, hasAudio: !!audio };
  } catch {
    return null;
  } finally {
    try { input.dispose(); } catch { /* bo qua */ }
  }
}

export interface ConvertHooks {
  /** 0..1 va so giay nguon da xu ly */
  onProgress?: (fraction: number, processedSec: number) => void;
  signal?: AbortSignal | undefined;
}

/** Chuyen `file` theo `s`; tra ve noi dung MP4. Nem TranscodeError (ma + thong bao tieng Viet o TRANSCODE_MESSAGES). */
export async function convertFile(file: File, s: TranscodeSettings, hooks: ConvertHooks = {}): Promise<ArrayBuffer> {
  if (!hasWebCodecs()) throw new TranscodeError('unsupported_browser', 'no WebCodecs');
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    let vt;
    try {
      vt = await input.getPrimaryVideoTrack();
    } catch {
      throw new TranscodeError('read_failed', 'doc tep that bai');
    }
    if (!vt) throw new TranscodeError('no_video', 'khong co video');
    if (!(await vt.canDecode())) throw new TranscodeError('decode_unsupported', `khong giai ma duoc ${String(vt.codec)}`);
    if (!(await mb.canEncodeVideo('avc', { width: s.width, height: s.height, bitrate: s.videoBps }))) throw new TranscodeError('encode_unsupported', 'khong ma hoa duoc H.264');
    // am thanh: giu nguyen neu da la AAC, khong thi ma hoa AAC 128 kbps; neu trinh duyet khong ma hoa duoc AAC thi bo tieng (quang cao thang may thuong khong tieng)
    const at = await input.getPrimaryAudioTrack();
    let audio: { codec?: 'aac'; bitrate?: number; discard?: boolean } = { codec: 'aac', bitrate: s.audioBps };
    if (at && at.codec !== 'aac' && !(await mb.canEncodeAudio('aac', { bitrate: s.audioBps }))) audio = { discard: true };
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const conv = await mb.Conversion.init({
      input,
      output,
      video: { codec: 'avc', width: s.width, height: s.height, fit: s.fit, frameRate: s.fps, bitrate: s.videoBps, keyFrameInterval: s.keyFrameSec, forceTranscode: true },
      audio,
      ...(s.trimEndSec ? { trim: { start: 0, end: s.trimEndSec } } : {}),
    });
    if (!conv.isValid) throw new TranscodeError('failed', 'cau hinh chuyen ma khong hop le');
    conv.onProgress = (p, t) => hooks.onProgress?.(Math.min(1, Math.max(0, p)), t);
    const onAbort = () => void conv.cancel();
    if (hooks.signal) {
      if (hooks.signal.aborted) throw new TranscodeError('canceled', 'huy');
      hooks.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      await conv.execute();
    } finally {
      hooks.signal?.removeEventListener('abort', onAbort);
    }
    if (!target.buffer) throw new TranscodeError('failed', 'khong co du lieu dau ra');
    return target.buffer;
  } catch (e) {
    if (e instanceof TranscodeError) throw e;
    if ((e as Error)?.name === 'ConversionCanceledError' || hooks.signal?.aborted) throw new TranscodeError('canceled', 'huy');
    console.error('[transcode] loi', (e as Error)?.name, (e as Error)?.message);
    throw new TranscodeError('failed', (e as Error)?.message ?? 'loi');
  } finally {
    try { input.dispose(); } catch { /* bo qua */ }
  }
}
