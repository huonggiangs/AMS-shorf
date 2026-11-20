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
import { saveDiag } from './creative-diag.js';
import { classifyDriveHtml, extractTitle, sanitizeSnippet, sanitizeUrl, warningCookieToken, type DriveDiag } from './drive-resolver.js';
import { isWebmMagic } from './webm-probe.js';
import { AUTO_CONVERT_HINT } from './creative.js';
import type { FinancePort } from '../ports.js';

/** Tran khi tai ve: bang tran video lon nhat (thang may 200 MB); finalizeUpload kiem lai theo loai man sau khi doc header. */
export const IMPORT_MAX_BYTES = VIDEO_RULES.elevatorMaxBytes;
/** Giu cho tuong thich: cau chung cu (nay dung cac thong bao theo tung nguyen nhan ben duoi). */
export const DRIVE_FAIL_MSG = 'Tệp Drive không chia sẻ công khai hoặc vượt hạn mức tải. Hãy đặt chia sẻ "Bất kỳ ai có đường liên kết" hoặc tải tệp lên trực tiếp.';
const DL_FALLBACK = 'Hãy tải tệp về máy rồi kéo vào ô tải lên.';
export const DRIVE_MSG = {
  login: 'Tệp Drive chưa chia sẻ công khai nên hệ thống không tải được. Mở Drive, bấm Chia sẻ, chọn "Bất kỳ ai có đường liên kết" (quyền Người xem) rồi bấm Thử lại.',
  quota: `Google đang tạm giới hạn lượt tải tệp này (quá nhiều lượt tải trong 24 giờ). Hãy thử lại sau, hoặc tải tệp về máy rồi kéo vào ô tải lên.`,
  blocked: `Google từ chối cho máy chủ của hệ thống tải tệp này (đây không phải lỗi của bạn). ${DL_FALLBACK}`,
  unrecognized: `Google trả về một trang xác nhận mà hệ thống chưa đọc được. ${DL_FALLBACK} Quản trị viên có thể xem chi tiết kỹ thuật trong nhật ký.`,
  unknown: `Google trả về một trang web thay vì tệp video. ${DL_FALLBACK} Quản trị viên có thể xem chi tiết kỹ thuật trong nhật ký.`,
  notFound: 'Không tìm thấy tệp trên Drive. Kiểm tra lại liên kết (tệp có thể đã bị xóa).',
} as const;
/** Ma loi cua finalizeUpload ma chuyen ma o trinh duyet sua duoc. */
const CONVERTIBLE = new Set(['unsupported_codec', 'video_resolution_too_high', 'file_too_large', 'creative_size_mismatch']);
const firstSentence = (t: string): string => {
  const i = t.search(/[.!?](\s|$)/);
  return (i > 0 ? t.slice(0, i + 1) : t).slice(0, 240);
};
export const NEEDS_CONVERT_MSG = `Tệp này cần chuyển sang H.264. ${DL_FALLBACK} Hệ thống sẽ tự chuyển.`;
export const YOUTUBE_MSG = 'Chưa hỗ trợ tải từ YouTube. Hãy dùng tệp tải lên hoặc liên kết Google Drive.';
const UA = 'Mozilla/5.0 (compatible; AMS-MediaImport/1.0)';
/** Drive tra trang khac nhau cho UA la; dung UA trinh duyet pho thong cho Drive. */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 5;
const MAX_ATTEMPTS = 3;

export class ImportError extends Error {
  constructor(public code: string, message: string, public retryable = false, public diag: DriveDiag | null = null) {
    super(message);
    this.name = 'ImportError';
  }
}
/** Vet cac buoc goi (an toan: khong cookie/gia tri tham so) de chan doan; gan vao ImportError khi that bai. */
interface Trace {
  steps: DriveDiag['steps'];
  last: { http: number | null; content_type: string | null; title: string | null; snippet: string | null; final_url: string | null };
}
const newTrace = (): Trace => ({ steps: [], last: { http: null, content_type: null, title: null, snippet: null, final_url: null } });
const diagOf = (code: string, tr: Trace): DriveDiag => ({ kind: 'import', code, ...tr.last, steps: tr.steps.slice(-8) });
type Jar = Map<string, string>;

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

