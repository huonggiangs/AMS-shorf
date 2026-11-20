// Doc "dau tep" WebM/Matroska (EBML) bang doc doan nho: chi lay codec hinh, kich thuoc, thoi luong. Hop Cloudflare Workers (khong ffprobe, khong doc ca tep).
// KHONG giai ma, KHONG phai quet virus. Dung de bao DUNG ly do khi tep WebM (vd AV1/VP9 4K tu Drive) khong dat quy tac.
import type { RangeReader } from './mp4-probe.js';

export interface WebmProbe {
  recognized: boolean;
  w: number | null;
  h: number | null;
  durationS: number | null;
  /** quy ve fourcc nhu MP4 (avc1, hvc1, vp09, vp08, av01) de dung chung videoSpecProblem */
  videoCodec: string | null;
  audioCodec: string | null;
}

export const isWebmMagic = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TRACKS = 0x1654ae6b;
const ID_CLUSTER = 0x1f43b675;
const ID_TRACKENTRY = 0xae;
const ID_TIMESCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_TRACKTYPE = 0x83;
const ID_CODECID = 0x86;
const ID_VIDEO = 0xe0;
const ID_PIXW = 0xb0;
const ID_PIXH = 0xba;
const ID_DISPW = 0x54b0;
const ID_DISPH = 0x54ba;

/** doc ma phan tu (giu bit do dai) */
function readId(b: Uint8Array, o: number): { id: number; len: number } | null {
  const f = b[o];
  if (f === undefined || f === 0) return null;
  const len = Math.clz32(f) - 23; // 1..4
  if (len < 1 || len > 4 || o + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[o + i]!;
  return { id, len };
}
/** doc kich thuoc phan tu; size = -1 neu "khong biet" */
function readSize(b: Uint8Array, o: number): { size: number; len: number } | null {
  const f = b[o];
  if (f === undefined || f === 0) return null;
  const len = Math.clz32(f) - 23; // 1..8
  if (len < 1 || len > 8 || o + len > b.length) return null;
  let v = f & (0xff >> len);
  let allOnes = v === 0xff >> len;
  for (let i = 1; i < len; i++) {
    const x = b[o + i]!;
    if (x !== 0xff) allOnes = false;
    v = v * 256 + x;
  }
  return { size: allOnes ? -1 : v, len };
}
const uint = (b: Uint8Array, s: number, e: number): number => {
  let v = 0;
  for (let i = s; i < e; i++) v = v * 256 + b[i]!;
  return v;
};
const flt = (b: Uint8Array, s: number, e: number): number | null => {
  const dv = new DataView(b.buffer, b.byteOffset + s, e - s);
  return e - s === 4 ? dv.getFloat32(0) : e - s === 8 ? dv.getFloat64(0) : null;
};
const str = (b: Uint8Array, s: number, e: number): string => String.fromCharCode(...b.subarray(s, e)).replace(/\0+$/, '');

export function webmCodecToFourcc(id: string): string {
  const c = id.toUpperCase();
  if (c === 'V_VP9') return 'vp09';
  if (c === 'V_VP8') return 'vp08';
  if (c === 'V_AV1') return 'av01';
  if (c === 'V_MPEG4/ISO/AVC') return 'avc1';
  if (c === 'V_MPEGH/ISO/HEVC') return 'hvc1';
  if (c.startsWith('A_')) return c.slice(2).toLowerCase();
  return id.toLowerCase().slice(0, 24);
}

/** Phan tich bo dem dau tep WebM (>= vai chuc KB: EBML header + Segment/Info/Tracks truoc Cluster dau). */
export function parseWebmHead(b: Uint8Array): WebmProbe {
  const out: WebmProbe = { recognized: false, w: null, h: null, durationS: null, videoCodec: null, audioCodec: null };
  if (!isWebmMagic(b)) return out;
  out.recognized = true;
  let timescale = 1_000_000;
  let durationTicks: number | null = null;

  const walk = (from: number, to: number, depth: number, onEl: (id: number, s: number, e: number) => 'enter' | 'skip' | 'stop'): boolean => {
    let o = from;
    while (o < to && o < b.length) {
      const id = readId(b, o);
      if (!id) return false;
      const sz = readSize(b, o + id.len);
      if (!sz) return false;
      const start = o + id.len + sz.len;
      const end = sz.size < 0 ? to : Math.min(to, start + sz.size);
      const act = onEl(id.id, start, end);
      if (act === 'stop') return true;
      if (act === 'enter' && depth < 6 && walk(start, end, depth + 1, onEl)) return true;
      if (sz.size < 0) return false; // khong biet do dai va khong vao => khong tiep tuc duoc
      o = start + sz.size;
    }
    return false;
  };

  let curTrack: { type: number; codec: string | null; w: number | null; h: number | null; dw: number | null; dh: number | null } | null = null;
  const flush = () => {
    if (!curTrack) return;
    if (curTrack.type === 1 && !out.videoCodec) {
      out.videoCodec = curTrack.codec ? webmCodecToFourcc(curTrack.codec) : null;
      out.w = curTrack.dw ?? curTrack.w;
      out.h = curTrack.dh ?? curTrack.h;
    } else if (curTrack.type === 2 && !out.audioCodec) out.audioCodec = curTrack.codec ? webmCodecToFourcc(curTrack.codec) : null;
    curTrack = null;
  };
  walk(0, b.length, 0, (id, s, e) => {
    switch (id) {
      case ID_EBML:
        return 'skip';
      case ID_SEGMENT:
      case ID_INFO:
      case ID_TRACKS:
        return 'enter';
      case ID_CLUSTER:
        flush();
        return 'stop'; // Tracks/Info nam truoc Cluster dau
      case ID_TIMESCALE:
        timescale = uint(b, s, e) || timescale;
        return 'skip';
      case ID_DURATION:
        durationTicks = flt(b, s, e);
        return 'skip';
      case ID_TRACKENTRY:
        flush();
        curTrack = { type: 0, codec: null, w: null, h: null, dw: null, dh: null };
        return 'enter';
      case ID_TRACKTYPE:
        if (curTrack) curTrack.type = uint(b, s, e);
        return 'skip';
      case ID_CODECID:
        if (curTrack) curTrack.codec = str(b, s, e);
        return 'skip';
      case ID_VIDEO:
        return 'enter';
      case ID_PIXW:
        if (curTrack) curTrack.w = uint(b, s, e);
        return 'skip';
      case ID_PIXH:
        if (curTrack) curTrack.h = uint(b, s, e);
        return 'skip';
      case ID_DISPW:
        if (curTrack) curTrack.dw = uint(b, s, e);
        return 'skip';
      case ID_DISPH:
        if (curTrack) curTrack.dh = uint(b, s, e);
        return 'skip';
      default:
        return 'skip';
    }
  });
  flush();
  if (durationTicks !== null && Number.isFinite(durationTicks) && durationTicks > 0) out.durationS = (durationTicks * timescale) / 1e9;
  return out;
}

/** Doc <= 512 KB dau tep qua range read. */
export async function probeWebm(read: RangeReader, size: number): Promise<WebmProbe> {
  const head = await read(0, Math.min(size, 512 * 1024));
  return head ? parseWebmHead(head) : { recognized: false, w: null, h: null, durationS: null, videoCodec: null, audioCodec: null };
}
