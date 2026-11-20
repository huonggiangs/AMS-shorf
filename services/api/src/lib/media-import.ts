// Nhap tep tu lien ket (Google Drive cong khai, Dropbox, URL truc tiep) NGAY TREN WORKER: tai ve -> R2 multipart (phan 32 MiB, khong nap ca tep vao bo nho)
// -> luong xac nhan chung voi tai len (finalizeUpload: doc header MP4, kiem spec, outbox quet, tu duyet).
// Chay trong Queue consumer (chu de `media.import`, outbox -> JOBS_QUEUE): thoi gian dai hon waitUntil; co ngan sach thoi gian, TIEP TUC bang Range sau khi mat ket noi.
// Bao ve SSRF: chi https, ten mien thuoc allowlist (Drive: drive.google.com, drive.usercontent.google.com, docs.google.com, *.googleusercontent.com), khong IP/ten noi bo,
// chuyen huong duoc xu ly THU CONG va moi buoc deu kiem lai allowlist. URL truc tiep (ten mien bat ky) chi bat tren Cloudflare (Worker khong cham duoc mang noi bo).
import type { Runtime } from '@ams/runtime';
import { HttpError } from './errors.js';
import { writeAudit } from './audit.js';
import { MB, MULTIPART_MAX_PART_BYTES, VIDEO_RULES, multipartPartSize } from './creative.js';
import { enqueueMediaImport, TOPIC_MEDIA_IMPORT } from '../outbox.js';
import { finalizeUpload, loadMediaUnscoped, safeFileName } from '../routes/media.js';
import { getTransfer, partsOf, type TransferPart } from './transfers.js';
import type { FinancePort } from '../ports.js';

/** Tran khi tai ve: bang tran video lon nhat (thang may 200 MB); finalizeUpload kiem lai theo loai man sau khi doc header. */
export const IMPORT_MAX_BYTES = VIDEO_RULES.elevatorMaxBytes;
export const DRIVE_FAIL_MSG = 'Tệp Drive không chia sẻ công khai hoặc vượt hạn mức tải. Hãy đặt chia sẻ "Bất kỳ ai có đường liên kết" hoặc tải tệp lên trực tiếp.';
export const YOUTUBE_MSG = 'Chưa hỗ trợ tải từ YouTube. Hãy dùng tệp tải lên hoặc liên kết Google Drive.';
const UA = 'Mozilla/5.0 (compatible; AMS-MediaImport/1.0)';
const MAX_REDIRECTS = 5;
const MAX_ATTEMPTS = 3;

export class ImportError extends Error {
  constructor(public code: string, message: string, public retryable = false) {
    super(message);
    this.name = 'ImportError';
  }
}

// ----------------------------------------------------------------------------------------------- phan tich lien ket
const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
export function parseDriveId(raw: string): { id: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'Liên kết không hợp lệ.' };
  }
  const host = u.hostname.toLowerCase();
  if (host !== 'drive.google.com' && host !== 'docs.google.com' && host !== 'drive.usercontent.google.com') return { error: 'Liên kết phải thuộc drive.google.com.' };
  if (/\/drive\/(u\/\d+\/)?folders\//.test(u.pathname)) return { error: 'Đây là liên kết thư mục Drive. Hãy dán liên kết của một tệp video (Chia sẻ > Sao chép đường liên kết).' };
  const m = u.pathname.match(/\/file\/d\/([^/]+)/) ?? u.pathname.match(/\/d\/([^/]+)/);
  const id = m?.[1] ?? u.searchParams.get('id') ?? '';
  if (!DRIVE_ID.test(id)) return { error: 'Không nhận ra mã tệp trong liên kết Drive. Dạng đúng: https://drive.google.com/file/d/<mã>/view' };
  return { id };
}