/** Cookie giua cac lan goi (Drive dat cookie o trang xac nhan va doi lai o buoc tai). Chi gui toi ten mien da qua allowlist. */
function absorbCookies(jar: Jar, res: Response): void {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const kv = c.split(';')[0] ?? '';
    const i = kv.indexOf('=');
    if (i > 0) {
      const v = kv.slice(i + 1).trim();
      if (/;\s*max-age=0\b|;\s*expires=thu, 01 jan 1970/i.test(c) || v === '') jar.delete(kv.slice(0, i).trim());
      else jar.set(kv.slice(0, i).trim(), v);
    }
  }
}
const cookieHeader = (jar: Jar): string => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function safeFetch(fetchFn: FetchFn, start: URL, init: RequestInit, allow: (h: string) => boolean, o: { jar?: Jar; trace?: Trace } = {}): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !publicHost(url.hostname) || !allow(url.hostname.toLowerCase())) {
      if (url.hostname.toLowerCase().endsWith('accounts.google.com')) {
        // Drive chuyen toi trang dang nhap Google = tep khong cong khai (khong theo, chi ghi nhan)
        if (o.trace) o.trace.last = { ...o.trace.last, final_url: sanitizeUrl(url) };
        throw new ImportError('drive_login_required', DRIVE_MSG.login);
      }
      throw new ImportError('redirect_blocked', 'Liên kết chuyển hướng tới địa chỉ không được phép nên đã bị chặn.');
    }
    const headers = new Headers(init.headers);
    if (o.jar && o.jar.size) headers.set('cookie', cookieHeader(o.jar));
    const res = await fetchFn(url, { ...init, headers, redirect: 'manual' });
    if (o.jar) absorbCookies(o.jar, res);
    if (o.trace) {
      const ct = res.headers.get('content-type');
      o.trace.steps.push({ url: sanitizeUrl(url), status: res.status, content_type: ct ? ct.split(';')[0]!.trim().slice(0, 60) : null });
      o.trace.last = { ...o.trace.last, http: res.status, content_type: ct ? ct.slice(0, 80) : null, final_url: sanitizeUrl(url) };
    }
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
const cancelBody = async (res: Response) => { try { await res.body?.cancel(); } catch { /* bo qua */ } };

function httpProblem(status: number, plan: ImportPlan, tr: Trace): ImportError {
  const d = (code: string) => diagOf(code, tr);
  if (plan.drive && (status === 401 || status === 403 || status === 429)) return new ImportError('drive_blocked', DRIVE_MSG.blocked, false, d('drive_blocked'));
  if (plan.drive && status === 404) return new ImportError('source_not_found', DRIVE_MSG.notFound, false, d('source_not_found'));
  if (status === 404 || status === 410) return new ImportError('source_not_found', 'Không tìm thấy tệp ở liên kết này (đã xóa hoặc sai đường dẫn).', false, d('source_not_found'));
  if (status === 401 || status === 403) return new ImportError('source_forbidden', 'Nguồn từ chối truy cập tệp (không công khai).', false, d('source_forbidden'));
  if (status === 429 || status >= 500) return new ImportError('source_unavailable', `Máy chủ nguồn đang bận hoặc lỗi (${status}). Sẽ thử lại.`, true, d('source_unavailable'));
  return new ImportError('source_error', `Máy chủ nguồn trả về lỗi ${status}.`, false, d('source_error'));
}

interface Opened {
  res: Response;
  /** vi tri byte dau tien cua res.body trong tep */
  offset: number;
  /** tong dung luong tep neu biet */
  total: number | null;
}

/** Lien ket ung vien cua Drive, theo thu tu thu: (1) usercontent ... confirm=t, (2) form/lien ket doc tu trang xac nhan (chen len dau hang doi), (3) drive.google.com/uc (kieu cu, cookie download_warning). */
export const driveCandidates = (id: string): URL[] => [
  new URL(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`),
  new URL(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`),
];

