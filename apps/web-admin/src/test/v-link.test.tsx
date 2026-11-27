// v-link: tab "Dan link video" + duyet creative stream (xem truoc, xac nhan da xem toan bo).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { checkStreamUrl } from '../lib/creative';

type Handler = (url: URL, method: string, body: Record<string, unknown> | null) => { status?: number; body: unknown } | undefined;
let handlers: Handler[] = [];
const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    for (const h of handlers) {
      const r = h(url, method, body);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const on = (path: string, data: unknown, method = 'GET', status = 200): Handler => (u, m) => (u.pathname === `/api${path}` && m === method ? { status, body: data } : undefined);
const me: Handler = (u) => (u.pathname === '/api/auth/me' ? { body: { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'admin' }, permissions: { overview: ['view'], customers: ['view'], media: ['view', 'write', 'approve'] } } } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const stream = { delivery: 'stream', stream_url: 'https://cdn.adhost.vn/a.mp4', stream_host: 'cdn.adhost.vn', stream_kind: 'mp4', declared_duration_s: 15, probe_status: 'ok', needs_review: false, content_length: 5000000, etag: '"v1"', info: { width: 7680, height: 4320, resolution_label: '8K', codec: 'H.264' }, warnings: [{ code: 'weak_validators', message: 'Máy chủ không trả ETag' }] };
const m1 = { id: 'm1', name: 'a.mp4', kind: 'stream', delivery: 'stream', mime: 'video/mp4', width: 7680, height: 4320, duration_sec: 15, status: 'pending', owner_name: 'Vinamilk', scan_state: 'needs_manual_review', scan_reasons: ['remote_stream_unscanned'], content_version: 3, stream, blocker: { code: 'creative_needs_manual_review', action: 'manual_review', message: 'Video từ liên kết không được quét mã độc.' } };

beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('checkStreamUrl', () => {
  it('nhan https hop le, tu choi http/IP/userinfo/YouTube', () => {
    expect(checkStreamUrl('https://cdn.adhost.vn/a.mp4').ok).toBe(true);
    expect(checkStreamUrl('https://cdn.adhost.vn/live').ok).toBe(true);
    for (const u of ['http://a.vn/a.mp4', 'https://127.0.0.1/a.mp4', 'https://[::1]/a.mp4', 'https://u:p@a.vn/a.mp4', 'https://localhost/a.mp4', 'https://a.vn:8443/a.mp4']) expect(checkStreamUrl(u).ok, u).toBe(false);
    const yt = checkStreamUrl('https://www.youtube.com/watch?v=1');
    expect(yt.ok).toBe(false);
    expect(yt.message).toContain('.mp4');
  });
});

describe('Media: dan link video', () => {
  it('tab "Dan link video" gui POST /link voi thoi luong bat buoc', async () => {
    handlers.push(me, on('/admin/v1/media/link', { ...m1 }, 'POST', 201), on('/admin/v1/customers', { items: [{ id: 'c1', short_name: 'Vinamilk', legal_name: 'Vinamilk', code: 'K001', status: 'active', credit_limit_vnd: 0, debt_vnd: 0 }], total: 1, page: 1, page_size: 200 }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    await userEvent.click(await screen.findByRole('button', { name: 'Dán link video' }, { timeout: 5000 }));
    const dlg = await screen.findByRole('dialog', { name: 'Dán link video' });
    await within(dlg).findByRole('option', { name: /Vinamilk/ }, { timeout: 3000 }).catch((e) => { console.log(calls.map((c) => c.path).join(','), within(dlg).getByLabelText('Khách hàng sở hữu nội dung').outerHTML); throw e; });
    await userEvent.selectOptions(within(dlg).getByLabelText('Khách hàng sở hữu nội dung'), 'c1');
    await userEvent.type(within(dlg).getByLabelText('Liên kết video'), 'https://www.youtube.com/watch?v=1');
    expect(within(dlg).getByRole('status')).toHaveTextContent('trang xem video');
    await userEvent.clear(within(dlg).getByLabelText('Liên kết video'));
    await userEvent.type(within(dlg).getByLabelText('Liên kết video'), 'https://cdn.adhost.vn/a.mp4');
    await userEvent.type(within(dlg).getByLabelText('Thời lượng video (giây)'), '15');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Thêm link video' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/media/link'))?.body).toMatchObject({ url: 'https://cdn.adhost.vn/a.mp4', duration_sec: 15, target_type: 'tv', customer_id: 'c1' }));
  });

  it('duyet creative stream: xem truoc + thong tin + bat buoc tick "da xem toan bo" roi gui confirm_full_view', async () => {
    handlers.push(me, on('/admin/v1/media', { items: [m1], total: 1, page: 1, page_size: 9 }), on('/admin/v1/media/m1', { ...m1, preview_url: stream.stream_url }), on('/admin/v1/media/m1/approve', { ...m1, status: 'approved' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    await userEvent.click(await screen.findByRole('button', { name: 'Xem và duyệt' }));
    const dlg = await screen.findByRole('dialog', { name: 'Xem và duyệt tệp' });
    expect(await within(dlg).findByLabelText('Xem trước a.mp4')).toHaveAttribute('src', stream.stream_url);
    expect(within(dlg).getByLabelText('Thông tin liên kết video')).toHaveTextContent('cdn.adhost.vn');
    expect(within(dlg).getByLabelText('Thông tin liên kết video')).toHaveTextContent('7680×4320 (8K)');
    expect(within(dlg).getByLabelText('Cảnh báo về video')).toHaveTextContent('Máy chủ không trả ETag');
    await userEvent.type(within(dlg).getAllByRole('textbox')[0]!, 'da xem het');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Duyệt video' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Tôi đã xem toàn bộ nội dung');
    await userEvent.click(within(dlg).getByRole('checkbox', { name: /đã xem toàn bộ/i }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Duyệt video' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('cam kết pháp lý'); // bat buoc tick cam ket
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Cam kết pháp lý' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Duyệt video' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/m1/approve'))?.body).toEqual({ manual_review_note: 'da xem het', content_version: 3, attest: { accepted: true, version: 'legal-v1', kid_safe: false }, confirm_full_view: true }));
  });
});