export const driveDownloadUrl = (id: string): URL => new URL(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`);

const isDriveHost = (h: string) => h === 'drive.google.com' || h === 'docs.google.com' || h === 'drive.usercontent.google.com' || h === 'googleusercontent.com' || h.endsWith('.googleusercontent.com');
const isDropboxHost = (h: string) => h === 'dropbox.com' || h.endsWith('.dropbox.com') || h === 'dropboxusercontent.com' || h.endsWith('.dropboxusercontent.com');

/** Ten mien hop le de goi di (khong IP, khong ten noi bo). */
export function publicHost(h: string): boolean {
  const host = h.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return false;
  return true;
}

export interface ImportPlan {
  source: 'gdrive' | 'dropbox' | 'url';
  label: string;
  start: URL;
  allowHost: (host: string) => boolean;
  drive: boolean;
}

/** `anyHost`: cho phep URL truc tiep o ten mien bat ky (chi Cloudflare/test). */
export function planImport(source: string, rawUrl: string, anyHost: boolean): ImportPlan {
  if (source === 'youtube') throw new ImportError('youtube_unsupported', YOUTUBE_MSG);
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new ImportError('bad_media_url', 'Liên kết không hợp lệ.');
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !publicHost(u.hostname)) throw new ImportError('bad_media_url', 'Liên kết không hợp lệ hoặc không được phép.');
  if (source === 'gdrive' || source === 'drive') {
    const p = parseDriveId(rawUrl);
    if ('error' in p) throw new ImportError('bad_media_url', p.error);
    return { source: 'gdrive', label: 'Drive', start: driveDownloadUrl(p.id), allowHost: isDriveHost, drive: true };
  }
  if (source === 'dropbox') {
    if (!isDropboxHost(u.hostname.toLowerCase())) throw new ImportError('bad_media_url', 'Liên kết phải thuộc dropbox.com.');
    u.searchParams.delete('dl');
    u.searchParams.set('dl', '1');
    return { source: 'dropbox', label: 'Dropbox', start: u, allowHost: (h) => isDropboxHost(h), drive: false };
  }
  if (!anyHost) throw new ImportError('url_unsupported', 'Máy chủ này chỉ nhập từ Google Drive hoặc Dropbox. Hãy dùng liên kết Drive/Dropbox hoặc tải tệp lên.');
  return { source: 'url', label: 'liên kết', start: u, allowHost: (h) => publicHost(h), drive: false };
}

// ----------------------------------------------------------------------------------------------- tai (chuyen huong thu cong, kiem allowlist moi buoc)
type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

async function safeFetch(fetchFn: FetchFn, start: URL, init: RequestInit, allow: (h: string) => boolean): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !publicHost(url.hostname) || !allow(url.hostname.toLowerCase())) {
      throw new ImportError('redirect_blocked', 'Liên kết chuyển hướng tới địa chỉ không được phép nên đã bị chặn.');
    }
    const res = await fetchFn(url, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* bo qua */ }
      if (!loc) throw new ImportError('bad_response', 'Máy chủ nguồn trả về chuyển hướng không hợp lệ.', true);
      try {
        url = new URL(loc, url);
      } catch {
        throw new ImportError('redirect_blocked', 'Liên kết chuyển hướng không hợp lệ.');
      }
      continue;
    }
    return { res, url };
  }
  throw new ImportError('too_many_redirects', 'Liên kết chuyển hướng quá nhiều lần.');
}

const isHtml = (res: Response) => (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html');

/** Trang xac nhan "khong quet duoc virus" cua Drive (tep lon): lay form #download-form va gui lai. */
function parseDriveConfirm(html: string, base: URL): URL | null {
  const form = html.match(/<form[^>]*id="download-form"[^>]*>([\s\S]*?)<\/form>/i);
  if (!form) return null;
  const action = form[0].match(/action="([^"]+)"/i)?.[1]?.replace(/&amp;/g, '&');
  let u: URL;
  try {
    u = new URL(action ?? 'https://drive.usercontent.google.com/download', base);
  } catch {
    return null;
  }
  for (const m of form[1]!.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = m[0].match(/name="([^"]+)"/i)?.[1];
    const value = m[0].match(/value="([^"]*)"/i)?.[1] ?? '';
    if (name) u.searchParams.set(name, value.replace(/&amp;/g, '&'));
  }
  return u;
}

const cookiesOf = (res: Response): string => {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return list.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
};

function httpProblem(status: number, plan: ImportPlan): ImportError {
  if (plan.drive && (status === 401 || status === 403 || status === 429)) return new ImportError('drive_not_public', DRIVE_FAIL_MSG);
  if (plan.drive && status === 404) return new ImportError('source_not_found', 'Không tìm thấy tệp trên Drive. Kiểm tra lại liên kết.');
  if (status === 404 || status === 410) return new ImportError('source_not_found', 'Không tìm thấy tệp ở liên kết này (đã xóa hoặc sai đường dẫn).');
  if (status === 401 || status === 403) return new ImportError('source_forbidden', 'Nguồn từ chối truy cập tệp (không công khai).');
  if (status === 429 || status >= 500) return new ImportError('source_unavailable', `Máy chủ nguồn đang bận hoặc lỗi (${status}). Sẽ thử lại.`, true);
  return new ImportError('source_error', `Máy chủ nguồn trả về lỗi ${status}.`);
}

interface Opened {
  res: Response;
  /** vi tri byte dau tien cua res.body trong tep */
  offset: number;
  /** tong dung luong tep neu biet */
  total: number | null;
}

async function openSource(fetchFn: FetchFn, plan: ImportPlan, from: number, signal: AbortSignal | undefined): Promise<Opened> {
  const headers: Record<string, string> = { 'user-agent': UA, accept: '*/*' };
  if (from > 0) headers['range'] = `bytes=${from}-`;
  const init: RequestInit = { method: 'GET', headers, ...(signal ? { signal } : {}) };
  let { res, url } = await safeFetch(fetchFn, plan.start, init, plan.allowHost);
  if (plan.drive && isHtml(res) && res.ok) {
    const html = (await res.text()).slice(0, 600_000);
    const next = parseDriveConfirm(html, url);
    if (!next) throw new ImportError('drive_not_public', DRIVE_FAIL_MSG);
    const ck = cookiesOf(res);
    const r2 = await safeFetch(fetchFn, next, { ...init, headers: { ...headers, ...(ck ? { cookie: ck } : {}) } }, plan.allowHost);
    res = r2.res;
    url = r2.url;
    if (isHtml(res)) {
      try { await res.body?.cancel(); } catch { /* bo qua */ }
      throw new ImportError('drive_not_public', DRIVE_FAIL_MSG);
    }
  }
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* bo qua */ }
    throw httpProblem(res.status, plan);
  }
  if (isHtml(res)) {
    try { await res.body?.cancel(); } catch { /* bo qua */ }
    throw new ImportError(plan.drive ? 'drive_not_public' : 'not_media', plan.drive ? DRIVE_FAIL_MSG : 'Liên kết trả về trang web, không phải tệp video/ảnh.');
  }
  const len = Number(res.headers.get('content-length') ?? NaN);
  let offset = 0;
  let total: number | null = Number.isFinite(len) && len >= 0 ? len : null;
  if (res.status === 206) {
    const cr = res.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
    offset = cr ? Number(cr[1]) : -1;
    total = cr && cr[3] !== '*' ? Number(cr[3]) : null;
  }
  return { res, offset, total };
}

// ----------------------------------------------------------------------------------------------- nhan dang noi dung
export function sniffImportMime(b: Uint8Array): 'video/mp4' | 'image/png' | 'image/jpeg' | null {
  if (b.length >= 12 && String.fromCharCode(b[4]!, b[5]!, b[6]!, b[7]!) === 'ftyp') return 'video/mp4';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

function fileNameOf(res: Response): string | null {
  const cd = res.headers.get('content-disposition') ?? '';
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i)?.[1];
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  const raw = star ?? plain;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}

const EXT_OF: Record<string, string> = { 'video/mp4': 'mp4', 'image/png': 'png', 'image/jpeg': 'jpg' };

// ----------------------------------------------------------------------------------------------- bo nhap
export interface ImporterOptions {
  fetch?: FetchFn;
  finance?: () => Promise<FinancePort>;
  /** ngan sach thoi gian mot lan chay (ms); het gio -> dung, de cron/queue tiep tuc bang Range. Mac dinh 10 phut. */
  budgetMs?: number;
  /** cho phep URL truc tiep o ten mien bat ky (mac dinh: chi khi runtime khong phai docker/k8s) */
  anyHost?: boolean;
  log?: (m: string) => void;
}

/** requeued: loi tam thoi, cron dat lai sau >= 90 giay (lui dan); continue: het ngan sach thoi gian, tiep tuc NGAY o lan chay ke tiep */
export type ImportOutcome = 'done' | 'failed' | 'requeued' | 'continue' | 'skipped';

export function createMediaImporter(rt: Runtime, opts: ImporterOptions = {}) {
  const fetchFn: FetchFn = opts.fetch ?? ((i, init) => fetch(i as string, init));
  const budgetMs = opts.budgetMs ?? 600_000;
  const anyHost = opts.anyHost ?? (rt.config.runtime === 'cloudflare' || rt.config.runtime === 'test');
  const log = opts.log ?? ((m: string) => console.error(m));
  const ip = 'import-worker';

  async function fail(id: string, customerId: string, actorId: string | null, code: string, message: string, storageKey: string | null, creativeState: 'invalid' | null = 'invalid'): Promise<void> {
    const nowIso = rt.clock.now().toISOString();
    const t = await getTransfer(rt.db, id);
    if (t?.upload_id && storageKey) {
      try { await rt.objects.multipartAbort?.(storageKey, t.upload_id); } catch { /* khong chan */ }
    }
    await rt.db.tx(async (db) => {
      await db.run("UPDATE creative_transfers SET status = 'failed', error_code = ?, error_message = ?, upload_id = NULL, updated_at = ? WHERE creative_id = ?", [code, message, nowIso, id]);
      if (creativeState) await db.run("UPDATE creatives SET review_state = 'rejected', review_note = ?, state = ? WHERE id = ? AND state IN ('importing','invalid')", [message, creativeState, id]);
      await writeAudit(db, { rt, ip, actorId }, { action: 'media.import_failed', objectType: 'creative', objectId: id, customerId, diff: { code, message } });
    });
  }

  async function progress(id: string, parts: TransferPart[], total: number | null): Promise<void> {
    const done = parts.reduce((a, p) => a + p.size, 0);
    await rt.db.run('UPDATE creative_transfers SET parts = ?, bytes_done = ?, bytes_total = COALESCE(?, bytes_total), updated_at = ? WHERE creative_id = ?', [JSON.stringify(parts), done, total, rt.clock.now().toISOString(), id]);
  }

  /** Chay mot viec nhap. Khong nem loi (moi loi ghi vao creative_transfers). */
  async function run(id: string): Promise<ImportOutcome> {
    const started = rt.clock.now().getTime();
    const claimed = await rt.db.run("UPDATE creative_transfers SET status = 'running', attempts = attempts + 1, updated_at = ?, error_code = NULL, error_message = NULL WHERE creative_id = ? AND kind = 'import' AND status = 'queued'", [rt.clock.now().toISOString(), id]);
    if (claimed.changes === 0) return 'skipped'; // da chay/xong/loi: idempotent
    let m = await loadMediaUnscoped(rt, id);
    if (!m || m.state !== 'importing' || !m.source_url) {
      await rt.db.run("UPDATE creative_transfers SET status = 'failed', error_code = 'invalid_state', updated_at = ? WHERE creative_id = ?", [rt.clock.now().toISOString(), id]);
      return 'skipped';
    }
    let storageKey = m.storage_key;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), budgetMs + 60_000);
    try {
      const plan = planImport(m.source === 'gdrive' ? 'gdrive' : m.source, m.source_url, anyHost);
      let t = (await getTransfer(rt.db, id))!;
      const partSize = multipartPartSize(rt);
      let parts = partsOf(t.parts).sort((a, b) => a.n - b.n);
      let done = parts.reduce((a, p) => a + p.size, 0);
      let uploadId = t.upload_id;
      // TIEP TUC: da co phien multipart + phan -> xin Range tu byte `done`; nguon khong ho tro -> lam lai tu dau
      let opened = await openSource(fetchFn, plan, uploadId && done > 0 ? done : 0, ctl.signal);
      if (uploadId && done > 0 && opened.offset !== done) {
        try { await opened.res.body?.cancel(); } catch { /* bo qua */ }
        try { await rt.objects.multipartAbort?.(storageKey!, uploadId); } catch { /* khong chan */ }
        uploadId = null;
        parts = [];
        done = 0;
        opened = await openSource(fetchFn, plan, 0, ctl.signal);
      }
      if (opened.offset !== done) throw new ImportError('bad_response', 'Nguồn không trả đúng đoạn dữ liệu yêu cầu.', true);
      if (opened.total !== null && opened.total > IMPORT_MAX_BYTES) throw new ImportError('file_too_large', `Tệp ${(opened.total / MB).toFixed(1)} MB vượt giới hạn tải về ${IMPORT_MAX_BYTES / MB} MB. Hãy nén lại (H.264/H.265) rồi chia sẻ lại.`);
      const body = opened.res.body;
      if (!body) throw new ImportError('bad_response', 'Nguồn không trả nội dung.', true);

      const reader = body.getReader();
      const buf = new Uint8Array(Math.min(partSize, MULTIPART_MAX_PART_BYTES));
      let fill = 0;
      let mime = m.mime;
      let first = true;
      let outOfTime = false;
      const flush = async (): Promise<void> => {
        if (fill === 0) return;
        const n = parts.length + 1;
        const slice = buf.slice(0, fill); // sao chep: buf duoc dung lai o phan ke tiep
        const r = await rt.objects.multipartUploadPart!(storageKey!, uploadId!, n, slice, slice.length);
        parts.push({ n, etag: r.etag, size: slice.length });
        done += slice.length;
        fill = 0;
        await progress(id, parts, opened.total === null ? null : opened.total);
      };
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        let off = 0;
        while (off < value.length) {
          if (first) {
            // chi can ~12 byte dau de nhan dang; gom du truoc khi tao multipart
            const head = value.subarray(0, Math.min(value.length, 64));
            const sn = opened.offset === 0 ? sniffImportMime(head) : (m.mime as ReturnType<typeof sniffImportMime>);
            if (!sn) throw new ImportError('not_media', plan.drive ? DRIVE_FAIL_MSG : 'Tệp tải về không phải MP4, PNG hoặc JPG hợp lệ.');
            if (!uploadId) {
              mime = sn;
              const name = (m.name ?? '').startsWith('Tệp từ ') ? (fileNameOf(opened.res) ?? m.name) : m.name;
              const ext = EXT_OF[sn]!;
              const base = safeFileName(name ?? 'import');
              storageKey = `media/${m.customer_id}/${m.id}/${/\.(mp4|png|jpe?g)$/i.test(base) ? base : `${base}.${ext}`}`;
              uploadId = (await rt.objects.multipartCreate!(storageKey, sn)).uploadId;
              await rt.db.run('UPDATE creative_transfers SET upload_id = ?, part_size = ?, total_parts = ?, bytes_total = ?, updated_at = ? WHERE creative_id = ?', [uploadId, partSize, opened.total === null ? null : Math.ceil(opened.total / partSize), opened.total, rt.clock.now().toISOString(), id]);
              await rt.db.run("UPDATE creatives SET storage_key = ?, mime = ?, kind = ?, name = ? WHERE id = ? AND state = 'importing'", [storageKey, sn, sn.startsWith('video/') ? 'video' : 'image', name ?? m.name, id]);
            }
            first = false;
          }
          const take = Math.min(value.length - off, buf.length - fill);
          buf.set(value.subarray(off, off + take), fill);
          fill += take;
          off += take;
          if (done + fill > IMPORT_MAX_BYTES) throw new ImportError('file_too_large', `Tệp vượt giới hạn tải về ${IMPORT_MAX_BYTES / MB} MB. Hãy nén lại rồi chia sẻ lại.`);
          if (fill === buf.length) await flush();
        }
        if (rt.clock.now().getTime() - started > budgetMs && fill === 0) {
          outOfTime = true;
          break;
        }
      }
      if (outOfTime) {
        try { await reader.cancel(); } catch { /* bo qua */ }
        await rt.db.run("UPDATE creative_transfers SET status = 'queued', updated_at = ? WHERE creative_id = ?", [rt.clock.now().toISOString(), id]);
        return 'continue'; // tiep tuc bang Range o lan chay ke tiep
      }
      if (first || !uploadId) throw new ImportError('not_media', plan.drive ? DRIVE_FAIL_MSG : 'Nguồn trả về tệp rỗng.');
      await flush();
      const totalSize = done;
      if (opened.total !== null && totalSize !== opened.total) throw new ImportError('truncated', 'Tải về bị ngắt giữa chừng. Sẽ thử lại.', true);
      await rt.objects.multipartComplete!(storageKey!, uploadId, parts.map((p) => ({ n: p.n, etag: p.etag })));
      await rt.db.run("UPDATE creative_transfers SET upload_id = NULL, bytes_done = ?, bytes_total = ?, updated_at = ? WHERE creative_id = ?", [totalSize, totalSize, rt.clock.now().toISOString(), id]);
      const head = await rt.objects.head(storageKey!);
      if (!head || head.size !== totalSize) throw new ImportError('length_mismatch', 'Dung lượng tệp ghép được không khớp. Hãy thử lại.', true);

      m = (await loadMediaUnscoped(rt, id))!;
      try {
        await finalizeUpload({
          rt, m, hints: {}, fromState: 'importing', finance: opts.finance,
          actor: { id: m.uploaded_by, kind: m.uploader_kind, ip },
          autoApprove: m.uploader_kind === 'internal',
        });
      } catch (e) {
        if (e instanceof HttpError) {
          // finalizeUpload da danh dau 'invalid' + xoa tep neu sai spec; ghi lai vao tien trinh de UI hien nut Thu lai
          await rt.db.run("UPDATE creative_transfers SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE creative_id = ?", [e.code, e.message, rt.clock.now().toISOString(), id]);
          await rt.db.tx(async (db) => { await writeAudit(db, { rt, ip, actorId: m!.uploaded_by }, { action: 'media.import_failed', objectType: 'creative', objectId: id, customerId: m!.customer_id, diff: { code: e.code, message: e.message } }); });
          return 'failed';
        }
        throw e;
      }
      await rt.db.tx(async (db) => {
        await db.run("UPDATE creative_transfers SET status = 'done', error_code = NULL, error_message = NULL, updated_at = ? WHERE creative_id = ?", [rt.clock.now().toISOString(), id]);
        await writeAudit(db, { rt, ip, actorId: m!.uploaded_by }, { action: 'media.import_done', objectType: 'creative', objectId: id, customerId: m!.customer_id, diff: { source: plan.source, size_bytes: totalSize, parts: parts.length } });
      });
      return 'done';
    } catch (e) {
      const cur = await getTransfer(rt.db, id).catch(() => null);
      const attempts = Number(cur?.attempts ?? 1);
      if (e instanceof ImportError && !e.retryable) {
        await fail(id, m.customer_id, m.uploaded_by, e.code, e.message, storageKey);
        return 'failed';
      }
      const aborted = (e as { name?: string })?.name === 'AbortError';
      log(`[import] ${id} loi tam thoi (lan ${attempts}): ${(e as Error).name}: ${(e as Error).message}`);
      if (attempts >= MAX_ATTEMPTS) {
        await fail(id, m.customer_id, m.uploaded_by, aborted ? 'import_timeout' : 'import_network', aborted ? 'Quá thời gian tải tệp từ liên kết. Bấm "Thử lại" hoặc dùng tệp tải lên.' : 'Không tải được tệp từ liên kết (lỗi mạng hoặc nguồn). Bấm "Thử lại".', storageKey);
        return 'failed';
      }
      await rt.db.run("UPDATE creative_transfers SET status = 'queued', error_message = ?, updated_at = ? WHERE creative_id = ? AND status = 'running'", ['Đang thử lại sau lỗi tạm thời…', rt.clock.now().toISOString(), id]);
      return 'requeued';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Cron: (a) viec 'running' im qua 10 phut (Worker bi ngat) -> 'queued' (toi da 5 lan) ; (b) viec 'queued' qua 90 giay (loi tam thoi, het ngan sach) -> dat lai outbox.
   * Khong bao gio dat lai viec da 'done'/'failed'.
   */
  async function sweep(limit = 10): Promise<number> {
    const now = rt.clock.now();
    const stale = new Date(now.getTime() - 10 * 60_000).toISOString();
    const stuck = await rt.db.query<{ creative_id: string; attempts: number }>("SELECT creative_id, attempts FROM creative_transfers WHERE kind = 'import' AND status = 'running' AND updated_at < ? LIMIT ?", [stale, limit]);
    for (const s of stuck) {
      if (Number(s.attempts) >= 5) {
        const m = await loadMediaUnscoped(rt, s.creative_id);
        if (m) await fail(s.creative_id, m.customer_id, m.uploaded_by, 'import_timeout', 'Quá thời gian tải tệp từ liên kết. Bấm "Thử lại" hoặc dùng tệp tải lên.', m.storage_key);
      } else {
        await rt.db.run("UPDATE creative_transfers SET status = 'queued', updated_at = ? WHERE creative_id = ? AND status = 'running'", [now.toISOString(), s.creative_id]);
      }
    }
    const idle = new Date(now.getTime() - 90_000).toISOString();
    const due = await rt.db.query<{ creative_id: string }>("SELECT creative_id FROM creative_transfers WHERE kind = 'import' AND status = 'queued' AND updated_at < ? LIMIT ?", [idle, limit]);
    for (const d of due) {
      await rt.db.tx(async (db) => {
        await db.run('UPDATE creative_transfers SET updated_at = ? WHERE creative_id = ?', [now.toISOString(), d.creative_id]); // tranh dat lai moi phut
        await enqueueMediaImport(db, rt, d.creative_id, rt.id());
      });
    }
    return due.length + stuck.length;
  }

  return {
    run,
    sweep,
    subscribe(): void {
      rt.queue.subscribe(TOPIC_MEDIA_IMPORT, async (msg) => {
        const id = (msg as { creative_id?: string } | null)?.creative_id;
        if (typeof id !== 'string') return;
        const out = await run(id);
        if (out === 'continue') await rt.db.tx(async (db) => { await enqueueMediaImport(db, rt, id, rt.id()); }); // outbox -> queue
      });
    },
  };
}
export type MediaImporter = ReturnType<typeof createMediaImporter>;
