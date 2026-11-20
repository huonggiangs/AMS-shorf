// w-web: trang Noi dung & Media giai thich moi trang thai khong duyet duoc + duyet 1 buoc; popup co kich thuoc md/lg/xl.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { Dialog } from '../components/Dialog';
import { reasonText } from '../pages/CreativeReview';

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
const media = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `${id}.mp4`, kind: 'video', mime: 'video/mp4', width: 1920, height: 1080, duration_sec: 312, size_bytes: 250 * 1048576, status: 'pending', owner_name: 'Vinamilk', scan_state: 'needs_manual_review', scan_reasons: ['too_large_to_read_inline'], content_version: 2, blocker: null, ...extra });
const BLK = (code: string, action: string, message: string) => ({ code, action, message });

beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('Noi dung & Media: moi trang thai khong duyet duoc co giai thich + hanh dong', () => {
  it('needs_manual_review: khong co nut Duyet thuong; co ly do, "Xem va duyet" mo popup xem truoc, duyet 1 buoc gui ghi chu + phien ban', async () => {
    const m = media('m1', { blocker: BLK('creative_needs_manual_review', 'manual_review', 'Tệp chưa qua kiểm tra tự động nên cần người có quyền kiểm tra thủ công trước khi duyệt.') });
    handlers.push(me(['view', 'write', 'approve']), on('/admin/v1/media', { items: [m], total: 1, page: 1, page_size: 9 }), on('/admin/v1/media/m1', { ...m, preview_url: 'https://files.example/m1.mp4' }), on('/admin/v1/media/m1/approve', { ...m, status: 'approved' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    const why = await screen.findByRole('status', { name: 'Vì sao chưa duyệt được' });
    expect(why).toHaveTextContent('cần người có quyền kiểm tra thủ công');
    expect(why).toHaveTextContent('Tệp quá lớn để đọc kiểm tra tự động'); // ly do duoc dich
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull(); // khong con nut Duyet that bai
    await userEvent.click(within(why).getByRole('button', { name: 'Xem và duyệt' }));
    const dlg = await screen.findByRole('dialog', { name: 'Xem và duyệt tệp' });
    expect(dlg.className).toContain('xl');
    expect(await within(dlg).findByLabelText('Xem trước m1.mp4')).toHaveAttribute('src', 'https://files.example/m1.mp4');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Duyệt tệp' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('tối thiểu 3 ký tự');
    await userEvent.type(within(dlg).getByRole('textbox'), 'da xem het video');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Duyệt tệp' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/m1/approve'))?.body).toEqual({ manual_review_note: 'da xem het video', content_version: 2 }));
  });

  it('scan pending: hien "Kiem tra lai" va goi /recheck; tep chua xac nhan: "Xac nhan lai" goi /confirm', async () => {
    const p = media('p1', { scan_state: 'pending', scan_reasons: [], blocker: BLK('creative_scan_pending', 'recheck', 'Tệp đang chờ quét. Vui lòng thử lại sau ít phút.') });
    const u = media('u1', { status: 'processing', scan_state: 'pending', scan_reasons: [], blocker: BLK('upload_incomplete', 'confirm', 'Tệp chưa tải xong hoặc chưa được xác nhận.') });
    handlers.push(me(['view', 'write', 'approve']), on('/admin/v1/media', { items: [p, u], total: 2, page: 1, page_size: 9 }), on('/admin/v1/media/p1/recheck', p, 'POST'), on('/admin/v1/media/u1/confirm', u, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    const boxes = await screen.findAllByRole('status', { name: 'Vì sao chưa duyệt được' });
    expect(boxes).toHaveLength(2);
    await userEvent.click(within(boxes[0]!).getByRole('button', { name: 'Kiểm tra lại' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/p1/recheck'))).toBe(true));
    await userEvent.click(within(boxes[1]!).getByRole('button', { name: 'Xác nhận lại' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/u1/confirm'))).toBe(true));
  });

  it('tep sach (khong blocker): van co nut Duyet thuong; nguoi khong co quyen duyet khong thay nut Xem va duyet', async () => {
    handlers.push(me(['view', 'write', 'approve']), on('/admin/v1/media', { items: [media('c1', { scan_state: 'clean', scan_reasons: [] })], total: 1, page: 1, page_size: 9 }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    expect(await screen.findByRole('button', { name: 'Duyệt' })).toBeInTheDocument();
  });

  it('khong co media:approve: thay giai thich nhung khong co nut duyet tay', async () => {
    const m = media('m2', { blocker: BLK('creative_needs_manual_review', 'manual_review', 'Cần kiểm tra thủ công.') });
    handlers.push(me(['view', 'write']), on('/admin/v1/media', { items: [m], total: 1, page: 1, page_size: 9 }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    const why = await screen.findByRole('status', { name: 'Vì sao chưa duyệt được' });
    expect(within(why).queryByRole('button', { name: 'Xem và duyệt' })).toBeNull();
    expect(why).toHaveTextContent('Cần người có quyền duyệt xem tệp.');
  });

  it('hop thoai tai len ghi ro gioi han dung luong/thoi luong', async () => {
    handlers.push(me(['view', 'write']), on('/admin/v1/media', { items: [], total: 0 }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/media');
    await userEvent.click(await screen.findByRole('button', { name: /Tải nội dung mới/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Tải nội dung' });
    expect(dlg).toHaveTextContent('tối đa 100 MB');
    expect(dlg).toHaveTextContent('AV1');
    expect(dlg).toHaveTextContent('5–60 giây');
    expect(dlg.className).toContain('lg');
  });
});

describe('reasonText', () => {
  it('dich ma co tham so', () => {
    expect(reasonText('too_large_to_read_inline')).toMatch(/quá lớn/);
    expect(reasonText('dimensions_mismatch:1920x1080!=1080x1920')).toContain('1920x1080 so với 1080x1920');
    expect(reasonText('mp4_brand_not_allowed:qt')).toContain('(qt)');
    expect(reasonText('mp4_trailing_bytes')).toMatch(/dữ liệu thừa/);
    expect(reasonText('khong_biet')).toBe('khong_biet');
  });
});

describe('Dialog: kich thuoc', () => {
  it.each(['sm', 'md', 'lg', 'xl'] as const)('size=%s -> class %s; mac dinh md', (s) => {
    const { container, unmount } = render(<Dialog open onClose={() => undefined} size={s} label="x"><p>noi dung</p></Dialog>);
    expect(container.querySelector('dialog')!.className).toBe(`dlg ${s}`);
    unmount();
  });
  it('mac dinh la md', () => {
    const { container } = render(<Dialog open onClose={() => undefined} label="x"><p>n</p></Dialog>);
    expect(container.querySelector('dialog')!.className).toBe('dlg md');
  });
});
