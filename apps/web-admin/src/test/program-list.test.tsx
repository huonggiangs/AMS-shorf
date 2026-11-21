// Danh sach chuong trinh phat song: /workbench (gan day) va /schedule (tab noi bo).
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



const prog = (id: string, name: string, target: string, status: string, orient?: 'portrait' | 'landscape', zones = 0, upd = '2026-11-21T09:00:00Z') => ({
  id, name, target_type: target, regions: ['HN'], start_date: '2026-11-20', end_date: '2027-11-20', start_min: 360, end_min: 1320, priority: 1, header: null, footer: null,
  status, version: 2, item_count: 2, updated_at: upd, published_at: null, items: [],
  layout: orient ? { template_id: null, orientation: orient, zones: Array.from({ length: zones }, (_, i) => ({ id: `z${i}`, type: 'video', x: 0, y: 0, w: 100, h: 100, z: i })) } : null,
});
const list = { items: [prog('p-old', 'Chương trình cũ', 'elevator', 'draft', undefined, 0, '2026-11-01T00:00:00Z'), prog('p-new', 'Menu F&B Giờ Vàng', 'elevator', 'published', 'portrait', 3), prog('p-tv', 'Sảnh ngang TV', 'tv', 'ended')], total: 3 };

describe('Danh sach chuong trinh phat song', () => {
  it('/schedule mo tab noi bo, hien dinh dang va loc theo huong', async () => {
    handlers.push(me(['view', 'write']), on('/admin/v1/broadcast', list));
    vi.stubGlobal('fetch', mockFetch());
    mount('/schedule');
    expect(await screen.findByText('Menu F&B Giờ Vàng')).toBeTruthy();
    expect(screen.getByText('Phiên bản v2 · 3 vùng hiển thị')).toBeTruthy();
    expect(screen.getByText('Đã xuất bản')).toBeTruthy();
    expect(screen.getByText('Bản nháp')).toBeTruthy();
    expect(screen.getByText('Đã kết thúc')).toBeTruthy();
    expect(screen.getAllByText('Dọc 9:16').length).toBe(2);
    expect(screen.getByText('Ngang 16:9')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gỡ phát' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Màn hình Ngang 16:9' }));
    expect(screen.queryByText('Menu F&B Giờ Vàng')).toBeNull();
    expect(screen.getByText('Sảnh ngang TV')).toBeTruthy();
  });

  it('nut Phat hanh ngay goi publish; tab Lich chien dich van con', async () => {
    handlers.push(me(['view', 'write']), on('/admin/v1/broadcast', list), on('/admin/v1/broadcast/p-old/publish', { ok: true }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/schedule');
    await screen.findByText('Chương trình cũ');
    await userEvent.click(screen.getAllByRole('button', { name: 'Phát hành ngay' })[0]!);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/v1/broadcast/p-old/publish')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Lịch chiến dịch' }));
    expect(await screen.findByText('Timeline kéo thả')).toBeTruthy();
  });

  it('/workbench hien chuong trinh gan day, moi nhat truoc, co lien ket Xem tat ca', async () => {
    handlers.push(me(['view', 'write']), on('/admin/v1/broadcast-insights/summary', { programs: { total: 3, live: 1, published: 1, draft: 1, expired: 1, recent: [] }, media: { pending_review: 0, approved: 0, rejected: 0 }, devices: { online: 0, offline: 0, awaiting_approval: 0, regions: [] }, notices: [], queue: { pending: 0, delivered: 0, failed: 0 } }), on('/admin/v1/broadcast', list));
    vi.stubGlobal('fetch', mockFetch());
    mount('/workbench');
    expect(await screen.findByText('Chương trình phát sóng gần đây')).toBeTruthy();
    const rows = (await screen.findAllByText(/Phiên bản v2/)).map((e) => e.parentElement?.textContent ?? '');
    expect(rows[rows.length - 1]).toContain('Chương trình cũ');
    expect(screen.getByRole('button', { name: 'Xem tất cả' })).toBeTruthy();
  });
});
