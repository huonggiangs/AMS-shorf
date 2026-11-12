// ffprobe / ffmpeg qua tien trinh con, tep tam rieng cho moi lan chay. Co ban gia (FakeMedia) cho test.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface ProbeResult {
  kind: 'video' | 'image';
  width: number;
  height: number;
  durationS: number | null;
  codec: string | null;
  hasAudio: boolean;
  bitrate: number | null;
}

export type TargetKind = 'tv' | 'elevator' | 'led_p5';

export interface Rendition {
  profile: string;
  ext: string;
  contentType: string;
  body: Uint8Array;
  width: number;
  height: number;
  codec: string;
}

export interface MediaTools {
  available(): Promise<boolean>;
  probe(bytes: Uint8Array, ext: string): Promise<ProbeResult>;
  transcode(bytes: Uint8Array, ext: string, probe: ProbeResult, target: TargetKind): Promise<Rendition[]>;
}

/** Ho so TV-safe (DAC-TA muc 6): H.264 yuv420p faststart; thang may <=1080x1920, <=8 Mbps; LED/thang may khong am thanh; anh -> webp (tru LED: can dung PNG/JPG). */
export function videoArgs(p: ProbeResult, target: TargetKind, threads: number): string[] {
  const maxRate = target === 'elevator' ? '8M' : target === 'led_p5' ? '8M' : '20M';
  const a = ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23', '-maxrate', maxRate, '-bufsize', target === 'tv' ? '40M' : '16M', '-movflags', '+faststart', '-threads', String(threads)];
  if (target === 'elevator') a.push('-vf', "scale='min(1080,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2");
  else a.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
  if (target === 'tv' && p.hasAudio) a.push('-c:a', 'aac', '-b:a', '128k');
  else a.push('-an');
  return a;
}

export class FfmpegTools implements MediaTools {
  private ok: boolean | null = null;
  constructor(private o: { ffmpeg?: string; ffprobe?: string; threads?: number; timeoutMs?: number } = {}) {}
  private get ff() { return this.o.ffmpeg ?? 'ffmpeg'; }
  private get fp() { return this.o.ffprobe ?? 'ffprobe'; }

  async available(): Promise<boolean> {
    if (this.ok !== null) return this.ok;
    try {
      await exec(this.fp, ['-version'], { timeout: 10_000 });
      await exec(this.ff, ['-version'], { timeout: 10_000 });
      this.ok = true;
    } catch {
      this.ok = false;
    }
    return this.ok;
  }

  private async withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'ams-media-'));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async probe(bytes: Uint8Array, ext: string): Promise<ProbeResult> {
    return this.withTmp(async (dir) => {
      const f = join(dir, `in.${ext}`);
      await writeFile(f, bytes);
      const { stdout } = await exec(this.fp, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f], { timeout: this.o.timeoutMs ?? 60_000, maxBuffer: 8 * 1024 * 1024 });
      const j = JSON.parse(stdout) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
      const v = (j.streams ?? []).find((s) => s['codec_type'] === 'video');
      if (!v) throw new Error('khong co luong video/anh');
      const w = Number(v['width']);
      const h = Number(v['height']);
      if (!w || !h) throw new Error('khong doc duoc kich thuoc');
      const isImg = ['png', 'jpeg', 'mjpeg', 'webp'].includes(String(v['codec_name'])) && !(Number(j.format?.['duration']) > 0 && String(j.format?.['format_name']).includes('mp4'));
      const dur = Number(j.format?.['duration'] ?? v['duration']);
      const br = Number(j.format?.['bit_rate']);
      return {
        kind: isImg ? 'image' : 'video',
        width: w,
        height: h,
        durationS: !isImg && Number.isFinite(dur) && dur > 0 ? dur : null,
        codec: String(v['codec_name'] ?? '') || null,
        hasAudio: (j.streams ?? []).some((s) => s['codec_type'] === 'audio'),
        bitrate: Number.isFinite(br) && br > 0 ? br : null,
      };
    });
  }

  async transcode(bytes: Uint8Array, ext: string, p: ProbeResult, target: TargetKind): Promise<Rendition[]> {
    const threads = this.o.threads ?? 2;
    return this.withTmp(async (dir) => {
      const inp = join(dir, `in.${ext}`);
      await writeFile(inp, bytes);
      const opts = { timeout: this.o.timeoutMs ?? 600_000, maxBuffer: 8 * 1024 * 1024 };
      if (p.kind === 'video') {
        const out = join(dir, 'out.mp4');
        await exec(this.ff, ['-y', '-v', 'error', '-i', inp, ...videoArgs(p, target, threads), out], opts);
        const rp = await this.probe(await readFile(out), 'mp4');
        return [{ profile: 'tv-safe-h264', ext: 'mp4', contentType: 'video/mp4', body: await readFile(out), width: rp.width, height: rp.height, codec: rp.codec ?? 'h264' }];
      }
      if (target === 'led_p5') return []; // LED: dung PNG/JPG goc dung kich thuoc, khong doi dinh dang
      const out = join(dir, 'out.webp');
      await exec(this.ff, ['-y', '-v', 'error', '-i', inp, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '85', out], opts);
      return [{ profile: 'tv-safe-webp', ext: 'webp', contentType: 'image/webp', body: await readFile(out), width: p.width, height: p.height, codec: 'webp' }];
    });
  }
}

/** Ban gia: tra ve ket qua dinh san. */
export class FakeMedia implements MediaTools {
  transcodes = 0;
  constructor(private o: { probe?: ProbeResult | Error; renditions?: Rendition[]; unavailable?: boolean } = {}) {}
  async available() { return !this.o.unavailable; }
  async probe(): Promise<ProbeResult> {
    if (this.o.probe instanceof Error) throw this.o.probe;
    return this.o.probe ?? { kind: 'video', width: 1920, height: 1080, durationS: 15, codec: 'h264', hasAudio: false, bitrate: 2_000_000 };
  }
  async transcode(): Promise<Rendition[]> {
    this.transcodes++;
    return this.o.renditions ?? [];
  }
}
