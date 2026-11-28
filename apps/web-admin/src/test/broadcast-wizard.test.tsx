// Wizard 4 buoc: tao moi -> phat hanh -> gui lenh toi thiet bi + bang tinh trang.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { quickLayout } from '../components/BroadcastWizard';

const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
const prog = { id: 'p9', name: 'CT moi', target_type: 'elevator', regions: [], start_min: 0, end_min: 1440, priority: 3, status: 'draft', item_count: 1, version: 1, device_count: 1, items: [{ creative_id: 'm1', position: 0, name: 'QC', kind: 'video', review_state: 'approved', state: 'ready', ready: true, in_campaign: false, zone_id: 'main' }], layout: null };
const reply = (u: URL, m: string): unknown => {
  const p = u.pathname.replace('/api', '');
  if (p === '/auth/me') return { user: { id: 'u', email: 'a@b', name: 'A', role: 'admin' }, permissions: { overview: ['view'], schedule: ['view', 'write'], media: ['view'] } };
  if (p === '/admin/v1/broadcast' && m === 'POST') return prog;
  if (p === '/admin/v1/broadcast/p9/publish') return { ...prog, status: 'published', push: { matched: 1, pushed: 1, skipped: 0 } };
  if (p === '/admin/v1/broadcast/p9/delivery') return { program_id: 'p9', status: 'published', version: 1, total: 1, items: [{ id: 'd1', name: 'TM-01', region: 'HN', online: true, command: { status: 'pending', at: '2026-01-01T00:00:00Z' } }] };
  if (p === '/admin/v1/broadcast/devices-pick') return { items: [{ id: 'd1', name: 'TM-01', region: 'HN', kind: 'elevator', online: true }], truncated: false };
  if (p === '/admin/v1/media') return { items: [{ id: 'm1', name: 'QC', kind: 'video', status: 'approved', mime: 'video/mp4' }], total: 1 };
  return { items: [], total: 0 };
};
beforeEach(() => { calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };

describe('BroadcastWizard', () => {
  it('quickLayout: 1, 2, 3 vung theo huong', () => {
    expect(quickLayout('full', 'portrait')).toHaveLength(1);
    expect(quickLayout('half', 'landscape').map((z) => z.w)).toEqual([50, 50]);
    expect(quickLayout('three', 'portrait').map((z) => z.type)).toEqual(['video', 'image', 'marquee']);
  });
  it('khong cho sang buoc sau khi thieu ten; phat hanh gui device_ids va hien tinh trang thiet bi', async () => {
    vi.stubGlobal('fetch', vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(i), 'http://localhost');
      const m = init?.method ?? 'GET';
      calls.push({ method: m, path: u.pathname, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
      return new Response(JSON.stringify(reply(u, m)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={['/broadcast?new=1']}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
    await user.click(await screen.findByRole('button', { name: /Bước tiếp theo/ }));
    expect(await screen.findByText('Nhập tên chương trình.')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Ưu đãi cuối năm/), 'CT moi');
    await user.click(screen.getByRole('button', { name: /Bước tiếp theo/ }));
    // buoc 2: them tu lieu vao vung
    await user.click(await screen.findByText(/Toàn màn hình|Video 1/, { selector: '.nm' }));
    await user.click(await screen.findByRole('button', { name: 'Thêm mục Video' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Chọn tệp' }), 'm1');
    await user.click(screen.getByRole('button', { name: /Bước tiếp theo/ }));
    await user.click(await screen.findByLabelText('Chọn TM-01'));
    await user.click(screen.getByRole('button', { name: /Bước tiếp theo/ }));
    await user.click(await screen.findByRole('button', { name: 'Phát hành' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/p9/publish'))).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/admin/v1/broadcast')!;
    expect(post.body).toMatchObject({ name: 'CT moi', creative_ids: ['m1'], device_ids: ['d1'], regions: [] });
    expect(await screen.findByText(/Đã gửi lệnh làm mới tới 1 thiết bị/)).toBeInTheDocument();
    expect(await screen.findByText('Đang chờ thiết bị nhận')).toBeInTheDocument();
  });
});
