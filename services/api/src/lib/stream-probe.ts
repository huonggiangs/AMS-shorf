// Kiem tra URL video "dan link" tu phia may chu, AN TOAN (SSRF) va KHONG tai video:
//  - chi HEAD + mot yeu cau Range 0-65535 (doc toi da 64 KB roi huy luong), timeout 5 s moi yeu cau;
//  - https/cong 443 (validateStreamUrl) kiem tra o MOI buoc chuyen huong (toi da 3), khong theo redirect tu dong;
//  - tuy chon `resolve` (Node): giai ma DNS va chan moi dia chi rieng/loopback/link-local/metadata (chong DNS rebinding). Tren Cloudflare Workers
//    fetch khong toi duoc dia chi rieng nen khong can; neu co nodejs_compat thi dung duoc dns nhu Node.
//  - ket qua ve codec/do phan giai/fps CHI MANG TINH THAM KHAO (canh bao), khong bao gio la ly do tu choi (video 2K-8K, bitrate/fps bat ky deu nhan).
import { isBlockedIp, sha256Hex, streamKindFromContentType, streamKindFromPath, validateStreamUrl, type StreamKind } from '@ams/shared';
import { probeMp4 } from './mp4-probe.js';

export const PROBE_TIMEOUT_MS = 5000;
export const PROBE_MAX_BYTES = 64 * 1024;
export const PROBE_MAX_REDIRECTS = 3;

export interface ProbeDeps {
  fetch: typeof fetch;
  /** giai ma ten mien -> danh sach IP; null = khong kiem tra DNS (Workers) */
  resolve: ((host: string) => Promise<string[]>) | null;
  timeoutMs?: number;
}

let deps: ProbeDeps | null = null;
/** Cho test/Node: thay fetch + resolver. Mac dinh: fetch toan cuc, resolver dns (neu co). */
export function setProbeDeps(d: ProbeDeps | null): void {
  deps = d;
}
async function nodeResolve(host: string): Promise<string[]> {
  const dns = await import('node:dns').catch(() => null);
  if (!dns?.promises) throw new Error('no-dns');
  const rs = await dns.promises.lookup(host, { all: true, verbatim: true });
  return rs.map((r) => r.address);
}
export function probeDeps(): ProbeDeps {
  if (deps) return deps;
  let canResolve: boolean | null = null;
  return (deps = {
    fetch: (...a) => globalThis.fetch(...a),
    resolve: async (h) => {
      if (canResolve === false) return [];
      try {
        const r = await nodeResolve(h);
        canResolve = true;
        return r;
      } catch (e) {
        if ((e as Error).message === 'no-dns') {
          canResolve = false;
          return [];
        }
        throw e;
      }
    },
  });
}

export class ProbeError extends Error {
  constructor(public code: string, message: string, public status: 'invalid' | 'unreachable' | 'http_error' = 'invalid', public httpStatus: number | null = null) {
    super(message);
  }
}

export interface StreamInfo {
  codec: string | null;
  audio_codec: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  fps: number | null;
  /** nhan do phan giai de hien thi (vd '4K', '8K'); chi de tham khao */
  resolution_label: string | null;
}
export interface StreamProbe {
  /** 'ok' = truy cap duoc va nhan dien dung loai */
  status: 'ok' | 'unreachable' | 'http_error';
  http_status: number | null;
  kind: StreamKind;
  content_type: string | null;
  content_length: number | null;
  etag: string | null;
  last_modified: string | null;
  body_hash: string | null;
  /** host cua URL cuoi cung sau chuyen huong (hien thi cho nguoi duyet) */
  final_host: string;
  redirects: number;
  info: StreamInfo;
  warnings: string[];
}

