// Media worker: nhan creative da tai len -> kiem loai/kich thuoc/magic bytes -> ffprobe -> chuyen ma -> cap nhat creatives (khong quet virus: anh/video chuan khong chua ma thuc thi; kiem tra cau truc + chuyen ma lam sach tep).
import type { Runtime } from '@ams/runtime';
import { sha256Hex } from '@ams/shared';
import { FfmpegTools, type MediaTools, type ProbeResult, type TargetKind } from './media.js';
import { mimeMatches, sniff } from './sniff.js';

export const MEDIA_TOPIC = 'media.uploaded';
export interface MediaMessage { creative_id: string }

/** Gia tri creatives.scan_state do worker ghi. 'clean' = qua kiem tra cau truc; 'unscanned' = tep bi tu choi truoc khi kiem tra xong; 'infected' chi con o du lieu cu. */
export type ScanState = 'pending' | 'clean' | 'infected' | 'unscanned';

export type Outcome = 'processed' | 'rejected' | 'skipped' | 'deferred';
export interface Result { outcome: Outcome; scan_state?: ScanState; reason?: string; code?: string }

interface Row {
  id: string; customer_id: string; uploader_kind: string | null; name: string | null; target_type: string | null; px_w: number | null; px_h: number | null;
  source: string; storage_key: string | null; mime: string | null; size_bytes: number | null; duration_s: number | null;
  scan_state: string; state: string; review_state: string;
}

export interface WorkerOptions {
  media?: MediaTools;
  transcode?: boolean;      // MEDIA_TRANSCODE (mac dinh true)
  maxBytes?: number;        // tran cung bo nho (ObjectStore.get doc ca tep)
  log?: (m: string) => void;
}

const MB = 1024 * 1024;
const SIZE_LIMIT_MB: Record<TargetKind, number> = { tv: 500, elevator: 30, led_p5: 50 };
/** Thang may 2K/4K (rong > 1080): tran 100 MB (cung services/api/src/lib/creative.ts ELEVATOR_HIRES_LIMIT_MB) */
const ELEVATOR_HIRES_LIMIT_MB = 100;
/** Video thang may (HD-4K): tran 200 MB tu 20/11/2026 (cung services/api/src/lib/creative.ts ELEVATOR_VIDEO_LIMIT_MB); video TV/LED toi da 100 MB */
const ELEVATOR_VIDEO_LIMIT_MB = 200;
const VIDEO_LIMIT_MB = 100;
const DURATION: Partial<Record<TargetKind, [number, number]>> = { elevator: [10, 30], led_p5: [5, 15] };
const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', mp4: 'mp4', webm: 'webm' };
const tk = (t: string | null): TargetKind | null => (t === 'tv' || t === 'elevator' || t === 'led_p5' ? t : t === 'led' ? 'led_p5' : null);

export function optionsFromEnv(env: Record<string, string | undefined>): WorkerOptions {
  return {
    media: new FfmpegTools({ threads: Number(env['MEDIA_FFMPEG_THREADS'] ?? 2), timeoutMs: Number(env['MEDIA_FFMPEG_TIMEOUT_MS'] ?? 600_000) }),
    transcode: env['MEDIA_TRANSCODE'] !== '0',
    maxBytes: Number(env['MEDIA_MAX_BYTES'] ?? 512 * MB),
  };
}

