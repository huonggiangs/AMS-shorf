// Kiem tra creative tren Cloudflare (khong co ClamAV/ffmpeg). KHONG PHAI quet virus: xem docs/CLOUDFLARE-MEDIA-LIMITS.md.
// 'clean' CHI cho tep nam trong danh sach cho phep hep (png/jpg/webp/mp4) va qua moi kiem tra cau truc; moi truong hop khac
// -> 'needs_manual_review' (admin duyet/tu choi, co audit). Cong quet (chi creative 'clean' moi duoc phat) khong doi.
import type { Runtime } from '@ams/runtime';
import { sha256Hex } from '@ams/shared';

export const CF_VALIDATOR_ENGINE = 'cf-validator-v1';
export const MEDIA_TOPIC = 'media.uploaded';
export type CfKind = 'png' | 'jpeg' | 'webp' | 'mp4';

const MB = 1024 * 1024;
export interface CfLimits {
  /** tran doc tep vao bo nho Worker (R2 get doc ca tep; Worker 128 MB). Tep lon hon => manual review, khong doc. */
  maxReadBytes: number;
  maxImageBytes: number;
  maxVideoBytes: number;
  /** trần so diem anh (chong "bom giai nen") */
  maxPixels: number;
  maxDim: number;
}
export const DEFAULT_LIMITS: CfLimits = { maxReadBytes: 48 * MB, maxImageBytes: 25 * MB, maxVideoBytes: 48 * MB, maxPixels: 36_000_000, maxDim: 8192 };

export interface Declared {
  mime: string | null;
  sizeBytes: number | null;
  w: number | null;
  h: number | null;
  durationS: number | null;
  /** [min,max] giay theo loai man hinh (null = khong rang buoc) */
  durationRange?: [number, number] | null;
}
export interface Facts { kind?: CfKind; w?: number; h?: number; durationS?: number; sha256?: string; size: number }
export interface Verdict { clean: boolean; reasons: string[]; facts: Facts }

const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number): string => String.fromCharCode(...b.subarray(o, o + n));
const MIME_OF: Record<CfKind, string[]> = { png: ['image/png'], jpeg: ['image/jpeg'], webp: ['image/webp'], mp4: ['video/mp4'] };

export function sniffCf(b: Uint8Array): CfKind | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') return 'mp4';
  return null;
}

type Px = { w: number; h: number };

/** PNG: chuoi chunk hop le tu IHDR toi IEND, IEND la byte cuoi (khong du lieu thua: da gap polyglot). */
function checkPng(b: Uint8Array, why: string[]): Px | null {
  if (b.length < 33 || ascii(b, 12, 4) !== 'IHDR' || u32(b, 8) !== 13) {
    why.push('png_ihdr_invalid');
    return null;
  }
  const px = { w: u32(b, 16), h: u32(b, 20) };
  let o = 8;
  let end = false;
  while (o + 12 <= b.length) {
    const len = u32(b, o);
    const type = ascii(b, o + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type) || o + 12 + len > b.length) {
      why.push('png_chunk_overrun');
      return px;
    }
    o += 12 + len;
    if (type === 'IEND') {
      end = true;
      break;
    }
  }
  if (!end) why.push('png_no_iend');
  else if (o !== b.length) why.push('png_trailing_data');
  return px;
}

/** JPEG: doc SOFn lay kich thuoc, bat buoc ket thuc FFD9 (cho phep 0x00 dem cuoi). */
function checkJpeg(b: Uint8Array, why: string[]): Px | null {
  let px: Px | null = null;
  let i = 2;
  while (i + 4 <= b.length && !px) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1]!;
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 <= b.length) px = { h: (b[i + 5]! << 8) | b[i + 6]!, w: (b[i + 7]! << 8) | b[i + 8]! };
      break;
    }
    if (m === 0xda) break; // bat dau du lieu quet ma khong thay SOF
    i += 2 + len;
  }
  if (!px) why.push('jpeg_no_sof');
  let e = b.length;
  while (e > 2 && b[e - 1] === 0) e--;
  if (!(b[e - 2] === 0xff && b[e - 1] === 0xd9)) why.push('jpeg_no_eoi');
  return px;
}