const GOOD_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09']);
const CODEC_NAME: Record<string, string> = { avc1: 'H.264', avc3: 'H.264', hvc1: 'H.265/HEVC', hev1: 'H.265/HEVC', av01: 'AV1', vp09: 'VP9', vp08: 'VP8', mp4v: 'MPEG-4 Part 2' };
export const resolutionLabel = (w: number | null, h: number | null): string | null => {
  if (!w || !h) return null;
  const long = Math.max(w, h);
  return long >= 7680 ? '8K' : long >= 5120 ? '5K' : long >= 3840 ? '4K' : long >= 2560 ? '2K (QHD)' : long >= 1920 ? 'Full HD' : long >= 1280 ? 'HD' : 'SD';
};

/** Mot yeu cau co kiem tra SSRF moi buoc chuyen huong. */
async function safeFetch(rawUrl: string, init: RequestInit, d: ProbeDeps): Promise<{ res: Response; url: URL; redirects: number }> {
  let cur = rawUrl;
  const signal = AbortSignal.timeout(d.timeoutMs ?? PROBE_TIMEOUT_MS);
  for (let hop = 0; ; hop++) {
    const v = validateStreamUrl(cur);
    if (!v.ok) throw new ProbeError(hop === 0 ? v.code : 'redirect_blocked', hop === 0 ? v.message : `Liên kết chuyển hướng tới địa chỉ không an toàn (${v.message})`);
    if (d.resolve) {
      let addrs: string[];
      try {
        addrs = await d.resolve(v.host);
      } catch {
        throw new ProbeError('dns_failed', 'Không phân giải được tên miền của liên kết.', 'unreachable');
      }
      if (addrs.some((a) => isBlockedIp(a))) throw new ProbeError('host_resolves_private', 'Tên miền trỏ tới địa chỉ IP nội bộ/không công khai, không chấp nhận.');
    }
    let res: Response;
    try {
      res = await d.fetch(v.url.toString(), { ...init, redirect: 'manual', credentials: 'omit', signal, headers: { 'user-agent': 'AMS-LinkProbe/1.0', 'accept-encoding': 'identity', ...(init.headers as Record<string, string> | undefined) } });
    } catch (e) {
      const timeout = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
      throw new ProbeError(timeout ? 'timeout' : 'unreachable', timeout ? 'Máy chủ video không phản hồi trong 5 giây.' : 'Không kết nối được tới liên kết video.', 'unreachable');
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* bo qua */ }
      if (!loc) throw new ProbeError('bad_redirect', 'Liên kết chuyển hướng nhưng thiếu địa chỉ đích.', 'http_error', res.status);
      if (hop >= PROBE_MAX_REDIRECTS) throw new ProbeError('too_many_redirects', `Liên kết chuyển hướng quá ${PROBE_MAX_REDIRECTS} lần.`, 'http_error', res.status);
      try {
        cur = new URL(loc, v.url).toString();
      } catch {
        throw new ProbeError('bad_redirect', 'Địa chỉ chuyển hướng không hợp lệ.', 'http_error', res.status);
      }
      continue;
    }
    return { res, url: v.url, redirects: hop };
  }
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const body = res.body;
  if (!body) return new Uint8Array((await res.arrayBuffer()).slice(0, max));
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    while (n < max) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      n += value.length;
    }
  } finally {
    try { await reader.cancel(); } catch { /* bo qua */ }
  }
  const out = new Uint8Array(Math.min(n, max));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - o);
    if (take <= 0) break;
    out.set(c.subarray(0, take), o);
    o += take;
  }
  return out;
}

const num = (s: string | null): number | null => {
  if (s === null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};

const emptyInfo = (): StreamInfo => ({ codec: null, audio_codec: null, width: null, height: null, duration_s: null, fps: null, resolution_label: null });
const text = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: false }).decode(b);

