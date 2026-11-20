import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

type Reply = { status?: number; body: unknown } | undefined;
type Handler = (url: URL, init?: RequestInit) => Reply;
let handlers: Handler[] = [];
const reqs: { method: string; path: string; body?: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    reqs.push({ method, path: url.pathname, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const ops = { user: { id: 'u1', email: 'o@ams.vn', name: 'Vận hành', role: 'device_ops' }, permissions: { overview: ['view'], devices: ['view', 'write'], tv_experience: ['view', 'write'] } };
const viewer = { user: { id: 'u3', email: 'v@ams.vn', name: 'Xem', role: 'device_ops' }, permissions: { overview: ['view'], devices: ['view'] } };
const boss = { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'super_admin' }, permissions: { overview: ['view'], media: ['view', 'approve'], tv_experience: ['view', 'write', 'approve'] } };
const me = (m: unknown): Handler => (u) => (u.pathname === '/api/auth/me' ? { body: m } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
beforeEach(() => { handlers = []; reqs.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

const device = { id: 'd1', name: 'BRAVIA 4K', kind: 'tv', model: 'BRAVIA', os: 'android', owner_name: null, app_version: '1.0.102', region: 'Hà Nội', status: 'checking', trust_level: 0, pairing_state: 'pending', paired_at: null, last_seen_at: '2026-11-19T03:00:00.000Z', views: 0, recent_ads: [] };
const deviceList: Handler = (u) => (u.pathname === '/api/admin/v1/devices' ? { body: { items: [device], total: 1, page: 1, page_size: 20 } } : undefined);

describe('Ghép mã (Devices)', () => {
  it('co nut "Ghép mã"; nhap 6 so -> POST /devices/pair; ma sai hien thong bao tieng Viet theo ma loi', async () => {
    handlers.push(me(ops), deviceList, (u, i) => (u.pathname === '/api/admin/v1/devices/pair' && i?.method === 'POST' ? { status: 404, body: { error: { code: 'pair_code_not_found', message: 'Mã ghép đôi không đúng.' } } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/devices');
    await screen.findByText('Chờ ghép mã', { selector: 'span.tag, span' });
    await user.click(await screen.findByRole('button', { name: /Ghép mã/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Ghép mã TV' });
    const submit = within(dlg).getByRole('button', { name: 'Ghép TV' });
    expect(submit).toBeDisabled();
    await user.type(within(dlg).getByLabelText('Mã 6 số trên TV'), '12a34');
    expect(submit).toBeDisabled(); // chi nhan chu so, chua du 6
    await user.type(within(dlg).getByLabelText('Mã 6 số trên TV'), '56');
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(reqs.find((r) => r.path === '/api/admin/v1/devices/pair')?.body).toEqual({ code: '123456' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Mã không đúng. Kiểm tra lại 6 số đang hiện trên màn hình TV.');
  });
  it('khong co quyen ghi -> khong co nut Ghep ma', async () => {
    handlers.push(me(viewer), deviceList);
    vi.stubGlobal('fetch', mockFetch());
    mount('/devices');
    await screen.findByText('BRAVIA 4K');
    expect(screen.queryByRole('button', { name: /Ghép mã/ })).toBeNull();
  });
});

describe('Lenh thiet bi (drawer)', () => {
  const paired = { ...device, trust_level: 1, pairing_state: 'paired', paired_at: '2026-11-19T03:05:00.000Z', owner_name: 'Phòng 101', status: 'active' };
  const cmds = { items: [{ id: 'c1', type: 'lock', label: 'Khóa TV', args: null, state: 'pending', status: 'pending', expires_at: '2026-11-19T05:00:00.000Z', created_at: '2026-11-19T04:00:00.000Z', created_by: 'Vận hành', result: null, deliveries: 0, timeline: [{ at: '2026-11-19T04:00:00.000Z', event: 'created' }] }],
    delivery: { mode: 'heartbeat_polling', realtime: false, note: 'Lệnh KHÔNG tới TV ngay: TV chỉ nhận ở heartbeat kế tiếp.', paired_cap_s: null },
    types: [{ type: 'message', label: 'Gửi thông báo lên TV', desc: 'Hiện tin nhắn', support: 'brainrot', risky: false }, { type: 'lock', label: 'Khóa TV', desc: 'Khóa', support: 'brainrot', risky: true }] };
  it('hien ghi chu polling (khong realtime), danh sach lenh co trang thai; gui tin nhan kem idempotency_key; huy lenh dang cho', async () => {
    handlers.push(me(ops), deviceList, (u, i) => {
      if (u.pathname === '/api/admin/v1/devices/d1') return { body: paired };
      if (u.pathname === '/api/admin/v1/devices/d1/commands' && (i?.method ?? 'GET') === 'GET') return { body: cmds };
      if (u.pathname === '/api/admin/v1/devices/d1/commands' && i?.method === 'POST') return { status: 201, body: { ...cmds.items[0], id: 'c2' } };
      if (u.pathname === '/api/admin/v1/devices/d1/commands/c1/cancel') return { body: { ...cmds.items[0], state: 'cancelled', cancel_note: null } };
      return undefined;
    });
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/devices?open=d1');
    expect(await screen.findByText(/KHÔNG tới TV ngay/)).toBeInTheDocument();
    expect(screen.getByText('Đang chờ TV nhận')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Nội dung \(tối đa 200/), 'Đến giờ nghỉ mắt');
    await user.click(screen.getByRole('button', { name: 'Gửi lệnh' }));
    await waitFor(() => expect(reqs.find((r) => r.method === 'POST' && r.path.endsWith('/commands'))?.body).toMatchObject({ type: 'message', args: { text: 'Đến giờ nghỉ mắt', seconds: 15 }, ttl_s: 3600, idempotency_key: expect.stringMatching(/^ui-/) }));
    await user.click(screen.getByRole('button', { name: 'Hủy lệnh' }));
    await waitFor(() => expect(reqs.some((r) => r.path.endsWith('/commands/c1/cancel'))).toBe(true));
  });
  it('TV chua ghep -> khong cho gui lenh, noi ro ly do', async () => {
    handlers.push(me(ops), deviceList, (u) => (u.pathname === '/api/admin/v1/devices/d1' ? { body: device } : u.pathname === '/api/admin/v1/devices/d1/commands' ? { body: { ...cmds, items: [] } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/devices?open=d1');
    expect(await screen.findByText('TV chưa ghép mã nên chưa gửi lệnh được.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi lệnh' })).toBeNull();
  });
});

describe('Duyet creative: kid_safe/contexts co xac nhan', () => {
  const item = { id: 'm1', name: 'VF9 ADS', customer: 'VinFast', industry: 'Ô tô', review_state: 'approved', duration_s: 15, kid_safe: false, contexts: ['fullscreen'], content_version: 3, lock_eligible: false, kid_review: { current: false, reviewed_at: null, reviewed_by: null, note: null } };
  it('Luu bi khoa cho toi khi tich xac nhan + ghi chu; gui confirm_reviewed + note + kid_safe + contexts', async () => {
    handlers.push(me(boss), (u, i) => {
      if (u.pathname === '/api/admin/v1/tv-experience/creatives' && (i?.method ?? 'GET') === 'GET') return { body: { items: [item], total: 1 } };
      if (u.pathname === '/api/admin/v1/tv-experience/creatives/m1' && i?.method === 'PUT') return { body: { ...item, kid_safe: true } };
      return undefined;
    });
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/creative-review');
    await user.click(await screen.findByRole('button', { name: 'Cấu hình' }));
    const dlg = await screen.findByRole('dialog', { name: 'Cấu hình hiển thị trên TV' });
    await user.click(within(dlg).getByLabelText(/Màn khóa/));
    await user.click(within(dlg).getByLabelText(/Phù hợp màn hình có trẻ em/));
    const save = within(dlg).getByRole('button', { name: 'Lưu' });
    expect(save).toBeDisabled();
    await user.click(within(dlg).getByLabelText(/Tôi xác nhận đã xem toàn bộ nội dung/));
    expect(save).toBeDisabled(); // thieu ghi chu
    await user.type(within(dlg).getByLabelText(/Ghi chú duyệt/), 'Đã xem, phù hợp');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(reqs.find((r) => r.method === 'PUT')?.body).toEqual({ contexts: ['fullscreen', 'lock'], kid_safe: true, confirm_reviewed: true, note: 'Đã xem, phù hợp' }));
  });
});
