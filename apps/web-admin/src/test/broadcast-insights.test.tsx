// Ban lam viec, Phan phoi thong minh, Hang doi & Nhat ky (phat song noi bo).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

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
const me = (schedule: string[]): Handler => (u) => (u.pathname === '/api/auth/me' ? { body: { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'admin' }, permissions: { overview: ['view'], customers: ['view'], schedule, devices: schedule } } } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };
beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());


const summary = {
  programs: { total: 3, live: 1, published: 2, draft: 1, expired: 0, recent: [{ id: 'p1', name: 'Giới thiệu tòa nhà', target_type: 'elevator', status: 'published', live: true, item_count: 4, updated_at: '2026-11-21T09:00:00Z' }] },
  media: { pending_review: 5, approved: 12, rejected: 1 },
  devices: { online: 7, offline: 2, awaiting_approval: 1, regions: [{ region: 'HN', online: 5, offline: 1 }] },
  notices: [{ id: 'n1', at: '2026-11-21T09:00:00Z', text: 'Cúp điện 14h', target: 'elevator', regions: ['HN'], matched: 3, queued: 3 }],
  queue: { pending: 2, delivered: 1, failed: 4 },
};

describe('Ban lam viec', () => {
  it('hien so lieu tong quan va loi tat theo quyen', async () => {
    handlers.push(me(['view', 'write']), on('/admin/v1/broadcast-insights/summary', summary));
    vi.stubGlobal('fetch', mockFetch());
    mount('/workbench');
    expect(await screen.findByText('Giới thiệu tòa nhà')).toBeInTheDocument();
    expect(screen.getByText('Tệp chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText('Cúp điện 14h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tạo chương trình/ })).toBeInTheDocument();
    expect(screen.getByText(/4 lệnh gửi thiết bị bị lỗi/)).toBeInTheDocument();
  });
  it('chi xem: khong co nut tao/gui', async () => {
    handlers.push(me(['view']), on('/admin/v1/broadcast-insights/summary', summary));
    vi.stubGlobal('fetch', mockFetch());
    mount('/workbench');
    await screen.findByText('Giới thiệu tòa nhà');
    expect(screen.queryByRole('button', { name: /Tạo chương trình/ })).toBeNull();
  });
});

describe('Phan phoi thong minh', () => {
  it('gui ngu canh, hien xep hang + ly do + canh bao; lich su', async () => {
    handlers.push(
      me(['view']),
      on('/admin/v1/broadcast-insights/recommend', { items: [{ id: 'h1', at: '2026-11-21T08:00:00Z', actor: 'Admin', context: { place: 'mall', hour: 10, audience: 'adult', density: 'high' }, top: [{ id: 'p1', name: 'Khuyến mãi', score: 77 }] }], total: 1 }),
      on('/admin/v1/broadcast-insights/recommend', { engine: 'rules', summary: 'Đề xuất “Giới thiệu tòa nhà” (82/100).', items: [{ program_id: 'p1', name: 'Giới thiệu tòa nhà', status: 'published', target_type: 'elevator', score: 82, reasons: ['Khung giờ 06:00–12:00 bao trùm 09h (+15).'], warnings: ['2 tệp chưa duyệt (−30).'], regions: ['HN'], groups: [{ region: 'HN', online: 3, total: 4 }], online_total: 3, device_total: 4 }], media_suggestions: [] }, 'POST'),
    );
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/smart');
    expect(await screen.findByText(/Khuyến mãi \(77\)/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Loại địa điểm'), 'office');
    await user.selectOptions(screen.getByLabelText('Đối tượng xem'), 'child');
    await user.click(screen.getByRole('button', { name: 'Đề xuất phân phối' }));
    expect(await screen.findByText(/Khung giờ 06:00–12:00/)).toBeInTheDocument();
    expect(screen.getByText(/2 tệp chưa duyệt/)).toBeInTheDocument();
    expect(screen.getByText(/HN \(3\/4\)/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ place: 'office', audience: 'child' });
    expect(typeof post.body!['hour']).toBe('number');
  });
});

describe('Hang doi & Nhat ky', () => {
  const row = (o: Record<string, unknown>) => ({ id: 'c1', device_id: 'd1', device_name: 'TM Sảnh A', device_kind: 'elevator', region: 'HN', type: 'message', args: { text: 'Xin chào' }, status: 'pending', state: 'pending', created_at: '2026-11-21T09:00:00Z', deliveries: 0, cancellable: true, ...o });
  it('hang doi: hien lenh, huy lenh dang cho, thu lai lenh loi; tab nhat ky', async () => {
    handlers.push(
      me(['view', 'write']),
      on('/admin/v1/broadcast-insights/queue', { items: [row({}), row({ id: 'c2', type: 'reboot', args: {}, status: 'failed', state: 'failed', cancellable: false })], total: 2, page: 1, page_size: 10 }),
      on('/admin/v1/devices/d1/commands/c1/cancel', { id: 'c1' }, 'POST'),
      on('/admin/v1/devices/d1/commands', { id: 'c3' }, 'POST', 201),
      on('/admin/v1/broadcast-insights/logs', { items: [{ id: 'l1', at: '2026-11-21T08:00:00Z', actor: 'Admin', action: 'broadcast.publish', object_type: 'broadcast_program', object_id: 'p1', diff: null }], total: 1, page: 1, page_size: 10 }),
    );
    vi.stubGlobal('fetch', mockFetch());
    vi.stubGlobal('confirm', () => true);
    const user = userEvent.setup();
    mount('/queue');
    expect((await screen.findAllByText('TM Sảnh A')).length).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/v1/devices/d1/commands/c1/cancel')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/v1/devices/d1/commands')).toBe(true));
    expect(calls.find((c) => c.path === '/api/admin/v1/devices/d1/commands')!.body).toEqual({ type: 'reboot', args: {} });
    await user.click(screen.getByRole('button', { name: 'Nhật ký phát sóng' }));
    expect(await screen.findByRole('cell', { name: 'Xuất bản' })).toBeInTheDocument();
  });
});
