// Client fetch co kieu, dung kieu sinh tu OpenAPI (`paths`). Khong phu thuoc thu vien ngoai; chay Node 22, trinh duyet, Workers.
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type AnyOp = { parameters?: { query?: unknown; path?: unknown; header?: unknown }; requestBody?: unknown; responses: unknown };

export type PathsWith<P, M extends Method> = { [K in keyof P]: P[K] extends { [m in M]: AnyOp } ? K : never }[keyof P];
type OpOf<P, K extends keyof P, M extends Method> = P[K] extends { [m in M]: infer O } ? O : never;

type Defined<T> = Exclude<T, undefined | never>;
type PathParams<O> = O extends { parameters: { path: infer X } } ? X : never;
type QueryParams<O> = O extends { parameters: { query?: infer X } } ? Defined<X> : never;
type HeaderParams<O> = O extends { parameters: { header?: infer X } } ? Defined<X> : never;
type JsonBody<O> = O extends { requestBody: { content: { 'application/json': infer B } } } ? B : O extends { requestBody?: { content: { 'application/json': infer B } } } ? B : never;
type HasBody<O> = O extends { requestBody: { content: { 'application/json': unknown } } } ? true : false;

type Responses<O> = O extends { responses: infer R } ? R : never;
export type SuccessOf<O> = {
  [S in keyof Responses<O> & (200 | 201 | 202 | 204)]: Responses<O>[S] extends { content: { 'application/json': infer B } } ? B : undefined;
}[keyof Responses<O> & (200 | 201 | 202 | 204)];

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export type RequestInit2<O> = ([PathParams<O>] extends [never] ? { path?: undefined } : { path: PathParams<O> }) &
  ([QueryParams<O>] extends [never] ? { query?: undefined } : { query?: QueryParams<O> }) &
  ([HeaderParams<O>] extends [never] ? { headers?: Record<string, string> } : { headers?: Record<string, string> & Partial<HeaderParams<O>> }) &
  (HasBody<O> extends true ? { body: JsonBody<O> } : { body?: undefined }) & { signal?: AbortSignal };

export type Result<O> = { ok: true; status: number; data: SuccessOf<O>; response: Response } | { ok: false; status: number; error: ErrorBody['error'] | { code: 'network_error' | 'invalid_response'; message: string }; response?: Response };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** mac dinh globalThis.fetch */
  fetch?: typeof fetch;
  /** trinh duyet: 'include' de gui cookie phien ams_session (mac dinh 'include') */
  credentials?: RequestCredentials;
  /** token CSRF (tu /auth/me hoac phan hoi dang nhap); tu dong gan X-CSRF-Token cho phuong thuc ghi */
  csrfToken?: string;
  headers?: Record<string, string>;
  /** chu ky thiet bi (gateway): goi voi (method, pathWithQuery, bodyBytes) tra ve header can them */
  sign?: (method: string, pathWithQuery: string, body: Uint8Array) => Promise<Record<string, string>>;
}

const enc = new TextEncoder();

function fillPath(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/\{([^}]+)\}/g, (_, k: string) => {
    const v = params?.[k];
    if (v === undefined || v === null) throw new Error(`Thieu tham so duong dan {${k}} cho ${path}`);
    return encodeURIComponent(String(v));
  });
}
function qs(q: Record<string, unknown> | undefined): string {
  if (!q) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export class AmsClient<P> {
  csrfToken: string | undefined;
  constructor(private o: ClientOptions) {
    this.csrfToken = o.csrfToken;
  }

  async request<M extends Method, K extends PathsWith<P, M> & string>(method: M, path: K, init?: RequestInit2<OpOf<P, K, M>>): Promise<Result<OpOf<P, K, M>>> {
    const i = (init ?? {}) as { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };
    const url = this.o.baseUrl.replace(/\/$/, '') + fillPath(path, i.path) + qs(i.query);
    const pathWithQuery = url.slice(url.indexOf('/', url.indexOf('//') + 2));
    const bodyBytes = i.body === undefined ? new Uint8Array() : enc.encode(JSON.stringify(i.body));
    const headers: Record<string, string> = { accept: 'application/json', ...this.o.headers, ...i.headers };
    if (i.body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'get' && this.csrfToken && !headers['x-csrf-token']) headers['x-csrf-token'] = this.csrfToken;
    if (this.o.sign) Object.assign(headers, await this.o.sign(method.toUpperCase(), pathWithQuery, bodyBytes));
    const f = this.o.fetch ?? globalThis.fetch;
    let res: Response;
    try {
      res = await f(url, { method: method.toUpperCase(), headers, body: i.body === undefined ? undefined : (bodyBytes as unknown as BodyInit), credentials: this.o.credentials ?? 'include', signal: i.signal });
    } catch (e) {
      return { ok: false, status: 0, error: { code: 'network_error', message: (e as Error).message } };
    }
    const text = res.status === 204 || res.status === 304 ? '' : await res.text();
    let json: unknown;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: false, status: res.status, error: { code: 'invalid_response', message: 'Phan hoi khong phai JSON' }, response: res };
      }
    }
    if (res.ok || res.status === 304) return { ok: true, status: res.status, data: json as SuccessOf<OpOf<P, K, M>>, response: res };
    const e = (json as Partial<ErrorBody> | undefined)?.error;
    return { ok: false, status: res.status, error: e && typeof e.code === 'string' ? e : { code: 'invalid_response', message: `HTTP ${res.status}` }, response: res };
  }

  /** Nhu request nhung nem ApiError khi that bai; tra thang `data`. */
  async call<M extends Method, K extends PathsWith<P, M> & string>(method: M, path: K, init?: RequestInit2<OpOf<P, K, M>>): Promise<SuccessOf<OpOf<P, K, M>>> {
    const r = await this.request(method, path, init);
    if (!r.ok) throw new ApiError(r.status, r.error.code, r.error.message, (r.error as { details?: unknown }).details);
    return r.data;
  }

  get<K extends PathsWith<P, 'get'> & string>(path: K, init?: RequestInit2<OpOf<P, K, 'get'>>) {
    return this.request('get', path, init);
  }
  post<K extends PathsWith<P, 'post'> & string>(path: K, init?: RequestInit2<OpOf<P, K, 'post'>>) {
    return this.request('post', path, init);
  }
  put<K extends PathsWith<P, 'put'> & string>(path: K, init?: RequestInit2<OpOf<P, K, 'put'>>) {
    return this.request('put', path, init);
  }
  delete<K extends PathsWith<P, 'delete'> & string>(path: K, init?: RequestInit2<OpOf<P, K, 'delete'>>) {
    return this.request('delete', path, init);
  }
}