export function createMediaWorker(rt: Runtime, opts: WorkerOptions = {}) {
  const media = opts.media ?? new FfmpegTools();
  const log = opts.log ?? (() => {});
  const maxBytes = opts.maxBytes ?? 512 * MB;
  const stats = { processed: 0, rejected: 0, skipped: 0, deferred: 0, errors: 0 };

  /** Tu choi: chi khi con 'pending' (dieu kien trong SQL). */
  async function reject(row: Row, code: string, message: string, extra: { sha?: string | null; scan: ScanState }): Promise<Result> {
    const r = await rt.db.run(
      "UPDATE creatives SET scan_state = ?, sha256 = COALESCE(?, sha256), review_state = 'rejected', review_note = ?, state = 'invalid' WHERE id = ? AND scan_state = 'pending' AND state <> 'uploading'",
      [extra.scan, extra.sha ?? null, message, row.id],
    );
    if (r.changes === 0) return { outcome: 'skipped', reason: 'da duoc xu ly noi khac' };
    log(`[media-worker] ${row.id} tu choi: ${code}`);
    return { outcome: 'rejected', scan_state: extra.scan, code, reason: message };
  }

  async function process(id: string): Promise<Result> {
    const row = (await rt.db.query<Row>('SELECT id, customer_id, uploader_kind, name, target_type, px_w, px_h, source, storage_key, mime, size_bytes, duration_s, scan_state, state, review_state FROM creatives WHERE id = ?', [id]))[0];
    if (!row) return done({ outcome: 'skipped', reason: 'khong co creative' });
    if (row.scan_state !== 'pending') return done({ outcome: 'skipped', reason: `scan_state=${row.scan_state}` });
    if (row.source !== 'upload' || !row.storage_key) return done({ outcome: 'skipped', reason: 'nguon link: chua tai ve (xem requests.md)' });
    if (row.state === 'uploading') return done({ outcome: 'deferred', reason: 'chua confirm' });

    // khoa mem tren KV de hai instance khong lam cung mot tep; ghi cuoi cung van la UPDATE co dieu kien.
    if ((await rt.kv.incr(`media:lock:${id}`, 900)) > 1) return done({ outcome: 'deferred', reason: 'dang xu ly' });
    try {
      return done(await run(row));
    } finally {
      await rt.kv.del(`media:lock:${id}`);
    }
  }

  function done(r: Result): Result {
    stats[r.outcome === 'processed' ? 'processed' : r.outcome === 'rejected' ? 'rejected' : r.outcome === 'skipped' ? 'skipped' : 'deferred']++;
    return r;
  }

  async function run(row: Row): Promise<Result> {
    const key = row.storage_key!;
    const head = await rt.objects.head(key);
    if (!head) return { outcome: 'deferred', reason: 'chua thay tep tren kho' };
    if (row.uploader_kind === 'internal') return runLibrary(row, head.size);
    const target = tk(row.target_type);
    const hires = target === 'elevator' && Number(row.px_w ?? 0) > 1080;
    const isVideo = (row.mime ?? '').toLowerCase().startsWith('video/');
    const typeMb = hires ? ELEVATOR_HIRES_LIMIT_MB : target ? SIZE_LIMIT_MB[target] : SIZE_LIMIT_MB.tv;
    const capMb = isVideo ? (target === 'elevator' ? ELEVATOR_VIDEO_LIMIT_MB : Math.min(typeMb, VIDEO_LIMIT_MB)) : typeMb;
    const limit = Math.min(maxBytes, capMb * MB);
    if (head.size > limit) return reject(row, 'file_too_large', `Tệp ${(head.size / MB).toFixed(1)} MB vượt giới hạn ${Math.floor(limit / MB)} MB.`, { scan: 'unscanned' });
    const bytes = await rt.objects.get(key);
    if (!bytes) return { outcome: 'deferred', reason: 'khong doc duoc tep' };

    const kind = sniff(bytes);
    if (!kind) return reject(row, 'unsupported_type', 'Định dạng tệp không được hỗ trợ (chỉ MP4 H.264, WebM, PNG, JPG).', { scan: 'unscanned' });
    if (row.mime && !mimeMatches(row.mime, kind)) return reject(row, 'content_type_mismatch', `Nội dung tệp (${kind}) không khớp loại đã khai báo (${row.mime}).`, { scan: 'unscanned' });
    const sha = await sha256Hex(bytes);

    const scan: ScanState = 'clean';

    let probe: ProbeResult | null = null;
    const haveMedia = await media.available();
    if (haveMedia) {
      try {
        probe = await media.probe(bytes, EXT[kind]!);
      } catch (e) {
        return reject(row, 'unreadable_media', 'Không đọc được tệp (hỏng hoặc không phải phương tiện hợp lệ).', { sha, scan });
      }
      if ((probe.kind === 'video') !== (kind === 'webm' || kind === 'mp4')) {
        return reject(row, 'content_type_mismatch', 'Loại nội dung không khớp.', { sha, scan });
      }
      if (row.px_w && row.px_h && (probe.width !== Number(row.px_w) || probe.height !== Number(row.px_h))) {
        return reject(row, 'creative_size_mismatch', `Kích thước thật ${probe.width}×${probe.height} khác khai báo ${row.px_w}×${row.px_h}.`, { sha, scan });
      }
      const range = target ? DURATION[target] : undefined;
      if (range && probe.kind === 'video' && probe.durationS !== null && (probe.durationS < range[0] - 0.5 || probe.durationS > range[1] + 0.5)) {
        return reject(row, 'duration_out_of_range', `Thời lượng phải từ ${range[0]} đến ${range[1]} giây, tệp dài ${Math.round(probe.durationS)} giây.`, { sha, scan });
      }
      if (target === 'led_p5' && probe.kind === 'video' && probe.hasAudio) log(`[media-worker] ${row.id}: LED khong am thanh -> bo am thanh khi chuyen ma`);
    }

    // Chuyen ma (khong phat nguyen tep: THREAT-MODEL T). Loi chuyen ma khong lam hong creative goc; bo qua, ghi log.
    const renditions: { profile: string; key: string; content_type: string; width: number; height: number; codec: string; size: number; sha256: string }[] = [];
    if (probe && opts.transcode !== false) {
      try {
        const base = `renditions/${row.customer_id}/${row.id}`;
        for (const r of await media.transcode(bytes, EXT[kind]!, probe, target ?? 'tv')) {
          const k = `${base}/${r.profile}.${r.ext}`;
          await rt.objects.put(k, r.body, r.contentType);
          renditions.push({ profile: r.profile, key: k, content_type: r.contentType, width: r.width, height: r.height, codec: r.codec, size: r.body.length, sha256: await sha256Hex(r.body) });
        }
        const manifest = { creative_id: row.id, source_sha256: sha, probe, renditions, created_at: rt.clock.now().toISOString() };
        await rt.objects.put(`${base}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest)), 'application/json');
      } catch (e) {
        stats.errors++;
        log(`[media-worker] ${row.id}: chuyen ma that bai: ${(e as Error).message}`);
      }
    }

    const res = await rt.db.run(
      `UPDATE creatives SET scan_state = ?, sha256 = ?, codec = COALESCE(?, codec), duration_s = COALESCE(?, duration_s),
         px_w = COALESCE(px_w, ?), px_h = COALESCE(px_h, ?), size_bytes = ?
       WHERE id = ? AND scan_state = 'pending' AND state <> 'uploading'`,
      [scan, sha, probe?.codec ?? null, probe?.durationS == null ? null : Math.round(probe.durationS), probe?.width ?? null, probe?.height ?? null, head.size, row.id],
    );
    if (res.changes === 0) return { outcome: 'skipped', reason: 'da duoc xu ly noi khac' };
    return { outcome: 'processed', scan_state: scan };
  }


  /** Kho chung (tai len noi bo): nhan moi dinh dang/codec, KHONG rang buoc loai man/thoi luong; video khong phai MP4 H.264 duoc chuyen sang MP4 H.264/AAC va THAY tep goc. */
  async function runLibrary(row: Row, size: number): Promise<Result> {
    const key = row.storage_key!;
    const manual = async (why: string): Promise<Result> => {
      const r = await rt.db.run("UPDATE creatives SET scan_state = 'needs_manual_review', review_note = ? WHERE id = ? AND scan_state = 'pending' AND state <> 'uploading'", [why, row.id]);
      return r.changes === 0 ? { outcome: 'skipped', reason: 'da duoc xu ly noi khac' } : { outcome: 'processed', scan_state: 'unscanned', reason: why };
    };
    const isVideo = (row.mime ?? '').toLowerCase().startsWith('video/');
    if (!(await media.available())) return manual('Cần media-worker (ffmpeg) để kiểm tra/chuyển mã tệp này; duyệt thủ công nếu thiết bị phát được.');
    if (size > maxBytes) return manual(`Tệp ${(size / MB).toFixed(0)} MB quá lớn để chuyển mã tự động (giới hạn ${Math.floor(maxBytes / MB)} MB bộ nhớ worker): duyệt thủ công hoặc nén lại.`);
    const bytes = await rt.objects.get(key);
    if (!bytes) return { outcome: 'deferred', reason: 'khong doc duoc tep' };
    const ext = (key.split('.').pop() ?? (isVideo ? 'mp4' : 'png')).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const sha = await sha256Hex(bytes);
    let probe: ProbeResult;
    try {
      probe = await media.probe(bytes, ext);
    } catch {
      return reject(row, 'unreadable_media', 'Không đọc được tệp (hỏng hoặc định dạng không được ffmpeg hỗ trợ).', { sha, scan: 'unscanned' });
    }
    let finalSha = sha;
    let finalKey = key;
    let finalSize = size;
    let mime: string | null = null;
    let codec = probe.codec;
    let w = probe.width;
    let h = probe.height;
    let dur = probe.durationS;
    const playable = probe.kind === 'video' && probe.codec === 'h264' && (ext === 'mp4' || ext === 'm4v' || ext === 'mov');
    if (probe.kind === 'video' && !playable && opts.transcode !== false) {
      try {
        const r = await media.toPlayableMp4(bytes, ext, probe);
        finalKey = `media/${row.customer_id}/${row.id}/v1-playable.mp4`;
        await rt.objects.put(finalKey, r.body, 'video/mp4');
        finalSha = await sha256Hex(r.body);
        finalSize = r.body.length;
        mime = 'video/mp4';
        codec = r.codec;
        w = r.width;
        h = r.height;
        if (finalKey !== key) { try { await rt.objects.delete?.(key); } catch { /* khoa goc mo coi: khong anh huong */ } }
        log(`[media-worker] ${row.id}: kho chung chuyen ma ${probe.codec}/${ext} -> h264 mp4`);
      } catch (e) {
        stats.errors++;
        return manual(`Chuyển mã tự động thất bại (${(e as Error).message.slice(0, 120)}): duyệt thủ công hoặc tải lại bằng MP4 H.264.`);
      }
    }
    const res = await rt.db.run(
      `UPDATE creatives SET scan_state = 'clean', sha256 = ?, codec = COALESCE(?, codec), duration_s = COALESCE(?, duration_s), px_w = ?, px_h = ?, orientation = ?,
         size_bytes = ?, storage_key = ?, mime = COALESCE(?, mime), kind = ?, source = 'upload'
       WHERE id = ? AND scan_state = 'pending' AND state <> 'uploading'`,
      [finalSha, codec, dur == null ? null : Math.round(dur), w, h, w >= h ? 'landscape' : 'portrait', finalSize, finalKey, mime, probe.kind, row.id],
    );
    if (res.changes === 0) return { outcome: 'skipped', reason: 'da duoc xu ly noi khac' };
    return { outcome: 'processed', scan_state: 'clean' };
  }

  /** Quet DB tim creative con 'pending' (phong khi mat tin nhan). */
  async function sweep(limit = 20): Promise<number> {
    const rows = await rt.db.query<{ id: string }>(
      "SELECT id FROM creatives WHERE scan_state = 'pending' AND source = 'upload' AND storage_key IS NOT NULL AND state NOT IN ('uploading','invalid') ORDER BY created_at LIMIT ?",
      [limit],
    );
    let n = 0;
    for (const r of rows) {
      try {
        if ((await process(r.id)).outcome === 'processed') n++;
      } catch (e) {
        stats.errors++;
        log(`[media-worker] loi ${r.id}: ${(e as Error).message}`);
      }
    }
    return n;
  }

  return {
    stats,
    process,
    sweep,
    subscribe() {
      rt.queue.subscribe(MEDIA_TOPIC, async (m) => {
        const id = (m as MediaMessage)?.creative_id;
        if (typeof id === 'string') await process(id);
      });
    },
  };
}
export type MediaWorker = ReturnType<typeof createMediaWorker>;
