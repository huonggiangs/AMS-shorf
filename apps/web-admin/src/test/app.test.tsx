import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

type Handler = (url: URL, init?: RequestInit) => { status?: number; body: unknown } | undefined;
let handlers: Handler[] = [];
const json = (body: unknown, status = 200) => ({ status, body });
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });

const staff = { user: { id: 'u1', email: 'a@ams.vn', name: 'Anh Trần', role: 'content_manager' }, permissions: { overview: ['view'], campaigns: ['view', 'write'], media: ['view'], devices: ['view'] } };
const ext = { user: { id: 'u2', email: 'k@vinamilk.example', name: 'Lan', role: 'customer', customer_id: 'K001' }, permissions: { campaigns: ['view', 'write'], media: ['view', 'write'], finance: ['view'], devices: ['view'], admin: ['view'] }, customer_scope: { customer_id: 'K001', code: 'K001', name: 'Vinamilk' } };

const mount = (path = '/') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UiProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MemoryRouter>
      </UiProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => { handlers = []; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('auth flow', () => {
  it('unauthenticated users land on the login page', async () => {
    handlers.push((u) => (u.pathname === '/api/auth/me' ? json({ error: { code: 'unauthorized', message: 'Chưa đăng nhập' } }, 401) : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/campaigns');
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
  });

  it('password then TOTP code, then the shell with only permitted menu groups', async () => {
    let authed = false;
    handlers.push((u, init) => {
      if (u.pathname === '/api/auth/me') return authed ? json(staff) : json({ error: { code: 'unauthorized', message: 'x' } }, 401);
      if (u.pathname === '/api/auth/login') return json({ mfa_required: true, mfa_token: 'tok' });
      if (u.pathname === '/api/auth/mfa/verify') { expect(JSON.parse(String(init?.body))).toEqual({ mfa_token: 'tok', code: '123456' }); authed = true; return json({ ok: true }); }
      return undefined;
    });
    vi.stubGlobal('fetch', mockFetch());
    mount('/');
    await userEvent.type(await screen.findByLabelText('Email'), 'a@ams.vn');
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await userEvent.type(await screen.findByLabelText('Mã xác thực 6 số'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    const menu = await screen.findByRole('complementary', { name: 'menu' });
    expect(menu).toHaveTextContent('Tổng quan');
    expect(menu).toHaveTextContent('Quảng cáo');
    expect(menu).not.toHaveTextContent('Doanh thu');
    expect(menu).not.toHaveTextContent('Quản trị');
  });

  it('shows the server error message on a bad password', async () => {
    handlers.push((u) => {
      if (u.pathname === '/api/auth/me') return json({ error: { code: 'unauthorized', message: 'x' } }, 401);
      if (u.pathname === '/api/auth/login') return json({ error: { code: 'invalid_credentials', message: 'Sai email hoặc mật khẩu.' } }, 401);
      return undefined;
    });
    vi.stubGlobal('fetch', mockFetch());
    mount('/');
    await userEvent.type(await screen.findByLabelText('Email'), 'a@ams.vn');
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'bad');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sai email hoặc mật khẩu.');
  });
});

describe('external (customer) account', () => {
  it('hides every menu except ads, media and wallet regardless of granted modules', async () => {
    handlers.push((u) => (u.pathname === '/api/auth/me' ? json(ext) : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/');
    const menu = await screen.findByRole('complementary', { name: 'menu' });
    await waitFor(() => expect(menu).toHaveTextContent('Quảng cáo'));
    expect(menu).toHaveTextContent('Doanh thu');
    expect(menu).not.toHaveTextContent('Tổng quan');
    expect(menu).not.toHaveTextContent('Quản trị');
    expect(menu).not.toHaveTextContent('Đối tác');
    // customer home resolves to the portal campaigns endpoint
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).startsWith('/api/portal/v1/campaigns'))).toBe(true));
  });

  it('blocks direct navigation to an admin page', async () => {
    handlers.push((u) => (u.pathname === '/api/auth/me' ? json(ext) : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/access');
    expect(await screen.findByText('Không có quyền truy cập')).toBeInTheDocument();
  });
});

describe('session expiry', () => {
  it('a 401 from any API call returns to login with a notice', async () => {
    let me = true;
    handlers.push((u) => {
      if (u.pathname === '/api/auth/me') return me ? json(staff) : json({ error: { code: 'unauthorized', message: 'x' } }, 401);
      if (u.pathname === '/api/portal/v1/campaigns' || u.pathname === '/api/admin/v1/campaigns') { me = false; return json({ error: { code: 'session_expired', message: 'Phiên hết hạn' } }, 401); }
      return undefined;
    });
    vi.stubGlobal('fetch', mockFetch());
    mount('/ads');
    expect(await screen.findByText(/Phiên đã hết hạn/)).toBeInTheDocument();
  });
});
