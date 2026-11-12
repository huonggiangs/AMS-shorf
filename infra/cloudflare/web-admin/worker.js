// Worker mỏng cho web-admin: /api/* -> Worker `api` (service binding), còn lại phục vụ tệp tĩnh.
// /api/admin/v1/devices  ->  api: /admin/v1/devices   (cắt tiền tố /api, giống nginx ở bản Docker)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok\n', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname.startsWith('/api/')) {
      const target = new URL(request.url);
      target.pathname = url.pathname.slice(4); // bỏ "/api"
      const headers = new Headers(request.headers);
      headers.set('x-forwarded-host', url.host);
      headers.set('x-forwarded-proto', 'https');
      return env.API.fetch(new Request(target, new Request(request, { headers })));
    }
    return env.ASSETS.fetch(request);
  },
};