/** WebP: RIFF size khop kich thuoc tep; doc kich thuoc tu VP8 / VP8L / VP8X. */
function checkWebp(b: Uint8Array, why: string[]): Px | null {
  const riff = b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! * 2 ** 24);
  if (riff + 8 !== b.length) why.push('webp_riff_size_mismatch');
  const t = ascii(b, 12, 4);
  const le24 = (o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
  if (t === 'VP8X' && b.length >= 30) return { w: le24(24) + 1, h: le24(27) + 1 };
  if (t === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! * 2 ** 24);
    return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
  }
  if (t === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { w: (b[26]! | (b[27]! << 8)) & 0x3fff, h: (b[28]! | (b[29]! << 8)) & 0x3fff };
  why.push('webp_header_invalid');
  return null;
}

const BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash', 'cmfc']);
interface Box { type: string; start: number; end: number; hdr: number }
function boxes(b: Uint8Array, from: number, to: number, why: string[], top: boolean): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o < to) {
    if (o + 8 > to) {
      why.push(top ? 'mp4_trailing_bytes' : 'mp4_box_truncated');
      break;
    }
    let size = u32(b, o);
    const type = ascii(b, o + 4, 4);
    let hdr = 8;
    if (size === 1) {
      if (o + 16 > to || u32(b, o + 8) !== 0) {
        why.push('mp4_box_too_large');
        break;
      }
      size = u32(b, o + 12);
      hdr = 16;
    } else if (size === 0) size = to - o;
    if (size < hdr || o + size > to) {
      why.push('mp4_box_overrun');
      break;
    }
    out.push({ type, start: o, end: o + size, hdr });
    o += size;
  }
  return out;
}

/** MP4: ftyp dau tep voi brand cho phep, chuoi box ccap cao khop dung cuoi tep, co moov + mdat; doc thoi luong (mvhd) va kich thuoc (tkhd). */
function checkMp4(b: Uint8Array, why: string[]): { px: Px | null; durationS: number | null } {
  const top = boxes(b, 0, b.length, why, true);
  const ftyp = top[0];
  if (!ftyp || ftyp.type !== 'ftyp' || ftyp.end - ftyp.start < 16) {
    why.push('mp4_ftyp_missing');
    return { px: null, durationS: null };
  }
  const brand = ascii(b, ftyp.start + 8, 4);
  if (!BRANDS.has(brand)) why.push(`mp4_brand_not_allowed:${brand.trim()}`);
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) why.push('mp4_no_moov');
  if (!top.some((x) => x.type === 'mdat')) why.push('mp4_no_mdat');
  let px: Px | null = null;
  let durationS: number | null = null;
  if (moov) {
    const kids = boxes(b, moov.start + moov.hdr, moov.end, why, false);
    const mvhd = kids.find((x) => x.type === 'mvhd');
    if (mvhd) {
      const p = mvhd.start + mvhd.hdr;
      const ver = b[p]!;
      const ts = ver === 1 ? u32(b, p + 20) : u32(b, p + 12);
      const dur = ver === 1 ? u32(b, p + 24) * 2 ** 32 + u32(b, p + 28) : u32(b, p + 16);
      if (ts > 0) durationS = dur / ts;
    } else why.push('mp4_no_mvhd');
    for (const trak of kids.filter((x) => x.type === 'trak')) {
      const tk = boxes(b, trak.start + trak.hdr, trak.end, why, false).find((x) => x.type === 'tkhd');
      if (!tk) continue;
      const p = tk.start + tk.hdr;
      const o = b[p] === 1 ? p + 88 : p + 76;
      if (o + 8 <= b.length) {
        const w = u32(b, o) >>> 16;
        const h = u32(b, o + 4) >>> 16;
        if (w > 0 && h > 0) {
          px = { w, h };
          break;
        }
      }
    }
    if (!px) why.push('mp4_no_video_track');
  }
  return { px, durationS };
}

