import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { meSchema } from '../api/schemas';

const me = (forced?: boolean) => ({
  user: { id: 'u1', email: 'a@ams.vn', name: 'Anh Tran', role: 'content_manager' },
  permissions: { overview: ['view'], campaigns: ['view', 'write'], media: ['view'], devices: ['view'] },
  ...(forced === undefined ? {} : { must_change_password: forced }),
});
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const Where = () => <span data-testid="loc">{useLocation().pathname}</span>;
const mount = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UiProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <App />
            <Where />
          </AuthProvider>
        </MemoryRouter>
      </UiProvider>
    </QueryClientProvider>,
  );
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('must_change_password', () => {
  it('meSchema giu truong must_change_password', () => {
    expect(meSchema.parse(me(true)).must_change_password).toBe(true);
    expect(meSchema.parse(me()).must_change_password).toBeUndefined();
  });

  it('phien con song sau khi tai lai + co bat buoc: chuyen thang sang /profile, moi trang khac bi khoa; doi mat khau xong thi mo khoa', async () => {
    let forced = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input), 'http://localhost');
      if (u.pathname === '/api/auth/me') return res(me(forced));
      if (u.pathname === '/api/auth/change-password') { forced = false; return res({ ok: true, must_change_password: false }); }
      return res({ items: [], total: 0 });
    }));
    mount('/campaigns');
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/profile'));
    expect(await screen.findByText(/bắt buộc đổi mật khẩu/)).toBeInTheDocument();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Mật khẩu hiện tại'), 'Cu-Mat-Khau-1');
    await u.type(screen.getByLabelText('Mật khẩu mới'), 'Mat-Khau-Moi-2026x');
    await u.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'Mat-Khau-Moi-2026x');
    await u.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    await waitFor(() => expect(screen.queryByText(/bắt buộc đổi mật khẩu/)).not.toBeInTheDocument());
  });

  it('khong bat buoc: giu nguyen duong dan', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input), 'http://localhost');
      return u.pathname === '/api/auth/me' ? res(me(false)) : res({ items: [], total: 0 });
    }));
    mount('/campaigns');
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/campaigns'));
  });

  it('loi 403 password_change_required tu mot request bat ky khoa dieu huong ve /profile', async () => {
    let locked = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input), 'http://localhost');
      if (u.pathname === '/api/auth/me') return res(me(locked ? true : false));
      if (u.pathname.includes('/campaigns')) { locked = true; return res({ error: { code: 'password_change_required', message: 'Hãy đổi mật khẩu' } }, 403); }
      return res({ items: [], total: 0 });
    }));
    mount('/campaigns');
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/profile'));
  });
});
