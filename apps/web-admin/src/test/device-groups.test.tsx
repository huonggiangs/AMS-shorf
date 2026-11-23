import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

type Reply = { status?: number; body: unknown } | undefined;
type Handler = (url: URL, init?: RequestInit) => Reply;
let handlers: Handler[] = [];
const reqs: { method: string; path: string; body?: any; url?: string }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    reqs.push({ method: init?.method ?? 'GET', path: url.pathname, url: url.pathname + url.search, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const mk = (perms: Record<string, string[]>): unknown => ({ user: { id: 'u1', email: 'o@ams.vn', name: 'Vận hành', role: 'super_admin' }, permissions: { overview: ['view'], ...perms } });
const me = (m: unknown): Handler => (u) => (u.pathname === '/api/auth/me' ? { body: m } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
// jsdom chua co HTMLDialogElement.close/showModal
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };
beforeEach(() => { handlers = []; reqs.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

const fetchedUrls = (): string[] => reqs.map((r) => r.url ?? r.path);

const tree = { items: [
  { id: 'gN', parent_id: null, name: 'Miền Bắc', sort: 0, path: 'Miền Bắc', depth: 1, direct_count: 0, device_count: 3, online_count: 2 },
  { id: 'gHN', parent_id: 'gN', name: 'Hà Nội', sort: 0, path: 'Miền Bắc › Hà Nội', depth: 2, direct_count: 3, device_count: 3, online_count: 2 },
  { id: 'gS', parent_id: null, name: 'Miền Nam', sort: 1, path: 'Miền Nam', depth: 1, direct_count: 1, device_count: 1, online_count: 0 },
], total: 5, total_online: 2, unassigned: 1, max_depth: 6 };
const dev = (o: Record<string, unknown> = {}) => ({ id: 'd1', name: 'Màn sảnh A', kind: 'tv', status: 'online', online: true, controllable: true, synced: true, last_seen_at: '2026-11-19T03:00:00.000Z', px_w: 1080, px_h: 1920, mac: 'AA:BB:CC:DD:EE:01', serial: 'SN1', group_id: 'gHN', group_name: 'Hà Nội', location_id: 'l1', location_name: 'Vincom Bà Triệu', volume: 20, volume_at: null, volume_cmd: null, ...o });
const treeH: Handler = (u, init) => (u.pathname === '/api/admin/v1/device-groups' && (init?.method ?? 'GET') === 'GET' ? { body: tree } : undefined);
const devsH = (items: unknown[]): Handler => (u) => (u.pathname === '/api/admin/v1/device-groups/devices' ? { body: { items, total: items.length, page: 1, page_size: 50 } } : undefined);
const locs = [{ id: 'l1', name: 'Vincom Bà Triệu', address: '191 Bà Triệu', province: 'Hà Nội', district: 'Hai Bà Trưng', lat: 21.01, lng: 105.85, venue_type: 'supermarket', contact_name: 'Chị Lan', contact_phone: '0900000000', notes: null, status: 'active', device_count: 2, online_count: 1 }];
const all = { devices: ['view', 'write'] };

describe('d-tree: menu Thiết bị', () => {
  it('nhóm menu Thiết bị có 3 mục con, /devices vẫn chạy, quyền devices bao cả ba', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev()]));
    vi.stubGlobal('fetch', mockFetch());
    mount('/device-groups');
    expect(await screen.findByRole('button', { name: 'Thiết bị' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Danh sách thiết bị' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nhóm thiết bị' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Địa điểm' })).toBeInTheDocument();
  });
  it('/devices vẫn mở được trang danh sách cũ', async () => {
    handlers.push(me(mk(all)));
    vi.stubGlobal('fetch', mockFetch());
    mount('/devices');
    expect(await screen.findByText('Quản lý thiết bị')).toBeInTheDocument();
  });
  it('thiếu quyền devices: không có menu Thiết bị', async () => {
    handlers.push(me(mk({})));
    vi.stubGlobal('fetch', mockFetch());
    mount('/overview');
    await screen.findAllByText('Tổng quan');
    expect(screen.queryByRole('button', { name: 'Thiết bị' })).toBeNull();
  });
});

describe('d-tree: trang Nhóm thiết bị', () => {
  it('cây hiện số thiết bị cộng dồn; chọn nhóm -> lọc theo group_id; lọc Ngoại tuyến; tìm kiếm; URL nhớ trạng thái', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev()]));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/device-groups');
    const treeEl = await screen.findByRole('tree');
    expect(within(treeEl).getByText('Tất cả cụm màn hình')).toBeInTheDocument();
    expect(within(treeEl).getByText('Miền Bắc').closest('button')).toHaveTextContent('3');
    expect(within(treeEl).getByText('Chưa xếp nhóm').closest('button')).toHaveTextContent('1');
    expect(await screen.findByText('Màn sảnh A')).toBeInTheDocument();
    expect(screen.getByText(/SN1 · 1080×1920/)).toBeInTheDocument();
    await user.click(within(treeEl).getByText('Miền Bắc'));
    await waitFor(() => expect(fetchedUrls().some((u) => u.includes('/device-groups/devices') && u.includes('group_id=gN'))).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Ngoại tuyến' }));
    await user.type(screen.getByLabelText('Tìm thiết bị'), 'AA:BB');
    await waitFor(() => expect(fetchedUrls().some((u) => u.includes('group_id=gN') && u.includes('status%3Aoffline') && u.includes('q=AA%3ABB'))).toBe(true), { timeout: 3000 });
  });
  it('âm lượng đã xác nhận: hiện "Đang áp dụng: N% (qua trình phát)" khi TV box cố định âm lượng', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev({ volume: 40, volume_cmd: { id: 'c1', state: 'acked', percent: 40, applied_percent: 40, mode: 'player', created_at: '2026-11-19T03:00:00.000Z' } })]));
    vi.stubGlobal('fetch', mockFetch());
    mount('/device-groups');
    expect(await screen.findByText('Đang áp dụng: 40% (qua trình phát)')).toBeInTheDocument();
  });
  it('thanh trượt âm lượng: debounce rồi gửi MỘT lệnh set_volume, hiện trạng thái chờ', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev({ volume_cmd: { id: 'c1', state: 'pending', percent: 35, created_at: new Date().toISOString() } })]),
      (u, init) => (u.pathname === '/api/admin/v1/devices/d1/commands' && init?.method === 'POST' ? { status: 201, body: { id: 'c2', state: 'pending' } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/device-groups');
    const slider = await screen.findByLabelText('Âm lượng Màn sảnh A');
    expect(slider).toHaveValue('35'); // lệnh đang chờ: hiện giá trị đích
    expect(screen.getByText('Đang chờ thiết bị nhận lệnh')).toBeInTheDocument();
    expect(screen.getByText('Thiết bị báo: 20%')).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.change(slider, { target: { value: '55' } });
    expect(screen.getByText('55%')).toBeInTheDocument(); // lạc quan
    expect(reqs.filter((r) => r.method === 'POST')).toHaveLength(0); // chưa gửi trong lúc kéo
    await waitFor(() => expect(reqs.filter((r) => r.method === 'POST' && r.path === '/api/admin/v1/devices/d1/commands')).toHaveLength(1), { timeout: 2000 });
    expect(reqs.find((r) => r.method === 'POST')!.body).toEqual({ type: 'set_volume', args: { percent: 55 } });
  });
  it('lệnh âm lượng chờ quá lâu / hết hạn chưa giao: báo rõ "chưa nhận lệnh", có nút Thử lại gửi lại đúng mức cũ', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev({ volume_cmd: { id: 'c1', state: 'expired', percent: 65, deliveries: 0, created_at: '2026-11-19T03:00:00.000Z' } })]),
      (u, init) => (u.pathname === '/api/admin/v1/devices/d1/commands' && init?.method === 'POST' ? { status: 201, body: { id: 'c2', state: 'pending' } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/device-groups');
    expect(await screen.findByText('Thiết bị chưa nhận lệnh: app trên TV chưa hỗ trợ hoặc đang ngoại tuyến')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(reqs.find((r) => r.method === 'POST')?.body).toEqual({ type: 'set_volume', args: { percent: 65 } }));
  });
  it('app báo đã nhận (ack) nhưng không báo mức áp dụng: KHÔNG hiện "đã xác nhận" xanh, cảnh báo app có thể chưa hỗ trợ', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev({ volume_cmd: { id: 'c1', state: 'acked', percent: 70, applied_percent: null, deliveries: 1, created_at: '2026-11-19T03:00:00.000Z' } })]));
    vi.stubGlobal('fetch', mockFetch());
    mount('/device-groups');
    expect(await screen.findByText(/không báo mức đã áp dụng/)).toBeInTheDocument();
    expect(screen.queryByText('Thiết bị đã xác nhận')).not.toBeInTheDocument();
  });
  it('huy hiệu khả năng + ETA heartbeat: caps khai có/không/chưa rõ; app khai không hỗ trợ thì khóa thanh trượt', async () => {
    const soon = new Date(Date.now() + 90_000).toISOString();
    handlers.push(me(mk(all)), treeH, devsH([
      dev({ id: 'd1', can_set_volume: true, caps: ['set_volume'], next_heartbeat_at: soon }),
      dev({ id: 'd2', name: 'Màn B', can_set_volume: false, caps: ['reboot'] }),
      dev({ id: 'd3', name: 'Màn C', can_set_volume: null }),
    ]));
    vi.stubGlobal('fetch', mockFetch());
    mount('/device-groups');
    expect(await screen.findByText('App hỗ trợ âm lượng')).toBeInTheDocument();
    expect(screen.getByText('App chưa hỗ trợ âm lượng')).toBeInTheDocument();
    expect(screen.getByText('Chưa rõ app có hỗ trợ')).toBeInTheDocument();
    expect(screen.getByLabelText('Âm lượng Màn B')).toBeDisabled();
    expect(screen.getByLabelText('Âm lượng Màn C')).not.toBeDisabled(); // chưa rõ: vẫn cho gửi
    expect(screen.getByText(/Nhịp heartbeat kế tiếp dự kiến/)).toBeInTheDocument();
    expect(screen.getAllByText(/Chưa thấy nhịp heartbeat gần đây/).length).toBe(2);
  });
  it('thiết bị chưa cấp quyền: thanh trượt và nút Đồng bộ bị khóa; Xem màn hình luôn khóa với chú thích', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev({ controllable: false, synced: false, status: 'offline', online: false })]));
    vi.stubGlobal('fetch', mockFetch());
    mount('/device-groups');
    expect(await screen.findByLabelText('Âm lượng Màn sảnh A')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đồng bộ lại ngay' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xem màn hình' })).toHaveAttribute('title', expect.stringContaining('Cần bản app mới'));
    expect(screen.getByText('Chờ kết nối')).toBeInTheDocument();
  });
  it('Đồng bộ lại ngay gửi refresh_manifest; chỉ-xem thì không có thao tác ghi', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev()]), (u, init) => (u.pathname === '/api/admin/v1/devices/d1/commands' && init?.method === 'POST' ? { status: 201, body: { id: 'c9' } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/device-groups');
    await user.click(await screen.findByRole('button', { name: 'Đồng bộ lại ngay' }));
    await waitFor(() => expect(reqs.find((r) => r.method === 'POST')?.body).toEqual({ type: 'refresh_manifest' }));
  });
  it('chỉ có quyền xem: không có nút thêm nhóm / chọn hàng loạt; thanh trượt khóa', async () => {
    handlers.push(me(mk({ devices: ['view'] })), treeH, devsH([dev()]));
    vi.stubGlobal('fetch', mockFetch());
    mount('/device-groups');
    expect(await screen.findByLabelText('Âm lượng Màn sảnh A')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Thêm nhóm/ })).toBeNull();
    expect(screen.queryByLabelText('Chọn tất cả')).toBeNull();
  });
  it('đặt âm lượng cả nhóm -> POST /device-groups/:id/volume và báo thiết bị bị bỏ qua', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev()]), (u, init) => (u.pathname === '/api/admin/v1/device-groups/gN/volume' && init?.method === 'POST' ? { status: 202, body: { queued: 2, skipped: [{ device_id: 'x', reason: 'device_not_approved' }], commands: [] } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/device-groups?group=gN');
    await user.click(await screen.findByRole('button', { name: 'Đặt âm lượng cả nhóm' }));
    const dlg = await screen.findByRole('dialog', { name: /Đặt âm lượng nhóm/ });
    fireEvent.change(within(dlg).getByLabelText('Âm lượng hàng loạt'), { target: { value: '70' } });
    await user.click(within(dlg).getByRole('button', { name: 'Đặt âm lượng' }));
    expect(await within(dlg).findByText(/Đã xếp lệnh cho 2 thiết bị; bỏ qua 1/)).toBeInTheDocument();
    expect(reqs.find((r) => r.path.endsWith('/gN/volume'))!.body).toEqual({ percent: 70, include_children: true });
  });
  it('thêm nhóm con và chuyển nhóm hàng loạt', async () => {
    handlers.push(me(mk(all)), treeH, devsH([dev()]),
      (u, init) => (u.pathname === '/api/admin/v1/device-groups' && init?.method === 'POST' ? { status: 201, body: { id: 'new' } } : undefined),
      (u, init) => (u.pathname === '/api/admin/v1/device-groups/assign' && init?.method === 'PUT' ? { body: { updated: 1 } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/device-groups?group=gN');
    await user.click(await screen.findByRole('button', { name: 'Thêm nhóm con' }));
    const dlg = await screen.findByRole('dialog', { name: /Thêm nhóm con/ });
    await user.type(within(dlg).getByLabelText('Tên nhóm'), 'Hải Phòng');
    await user.click(within(dlg).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(reqs.find((r) => r.method === 'POST' && r.path === '/api/admin/v1/device-groups')!.body).toEqual({ name: 'Hải Phòng', parent_id: 'gN' }));
    await user.click(await screen.findByLabelText('Chọn Màn sảnh A'));
    await user.click(screen.getByRole('button', { name: 'Chuyển nhóm' }));
    const d2 = await screen.findByRole('dialog', { name: 'Chuyển nhóm' });
    await user.selectOptions(within(d2).getByRole('combobox'), 'gS');
    await user.click(within(d2).getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(reqs.find((r) => r.method === 'PUT')!.body).toEqual({ device_ids: ['d1'], group_id: 'gS' }));
  });
  it('lỗi máy chủ trùng tên hiện tiếng Việt', async () => {
    handlers.push(me(mk(all)), treeH, devsH([]),
      (u, init) => (u.pathname === '/api/admin/v1/device-groups' && init?.method === 'POST' ? { status: 409, body: { error: { code: 'group_name_taken', message: 'x' } } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/device-groups');
    await user.click(await screen.findByRole('button', { name: 'Thêm nhóm' }));
    const dlg = await screen.findByRole('dialog', { name: 'Thêm nhóm' });
    await user.type(within(dlg).getByLabelText('Tên nhóm'), 'Miền Bắc');
    await user.click(within(dlg).getByRole('button', { name: 'Lưu' }));
    expect(await within(dlg).findByText('Đã có nhóm cùng tên trong nhóm cha này.')).toBeInTheDocument();
  });
});

describe('d-tree: trang Địa điểm', () => {
  it('liệt kê, thêm địa điểm (POST) và xóa bắt buộc chọn nơi chuyển thiết bị (move_to)', async () => {
    handlers.push(me(mk(all)),
      (u, init) => (u.pathname === '/api/admin/v1/locations' && init?.method === 'POST' ? { status: 201, body: { id: 'l2' } } : undefined),
      (u, init) => (u.pathname === '/api/admin/v1/locations/l1' && init?.method === 'DELETE' ? { body: { deleted: true } } : undefined),
      (u) => (u.pathname === '/api/admin/v1/locations' ? { body: { items: locs, total: 1, page: 1, page_size: 50 } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/locations');
    expect(await screen.findByText('Vincom Bà Triệu')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Siêu thị')).toBeInTheDocument();
    expect(screen.getByText('21.01, 105.85')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thêm địa điểm' }));
    const dlg = await screen.findByRole('dialog', { name: /Thêm địa điểm/ });
    await user.type(within(dlg).getByLabelText('Tên địa điểm *'), 'Sân bay Nội Bài');
    await user.type(within(dlg).getByLabelText('Vĩ độ (lat)'), '21.2');
    await user.selectOptions(within(dlg).getByLabelText('Loại địa điểm'), 'airport');
    await user.click(within(dlg).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(reqs.find((r) => r.method === 'POST' && r.path === '/api/admin/v1/locations')!.body).toMatchObject({ name: 'Sân bay Nội Bài', venue_type: 'airport', lat: 21.2, lng: null }));
    await user.click(screen.getByRole('button', { name: 'Xóa' }));
    const d2 = await screen.findByRole('dialog', { name: 'Xóa địa điểm' });
    expect(within(d2).getByText(/đang có 2 thiết bị/)).toBeInTheDocument();
    await user.click(within(d2).getByRole('button', { name: 'Chuyển thiết bị và xóa' }));
    await waitFor(() => expect(fetchedUrls().some((x) => x.includes('/locations/l1') && x.includes('move_to=none'))).toBe(true));
  });
  it('chỉ-xem: không có nút thêm/sửa/xóa', async () => {
    handlers.push(me(mk({ devices: ['view'] })), (u) => (u.pathname === '/api/admin/v1/locations' ? { body: { items: locs, total: 1, page: 1, page_size: 50 } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/locations');
    expect(await screen.findByText('Vincom Bà Triệu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thêm địa điểm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull();
  });
});
