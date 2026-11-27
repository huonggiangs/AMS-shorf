// Cam ket phap ly: o bat buoc khi duyet nhanh, nhan 'Thieu cam ket phap ly', ky bo sung va ky hang loat co xac nhan.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

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
const me = (media: string[]): Handler => (u) => (u.pathname === '/api/auth/me' ? { body: { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'admin' }, permissions: { overview: ['view'], customers: ['view'], media } } } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const media = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `${id}.png`, kind: 'image', mime: 'image/png', width: 1920, height: 1080, size_bytes: 1048576, status: 'approved', owner_name: 'Vinamilk', scan_state: 'clean', scan_reasons: [], content_version: 1, blocker: null, ...extra });
const MISSING = { status: 'missing', kid_safe: false };

beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('Media: cam ket phap ly', () => {
  it('duyet nhanh: bat buoc tick cam ket; kid_safe mac dinh bo trong; gui attest dung dinh dang', async () => {
    const p = media('p1', { status: 'pending', attestation: MISSING });
    handlers.push(me(['view', 'write', 'approve']), on('/admin/v1/media', { items: [p], total: 1, page: 1, page_size: 9 }), on('/admin/v1/media/p1/approve', { ...p, status: 'approved' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    await userEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    const dlg = await screen.findByRole('dialog', { name: 'Duyệt tệp' });
    expect(within(dlg).getByText(/Tôi xác nhận nội dung này không vi phạm pháp luật Việt Nam/)).toBeInTheDocument();
    expect(within(dlg).getByRole('checkbox', { name: 'Phù hợp trẻ em' })).not.toBeChecked();
    expect(within(dlg).getByText(/chờ luật sư rà soát/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Duyệt' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('cam kết pháp lý');
    expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/p1/approve'))).toBeUndefined();
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Cam kết pháp lý' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/p1/approve'))?.body).toMatchObject({ attest: { accepted: true, version: 'legal-v1', kid_safe: false } }));
  });

  it('tep da duyet thieu cam ket: nhan "Thieu cam ket phap ly" + nut ky bo sung; co cam ket: nhan da ky', async () => {
    const a = media('a1', { attestation: MISSING });
    const b = media('b1', { attestation: { status: 'valid', kid_safe: true, signed_by_name: 'Lê Trường Sơn', signed_at: '2026-11-23T01:00:00Z', version: 'legal-v1' } });
    handlers.push(me(['view', 'write', 'approve']), on('/admin/v1/media', { items: [a, b], total: 2, page: 1, page_size: 9 }), on('/admin/v1/media/a1/attest', { result: 'signed' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    expect(await screen.findByText('Thiếu cam kết pháp lý')).toBeInTheDocument();
    expect(screen.getByText('Đã ký cam kết')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Ký cam kết' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Ký cam kết' }));
    const dlg = await screen.findByRole('dialog', { name: 'Ký cam kết pháp lý' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Ký cam kết' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('cam kết pháp lý');
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Cam kết pháp lý' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Ký cam kết' }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/a1/attest'))?.body).toEqual({ attest: { accepted: true, version: 'legal-v1', kid_safe: false } }));
  });

  it('ky xac nhan hang loat: can tick cam ket + xac nhan; gui confirm:true', async () => {
    const a = media('a1', { attestation: MISSING });
    handlers.push(me(['view', 'write', 'approve']), (u) => (u.pathname === '/api/admin/v1/media' ? { body: { items: u.searchParams.get('filter')?.includes('attestation:missing') ? [a] : [], total: 1, page: 1, page_size: 9 } } : undefined), on('/admin/v1/media/attest-bulk', { signed: ['a1'], skipped: [], total: 1 }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    await userEvent.click(await screen.findByRole('button', { name: 'Ký xác nhận hàng loạt' }));
    const dlg = await screen.findByRole('dialog', { name: 'Ký xác nhận hàng loạt' });
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Cam kết pháp lý' }));
    await userEvent.click(within(dlg).getByRole('button', { name: /Ký cho 1 tệp/ }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('chịu trách nhiệm');
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Xác nhận ký hàng loạt' }));
    await userEvent.click(within(dlg).getByRole('button', { name: /Ký cho 1 tệp/ }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/attest-bulk'))?.body).toEqual({ ids: ['a1'], attest: { accepted: true, version: 'legal-v1', kid_safe: false }, confirm: true }));
  });

  it('khong co media:approve: khong co nut ky', async () => {
    handlers.push(me(['view', 'write']), on('/admin/v1/media', { items: [media('a1', { attestation: MISSING })], total: 1, page: 1, page_size: 9 }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    expect(await screen.findByText('Thiếu cam kết pháp lý')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ký cam kết' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ký xác nhận hàng loạt' })).toBeNull();
  });
});
