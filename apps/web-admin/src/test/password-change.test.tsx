import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordForm, pwHint } from '../pages/Profile';

afterEach(() => vi.restoreAllMocks());

describe('pwHint (cung quy tac may chu)', () => {
  it('chap nhan >=12 ky tu co hoa/thuong/so; tu choi con lai', () => {
    expect(pwHint('Mat-Khau-Moi-2026x')).toBeNull();
    expect(pwHint('Ngan1a')).toMatch(/12/);
    expect(pwHint('khongcohoa123456')).toMatch(/chữ hoa/);
    expect(pwHint('KhongCoChuSoNao')).toMatch(/chữ số/);
  });
});

describe('ChangePasswordForm', () => {
  it('khong gui khi mat khau yeu / khong khop; gui POST /auth/change-password khi hop le', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', f);
    const done = vi.fn();
    const u = userEvent.setup();
    render(<ChangePasswordForm forced onDone={done} />);
    await u.type(screen.getByLabelText('Mật khẩu hiện tại'), 'Cu-Mat-Khau-1');
    await u.type(screen.getByLabelText('Mật khẩu mới'), 'yeu');
    await u.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'yeu');
    await u.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/12/);
    expect(f).not.toHaveBeenCalled();
    await u.clear(screen.getByLabelText('Mật khẩu mới'));
    await u.clear(screen.getByLabelText('Nhập lại mật khẩu mới'));
    await u.type(screen.getByLabelText('Mật khẩu mới'), 'Mat-Khau-Moi-2026x');
    await u.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'Mat-Khau-Moi-2026y');
    await u.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/không khớp/);
    await u.clear(screen.getByLabelText('Nhập lại mật khẩu mới'));
    await u.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'Mat-Khau-Moi-2026x');
    await u.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/change-password$/);
    expect(JSON.parse(String(init.body))).toEqual({ current_password: 'Cu-Mat-Khau-1', new_password: 'Mat-Khau-Moi-2026x' });
  });
});
