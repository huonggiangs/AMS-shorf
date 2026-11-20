// Doc "dau tep" MP4 bang cac doan doc nho (range read): hop voi Cloudflare Workers (khong ffprobe, khong native, khong doc ca tep vao bo nho 128 MB).
// Chi duyet chuoi box cap cao (ftyp, moov, mdat...) va doc mvhd/tkhd trong moov: cho ra thoi luong, kich thuoc hinh va cac bat thuong cau truc.
// KHONG giai ma hinh/tieng, KHONG phai quet virus (xem docs/CLOUDFLARE-MEDIA-LIMITS.md).
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array | null>;

export interface Mp4Probe {
  /** true: nhan ra container MP4 (ftyp o dau tep) */
  recognized: boolean;
  brand: string | null;
  w: number | null;
  h: number | null;
  durationS: number | null;
  /** fourcc codec hinh (stsd): avc1 = H.264, hvc1/hev1 = H.265, av01 = AV1... */
  videoCodec?: string | null;
  audioCodec?: string | null;
  /** ma bat thuong (rong = cau truc nhat quan) */
  reasons: string[];
  moovAtEnd: boolean;
}

const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number): string => String.fromCharCode(...b.subarray(o, o + n));
export const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash', 'cmfc']);

interface Kid { type: string; start: number; end: number; hdr: number }

/** Doc mvhd (thoi luong) + tkhd dau tien co kich thuoc (chieu rong/cao hinh) trong phan than (payload) cua box moov. */
export function parseMoovPayload(b: Uint8Array): { durationS: number | null; w: number | null; h: number | null; videoCodec: string | null; audioCodec: string | null; reasons: string[] } {
  const reasons: string[] = [];
  let durationS: number | null = null;
  let w: number | null = null;
  let h: number | null = null;
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  const kids = (buf: Uint8Array, from: number, to: number): Kid[] => {
    const out: Kid[] = [];
    let o = from;
    while (o + 8 <= to) {
      let size = u32(buf, o);
      let hdr = 8;
      if (size === 1) {
        if (o + 16 > to || u32(buf, o + 8) !== 0) break;
        size = u32(buf, o + 12);
        hdr = 16;
      } else if (size === 0) size = to - o;
      if (size < hdr || o + size > to) {
        reasons.push('mp4_box_overrun');
        break;
      }
      out.push({ type: ascii(buf, o + 4, 4), start: o, end: o + size, hdr });
      o += size;
    }
    return out;
  };
  const top = kids(b, 0, b.length);
  const mvhd = top.find((x) => x.type === 'mvhd');
  if (!mvhd) reasons.push('mp4_no_mvhd');
  else {
    const p = mvhd.start + mvhd.hdr;
    const ver = b[p]!;
    if (p + (ver === 1 ? 32 : 20) <= b.length) {
      const ts = ver === 1 ? u32(b, p + 20) : u32(b, p + 12);
      const dur = ver === 1 ? u32(b, p + 24) * 2 ** 32 + u32(b, p + 28) : u32(b, p + 16);
      if (ts > 0) durationS = dur / ts;
    }
  }
  for (const trak of top.filter((x) => x.type === 'trak')) {
    const tkids = kids(b, trak.start + trak.hdr, trak.end);
    const tk = tkids.find((x) => x.type === 'tkhd');
    if (!tk) continue;
    const p = tk.start + tk.hdr;
    const o = b[p] === 1 ? p + 88 : p + 76;
    let isVideo = false;
    if (o + 8 <= b.length) {
      const tw = u32(b, o) >>> 16;
      const th = u32(b, o + 4) >>> 16;
      if (tw > 0 && th > 0 && w === null) {
        w = tw;
        h = th;
        isVideo = true;
      }
    }
    // stsd: trak > mdia > minf > stbl > stsd; fourcc cua mau dau tien o payload+12 (fullbox 4 + so mau 4 + kich thuoc mau 4)
    let cur: Kid | undefined = trak;
    for (const name of ['mdia', 'minf', 'stbl', 'stsd']) {
      cur = cur ? kids(b, cur.start + cur.hdr, cur.end).find((x) => x.type === name) : undefined;
    }
    if (cur && cur.start + cur.hdr + 16 <= b.length) {
      const fcc = ascii(b, cur.start + cur.hdr + 12, 4);
      if (isVideo) videoCodec = fcc;
      else if (!audioCodec) audioCodec = fcc;
    }
  }
  if (w === null) reasons.push('mp4_no_video_track');
  return { durationS, w, h, videoCodec, audioCodec, reasons };
}