/** Doc than HTML (toi da 600 KB) roi huy phan con lai. */
async function readHtml(res: Response): Promise<string> {
  const t = (await res.text()).slice(0, 600_000);
  return t;
}

async function openDrive(fetchFn: FetchFn, plan: ImportPlan, from: number, signal: AbortSignal | undefined, tr: Trace): Promise<Opened> {
  const driveId = plan.start.searchParams.get('id') ?? '';
  const headers: Record<string, string> = { 'user-agent': BROWSER_UA, accept: '*/*', 'accept-language': 'en-US,en;q=0.9' };
  if (from > 0) headers['range'] = `bytes=${from}-`;
  const init: RequestInit = { method: 'GET', headers, ...(signal ? { signal } : {}) };
  const jar: Jar = new Map();
  const queue: URL[] = driveCandidates(driveId);
  const seen = new Set<string>();
  let worst: { rank: number; err: ImportError } | null = null;
  // quota > login > blocked > trang xac nhan khong doc duoc > khong ro
  const note = (rank: number, err: ImportError) => { if (!worst || rank > worst.rank) worst = { rank, err }; };
  for (let n = 0; n < 7 && queue.length; n++) {
    const next = queue.shift()!;
    const key = next.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    let got: { res: Response; url: URL };
    try {
      got = await safeFetch(fetchFn, next, init, plan.allowHost, { jar, trace: tr });
    } catch (e) {
      if (e instanceof ImportError && e.code === 'drive_login_required') {
        note(3, new ImportError(e.code, e.message, false, diagOf(e.code, tr)));
        continue;
      }
      throw e;
    }
    const { res, url } = got;
    if (!isHtml(res)) {
      if (res.ok) return finishOpen(res);
      await cancelBody(res);
      note(res.status === 404 ? 1 : 2, httpProblem(res.status, plan, tr));
      continue;
    }
    // Trang HTML (ma 200 hoac 403/404...): doc va phan loai
    const html = await readHtml(res);
    tr.last = { ...tr.last, title: extractTitle(html) || null, snippet: sanitizeSnippet(html) || null };
    const v = classifyDriveHtml(html, res.status, url);
    if (v.kind === 'confirm' && v.next) {
      queue.unshift(v.next);
      continue;
    }
    const tok = warningCookieToken(jar);
    if (tok && !seen.has(`tok:${tok}`)) {
      seen.add(`tok:${tok}`);
      queue.unshift(new URL(`https://drive.google.com/uc?export=download&confirm=${encodeURIComponent(tok)}&id=${encodeURIComponent(driveId)}`));
    }
    if (v.kind === 'quota') note(5, new ImportError('drive_quota', DRIVE_MSG.quota, false, diagOf('drive_quota', tr)));
    else if (v.kind === 'login') note(4, new ImportError('drive_login_required', DRIVE_MSG.login, false, diagOf('drive_login_required', tr)));
    else if (res.status === 403 || res.status === 429) note(3, new ImportError('drive_blocked', DRIVE_MSG.blocked, false, diagOf('drive_blocked', tr)));
    else if (v.kind === 'not_found') note(1, new ImportError('source_not_found', DRIVE_MSG.notFound, false, diagOf('source_not_found', tr)));
    else if (/download|confirm|virus|scan|quét/i.test(`${v.title} ${tr.last.snippet ?? ''}`)) note(2, new ImportError('drive_page_unrecognized', DRIVE_MSG.unrecognized, false, diagOf('drive_page_unrecognized', tr)));
    else note(1, new ImportError('drive_html_unknown', DRIVE_MSG.unknown, false, diagOf('drive_html_unknown', tr)));
  }
  throw (worst as { err: ImportError } | null)?.err ?? new ImportError('drive_html_unknown', DRIVE_MSG.unknown, false, diagOf('drive_html_unknown', tr));
}

