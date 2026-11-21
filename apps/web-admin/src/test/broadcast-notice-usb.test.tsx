// Thong bao khan (gui lenh message theo loai man/khu vuc) + chep goi USB cua chuong trinh phat song.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { linksText, playlistText, sha256Hex, usbSupported } from '../lib/usbExport';

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
const me = (schedule: string[]): Handler => (u) => (u.pathname === '/api/auth/me' ? { body: { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'admin' }, permissions: { overview: ['view'], customers: ['view'], schedule } } } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };
beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('Thong bao khan', () => {
  it('co quyen schedule:write: gui noi dung + loai man + khu vuc, hien ket qua; lich su', async () => {
    handlers.push(
      me(['view', 'write']),
      on('/admin/v1/broadcast/notice', { items: [{ id: 'h1', at: '2026-11-21T09:00:00Z', actor: 'Admin', text: 'Cúp điện 14h', target: 'elevator', regions: ['HN'], matched: 3, queued: 3, skipped: 0 }], total: 1 }),
      on('/admin/v1/broadcast/notice', { matched: 3, queued: 3, skipped: 0, ttl_s: 600 }, 'POST', 201),
    );
    vi.stubGlobal('fetch', mockFetch());
    vi.stubGlobal('confirm', () => true);
    const user = userEvent.setup();
    mount('/notice');
    expect(await screen.findByText('Cúp điện 14h')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Nội dung/), 'Bảo trì 15h');
    await user.selectOptions(screen.getByLabelText('Gửi tới'), 'elevator');
    await user.type(screen.getByLabelText('Khu vực'), 'HN, HCM');
    await user.click(screen.getByRole('button', { name: 'Gửi thông báo' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/v1/broadcast/notice')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ text: 'Bảo trì 15h', duration_s: 30, target: 'elevator', regions: ['HN', 'HCM'] });
  });

  it('khong co quyen ghi: khong co form gui', async () => {
    handlers.push(me(['view']), on('/admin/v1/broadcast/notice', { items: [], total: 0 }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/notice');
    expect(await screen.findByText('Chưa gửi thông báo nào.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi thông báo' })).toBeNull();
  });
});

describe('Goi USB: helper', () => {
  const pkg = { program_id: 'p', name: 'P', folder: 'ANIO', playlist: { version: 'v1', items: [{ id: 'a', file: '001-a.mp4', url: '001-a.mp4', duration: 15 }] }, files: [{ name: '001-a.mp4', url: 'https://m/x?sig=1', sha256: null, size_bytes: 5 }], total_bytes: 5 };
  it('playlist.json + danh sach lien ket + sha256 + khong ho tro showDirectoryPicker', async () => {
    expect(JSON.parse(playlistText(pkg))).toMatchObject({ version: 'v1', items: [{ file: '001-a.mp4', duration: 15 }] });
    expect(linksText(pkg)).toBe('001-a.mp4\thttps://m/x?sig=1');
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(usbSupported()).toBe(false);
  });
});

describe('Chuong trinh phat song: nut Chep ra USB', () => {
  it('hien nut khi co tep; mo hop thoai; goi usb-package', async () => {
    const prog = { id: 'p1', name: 'Gioi thieu', target_type: 'elevator', regions: [], start_min: 0, end_min: 1440, priority: 3, status: 'draft', version: 1, item_count: 2 };
    handlers.push(me(['view', 'write']), on('/admin/v1/broadcast', { items: [prog, { ...prog, id: 'p2', name: 'Rong', item_count: 0 }], total: 2, page: 1, page_size: 100 }));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/broadcast');
    expect(await screen.findByText('Gioi thieu')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Chép ra USB' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Chép ra USB' }));
    expect(await screen.findByRole('dialog', { name: 'Chép ra USB' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải danh sách' })).toBeInTheDocument();
  });
});
