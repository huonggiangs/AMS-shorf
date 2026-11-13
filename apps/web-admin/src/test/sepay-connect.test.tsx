import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { SepayConnectCard } from '../components/SepayConnect';

const REAL = 'AMS-real-key-1234';
const settings = (o: Record<string, unknown> = {}) => ({
  enabled: true, bank: 'MBBank', account_number: '9704123456', account_holder: 'CONG TY ABC', prefix: 'AMS', webhook_url: 'https://api.example.test/webhooks/payments/sepay',
  auth_mode: 'apikey', env: 'mock', has_secret: true, apikey_set: true, apikey_hint: '••••1234', apikey_source: 'db', secret_set: false, secret_hint: null, secret_source: null, ...o,
});
const me = (perms: string[]) => ({ user: { id: 'u1', email: 'f@ams.vn', name: 'KT', role: 'finance' }, permissions: { finance: perms } });

let calls: { method: string; path: string; body?: unknown }[] = [];
let state = settings();
let testReply: { status: number; body: unknown } = { status: 200, body: { ok: true, signature_ok: false, apikey_ok: true, problems: [], warnings: [], message: 'Cấu hình hợp lệ.' } };
let perms = ['view', 'write', 'approve'];
let pendingItems: unknown[] = [];

beforeEach(() => {
  calls = []; pendingItems = []; state = settings(); perms = ['view', 'write', 'approve'];
  testReply = { status: 200, body: { ok: true, signature_ok: false, apikey_ok: true, problems: [], warnings: [], message: 'Cấu hình hợp lệ.' } };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: u.pathname, body });
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/api/auth/me') return j(me(perms));
    if (u.pathname === '/api/admin/v1/settings/sepay/changes') return j({ items: pendingItems });
    if (/\/changes\/[^/]+\/(approve|reject)$/.test(u.pathname)) return j({ ok: true });
    if (u.pathname === '/api/admin/v1/settings/sepay/test') return j(testReply.body, testReply.status);
    if (u.pathname === '/api/admin/v1/settings/sepay' && method === 'PUT') {
      if (body?.account_number) return j({ ...state, pending_change_id: 'CH1' }, 202);
      if (body?.api_key) state = settings({ apikey_hint: `••••${String(body.api_key).slice(-4)}` });
      return j(state);
    }
    if (u.pathname === '/api/admin/v1/settings/sepay') return j(state);
    return j({ items: [], total: 0 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <UiProvider><MemoryRouter><AuthProvider><SepayConnectCard /></AuthProvider></MemoryRouter></UiProvider>
  </QueryClientProvider>,
);

describe('Kết nối SePay', () => {
  it('hiển thị khóa đã che, không bao giờ có khóa thật trong trang; URL webhook có nút sao chép', async () => {
    const { container } = mount();
    expect(await screen.findByRole('heading', { name: 'Kết nối SePay' })).toBeInTheDocument();
    expect(screen.getAllByText(/đã lưu ••••1234/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(container.innerHTML).not.toContain(REAL);
    expect(screen.getByText('https://api.example.test/webhooks/payments/sepay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sao chép URL' })).toBeInTheDocument();
    expect(screen.getByTestId('sepay-mode')).toHaveTextContent('mock');
  });

  it('ô API Key dạng mật khẩu, nút Hiện/Ẩn chỉ đổi kiểu ô nhập', async () => {
    mount();
    const input = await screen.findByLabelText('API Key');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.type(input, REAL);
    await userEvent.click(screen.getAllByRole('button', { name: 'Hiện' })[0]!);
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Ẩn' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('lưu: chỉ gửi trường đã đổi, xóa ô nhập sau khi lưu và hiện gợi ý mới', async () => {
    mount();
    await userEvent.type(await screen.findByLabelText('API Key'), REAL);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false); // thiếu TOTP: không gửi
    await userEvent.type(screen.getByLabelText('Mã TOTP xác nhận'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ api_key: REAL, totp: '123456' });
    await waitFor(() => expect(screen.getByLabelText('API Key')).toHaveValue(''));
  });

  it('số tài khoản sai định dạng chặn lưu', async () => {
    mount();
    const acc = await screen.findByLabelText('Số tài khoản');
    await userEvent.clear(acc);
    await userEvent.type(acc, '12ab');
    expect(screen.getByRole('button', { name: 'Lưu cấu hình' })).toBeDisabled();
    expect(screen.getByText('Số tài khoản gồm 6-20 chữ số.')).toBeInTheDocument();
  });

  it('Kiểm tra kết nối: trạng thái thành công', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra kết nối' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Kết nối hợp lệ');
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/settings/sepay/test'))).toBe(true);
  });

  it('Kiểm tra kết nối: liệt kê vấn đề khi thất bại và khi máy chủ báo lỗi', async () => {
    testReply = { status: 200, body: { ok: false, problems: ['chưa nhập số tài khoản'], warnings: ['Đang ở chế độ mock'], message: 'Cần xử lý.' } };
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra kết nối' }));
    const al = await screen.findByRole('alert');
    expect(al).toHaveTextContent('Chưa kết nối được');
    expect(al).toHaveTextContent('chưa nhập số tài khoản');
    testReply = { status: 500, body: { error: { code: 'x', message: 'Lỗi máy chủ' } } };
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Lỗi máy chủ'));
  });

  it('khóa đặt từ biến môi trường: ô bị khóa, không gửi api_key', async () => {
    state = settings({ apikey_source: 'env' });
    mount();
    expect(await screen.findByLabelText('API Key')).toBeDisabled();
    expect(screen.getByText(/đặt từ máy chủ/)).toBeInTheDocument();
  });

  it('RBAC: chỉ có quyền xem -> không có nút lưu/kiểm tra; không có quyền xem -> không hiện thẻ', async () => {
    perms = ['view'];
    const { unmount } = mount();
    await screen.findByRole('heading', { name: 'Kết nối SePay' });
    expect(screen.queryByRole('button', { name: 'Lưu cấu hình' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kiểm tra kết nối' })).toBeNull();
    expect(screen.getByLabelText('API Key')).toBeDisabled();
    unmount();
    calls = [];
    perms = [];
    mount();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/auth/me')).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('heading', { name: 'Kết nối SePay' })).toBeNull();
    expect(calls.some((c) => c.path === '/api/admin/v1/settings/sepay')).toBe(false);
  });

  it('đổi số tài khoản: gửi đề xuất (202) và hiện danh sách chờ duyệt với nút Duyệt cần TOTP', async () => {
    pendingItems = [{ id: 'CH1', status: 'pending', requested_by: 'F1', requested_at: '2026-11-12T00:00:00Z', changes: { account_number: '***888' } }];
    mount();
    const acc = await screen.findByLabelText('Số tài khoản');
    await userEvent.clear(acc);
    await userEvent.type(acc, '9704999888');
    await userEvent.type(screen.getByLabelText('Mã TOTP xác nhận'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ account_number: '9704999888', totp: '654321' }));
    const region = await screen.findByRole('region', { name: 'Thay đổi chờ duyệt' });
    expect(region).toHaveTextContent('***888');
    expect(region).not.toHaveTextContent('9704999888');
    await userEvent.type(screen.getByLabelText('Mã TOTP xác nhận'), '111222');
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/changes/CH1/approve') && (c.body as { totp: string }).totp === '111222')).toBe(true));
  });
});