function finishOpen(res: Response): Opened {
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

async function openSource(fetchFn: FetchFn, plan: ImportPlan, from: number, signal: AbortSignal | undefined, tr: Trace): Promise<Opened> {
  if (plan.drive) return openDrive(fetchFn, plan, from, signal, tr);
  const headers: Record<string, string> = { 'user-agent': UA, accept: '*/*' };
  if (from > 0) headers['range'] = `bytes=${from}-`;
  const init: RequestInit = { method: 'GET', headers, ...(signal ? { signal } : {}) };
  const { res } = await safeFetch(fetchFn, plan.start, init, plan.allowHost, { trace: tr });
  if (!res.ok) {
    await cancelBody(res);
    throw httpProblem(res.status, plan, tr);
  }
  if (isHtml(res)) {
    const html = await readHtml(res);
    tr.last = { ...tr.last, title: extractTitle(html) || null, snippet: sanitizeSnippet(html) || null };
    throw new ImportError('not_media', 'Liên kết trả về trang web, không phải tệp video/ảnh.', false, diagOf('not_media', tr));
  }
  return finishOpen(res);
}

// ----------------------------------------------------------------------------------------------- nhan dang noi dung
export type ImportMime = 'video/mp4' | 'video/webm' | 'video/quicktime' | 'image/png' | 'image/jpeg';
export function sniffImportMime(b: Uint8Array): ImportMime | null {
  if (isWebmMagic(b)) return 'video/webm';
  if (b.length >= 12 && String.fromCharCode(b[4]!, b[5]!, b[6]!, b[7]!) === 'ftyp') return String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
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

const EXT_OF: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'image/png': 'png', 'image/jpeg': 'jpg' };

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

  async function fail(id: string, customerId: string, actorId: string | null, code: string, message: string, storageKey: string | null, creativeState: 'invalid' | null = 'invalid', diag: DriveDiag | null = null): Promise<void> {
    const nowIso = rt.clock.now().toISOString();
    const t = await getTransfer(rt.db, id);
    if (t?.upload_id && storageKey) {
      try { await rt.objects.multipartAbort?.(storageKey, t.upload_id); } catch { /* khong chan */ }
    }
    await rt.db.tx(async (db) => {
      await db.run("UPDATE creative_transfers SET status = 'failed', error_code = ?, error_message = ?, upload_id = NULL, updated_at = ? WHERE creative_id = ?", [code, message, nowIso, id]);
      if (creativeState) await db.run("UPDATE creatives SET review_state = 'rejected', review_note = ?, state = ? WHERE id = ? AND state IN ('importing','invalid')", [message, creativeState, id]);
      if (diag) await saveDiag(db, id, diag, nowIso);
      await writeAudit(db, { rt, ip, actorId }, { action: 'media.import_failed', objectType: 'creative', objectId: id, customerId, diff: { code, message, ...(diag ? { diag } : {}) } });
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
    const tr = newTrace();
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
      let opened = await openSource(fetchFn, plan, uploadId && done > 0 ? done : 0, ctl.signal, tr);
      if (uploadId && done > 0 && opened.offset !== done) {
        try { await opened.res.body?.cancel(); } catch { /* bo qua */ }
        try { await rt.objects.multipartAbort?.(storageKey!, uploadId); } catch { /* khong chan */ }
        uploadId = null;
        parts = [];
        done = 0;
        opened = await openSource(fetchFn, plan, 0, ctl.signal, tr);
      }
      if (opened.offset !== done) throw new ImportError('bad_response', 'Nguồn không trả đúng đoạn dữ liệu yêu cầu.', true);
      if (opened.total !== null && opened.total > IMPORT_MAX_BYTES) throw new ImportError('file_too_large', `Tệp ${(opened.total / MB).toFixed(1)} MB vượt giới hạn ${IMPORT_MAX_BYTES / MB} MB của liên kết. ${NEEDS_CONVERT_MSG}`, false, diagOf('file_too_large', tr));
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
            if (!sn) {
              tr.last = { ...tr.last, snippet: `đầu tệp (hex): ${[...head.subarray(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join(' ')}` };
              throw new ImportError('not_media', `Tệp tải về không phải MP4, MOV, WebM, PNG hoặc JPG hợp lệ${plan.drive ? ' (Google trả về nội dung khác tệp video)' : ''}. ${DL_FALLBACK}`, false, diagOf('not_media', tr));
            }
            if (!uploadId) {
              mime = sn;
              const name = (m.name ?? '').startsWith('Tệp từ ') ? (fileNameOf(opened.res) ?? m.name) : m.name;
              const ext = EXT_OF[sn]!;
              const base = safeFileName(name ?? 'import');
              storageKey = `media/${m.customer_id}/${m.id}/${/\.(mp4|webm|mov|png|jpe?g)$/i.test(base) ? base : `${base}.${ext}`}`;
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
          if (done + fill > IMPORT_MAX_BYTES) throw new ImportError('file_too_large', `Tệp vượt giới hạn ${IMPORT_MAX_BYTES / MB} MB của liên kết. ${NEEDS_CONVERT_MSG}`, false, diagOf('file_too_large', tr));
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
      if (first || !uploadId) throw new ImportError('not_media', 'Nguồn trả về tệp rỗng.', false, diagOf('not_media', tr));
      await flush();
      const totalSize = done;
      if (opened.total !== null && totalSize !== opened.total) throw new ImportError('truncated', 'Tải về bị ngắt giữa chừng. Sẽ thử lại.', true);
      await rt.objects.multipartComplete!(storageKey!, uploadId, parts.map((p) => ({ n: p.n, etag: p.etag })));
      await rt.db.run("UPDATE creative_transfers SET upload_id = NULL, bytes_done = ?, bytes_total = ?, updated_at = ? WHERE creative_id = ?", [totalSize, totalSize, rt.clock.now().toISOString(), id]);
      const head = await rt.objects.head(storageKey!);
      if (!head || head.size !== totalSize) throw new ImportError('length_mismatch', 'Dung lượng tệp ghép được không khớp. Hãy thử lại.', true);

      m = (await loadMediaUnscoped(rt, id))!;
      try {
        const fin = await finalizeUpload({
          rt, m, hints: {}, fromState: 'importing', finance: opts.finance,
          actor: { id: m.uploaded_by, kind: m.uploader_kind, ip },
          autoApprove: m.uploader_kind === 'internal',
        });
        if (fin.warnings.length) await saveDiag(rt.db, id, { kind: 'import', code: 'warning', http: null, content_type: null, title: null, snippet: null, final_url: null, steps: [], warnings: fin.warnings }, rt.clock.now().toISOString());
      } catch (e) {
        if (e instanceof HttpError) {
          // finalizeUpload da danh dau 'invalid' + xoa tep neu sai spec; ghi lai vao tien trinh de UI hien nut Thu lai.
          // Tep sua duoc bang chuyen ma (codec/do phan giai/dung luong/ti le/thoi luong): bao dung lai "can chuyen sang H.264" kem ly do, khong bao nguoi dung tu xuat lai.
          const msg = CONVERTIBLE.has(e.code) ? `${NEEDS_CONVERT_MSG} Lý do: ${firstSentence(e.message)}` : e.message;
          await rt.db.run("UPDATE creative_transfers SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE creative_id = ?", [e.code, msg, rt.clock.now().toISOString(), id]);
          if (msg !== e.message) await rt.db.run("UPDATE creatives SET review_note = ? WHERE id = ? AND state = 'invalid'", [msg, id]);
          await rt.db.tx(async (db) => {
            await saveDiag(db, id, { kind: 'import', code: e.code, http: tr.last.http, content_type: tr.last.content_type, title: null, snippet: null, final_url: tr.last.final_url, steps: tr.steps.slice(-8) }, rt.clock.now().toISOString());
            await writeAudit(db, { rt, ip, actorId: m!.uploaded_by }, { action: 'media.import_failed', objectType: 'creative', objectId: id, customerId: m!.customer_id, diff: { code: e.code, message: e.message } });
          });
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
        await fail(id, m.customer_id, m.uploaded_by, e.code, e.message, storageKey, 'invalid', e.diag);
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
