import { z } from 'zod';

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

/** Error shape from PLAN §2: { error: { code, message, details? } } */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};
const readCsrfCookie = (): string | null => {
  try {
    const m = document.cookie.match(/(?:^|;\s*)__Host-ams_csrf=([^;]+)/) ?? document.cookie.match(/(?:^|;\s*)ams_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
};

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Subscribe to 401 responses (session expired / switched). */
export const onUnauthorized = (fn: Listener) => {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
};

const pwRequiredListeners = new Set<Listener>();
/** Subscribe to 403 `password_change_required` (forced password change pending): any request can raise it. */
export const onPasswordChangeRequired = (fn: Listener) => {
  pwRequiredListeners.add(fn);
  return () => pwRequiredListeners.delete(fn);
};

const termsListeners = new Set<Listener>();
/** Subscribe to 403 `terms_acceptance_required` (p4: co van ban phap ly moi can chap nhan). */
export const onTermsRequired = (fn: Listener) => {
  termsListeners.add(fn);
  return () => termsListeners.delete(fn);
};

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface ReqOpts<S extends z.ZodTypeAny | undefined> {
  query?: Query;
  body?: unknown;
  schema?: S;
  signal?: AbortSignal;
  /** do not fire the global 401 handler (used by /auth/me bootstrap and login) */
  quiet401?: boolean;
}

const qs = (q?: Query) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export async function request<S extends z.ZodTypeAny | undefined = undefined>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  opts: ReqOpts<S> = {},
): Promise<S extends z.ZodTypeAny ? z.infer<S> : unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET') {
    const t = csrfToken ?? readCsrfCookie();
    if (t) headers['X-CSRF-Token'] = t;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs(opts.query)}`, {
      method,
      headers,
      body,
      credentials: 'include',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error', 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  }
  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    if (res.status === 401 && !opts.quiet401) unauthorizedListeners.forEach((l) => l());
    if (res.status === 403 && err?.code === 'password_change_required') pwRequiredListeners.forEach((l) => l());
    if (res.status === 403 && err?.code === 'terms_acceptance_required') termsListeners.forEach((l) => l());
    throw new ApiError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? `Lỗi máy chủ (${res.status}).`,
      err?.details,
    );
  }
  if (opts.schema) {
    const r = opts.schema.safeParse(json);
    if (!r.success) {
      throw new ApiError(502, 'bad_response', 'Phản hồi từ máy chủ không đúng định dạng.', r.error.flatten());
    }
    return r.data as never;
  }
  return json as never;
}

/** Tieu de CSRF cho request ghi tu code khac (vd XHR tai tung phan len). */
export const csrfHeaders = (): Record<string, string> => {
  const t = csrfToken ?? readCsrfCookie();
  return t ? { 'X-CSRF-Token': t } : {};
};

/** PUT thang byte (anh dai dien): cung phien/CSRF nhu request(); khong doc JSON, nem ApiError khi loi. */
export async function putBlob(path: string, blob: Blob): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': blob.type || 'application/octet-stream', Accept: 'application/json' };
  const t = csrfToken ?? readCsrfCookie();
  if (t) headers['X-CSRF-Token'] = t;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'PUT', headers, body: blob, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'network_error', 'Không kết nối được máy chủ.');
  }
  if (!res.ok) {
    let msg = `Lỗi máy chủ (${res.status}).`;
    let code = `http_${res.status}`;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      msg = j.error?.message ?? msg;
      code = j.error?.code ?? code;
    } catch { /* khong phai JSON */ }
    throw new ApiError(res.status, code, msg);
  }
}

/** POST thang byte (tep nhap mau hop dong) va doc JSON tra ve: cung phien/CSRF nhu request(); nem ApiError khi loi. */
export async function postBlob<T = unknown>(path: string, blob: Blob, query?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream', Accept: 'application/json' };
  const t = csrfToken ?? readCsrfCookie();
  if (t) headers['X-CSRF-Token'] = t;
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs}`, { method: 'POST', headers, body: blob, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'network_error', 'Không kết nối được máy chủ.');
  }
  let j: unknown = null;
  try { j = await res.json(); } catch { /* khong phai JSON */ }
  if (!res.ok) {
    const e = (j as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `Lỗi máy chủ (${res.status}).`);
  }
  return j as T;
}

export const api = {
  get: <S extends z.ZodTypeAny | undefined = undefined>(p: string, o?: ReqOpts<S>) => request('GET', p, o),
  post: <S extends z.ZodTypeAny | undefined = undefined>(p: string, o?: ReqOpts<S>) => request('POST', p, o),
  patch: <S extends z.ZodTypeAny | undefined = undefined>(p: string, o?: ReqOpts<S>) => request('PATCH', p, o),
  put: <S extends z.ZodTypeAny | undefined = undefined>(p: string, o?: ReqOpts<S>) => request('PUT', p, o),
  del: <S extends z.ZodTypeAny | undefined = undefined>(p: string, o?: ReqOpts<S>) => request('DELETE', p, o),
};

export const errMsg = (e: unknown): string =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Đã xảy ra lỗi.';
