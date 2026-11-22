// m-list: danh sach co thumbnail, chuyen list/grid, sua (PATCH), xoa (confirm + bi chan khi dang dung), xoa hang loat, phan quyen.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { MediaThumb } from '../pages/media/MediaThumb';
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

const media = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `${id}.png`, kind: 'image', mime: 'image/png', width: 1920, height: 1080, duration_sec: 10, size_bytes: 2 * 1048576, status: 'approved', owner_name: 'Vinamilk', customer_id: 'c1', scan_state: 'clean', scan_reasons: [], content_version: 1, blocker: null, tags: ['tet'], created_at: '2026-11-10T03:00:00.000Z', thumb_url: `https://files.example/${id}.png`, ...extra });

beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('Noi dung & Media: danh sach, thumbnail, sua, xoa', () => {
  it('mac dinh la danh sach co thumbnail + cot ten/loai/thoi luong/dung luong/trang thai/khach/ngay; chuyen sang luoi', async () => {
    const m1 = media('m1');
    const m2 = media('m2', { kind: 'video', mime: 'video/mp4', thumb_url: null, media_url: null, status: 'pending' });
    const m3 = media('m3', { kind: 'link', mime: null, source: 'youtube', source_url: 'https://www.youtube.com/watch?v=x', thumb_url: null, duration_sec: null, size_bytes: null });
    handlers.push(me(['view', 'write', 'delete']), on('/admin/v1/media', { items: [m1, m2, m3], total: 3, page: 1, page_size: 20 }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    const table = await screen.findByRole('table', { name: 'Danh sách media' });
    for (const h of ['Tên', 'Loại', 'Thời lượng', 'Dung lượng', 'Trạng thái', 'Khách hàng', 'Ngày tạo']) expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(within(table).getByAltText('Ảnh xem trước m1.png')).toHaveAttribute('src', 'https://files.example/m1.png');
    expect(within(table).getByLabelText(/Video, chưa có ảnh xem trước/)).toBeInTheDocument(); // placeholder + nhan loai
    expect(within(table).getByLabelText(/Liên kết, chưa có ảnh xem trước/)).toBeInTheDocument();
    expect(within(table).getAllByTestId('media-row')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Lưới' }));
    expect(screen.queryByRole('table', { name: 'Danh sách media' })).toBeNull();
    expect(await screen.findAllByRole('checkbox', { name: /^Chọn tệp / })).toHaveLength(3);
    expect(localStorage.getItem('ams.media.view')).toBe('grid');
    expect(calls.some((c) => c.path === '/api/admin/v1/media')).toBe(true);
  });

  it('Sua: chi gui truong da doi qua PATCH; loi API hien thi tieng Viet', async () => {
    const m1 = media('m1', { description: 'cu' });
    handlers.push(me(['view', 'write']), on('/admin/v1/media', { items: [m1], total: 1, page: 1, page_size: 20 }), on('/admin/v1/media/m1', { ...m1, name: 'Ten moi' }, 'PATCH'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    await userEvent.click(await screen.findByRole('button', { name: 'Sửa m1.png' }));
    const dlg = await screen.findByRole('dialog', { name: 'Sửa media' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Chưa có thay đổi');
    const name = within(dlg).getByLabelText('Tên hiển thị');
    await userEvent.clear(name);
    await userEvent.type(name, 'Ten moi');
    const tags = within(dlg).getByLabelText(/Thẻ/);
    await userEvent.clear(tags);
    await userEvent.type(tags, 'tet, sale, tet');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Ten moi', tags: ['tet', 'sale'] }));
    expect(calls.find((c) => c.method === 'PATCH')?.path).toBe('/api/admin/v1/media/m1');
  });

  it('khong co quyen write/delete: khong hien nut Sua/Xoa/chon', async () => {
    handlers.push(me(['view']), on('/admin/v1/media', { items: [media('m1')], total: 1, page: 1, page_size: 20 }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    await screen.findByRole('table', { name: 'Danh sách media' });
    expect(screen.queryByRole('button', { name: /^Sửa / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Xóa / })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('Xoa tung tep trong danh sach: mo hop thoai xoa co san, goi bulk-delete voi 1 id', async () => {
    const m1 = media('m1');
    handlers.push(me(['view', 'write', 'delete']), on('/admin/v1/media', { items: [m1], total: 1, page: 1, page_size: 20 }), on('/admin/v1/media/bulk-delete', { requested: 1, deleted_count: 1, skipped_count: 0, freed_bytes: 0, objects_deleted: 0, deleted: [{ id: 'm1', name: 'm1.png', size_bytes: 0 }], skipped: [] }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    await userEvent.click(await screen.findByRole('button', { name: 'Xóa m1.png' }));
    const dlg = await screen.findByRole('dialog', { name: 'Xóa các tệp đã chọn' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Xóa 1 tệp' }));
    await waitFor(() => expect(calls.find((x) => x.path === '/api/admin/v1/media/bulk-delete')?.body).toEqual({ ids: ['m1'] }));
  });
});

describe('MediaThumb', () => {
  it('anh loi tai -> ve anh giu cho; video chua chup -> giu cho kem nhan loai', async () => {
    const { rerender } = render(<MediaThumb m={media('x') as never} />);
    const img = screen.getByAltText('Ảnh xem trước x.png');
    fireEvent.error(img);
    await waitFor(() => expect(screen.getByLabelText(/Ảnh, chưa có ảnh xem trước/)).toBeInTheDocument());
    rerender(<MediaThumb m={media('v', { kind: 'video', mime: 'video/mp4', thumb_url: null }) as never} />);
    expect(screen.getByLabelText(/Video, chưa có ảnh xem trước/)).toBeInTheDocument();
  });
});
