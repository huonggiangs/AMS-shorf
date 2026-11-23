import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

type Handler = (url: URL) => { status?: number; body: unknown } | undefined;
let handlers: Handler[] = [];
const paths: string[] = [];
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    paths.push(url.pathname + url.search);
    for (const h of handlers) {
      const r = h(url);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
beforeEach(() => { handlers = []; paths.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

const ext = { user: { id: 'u2', email: 'k@vinamilk.example', name: 'Lan', role: 'customer', customer_id: 'K001' }, permissions: { campaigns: ['view'], finance: ['view'] }, customer_scope: { customer_id: 'K001', code: 'K001', name: 'Vinamilk' } };
const admin = { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'super_admin' }, permissions: { overview: ['view'], finance: ['view'], devices: ['view'], campaigns: ['view'] } };
const report = (views: number) => ({
  range: { from: '2026-10-14', to: '2026-11-12', tz: 'Asia/Ho_Chi_Minh' }, scope: { customer: { id: 'K001', name: 'Vinamilk' } }, generated_at: '2026-11-12T03:00:00.000Z',
  totals: { views, watched_s: views * 15, campaigns: views ? 1 : 0, devices: 1, locations: 1 }, windows: { today: views, d7: views, d30: views },
  by_day: [{ day: '2026-11-11', views: 0, watched_s: 0 }, { day: '2026-11-12', views, watched_s: views * 15 }],
  by_campaign: views ? [{ id: 'c1', name: 'Sữa Hè 2026', views, watched_s: views * 15 }] : [],
  by_creative: views ? [{ id: 'cr1', name: 'Clip 15s', campaign_id: 'c1', campaign_name: 'Sữa Hè 2026', views, watched_s: views * 15 }] : [],
  by_location: views ? [{ id: 'l1', name: 'Chung cư Sunrise', views, watched_s: views * 15, devices: 1 }] : [],
  note: 'Lượt xem hợp lệ = màn đã cấp quyền phát đủ ≥ 90% thời lượng.',
});

describe('bao cao luot xem', () => {
  it('khach dang nhap vao thang Bao cao luot xem (khong thay Ly do/thiet bi), co 3 nut tai ve', async () => {
    handlers.push((u) => (u.pathname === '/api/auth/me' ? { body: ext } : undefined), (u) => (u.pathname === '/api/portal/v1/reports/views' ? { body: report(42) } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/');
    expect(await screen.findByRole('heading', { name: 'Báo cáo lượt xem quảng cáo' })).toBeInTheDocument();
    expect((await screen.findAllByText('Sữa Hè 2026')).length).toBeGreaterThan(0);
    expect(screen.getByText('Chung cư Sunrise')).toBeInTheDocument();
    expect(screen.queryByText('Theo thiết bị')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Báo cáo PDF/ }).getAttribute('href')).toContain('/api/portal/v1/reports/views/report.pdf?');
    expect(screen.getByRole('link', { name: /Tải CSV/ }).getAttribute('href')).toContain('export.csv');
    expect(paths.some((p) => p.startsWith('/api/admin/'))).toBe(false); // khach khong goi route admin
  });
  it('khach chua co luot xem: noi ro "chua co luot xem", nut tai bi khoa', async () => {
    handlers.push((u) => (u.pathname === '/api/auth/me' ? { body: ext } : undefined), (u) => (u.pathname === '/api/portal/v1/reports/views' ? { body: report(0) } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/views');
    expect(await screen.findByText(/Chưa có lượt xem trong khoảng này/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Báo cáo PDF/ })).toBeDisabled();
  });
  it('admin /history: tab Bao cao mac dinh + chip "Chan doan dong bo" giai thich vi sao 0, mo ra bang theo thiet bi', async () => {
    const diag = {
      generated_at: '2026-11-12T03:00:00.000Z',
      summary: { code: 'pending_trust', explain: 'Thiết bị chưa được cấp quyền: các lượt phát vẫn được lưu nhưng CHƯA tính vào báo cáo.', devices: 1, online: 1, events_accepted_24h: 5, events_rejected_24h: 1, stored_24h: 5, ingest_gap: 0, last_event_at: '2026-11-12T02:59:00.000Z', queue_lag_s: null },
      devices: [{ id: 'dev1', name: 'Thang máy A1', kind: 'elevator', location: null, trust_level: 0, blocked: false, online: true, last_heartbeat_at: '2026-11-12T02:55:00.000Z', last_event_at: '2026-11-12T02:59:00.000Z', received_24h: 6, accepted_24h: 5, valid_24h: 0, rejected_24h: 1, stored_24h: 5, rejected_by_reason: { not_in_manifest: 1 }, flagged_by_reason: { pending_trust: 5 }, aliases: {}, code: 'pending_trust', explain: 'Thiết bị chưa được cấp quyền.' }],
    };
    handlers.push((u) => (u.pathname === '/api/auth/me' ? { body: admin } : undefined), (u) => (u.pathname === '/api/admin/v1/history/diagnostics' ? { body: diag } : undefined), (u) => (u.pathname === '/api/admin/v1/reports/views' ? { body: { ...report(0), by_device: [] } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/history');
    expect(await screen.findByText(/CHƯA tính vào báo cáo/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chẩn đoán đồng bộ' }));
    expect(await screen.findByText('Thang máy A1 (elevator)')).toBeInTheDocument();
    expect(screen.getByText(/creative không thuộc lịch phát: 1/)).toBeInTheDocument();
    await waitFor(() => expect(paths.some((p) => p.startsWith('/api/admin/v1/reports/views'))).toBe(true));
  });
});