function sniffMp4(buf: Uint8Array, size: number, info: StreamInfo, warnings: string[]): Promise<void> {
  const ascii = (o: number, n: number) => String.fromCharCode(...buf.subarray(o, o + n));
  if (buf.length < 12 || ascii(4, 4) !== 'ftyp') {
    if (buf[0] === 0x3c || /^\s*(<!doctype|<html)/i.test(text(buf.subarray(0, 64)))) throw new ProbeError('not_video', 'Liên kết trả về một trang web (HTML), không phải tệp video MP4. Hãy dán liên kết trực tiếp tới tệp .mp4.');
    warnings.push('not_mp4_signature');
    return Promise.resolve();
  }
  return probeMp4(async (o, l) => (o + 8 <= buf.length ? buf.subarray(o, Math.min(o + l, buf.length)) : null), size, { maxMoovBytes: PROBE_MAX_BYTES }).then((p) => {
    if (!p.recognized) return;
    info.width = p.w;
    info.height = p.h;
    info.duration_s = p.durationS && p.durationS > 0 ? Math.round(p.durationS) : null;
    info.codec = p.videoCodec ? (CODEC_NAME[p.videoCodec] ?? p.videoCodec.trim()) : null;
    info.audio_codec = p.audioCodec ?? null;
    if (p.videoCodec && !GOOD_CODECS.has(p.videoCodec)) warnings.push(`codec_unusual:${CODEC_NAME[p.videoCodec] ?? p.videoCodec.trim()}`);
    if (!p.w || !p.h) warnings.push('metadata_not_in_first_64kb'); // moov o cuoi tep: bat dau phat cham hon, khong phai loi
  });
}

function sniffHls(buf: Uint8Array, info: StreamInfo, warnings: string[]): void {
  const t = text(buf).replace(/^﻿/, '').trimStart();
  if (!t.startsWith('#EXTM3U')) throw new ProbeError('hls_invalid', 'Tệp không phải playlist HLS hợp lệ (thiếu dòng #EXTM3U ở đầu).');
  let bestPx = 0;
  for (const m of t.matchAll(/RESOLUTION=(\d{2,5})x(\d{2,5})/g)) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w * h > bestPx) {
      bestPx = w * h;
      info.width = w;
      info.height = h;
    }
  }
  const codecs = /CODECS="([^"]+)"/.exec(t)?.[1];
  if (codecs) {
    const v = codecs.split(',').map((x) => x.trim()).find((x) => /^(avc|hvc|hev|av01|vp0)/.test(x));
    if (v) {
      const fcc = v.slice(0, 4);
      info.codec = CODEC_NAME[fcc] ?? v;
      if (!GOOD_CODECS.has(fcc)) warnings.push(`codec_unusual:${v}`);
    }
  }
  const fr = /FRAME-RATE=([\d.]+)/.exec(t)?.[1];
  if (fr) info.fps = Math.round(Number(fr) * 100) / 100;
  if (!t.includes('#EXT-X-STREAM-INF') && !t.includes('#EXT-X-ENDLIST') && t.includes('#EXTINF')) warnings.push('hls_live_or_incomplete');
  if (t.includes('#EXT-X-STREAM-INF') && !t.includes('#EXTINF')) return; // master playlist: thoi luong nam o cac playlist con
  const total = [...t.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  if (total > 0 && t.includes('#EXT-X-ENDLIST')) info.duration_s = Math.round(total);
}

function sniffDash(buf: Uint8Array, info: StreamInfo, warnings: string[]): void {
  const t = text(buf);
  if (!/<MPD[\s>]/.test(t)) throw new ProbeError('dash_invalid', 'Tệp không phải manifest DASH (.mpd) hợp lệ.');
  let w = 0;
  let h = 0;
  for (const m of t.matchAll(/width="(\d{2,5})"[^>]*?height="(\d{2,5})"/g)) {
    if (Number(m[1]) * Number(m[2]) > w * h) {
      w = Number(m[1]);
      h = Number(m[2]);
    }
  }
  if (w && h) {
    info.width = w;
    info.height = h;
  }
  const cod = /codecs="([^"]+)"/.exec(t)?.[1];
  if (cod) {
    info.codec = cod.split(',')[0]!.trim();
    if (!/^(avc|hvc|hev|av01|vp09)/.test(cod)) warnings.push(`codec_unusual:${cod}`);
  }
  const d = /mediaPresentationDuration="PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?"/.exec(t);
  if (d) info.duration_s = Math.round(Number(d[1] ?? 0) * 3600 + Number(d[2] ?? 0) * 60 + Number(d[3] ?? 0)) || null;
  if (/type="dynamic"/.test(t)) warnings.push('dash_live');
}

