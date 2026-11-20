// Trang Media: chon nhieu tep + "Xoa da chon" (hop xac nhan, go XOA khi > 5 tep, ket qua kem ly do bo qua). Chi hien voi quyen media:delete.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { chunkIds, fmtBytes } from '../pages/MediaPage';

type Handler = (url: URL, method: string, body: Record<string, unknown> | null) => { status?: number; body: unknown } | undefined;
let handlers: Handler[] = [];
const calls: { method: string; path: string; search: string; body: Record<string, unknown> | null }[] = [];
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, search: url.search, body });
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
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };
const media = (i: number) => ({ id: `m${i}`, name: `thu-${i}.mp4`, kind: 'video', mime: 'video/mp4', width: 1080, height: 1920, duration_sec: 15, size_bytes: 10 * 1048576, status: 'approved', owner_name: 'Vinamilk', scan_state: 'clean', scan_reasons: [], content_version: 1, blocker: null, thumb_url: null });
const page = (n: number, total = n) => ({ items: Array.from({ length: n }, (_, i) => media(i + 1)), total, page: 1, page_size: 9 });

beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('helpers xoa hang loat', () => {
  it('chunkIds chia <= 200 id; fmtBytes', () => {
    expect(chunkIds(Array.from({ length: 450 }, (_, i) => `a${i}`)).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(fmtBytes(10 * 1048576)).toBe('10.0 MB');
    expect(fmtBytes(3 * 1073741824)).toBe('3.00 GB');
  });
});

describe('Media: xoa hang loat', () => {
  it('khong co quyen media:delete -> khong co o chon, khong co nut Xoa da chon', async () => {
    handlers.push(me(['view', 'write', 'approve']), on('/admin/v1/media', page(2)));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    expect(await screen.findByText('thu-1.mp4')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Xóa đã chọn/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chọn tất cả trang này' })).toBeNull();
  });

  it('chon 2 tep: hop xac nhan neu so tep + dung luong + canh bao khong hoan tac, KHONG bat go XOA; gui ids; hien tep bi bo qua kem ly do', async () => {
    handlers.push(
      me(['view', 'write', 'approve', 'delete']),
      on('/admin/v1/media', page(3)),
      on('/admin/v1/media/bulk-delete', { requested: 2, deleted_count: 1, skipped_count: 1, freed_bytes: 10 * 1048576, objects_deleted: 2, deleted: [{ id: 'm1', name: 'thu-1.mp4', size_bytes: 10 * 1048576 }], skipped: [{ id: 'm2', name: 'thu-2.mp4', code: 'in_use', reason: 'Đang dùng trong chiến dịch Tết 2027' }] }, 'POST'),
    );
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/media');
    await screen.findByText('thu-1.mp4');
    const del = screen.getByRole('button', { name: 'Xóa đã chọn' });
    expect(del).toBeDisabled();
    await user.click(screen.getByLabelText('Chọn tệp thu-1.mp4'));
    await user.click(screen.getByLabelText('Chọn tệp thu-2.mp4'));
    expect(screen.getByText('Đã chọn 2 tệp')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa đã chọn (2)' }));
    const d = await screen.findByRole('dialog', { name: 'Xóa các tệp đã chọn' });
    expect(d).toHaveTextContent('2 tệp');
    expect(d).toHaveTextContent('20.0 MB');
    expect(d).toHaveTextContent('không thể hoàn tác');
    expect(within(d).queryByLabelText(/Gõ XOA/)).toBeNull();
    await user.click(within(d).getByRole('button', { name: 'Xóa 2 tệp' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/api/admin/v1/media/bulk-delete')?.body).toEqual({ ids: ['m1', 'm2'] }));
    const list = await within(d).findByRole('list', { name: 'Tệp bị bỏ qua' });
    expect(list).toHaveTextContent('thu-2.mp4: Đang dùng trong chiến dịch Tết 2027');
    expect(d).toHaveTextContent('Đã xóa 1 tệp');
  });

  it('hon 5 tep: phai go dung XOA moi bam duoc; "Chon tat ca trang nay" chon het; chu thuong khong du', async () => {
    handlers.push(me(['view', 'write', 'approve', 'delete']), on('/admin/v1/media', page(6)), on('/admin/v1/media/bulk-delete', { requested: 6, deleted_count: 6, skipped_count: 0, freed_bytes: 60 * 1048576, deleted: Array.from({ length: 6 }, (_, i) => ({ id: `m${i + 1}`, name: `thu-${i + 1}.mp4` })), skipped: [] }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/media');
    await screen.findByText('thu-1.mp4');
    await user.click(screen.getByRole('button', { name: 'Chọn tất cả trang này' }));
    expect(screen.getByText('Đã chọn 6 tệp')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa đã chọn (6)' }));
    const d = await screen.findByRole('dialog', { name: 'Xóa các tệp đã chọn' });
    expect(d).toHaveTextContent('60.0 MB');
    const go = within(d).getByRole('button', { name: 'Xóa 6 tệp' });
    expect(go).toBeDisabled();
    const box = within(d).getByLabelText('Gõ XOA để xác nhận');
    await user.type(box, 'xoa');
    expect(go).toBeDisabled();
    await user.clear(box);
    await user.type(box, 'XOA');
    expect(go).toBeEnabled();
    await user.click(go);
    await waitFor(() => expect(calls.find((c) => c.path === '/api/admin/v1/media/bulk-delete')?.body).toEqual({ ids: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] }));
    expect(await within(d).findByRole('status')).toHaveTextContent('Đã xóa 6 tệp');
  });

  it('"Chon tat ca N tep (theo bo loc hien tai)" lay moi trang theo bo loc; huy khong goi API xoa', async () => {
    handlers.push(me(['view', 'write', 'approve', 'delete']), (u, m) => {
      if (u.pathname !== '/api/admin/v1/media' || m !== 'GET') return undefined;
      return u.searchParams.get('page_size') === '200' ? { body: { items: Array.from({ length: 30 }, (_, i) => media(i + 1)), total: 30, page: 1, page_size: 200 } } : { body: { ...page(9, 30) } };
    });
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/media');
    await screen.findByText('thu-1.mp4');
    await user.click(screen.getByRole('button', { name: 'Chọn tất cả 30 tệp (theo bộ lọc hiện tại)' }));
    expect(await screen.findByText('Đã chọn 30 tệp')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa đã chọn (30)' }));
    const d = await screen.findByRole('dialog', { name: 'Xóa các tệp đã chọn' });
    expect(d).toHaveTextContent('300.0 MB');
    await user.click(within(d).getByRole('button', { name: 'Hủy' }));
    expect(calls.some((c) => c.path.endsWith('/bulk-delete'))).toBe(false);
  });
});