export async function validateCreativeBytes(bytes: Uint8Array, d: Declared, limits: CfLimits = DEFAULT_LIMITS): Promise<Verdict> {
  const why: string[] = [];
  const facts: Facts = { size: bytes.length };
  const kind = sniffCf(bytes);
  if (!kind) return { clean: false, reasons: ['type_not_in_allowlist'], facts };
  facts.kind = kind;
  if (d.mime && !MIME_OF[kind].includes(d.mime.toLowerCase().split(';')[0]!.trim())) why.push(`mime_mismatch:${d.mime}`);
  if (d.sizeBytes !== null && d.sizeBytes !== bytes.length) why.push('size_mismatch');
  const isImg = kind !== 'mp4';
  if (bytes.length > (isImg ? limits.maxImageBytes : limits.maxVideoBytes)) why.push('size_over_inline_limit');
  let px: Px | null = null;
  if (kind === 'png') px = checkPng(bytes, why);
  else if (kind === 'jpeg') px = checkJpeg(bytes, why);
  else if (kind === 'webp') px = checkWebp(bytes, why);
  else {
    const r = checkMp4(bytes, why);
    px = r.px;
    if (r.durationS !== null) {
      facts.durationS = Math.round(r.durationS * 100) / 100;
      if (!(r.durationS > 0)) why.push('mp4_zero_duration');
      if (d.durationS !== null && Math.abs(r.durationS - d.durationS) > 1.5) why.push('duration_mismatch');
      if (d.durationRange && (r.durationS < d.durationRange[0] - 0.5 || r.durationS > d.durationRange[1] + 0.5)) why.push('duration_out_of_range');
    }
  }
  if (px) {
    facts.w = px.w;
    facts.h = px.h;
    if (px.w < 1 || px.h < 1 || px.w > limits.maxDim || px.h > limits.maxDim || px.w * px.h > limits.maxPixels) why.push('dimensions_out_of_range');
    if (d.w && d.h && (px.w !== Number(d.w) || px.h !== Number(d.h))) why.push(`dimensions_mismatch:${px.w}x${px.h}!=${d.w}x${d.h}`);
  }
  facts.sha256 = await sha256Hex(bytes);
  return { clean: why.length === 0, reasons: why, facts };
}

interface Row {
  id: string; target_type: string | null; px_w: number | null; px_h: number | null; source: string; storage_key: string | null;
  mime: string | null; size_bytes: number | null; duration_s: number | null; scan_state: string; state: string;
}
const DURATION: Record<string, [number, number]> = { elevator: [10, 30], led_p5: [5, 15] };

export interface CfValidatorOptions {
  limits?: Partial<CfLimits>;
  /** false: khong bao gio ghi 'clean' (moi tep vao hang cho duyet tay). Mac dinh true. env CF_VALIDATOR_MARK_CLEAN=0 de tat. */
  markClean?: boolean;
  log?: (m: string) => void;
}
export type CfOutcome = { outcome: 'clean' | 'needs_manual_review' | 'skipped' | 'deferred'; reasons?: string[]; reason?: string };

