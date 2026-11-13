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
const fin = { user: { id: 'u1', email: 'f@ams.vn', name: 'Kế toán', role: 'finance' }, permissions: { overview: ['view'], finance: ['view', 'write', 'approve', 'delete'] } };
const admin = { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'super_admin' }, permissions: { overview: ['view'], tv_experience: ['view', 'write', 'approve'], finance: ['view', 'write', 'approve'] } };
const cust = { user: { id: 'u2', email: 'k@x', name: 'Lan', role: 'customer', customer_id: 'K001' }, permissions: { campaigns: ['view'], finance: ['view'] }, customer_scope: { customer_id: 'K001', code: 'K001', name: 'Vinamilk' } };

const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>,
  );
};
const meFor = (me: unknown): Handler => (u) => (u.pathname === '/api/auth/me' ? me : undefined);

beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('trang truoc day NotConnected nay goi API that', () => {
  it('History (noi bo) doc /admin/v1/history va hien dong du lieu, khong con ghi chu "chua co diem cuoi"', async () => {
    handlers.push(meFor(fin), (u) => (u.pathname === '/api/admin/v1/history' ? { items: [{ event_id: 'e1', ts: '2026-11-10T01:30:00.000Z', campaign: { id: 'c1', name: 'Tet Vinamilk' }, creative: { id: 'm1', name: 'Clip 15s' }, device: { id: 'd1', name: 'TV-001' }, vcr_pct: 100, valid: true, revenue_vnd: 2 }], total: 1, page: 1, page_size: 20 } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/history');
    expect(await screen.findByText('Tet Vinamilk')).toBeInTheDocument();
    expect(screen.getByText('TV-001')).toBeInTheDocument();
    expect(screen.queryByText(/chưa có điểm cuối API/)).toBeNull();
  });

  it('History (khach hang) dung cong /portal/v1/history', async () => {
    handlers.push(meFor(cust));
    vi.stubGlobal('fetch', mockFetch());
    mount('/finance');
    await screen.findByRole('heading', { name: 'Lịch sử xem quảng cáo' });
    expect(calls).toContain('/api/portal/v1/history');
    expect(calls).not.toContain('/api/admin/v1/history');
  });

  it('TvExperience: hien creative kid_safe va cho nguoi duyet cau hinh', async () => {
    handlers.push(meFor(admin), (u) => {
      if (u.pathname === '/api/admin/v1/tv-experience') return { settings: { lock_ads_enabled: false, fullscreen_ads_enabled: true, frequency: { per_hour: 30, min_gap_s: 60, same_creative_gap_s: 300 }, banned_industries: ['rượu bia'] }, summary: { creatives: 1, kid_safe: 1, lock_eligible: 1 }, can_approve: true };
      if (u.pathname === '/api/admin/v1/tv-experience/creatives') return { items: [{ id: 'm1', name: 'VF9 ADS', customer: 'VinFast', industry: 'Ô tô', review_state: 'approved', duration_s: 15, kid_safe: true, contexts: ['lock', 'fullscreen'], lock_eligible: true }], total: 1 };
      return undefined;
    });
    vi.stubGlobal('fetch', mockFetch());
    mount('/tv-experience');
    expect(await screen.findByText('VF9 ADS')).toBeInTheDocument();
    expect(screen.getByText('Lên màn khóa')).toBeInTheDocument();
    expect(await screen.findByText(/1 kid_safe/)).toBeInTheDocument();
  });

  it('Finance: hoa don VAT va doanh thu theo gio co API', async () => {
    handlers.push(meFor(fin), (u) => {
      if (u.pathname === '/api/admin/v1/invoices') return { items: [{ id: 'i1', customer: 'Vinamilk', period: '2026-10', amount_vnd: 60000000, vat_rate: 8, vat_vnd: 4800000, total_vnd: 64800000, status: 'draft' }], total: 1 };
      if (u.pathname === '/api/admin/v1/revenue/hourly') return { date: '2026-11-12', hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, impressions: h === 3 ? 5 : 0, valid: h === 3 ? 4 : 0, revenue_vnd: h === 3 ? 100 : 0, reward_vnd: 0 })), total: { impressions: 5, valid: 4, revenue_vnd: 100, reward_vnd: 0 }, freshness_at: '2026-11-12T03:10:00.000Z', generated_at: '2026-11-12T03:11:00.000Z', stale: false };
      return undefined;
    });
    vi.stubGlobal('fetch', mockFetch());
    mount('/finance');
    expect(await screen.findByText('Doanh thu theo giờ')).toBeInTheDocument();
    expect(await screen.findByText('Vinamilk')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Phát hành' })).toBeInTheDocument();
    expect(screen.queryByText(/chưa có điểm cuối API/)).toBeNull();
  });
});
