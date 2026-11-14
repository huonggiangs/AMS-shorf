import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

type Handler = (url: URL) => unknown;
let handlers: Handler[] = [];
const calls: string[] = [];
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url.pathname);
    for (const h of handlers) {
      const r = h(url);
      if (r !== undefined) return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const admin = { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'super_admin' }, permissions: { overview: ['view'], admin: ['view', 'write', 'approve', 'delete'] } };
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('p3-ops web', () => {
  it('/status cong khai: khong goi /auth/me, hien thanh phan va su co an toan', async () => {
    handlers.push((u) => (u.pathname === '/api/status' ? { status: 'degraded', updated_at: '2026-11-14T10:00:00.000Z', components: [{ id: 'admin', name: 'Trang quản trị', status: 'operational' }, { id: 'payments', name: 'Thanh toán', status: 'degraded' }], incidents: [{ component: 'payments', level: 'degraded', message: 'Nhận thanh toán tự động có thể chậm.', since: '2026-11-14T09:50:00.000Z' }] } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/status');
    expect(await screen.findByText('Suy giảm một phần', { selector: 'div' })).toBeTruthy();
    expect(screen.getByText('Thanh toán')).toBeTruthy();
    expect(screen.getByText(/Nhận thanh toán tự động có thể chậm/)).toBeTruthy();
  });

  it('trang Cảnh báo hien su co dang mo cho Super admin', async () => {
    handlers.push(
      (u) => (u.pathname === '/api/auth/me' ? admin : undefined),
      (u) => (u.pathname === '/api/admin/v1/ops/summary' ? {
        counts: { S1: 1, S2: 0, S3: 0 },
        incidents: [{ id: 'i1', rule_key: 'ledger:drift', severity: 'S1', component: 'payments', title: 'Ví lệch sổ cái', detail: '2 ví lệch', status: 'open', occurrences: 3, opened_at: '2026-11-14T09:00:00.000Z', last_seen_at: '2026-11-14T10:00:00.000Z' }],
        recent: [], jobs: [], backups: [], notifications: [], config: { emails: [], webhook_configured: false, webhook_host: null, mail_configured: false },
      } : undefined),
    );
    vi.stubGlobal('fetch', mockFetch());
    mount('/alerts');
    expect(await screen.findByText('Ví lệch sổ cái')).toBeTruthy();
    expect(screen.getByText(/Chưa có kênh nhận cảnh báo/)).toBeTruthy();
    expect(screen.getByText('Nhận xử lý')).toBeTruthy();
  });
});
