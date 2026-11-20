// Phan tich trang tra ve cua Google Drive khi tai tep (thuan, khong goi mang): nhan dang trang xac nhan "khong quet duoc virus" (nhieu dinh dang), trang dang nhap,
// trang het han muc, trang khong tim thay; va tao chan doan AN TOAN (khong cookie/token/URL ky) de luu cho admin.

export type DriveHtmlKind = 'confirm' | 'login' | 'quota' | 'not_found' | 'unknown';
export interface DriveHtmlVerdict {
  kind: DriveHtmlKind;
  /** URL ke tiep can goi (chi khi kind = 'confirm'): form hoac lien ket xac nhan */
  next: URL | null;
  title: string;
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x0*3d;/gi, '=')
    .replace(/&#x0*26;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));

/** Giai ma chuoi JS/JSON nhung trong trang: &, \x26, \/ */
const unescapeJs = (s: string): string =>
  s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/');

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const v = m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
  return v === null ? null : decodeEntities(v);
};

export function extractTitle(html: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  return decodeEntities(t).replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Lam sach doan dau cua phan hoi de ghi chan doan: bo script/style/the, gop khoang trang, che chuoi giong token, toi da `max` ky tu. */
export function sanitizeSnippet(html: string, max = 200): string {
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return text.replace(/[A-Za-z0-9_\-./+=]{24,}/g, '…').slice(0, max);
}

/** URL an toan de ghi: chi giu ten mien + duong dan (neu duong dan chua doan dai giong ma thi che) + TEN tham so, khong gia tri. */
export function sanitizeUrl(u: URL | string): string {
  try {
    const x = typeof u === 'string' ? new URL(u) : u;
    const names = [...new Set([...x.searchParams.keys()])].slice(0, 12);
    const path = x.pathname.replace(/[A-Za-z0-9_-]{24,}/g, '…');
    return `${x.hostname}${path}${names.length ? `?${names.join('&')}` : ''}`;
  } catch {
    return '(url?)';
  }
}

function resolveSafe(raw: string, base: URL): URL | null {
  try {
    const u = new URL(raw, base);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** Trang xac nhan: (1) <form> tai xuong (id="download-form" hoac action .../download), moi <input> co name (hidden hay khong) thanh tham so; (2) lien ket href co confirm=; (3) "downloadUrl" nhung trong script. */
export function parseDriveConfirm(html: string, base: URL): URL | null {
  for (const fm of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const open = fm[1] ?? '';
    const action = attr(open, 'action') ?? '';
    const isDl = /download-form/i.test(open) || /\/download\b|export=download|\/uc\b/i.test(action);
    if (!isDl) continue;
    const u = resolveSafe(action || 'https://drive.usercontent.google.com/download', base);
    if (!u) continue;
    for (const im of (fm[2] ?? '').matchAll(/<input\b[^>]*>/gi)) {
      const name = attr(im[0], 'name');
      const type = (attr(im[0], 'type') ?? 'text').toLowerCase();
      if (!name || type === 'submit' || type === 'button') continue;
      u.searchParams.set(name, attr(im[0], 'value') ?? '');
    }
    if (u.searchParams.has('id') || u.searchParams.has('confirm') || u.searchParams.has('uuid')) return u;
  }
  for (const am of html.matchAll(/href\s*=\s*(?:"([^"]*confirm=[^"]*)"|'([^']*confirm=[^']*)')/gi)) {
    const u = resolveSafe(decodeEntities(am[1] ?? am[2] ?? ''), base);
    if (u && u.searchParams.has('confirm')) return u;
  }
  const dj = html.match(/"downloadUrl"\s*:\s*"([^"]+)"/i)?.[1];
  if (dj) {
    const u = resolveSafe(unescapeJs(dj), base);
    if (u) return u;
  }
  return null;
}

const QUOTA_RE = /too many users|download quota|quota exceeded|exceeded the maximum number|can(?:no|')?t (?:view or )?download this file at this time|quá nhiều người dùng|vượt quá hạn mức|hạn mức tải/i;
const LOGIN_RE = /sign[\s-]*in|log[\s-]*in|đăng nhập|accounts\.google\.com\/(?:v3\/signin|servicelogin|signin)|ServiceLogin|need access|request access|yêu cầu quyền truy cập|bạn cần quyền/i;
const NOT_FOUND_RE = /file you have requested does not exist|not found|không tìm thấy|404\. that|that's an error/i;

/** Phan loai mot trang HTML tu Google. `status`: ma HTTP; `finalUrl`: URL sau chuyen huong. */
export function classifyDriveHtml(html: string, status: number, finalUrl: URL): DriveHtmlVerdict {
  const title = extractTitle(html);
  const next = parseDriveConfirm(html, finalUrl);
  if (next) return { kind: 'confirm', next, title };
  const head = `${title} ${sanitizeSnippet(html, 600)}`;
  if (QUOTA_RE.test(head)) return { kind: 'quota', next: null, title };
  if (finalUrl.hostname.endsWith('accounts.google.com') || /^(sign[\s-]*in|đăng nhập)\b/i.test(title) || /google accounts/i.test(title) || LOGIN_RE.test(head)) return { kind: 'login', next: null, title };
  if (status === 404 || NOT_FOUND_RE.test(head)) return { kind: 'not_found', next: null, title };
  return { kind: 'unknown', next: null, title };
}

/** Cookie kieu cu: download_warning_<hash>=<ma> -> ma xac nhan cho drive.google.com/uc?export=download&confirm=<ma>. */
export function warningCookieToken(jar: ReadonlyMap<string, string>): string | null {
  for (const [k, v] of jar) if (/^download_warning/i.test(k) && v) return v;
  return null;
}

export interface DriveDiag {
  kind: 'import';
  code: string;
  http: number | null;
  content_type: string | null;
  title: string | null;
  snippet: string | null;
  final_url: string | null;
  steps: { url: string; status: number; content_type: string | null }[];
  warnings?: string[];
}