/**
 * Duyet cac box cap cao bang doc 16 byte moi box, bo qua mdat theo kich thuoc (khong doc), doc nguyen moov neu <= maxMoovBytes.
 * `size`: kich thuoc tep that (head). Chi vai lan doc nho nen dung duoc cho tep hang tram MB.
 */
export async function probeMp4(read: RangeReader, size: number, opts: { maxMoovBytes?: number; maxBoxes?: number } = {}): Promise<Mp4Probe> {
  const maxMoov = opts.maxMoovBytes ?? 16 * 1024 * 1024;
  const maxBoxes = opts.maxBoxes ?? 64;
  const res: Mp4Probe = { recognized: false, brand: null, w: null, h: null, durationS: null, reasons: [], moovAtEnd: false };
  let o = 0;
  let n = 0;
  let sawMoov = false;
  let sawMdat = false;
  while (o < size) {
    if (n++ >= maxBoxes) {
      res.reasons.push('mp4_too_many_boxes');
      return res;
    }
    const head = await read(o, 16);
    if (!head || head.length < 8) {
      res.reasons.push(o === 0 ? 'mp4_ftyp_missing' : 'mp4_trailing_bytes');
      return res;
    }
    let boxSize = u32(head, 0);
    const type = ascii(head, 4, 4);
    let hdr = 8;
    if (boxSize === 1) {
      if (head.length < 16 || u32(head, 8) !== 0) {
        res.reasons.push('mp4_box_too_large');
        return res;
      }
      boxSize = u32(head, 12);
      hdr = 16;
    } else if (boxSize === 0) boxSize = size - o;
    if (boxSize < hdr || o + boxSize > size) {
      res.reasons.push('mp4_box_overrun');
      return res;
    }
    if (o === 0) {
      if (type !== 'ftyp' || boxSize < 16) {
        res.reasons.push('mp4_ftyp_missing');
        return res;
      }
      res.recognized = true;
      res.brand = ascii(head, 8, 4);
      if (!MP4_BRANDS.has(res.brand)) res.reasons.push(`mp4_brand_not_allowed:${res.brand.trim()}`);
    }
    if (type === 'mdat') sawMdat = true;
    if (type === 'moov') {
      sawMoov = true;
      res.moovAtEnd = sawMdat;
      if (boxSize > maxMoov) res.reasons.push('mp4_moov_too_large');
      else {
        const body = await read(o + hdr, boxSize - hdr);
        if (!body || body.length < boxSize - hdr) {
          res.reasons.push('mp4_moov_unreadable');
          return res;
        }
        const m = parseMoovPayload(body);
        res.durationS = m.durationS;
        res.w = m.w;
        res.h = m.h;
        res.videoCodec = m.videoCodec;
        res.audioCodec = m.audioCodec;
        res.reasons.push(...m.reasons);
      }
    }
    o += boxSize;
  }
  if (!sawMoov) res.reasons.push('mp4_no_moov');
  if (!sawMdat) res.reasons.push('mp4_no_mdat');
  return res;
}

type RangeStore = { getRange?: (k: string, o: number, l: number) => Promise<Uint8Array | null>; get: (k: string) => Promise<Uint8Array | null> };
/** RangeReader tu ObjectStore: getRange neu co; neu khong thi doc ca tep MOT lan (chi dung cho tep nho). */
export function rangeReaderFor(store: RangeStore, key: string): RangeReader {
  if (store.getRange) return (o, l) => store.getRange!(key, o, l);
  let whole: Promise<Uint8Array | null> | null = null;
  return async (o, l) => {
    whole ??= store.get(key);
    const b = await whole;
    return b ? b.subarray(o, o + l) : null;
  };
}
