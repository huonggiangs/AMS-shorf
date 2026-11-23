import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

let me: unknown;
const mount = (path: string) => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input), 'http://localhost');
    if (u.pathname === '/api/auth/me') return new Response(JSON.stringify(me), { status: 200 });
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const user = (permissions: Record<string, string[]>) => ({ user: { id: 'u1', email: 'o@ams.vn', name: 'Vận hành', role: 'super_admin' }, permissions });
beforeEach(() => { localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('sidebar sub-menu (thay cho hàng tab)', () => {
  it('nhóm đang xem mở sẵn, mục con có aria-current, không còn hàng tab trong nội dung', async () => {
    me = user({ overview: ['view'], devices: ['view'], schedule: ['view'], media: ['view'] });
    const { container } = mount('/device-groups');
    const menu = await screen.findByRole('complementary', { name: 'menu' });
    const head = await within(menu).findByRole('button', { name: 'Thiết bị' });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByRole('link', { name: 'Nhóm thiết bị' })).toHaveAttribute('aria-current', 'page');
    expect(within(menu).getByRole('link', { name: 'Danh sách thiết bị' })).not.toHaveAttribute('aria-current');
    expect(within(menu).getByRole('link', { name: 'Địa điểm' })).toHaveAttribute('href', '/locations');
    expect(container.querySelector('nav.tabs')).toBeNull();
    // nhóm khác đang thu gọn, mục con bị ẩn khỏi cây truy cập
    const bc = within(menu).getByRole('button', { name: 'Phát sóng nội bộ' });
    expect(bc).toHaveAttribute('aria-expanded', 'false');
    expect(within(menu).queryByRole('link', { name: 'Hàng đợi & Nhật ký' })).toBeNull();
  });

  it('bấm nhóm để mở/đóng, nhớ trạng thái trong localStorage, bấm mục con điều hướng', async () => {
    me = user({ overview: ['view'], devices: ['view'], schedule: ['view'], media: ['view'] });
    mount('/devices');
    const menu = await screen.findByRole('complementary', { name: 'menu' });
    const bc = await within(menu).findByRole('button', { name: 'Phát sóng nội bộ' });
    await userEvent.click(bc);
    expect(bc).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem('ams-nav-open') ?? '[]')).toContain('g6');
    for (const l of ['Bàn làm việc', 'Kho tư liệu', 'Chương trình phát sóng', 'Mẫu bố cục', 'Thông báo khẩn', 'Phân phối thông minh', 'Hàng đợi & Nhật ký']) {
      expect(within(menu).getByRole('link', { name: l })).toBeInTheDocument();
    }
    await userEvent.click(within(menu).getByRole('link', { name: 'Hàng đợi & Nhật ký' }));
    expect(await screen.findByRole('heading', { name: /Hàng đợi/ })).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Hàng đợi & Nhật ký' })).toHaveAttribute('aria-current', 'page');
    // nhóm đang xem vẫn có thể tự thu gọn rồi mở lại
    await userEvent.click(bc);
    expect(bc).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(bc);
    expect(bc).toHaveAttribute('aria-expanded', 'true');
  });

  it('khôi phục nhóm đã mở từ localStorage và chịu được dữ liệu hỏng', async () => {
    me = user({ overview: ['view'], devices: ['view'], schedule: ['view'] });
    localStorage.setItem('ams-nav-open', '["g6"]');
    const { unmount } = mount('/overview');
    const menu = await screen.findByRole('complementary', { name: 'menu' });
    expect(await within(menu).findByRole('button', { name: 'Phát sóng nội bộ' })).toHaveAttribute('aria-expanded', 'true');
    unmount();
    localStorage.setItem('ams-nav-open', '{bad');
    mount('/overview');
    const menu2 = await screen.findByRole('complementary', { name: 'menu' });
    expect(await within(menu2).findByRole('button', { name: 'Phát sóng nội bộ' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('chỉ hiện mục con có quyền; nhóm không có quyền bị ẩn', async () => {
    me = user({ overview: ['view'], devices: ['view'] });
    mount('/devices');
    const menu = await screen.findByRole('complementary', { name: 'menu' });
    await within(menu).findByRole('button', { name: 'Thiết bị' });
    expect(within(menu).queryByRole('button', { name: 'Phát sóng nội bộ' })).toBeNull();
    expect(within(menu).queryByRole('button', { name: 'Quản trị' })).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'Kho tư liệu' })).toBeNull();
  });
});
