import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { budgetError } from '../pages/Campaigns';
import { pwError, qrDataUrl } from '../pages/Invite';

afterEach(() => vi.restoreAllMocks());

const mount = (path: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider>
  </QueryClientProvider>,
);
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

describe('ngan sach chien dich (BUG-1)', () => {
  it('5.000.000 hop le; duoi toi thieu / le buoc bi bao loi', () => {
    expect(budgetError('5000000')).toBeNull();
    expect(budgetError('0')).toMatch(/tối thiểu/);
    expect(budgetError('1500.5')).toMatch(/bội số/);
    expect(budgetError('')).toMatch(/hợp lệ/);
  });
});

describe('/invite va /activate (BUG-2)', () => {
  it('chinh sach mat khau + QR', () => {
    expect(pwError('Mat-Khau-Moi-2026x')).toBeNull();
    expect(pwError('yeu')).toMatch(/12/);
    expect(qrDataUrl('otpauth://totp/AMS:a@b.c?secret=ABC')).toMatch(/^data:image/);
  });

  it('/activate: dat mat khau -> enroll TOTP -> xac nhan ma', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input), 'http://localhost');
      calls.push(`${init?.method ?? 'GET'} ${u.pathname}`);
      if (u.pathname.endsWith('/auth/invite/info')) return res({ email: 'ops@example.com', name: 'Ops UI' });
      if (u.pathname.endsWith('/auth/invite/accept')) return res({ ok: true, mfa_token: 'mt-1' });
      if (u.pathname.endsWith('/auth/mfa/enroll')) return res({ secret: 'JBSWY3DPEHPK3PXP', otpauth_url: 'otpauth://totp/AMS:ops?secret=JBSWY3DPEHPK3PXP' });
      if (u.pathname.endsWith('/auth/mfa/verify')) return res({ ok: true, csrf_token: 'c1' });
      if (u.pathname.endsWith('/auth/me')) return res({}, 401);
      return res({});
    }));
    const u = userEvent.setup();
    mount('/activate?token=abcdefghijklmnop');
    expect(await screen.findByText('Ops UI')).toBeInTheDocument();
    await u.type(screen.getByLabelText('Mật khẩu mới'), 'yeu');
    await u.type(screen.getByLabelText('Nhập lại mật khẩu'), 'yeu');
    await u.click(screen.getByRole('button', { name: /Đặt mật khẩu/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/12/);
    expect(calls.some((c) => c.includes('invite/accept'))).toBe(false);
    await u.clear(screen.getByLabelText('Mật khẩu mới'));
    await u.clear(screen.getByLabelText('Nhập lại mật khẩu'));
    await u.type(screen.getByLabelText('Mật khẩu mới'), 'Mat-Khau-Moi-2026x');
    await u.type(screen.getByLabelText('Nhập lại mật khẩu'), 'Mat-Khau-Moi-2026x');
    await u.click(screen.getByRole('button', { name: /Đặt mật khẩu/ }));
    expect(await screen.findByAltText('Mã QR TOTP')).toBeInTheDocument();
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    await u.type(screen.getByLabelText('Mã xác thực 6 số'), '123456');
    await u.click(screen.getByRole('button', { name: /Xác nhận/ }));
    await waitFor(() => expect(calls.some((c) => c.includes('mfa/verify'))).toBe(true));
  });

  it('/invite thieu token: bao loi', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({}, 401)));
    mount('/invite');
    expect(await screen.findByRole('alert')).toHaveTextContent(/thiếu mã mời/);
  });
});