const BAD_CT_BINARY = /^(text\/html|application\/(json|xhtml\+xml)|application\/pdf|image\/)/;

/**
 * Kiem tra mot URL video. Nem ProbeError (status 'invalid') khi URL khong an toan / khong phai video; tra StreamProbe voi status 'ok' | 'http_error' | 'unreachable'
 * khi URL hop le nhung may chu tra loi loi (de bo kiem tra lai ghi nhan). KHONG BAO GIO tai ca tep.
 */
export async function probeStreamUrl(rawUrl: string, opts: { kind?: StreamKind | null; deps?: ProbeDeps } = {}): Promise<StreamProbe> {
  const d = opts.deps ?? probeDeps();
  const v0 = validateStreamUrl(rawUrl);
  if (!v0.ok) throw new ProbeError(v0.code, v0.message);
  const warnings: string[] = [];

  // 1) HEAD (nhieu may chu cam HEAD => bo qua loi, dung Range GET)
  let head: Response | null = null;
  let headRedirects = 0;
  let finalUrl = v0.url;
  try {
    const h = await safeFetch(v0.url.toString(), { method: 'HEAD' }, d);
    head = h.res;
    headRedirects = h.redirects;
    finalUrl = h.url;
  } catch (e) {
    if (e instanceof ProbeError && e.status === 'invalid') throw e; // SSRF/chuyen huong xau: dung han
    head = null; // loi mang o HEAD: de Range GET xac dinh
  }
  const headOk = !!head && head.status >= 200 && head.status < 300;

  // 2) Range GET <= 64 KB
  const g = await safeFetch(v0.url.toString(), { method: 'GET', headers: { range: `bytes=0-${PROBE_MAX_BYTES - 1}` } }, d);
  const gr = g.res;
  finalUrl = g.url;
  const redirects = Math.max(headRedirects, g.redirects);
  const lower = (r: Response | null, n: string) => r?.headers.get(n) ?? null;
  if (gr.status >= 400 || gr.status < 200) {
    try { await gr.body?.cancel(); } catch { /* bo qua */ }
    return {
      status: 'http_error', http_status: gr.status, kind: opts.kind ?? v0.kindHint ?? 'mp4', content_type: null, content_length: null, etag: null, last_modified: null, body_hash: null,
      final_host: finalUrl.hostname, redirects, info: emptyInfo(), warnings: [`http_${gr.status}`],
    };
  }
  const buf = await readCapped(gr, PROBE_MAX_BYTES);
  const src = headOk ? head : gr; // validator lay tu HEAD neu co (nhat quan giua cac lan kiem tra), neu khong thi tu GET
  const contentType = (lower(src, 'content-type') ?? lower(gr, 'content-type'))?.split(';')[0]!.trim().toLowerCase() || null;
  const cr = /\/(\d+)\s*$/.exec(lower(gr, 'content-range') ?? '');
  const contentLength = (headOk ? num(lower(head, 'content-length')) : null) ?? (cr ? num(cr[1]!) : null) ?? (gr.status === 200 ? num(lower(gr, 'content-length')) : null);
  const etag = lower(src, 'etag') ?? lower(gr, 'etag');
  const lastModified = lower(src, 'last-modified') ?? lower(gr, 'last-modified');

  // 3) loai luong: khai bao > duoi tep (URL goc, roi URL cuoi) > content-type
  const kind = opts.kind ?? v0.kindHint ?? streamKindFromPath(finalUrl.pathname) ?? streamKindFromContentType(contentType);
  if (!kind) throw new ProbeError('stream_kind_unknown', 'Không nhận ra loại video. Dùng liên kết tệp .mp4/.webm hoặc luồng .m3u8 (HLS)/.mpd (DASH).');
  if (contentType && BAD_CT_BINARY.test(contentType)) throw new ProbeError('not_video', `Liên kết trả về nội dung "${contentType}", không phải video. Hãy dán liên kết trực tiếp tới tệp/luồng video.`);
  if (contentType === 'text/plain' && (kind === 'mp4' || kind === 'webm')) throw new ProbeError('not_video', 'Liên kết trả về văn bản thuần, không phải video.');

  const info = emptyInfo();
  if (kind === 'mp4') await sniffMp4(buf, contentLength ?? buf.length, info, warnings);
  else if (kind === 'webm') {
    if (!(buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3)) {
      if (buf[0] === 0x3c) throw new ProbeError('not_video', 'Liên kết trả về một trang web (HTML), không phải tệp WebM.');
      warnings.push('not_webm_signature');
    }
  } else if (kind === 'hls') sniffHls(buf, info, warnings);
  else sniffDash(buf, info, warnings);
  info.resolution_label = resolutionLabel(info.width, info.height);
  if ((kind === 'mp4' || kind === 'webm') && !etag && !lastModified) warnings.push('weak_validators');

  return {
    status: 'ok', http_status: gr.status, kind, content_type: contentType, content_length: contentLength, etag, last_modified: lastModified,
    body_hash: buf.length ? await sha256Hex(buf) : null, final_host: finalUrl.hostname, redirects, info, warnings,
  };
}

