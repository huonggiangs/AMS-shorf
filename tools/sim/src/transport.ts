export interface SimRequest {
  method: 'GET' | 'POST';
  path: string; // gom query
  headers: Record<string, string>;
  body?: string;
}
export interface SimResponse {
  status: number;
  headers: { get(name: string): string | null };
  text: string;
}
export type Transport = (req: SimRequest) => Promise<SimResponse>;

/** HTTP that (fetch). baseUrl khong co dau / cuoi. */
export function httpTransport(baseUrl: string): Transport {
  const base = baseUrl.replace(/\/+$/, '');
  return async (req) => {
    const res = await fetch(base + req.path, { method: req.method, headers: req.headers, ...(req.body !== undefined ? { body: req.body } : {}) });
    return { status: res.status, headers: res.headers, text: await res.text() };
  };
}

/** Goi thang vao ung dung Hono (khong qua mang): `app.request`. Do do tre la CPU cua gateway + DB trong bo nho. */
export function inProcessTransport(app: { request(input: string, init?: RequestInit): Response | Promise<Response> }): Transport {
  return async (req) => {
    const res = await app.request(req.path, { method: req.method, headers: req.headers, ...(req.body !== undefined ? { body: req.body } : {}) });
    return { status: res.status, headers: res.headers, text: await res.text() };
  };
}
