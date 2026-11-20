// Tep MP4 tong hop cho test tai len/nhap tu lien ket (H.264 + AAC, mdat kich thuoc tuy y).
/* eslint-disable @typescript-eslint/no-explicit-any */
export const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
const cat = (...p: (number[] | Uint8Array)[]) => {
  const out = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const box = (type: string, body: number[] | Uint8Array) => cat(be32(8 + body.length), tag(type), body);
/** MP4 H.264 (avc1) + AAC (mp4a) tong hop; mdat = `payload` byte (noi dung giong ngau nhien de phat hien sai thu tu phan). */
export function bigMp4(w: number, h: number, durS: number, payload: number): Uint8Array {
  const ts = 1000;
  const stsd = (fcc: string) => box('stsd', cat([0, 0, 0, 0], be32(1), be32(16), tag(fcc), new Array(8).fill(0)));
  const trak = (tw: number, th: number, fcc: string) => {
    const tkhd = box('tkhd', [0, 0, 0, 7, ...be32(0), ...be32(0), ...be32(1), ...be32(0), ...be32(durS * ts), ...new Array(8).fill(0), ...new Array(8).fill(0), ...new Array(36).fill(0), ...be32(tw << 16), ...be32(th << 16)]);
    return box('trak', cat(tkhd, box('mdia', box('minf', box('stbl', stsd(fcc))))));
  };
  const mvhd = box('mvhd', [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(ts), ...be32(Math.round(durS * ts)), ...new Array(80).fill(0)]);
  const mdat = new Uint8Array(payload);
  for (let i = 0; i < payload; i++) mdat[i] = (i * 31 + (i >> 8)) & 255;
  return cat(box('ftyp', [...tag('isom'), 0, 0, 2, 0, ...tag('isom'), ...tag('mp41')]), box('moov', cat(mvhd, trak(w, h, 'avc1'), trak(0, 0, 'mp4a'))), box('mdat', mdat));
}


/** WebM (EBML) tong hop: Segment (kich thuoc khong biet) > Info (duration) + Tracks (1 video) + Cluster(payload). codec: V_AV1 | V_VP9 | V_VP8 | V_MPEG4/ISO/AVC | V_MPEGH/ISO/HEVC. */
export function webmFile(codec: string, w: number, h: number, durS: number, payload: number): Uint8Array {
  const vint = (n: number) => [0x01, 0, 0, 0, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const el = (id: number[], body: number[] | Uint8Array) => cat(id, vint(body.length), body);
  const u16 = (n: number) => [(n >> 8) & 255, n & 255];
  const f64 = (x: number) => [...new Uint8Array(new Float64Array([x]).buffer)].reverse();
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], ascii('webm')));
  const info = el([0x15, 0x49, 0xa9, 0x66], cat(el([0x2a, 0xd7, 0xb1], be32(1_000_000)), el([0x44, 0x89], f64(durS * 1000))));
  const video = el([0xe0], cat(el([0xb0], u16(w)), el([0xba], u16(h))));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], cat(el([0x83], [1]), el([0x86], ascii(codec)), video)));
  const data = new Uint8Array(payload);
  for (let i = 0; i < payload; i++) data[i] = (i * 17 + (i >> 7)) & 255;
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], data);
  const segment = cat([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], info, tracks, cluster);
  return cat(header, segment);
}