/** Dau van tay noi dung: URL dan + loai + ETag/do dai/Last-Modified (+ hash 64 KB dau voi HLS/DASH hoac khi may chu khong tra validator). */
export async function streamBinding(url: string, p: Pick<StreamProbe, 'kind' | 'etag' | 'content_length' | 'last_modified' | 'body_hash'>): Promise<string> {
  const weak = (p.kind === 'mp4' || p.kind === 'webm') && !p.etag && !p.last_modified;
  const useHash = p.kind === 'hls' || p.kind === 'dash' || weak;
  return sha256Hex(JSON.stringify(['stream', url, p.kind, p.etag, p.content_length, p.last_modified, useHash ? p.body_hash : null]));
}

export const WARNING_TEXT: Record<string, string> = {
  not_mp4_signature: 'Đầu tệp không giống MP4 (thiếu ftyp) — kiểm tra kỹ khi xem trước.',
  not_webm_signature: 'Đầu tệp không giống WebM — kiểm tra kỹ khi xem trước.',
  metadata_not_in_first_64kb: 'Không đọc được thông tin video trong 64 KB đầu (metadata ở cuối tệp): TV có thể bắt đầu phát chậm hơn.',
  hls_live_or_incomplete: 'Playlist HLS không có #EXT-X-ENDLIST (luồng trực tiếp hoặc chưa hoàn tất): thời lượng không cố định.',
  dash_live: 'Manifest DASH là luồng trực tiếp (dynamic): thời lượng không cố định.',
  weak_validators: 'Máy chủ không trả ETag/Last-Modified: việc phát hiện thay đổi dựa trên 64 KB đầu của tệp, kém tin cậy hơn.',
};
export function warningText(code: string): string {
  if (code.startsWith('codec_unusual:')) return `Codec ${code.slice(14)} không thuộc nhóm H.264/HEVC/AV1/VP9, một số TV box có thể không phát được (chỉ cảnh báo).`;
  if (code.startsWith('http_')) return `Máy chủ trả mã lỗi HTTP ${code.slice(5)}.`;
  if (code.startsWith('duration_mismatch:')) return `Thời lượng khai báo lệch so với video (${code.slice(18)}).`;
  return WARNING_TEXT[code] ?? code;
}
