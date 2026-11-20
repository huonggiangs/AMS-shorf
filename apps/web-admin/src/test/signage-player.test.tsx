import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

type Reply = { status?: number; body: unknown } | undefined;
type Handler = (url: URL, init?: RequestInit) => Reply;
let handlers: Handler[] = [];
const reqs: { method: string; path: string; body?: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    reqs.push({ method: init?.method ?? 'GET', path: url.pathname, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const mk = (perms: Record<string, string[]>): unknown => ({ user: { id: 'u1', email: 'o@ams.vn', name: 'Vận hành', role: 'super_admin' }, permissions: { overview: ['view'], ...perms } });
const me = (m: unknown): Handler => (u) => (u.pathname === '/api/auth/me' ? { body: m } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
// jsdom chua co HTMLDialogElement.close/showModal
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };
beforeEach(() => { handlers = []; reqs.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

const lift = { id: 'e1', name: 'Thang máy A1', kind: 'elevator', model: 'RK3566', os: 'android', owner_name: null, app_version: '1.2.0', region: 'HN', status: 'checking', trust_level: 0, pairing_state: 'awaiting_approval', grant_state: 'awaiting', paired_at: null, play_source: 'usb', cache_mb: 512, px_w: 1080, px_h: 1920, orientation: 'portrait', screen: null, last_seen_at: '2026-11-19T03:00:00.000Z', views: 0, recent_ads: [] };
const list: Handler = (u) => (u.pathname === '/api/admin/v1/devices' ? { body: { items: [lift], total: 1, page: 1, page_size: 20 } } : undefined);
const one: Handler = (u) => (u.pathname === '/api/admin/v1/devices/e1' ? { body: { ...lift, seen_ads: [], views_7d: [] } } : undefined);
const cmds: Handler = (u) => (u.pathname === '/api/admin/v1/devices/e1/commands' ? { body: { items: [], total: 0, delivery: { mode: 'heartbeat', realtime: false, note: 'Lệnh đi qua heartbeat.' }, types: [{ type: 'reset_pin', label: 'Cấp lại mật khẩu', desc: 'x', support: 'protocol', risky: true, default_ttl_s: 900 }, { type: 'set_volume', label: 'Đặt âm lượng', desc: 'y', support: 'protocol', risky: false }] } } : undefined);
const logs: Handler = (u) => (u.pathname === '/api/admin/v1/devices/e1/logs' ? { body: { items: [{ id: '1', ts: '2026-11-19T03:00:00.000Z', level: 'error', tag: 'player', message: 'khong tai duoc video' }], total: 1, page: 1, page_size: 20, retention_days: 7 } } : undefined);

describe('Signage Player (thang may / LED)', () => {
  it('danh sach hien "Cho cap quyen", nguon phat va bo nho dem', async () => {
    handlers.push(me(mk({ devices: ['view', 'write', 'approve'] })), list);
    vi.stubGlobal('fetch', mockFetch());
    mount('/devices');
    expect((await screen.findAllByText('Chờ cấp quyền')).length).toBeGreaterThan(0);
    expect(await screen.findByText('USB')).toBeInTheDocument();
    expect(screen.getByText('512 MB')).toBeInTheDocument();
  });
  it('ngan chi tiet: cap quyen -> POST /approve voi venue; nhat ky 7 ngay hien dong log', async () => {
    handlers.push(me(mk({ devices: ['view', 'write', 'approve'], screens: ['view'] })), list, one, cmds, logs,
      (u) => (u.pathname === '/api/admin/v1/screens' ? { body: { items: [{ id: 'v1', name: 'Chung cư Sunrise', type: 'elevator', region: 'HN', status: 'online', screens: 2 }], total: 1, page: 1, page_size: 100 } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/devices?open=e1');
    expect(await screen.findByText('khong tai duoc video')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Cấp quyền' }));
    const dlg = await screen.findByRole('dialog', { name: 'Cấp quyền thiết bị' });
    await within(dlg).findByRole('option', { name: /Chung cư Sunrise/ });
    await user.selectOptions(within(dlg).getByLabelText('Địa điểm lắp đặt'), 'v1');
    await user.click(within(dlg).getByRole('button', { name: 'Cấp quyền' }));
    await waitFor(() => expect(reqs.find((r) => r.path === '/api/admin/v1/devices/e1/approve')?.body).toEqual({ venue_id: 'v1' }));
  });
  it('khong co quyen approve -> khong co nut Cap quyen', async () => {
    handlers.push(me(mk({ devices: ['view', 'write'] })), list, one, cmds, logs);
    vi.stubGlobal('fetch', mockFetch());
    mount('/devices?open=e1');
    expect(await screen.findByText('Bạn không có quyền cấp quyền thiết bị.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cấp quyền' })).toBeNull();
  });
});