export function createCfCreativeValidator(rt: Runtime, opts: CfValidatorOptions = {}) {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const markClean = opts.markClean ?? rt.config.env['CF_VALIDATOR_MARK_CLEAN'] !== '0';
  const log = opts.log ?? (() => {});

  async function finish(row: Row, state: 'clean' | 'needs_manual_review', v: { reasons: string[]; facts: Partial<Facts> }): Promise<CfOutcome> {
    const detail = JSON.stringify({ reasons: v.reasons, kind: v.facts.kind ?? null, size: v.facts.size ?? null, w: v.facts.w ?? null, h: v.facts.h ?? null, duration_s: v.facts.durationS ?? null, mark_clean: markClean });
    const now = rt.clock.now().toISOString();
    // chi ghi khi van 'pending' va da xac nhan (khong de de len ket qua cua media-worker VPS / admin)
    const res = await rt.db.run(
      `UPDATE creatives SET scan_state = ?, sha256 = COALESCE(?, sha256), px_w = COALESCE(px_w, ?), px_h = COALESCE(px_h, ?), duration_s = COALESCE(duration_s, ?)
       WHERE id = ? AND scan_state = 'pending' AND state <> 'uploading'`,
      [state, v.facts.sha256 ?? null, v.facts.w ?? null, v.facts.h ?? null, v.facts.durationS === undefined ? null : Math.round(v.facts.durationS), row.id],
    );
    if (res.changes === 0) return { outcome: 'skipped', reason: 'da duoc xu ly noi khac' };
    await rt.db.run(
      `INSERT INTO creative_validation (creative_id, engine, verdict, detail, sha256, checked_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT (creative_id) DO UPDATE SET engine = excluded.engine, verdict = excluded.verdict, detail = excluded.detail, sha256 = excluded.sha256, checked_at = excluded.checked_at`,
      [row.id, CF_VALIDATOR_ENGINE, state, detail, v.facts.sha256 ?? null, now],
    );
    log(`[cf-validate] ${row.id}: ${state}${v.reasons.length ? ' (' + v.reasons.join(',') + ')' : ''}`);
    return { outcome: state, reasons: v.reasons };
  }

  async function process(id: string): Promise<CfOutcome> {
    const row = (await rt.db.query<Row>('SELECT id, target_type, px_w, px_h, source, storage_key, mime, size_bytes, duration_s, scan_state, state FROM creatives WHERE id = ?', [id]))[0];
    if (!row) return { outcome: 'skipped', reason: 'khong co creative' };
    if (row.scan_state !== 'pending') return { outcome: 'skipped', reason: `scan_state=${row.scan_state}` };
    if (row.source !== 'upload' || !row.storage_key) return { outcome: 'skipped', reason: 'nguon link: khong tai ve duoc tren Cloudflare' };
    if (row.state === 'uploading') return { outcome: 'deferred', reason: 'chua confirm' };
    const head = await rt.objects.head(row.storage_key);
    if (!head) return { outcome: 'deferred', reason: 'chua thay tep tren kho' };
    if (head.size > limits.maxReadBytes) return finish(row, 'needs_manual_review', { reasons: ['too_large_to_read_inline'], facts: { size: head.size } });
    const bytes = await rt.objects.get(row.storage_key);
    if (!bytes) return { outcome: 'deferred', reason: 'khong doc duoc tep' };
    const v = await validateCreativeBytes(
      bytes,
      { mime: row.mime, sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes), w: row.px_w, h: row.px_h, durationS: row.duration_s === null ? null : Number(row.duration_s), durationRange: row.target_type ? DURATION[row.target_type] ?? null : null },
      limits,
    );
    if (v.clean && !markClean) return finish(row, 'needs_manual_review', { reasons: ['mark_clean_disabled'], facts: v.facts });
    return finish(row, v.clean ? 'clean' : 'needs_manual_review', v);
  }

  /** Tim creative dang 'pending' (mat tin nhan / cron). */
  async function sweep(limit = 10): Promise<number> {
    const rows = await rt.db.query<{ id: string }>(
      "SELECT id FROM creatives WHERE scan_state = 'pending' AND source = 'upload' AND storage_key IS NOT NULL AND state NOT IN ('uploading','invalid') ORDER BY created_at LIMIT ?",
      [limit],
    );
    let n = 0;
    for (const r of rows) {
      try {
        const o = await process(r.id);
        if (o.outcome === 'clean' || o.outcome === 'needs_manual_review') n++;
      } catch (e) {
        log(`[cf-validate] loi ${r.id}: ${(e as Error).message}`);
      }
    }
    return n;
  }

  return {
    process,
    sweep,
    subscribe() {
      rt.queue.subscribe(MEDIA_TOPIC, async (m) => {
        const id = (m as { creative_id?: string } | null)?.creative_id;
        if (typeof id !== 'string') return;
        const o = await process(id);
        if (o.outcome === 'deferred') throw new Error(`creative ${id} chua san sang: ${o.reason}`); // queue thu lai
      });
    },
  };
}
