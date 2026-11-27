// u1-ui web: dong gia hop dong (hop dong -> Dong gia) + trang Duyet creative.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { cpmToUnitMicro, lineFormToBody, emptyLineForm, microToVnd, vndToMicro } from '../lib/contractLines';

type Handler = (url: URL, method: string, body: Record<string, unknown> | null) => { status?: number; body: unknown } | undefined;
let handlers: Handler[] = [];
const calls: { method: string; path: string; body: Record<string, unknown> | null; query: string }[] = [];
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body, query: url.search });
    for (const h of handlers) {
      const r = h(url, method, body);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const perms = (finance: string[], media: string[] = ['view']) => ({ user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'finance' }, permissions: { overview: ['view'], customers: ['view'], finance, media } });
const on = (path: string, data: unknown | ((b: Record<string, unknown> | null) => unknown), method = 'GET', status = 200): Handler => (u, m, b) => (u.pathname === `/api${path}` && m === method ? { status, body: typeof data === 'function' ? (data as (b: Record<string, unknown> | null) => unknown)(b) : data } : undefined);
const meFor = (me: unknown): Handler => (u) => (u.pathname === '/api/auth/me' ? { body: me } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const list = (items: unknown[], extra = {}) => ({ items, total: items.length, page: 1, page_size: 20, ...extra });

beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); window.confirm = () => true; });
afterEach(() => vi.unstubAllGlobals());

describe('u1: tien te micro-VND', () => {
  it('vndToMicro / microToVnd / CPM lam tron len, khong qua so thuc', () => {
    expect(vndToMicro('33')).toBe(33_000_000);
    expect(vndToMicro('0,000001')).toBe(1);
    expect(vndToMicro('33.5')).toBe(33_500_000);
    for (const bad of ['', '0', '-1', 'abc', '1e3', '0,0000001', '1.000.001', '2000000']) expect(vndToMicro(bad)).toBeNull();
    expect(microToVnd(33_333_334)).toBe('33,333334');
    expect(microToVnd(1_500_000_000)).toBe('1.500');
    expect(cpmToUnitMicro(33_333_333_333)).toBe(33_333_334);
    expect(cpmToUnitMicro(25_000_000_000)).toBe(25_000_000);
  });
  it('lineFormToBody: thong bao tieng Viet cho gia, ngay, thoi han', () => {
    const f = { ...emptyLineForm(), price: '40' };
    expect(lineFormToBody({ ...f, price: '' }, {})).toEqual({ error: 'Nhập giá cho dòng hợp đồng.' });
    expect('error' in lineFormToBody({ ...f, price: '-3' }, {}) && (lineFormToBody({ ...f, price: '-3' }, {}) as { error: string }).error).toMatch(/Giá không hợp lệ/);
    expect(lineFormToBody({ ...f, effective_from: '2026-05-02', effective_to: '2026-05-01' }, {})).toEqual({ error: 'Ngày kết thúc hiệu lực phải sau hoặc bằng ngày bắt đầu.' });
    expect(lineFormToBody({ ...f, effective_from: '2025-01-01' }, { start: '2026-01-01', end: '2026-12-31' })).toEqual({ error: 'Ngày hiệu lực của dòng giá phải nằm trong thời hạn hợp đồng.' });
    const ok = lineFormToBody({ ...f, model: 'cpm', price: '25000', screen_type: 'led_p5' }, {});
    expect(ok).toEqual({ body: expect.objectContaining({ price_model: 'cpm', price_micro_vnd: 25_000_000_000, screen_type: 'led_p5', daypart: null, qty: 1 }) });
  });
});

describe('u1: dong gia hop dong', () => {
  const ct = { id: 'C1', number: 'HD-2026-001', customer_id: 'K001', customer_name: 'Vinamilk', title: 'HD', value_vnd: 1_000_000, start_date: '2026-01-01', end_date: '2026-12-31', paid_pct: 0, status: 'effective' };
  const line = { id: 'L1', screen_type: 'tv', region_id: null, daypart: 'peak', qty: 1, impression_price_micro_vnd: 33_000_000, impression_price_vnd: '33', model: 'fixed', cpm_micro_vnd: null, cpm_vnd: null, effective_from: null, effective_to: null };
  const cpmLine = { ...line, id: 'L2', screen_type: 'led_p5', daypart: null, model: 'cpm', cpm_micro_vnd: 25_000_000_000, cpm_vnd: '25000', impression_price_micro_vnd: 25_000_000, impression_price_vnd: '25', effective_from: '2026-03-01', effective_to: '2026-06-30' };
  const quote = { status: 'quoted', locked: false, placeholder: false, lines: [
    { screen_type: 'tv', region_id: '*', daypart: 'peak', unit_price_micro_vnd: 33_000_000, unit_price_vnd: '33', source: 'contract', floored: false },
    { screen_type: 'tv', region_id: '*', daypart: 'off_peak', unit_price_micro_vnd: 25_000_000, unit_price_vnd: '25', source: 'rate_card', floored: true },
  ] };
  const base = (items: unknown[], editable = true) => [on('/admin/v1/contracts', list([ct])), on('/admin/v1/contracts/C1/lines', { contract_id: 'C1', status: 'effective', start_date: '2026-01-01', end_date: '2026-12-31', editable, items, total: items.length }), on('/admin/v1/pricing/quote', quote)];
  const openLines = async () => {
    mount('/customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Hợp đồng' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dòng giá' }));
  };

  it('finance:approve thay danh sach (giá cố định + CPM), bao gia hieu luc co nguon va nang len san', async () => {
    handlers.push(meFor(perms(['view', 'approve'])), ...base([line, cpmLine]));
    vi.stubGlobal('fetch', mockFetch());
    await openLines();
    const panel = await screen.findByRole('region', { name: 'Dòng giá hợp đồng' });
    expect(await within(panel).findByText('33 ₫ / lượt')).toBeInTheDocument();
    expect(within(panel).getByText(/25000 ₫ \/ 1\.000 lượt \(CPM\)/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Thêm dòng giá' })).toBeInTheDocument();
    const prev = await within(panel).findByRole('region', { name: 'Giá áp dụng' });
    expect(await within(prev).findByText('Hợp đồng')).toBeInTheDocument();
    expect(within(prev).getByText('Nâng lên giá sàn')).toBeInTheDocument();
    const qc = calls.find((c) => c.path === '/api/admin/v1/pricing/quote')!;
    expect(qc.query).toContain('contract_id=C1');
    expect(qc.query).toContain('customer_id=K001');
  });

  it('them dong: validate tieng Viet, gui micro-VND nguyen + mo hinh CPM + ngay', async () => {
    handlers.push(meFor(perms(['view', 'approve'])), ...base([line]), on('/admin/v1/contracts/C1/lines', { id: 'N1' }, 'POST', 201));
    vi.stubGlobal('fetch', mockFetch());
    await openLines();
    await userEvent.click(await screen.findByRole('button', { name: 'Thêm dòng giá' }));
    const dlg = await screen.findByRole('dialog', { name: 'Thêm dòng giá' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Lưu' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Nhập giá cho dòng hợp đồng.');
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/lines'))).toBe(false);
    await userEvent.selectOptions(within(dlg).getByLabelText('Loại màn hình'), 'led_p5');
    await userEvent.selectOptions(within(dlg).getByLabelText('Mô hình giá'), 'cpm');
    await userEvent.type(within(dlg).getByLabelText('Giá CPM (₫ / 1.000 lượt)'), '-5');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Lưu' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Giá không hợp lệ');
    await userEvent.clear(within(dlg).getByLabelText('Giá CPM (₫ / 1.000 lượt)'));
    await userEvent.type(within(dlg).getByLabelText('Giá CPM (₫ / 1.000 lượt)'), '25000,5');
    await userEvent.type(within(dlg).getByLabelText('Hiệu lực từ'), '2026-03-01');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/api/admin/v1/contracts/C1/lines')?.body).toMatchObject({ screen_type: 'led_p5', price_model: 'cpm', price_micro_vnd: 25_000_500_000, effective_from: '2026-03-01', effective_to: null, daypart: null }));
  });

  it('sua dong (PUT, gia cu duoc dien san) va xoa dong (DELETE sau xac nhan)', async () => {
    handlers.push(meFor(perms(['view', 'approve'])), ...base([line]), on('/admin/v1/contracts/C1/lines/L1', { id: 'L1' }, 'PUT'), on('/admin/v1/contracts/C1/lines/L1', { ok: true }, 'DELETE'));
    vi.stubGlobal('fetch', mockFetch());
    await openLines();
    await userEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    const dlg = await screen.findByRole('dialog', { name: 'Sửa dòng giá' });
    const price = within(dlg).getByLabelText('Đơn giá (₫ / lượt)') as HTMLInputElement;
    expect(price.value).toBe('33');
    await userEvent.clear(price);
    await userEvent.type(price, '35,5');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ price_model: 'fixed', price_micro_vnd: 35_500_000, daypart: 'peak', screen_type: 'tv' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/v1/contracts/C1/lines/L1')).toBe(true));
  });

  it('loi may chu hien thong bao; chi finance:view thi chi doc (khong co nut ghi)', async () => {
    handlers.push(meFor(perms(['view'])), ...base([line]));
    vi.stubGlobal('fetch', mockFetch());
    await openLines();
    const panel = await screen.findByRole('region', { name: 'Dòng giá hợp đồng' });
    expect(await within(panel).findByText('33 ₫ / lượt')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Thêm dòng giá' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Sửa' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Xóa' })).toBeNull();
    expect(panel).toHaveTextContent('cần quyền duyệt tài chính');
  });

  it('hop dong da ket thuc: khong sua; khong co finance:view: khong co nut Dong gia', async () => {
    handlers.push(meFor(perms(['view', 'approve'])), ...base([line], false));
    vi.stubGlobal('fetch', mockFetch());
    await openLines();
    const panel = await screen.findByRole('region', { name: 'Dòng giá hợp đồng' });
    expect(await within(panel).findByText(/không còn sửa được dòng giá/)).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Thêm dòng giá' })).toBeNull();
  });

  it('khong co finance:view -> khong co nut Dong gia', async () => {
    handlers.push(meFor(perms([])), on('/admin/v1/contracts', list([ct])));
    vi.stubGlobal('fetch', mockFetch());
    mount('/customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Hợp đồng' }));
    await screen.findByText('HD-2026-001');
    expect(screen.queryByRole('button', { name: 'Dòng giá' })).toBeNull();
  });
});

describe('u1: Duyet creative', () => {
  const item = (id: string, extra = {}) => ({ id, customer_id: 'K001', customer_name: 'Vinamilk', name: `${id}.png`, mime: 'image/png', kind: 'image', size_bytes: 2_621_440, duration_s: null, width: 1920, height: 1080, scan_state: 'needs_manual_review', content_version: 3, created_at: '2026-11-12T01:00:00Z', reasons: ['png_trailing_data', 'ly_do_la'], preview_url: `https://files.example/${id}`, ...extra });
  const asAdmin = (media: string[]) => meFor(perms(['view'], media));

  it('hien thumbnail, ten tep, khach, kich thuoc, scan_state, phien ban, ly do (da dich); phan trang', async () => {
    handlers.push(asAdmin(['view', 'approve']), (u) => (u.pathname === '/api/admin/v1/media/scan-review/queue' ? { body: { items: [item('a1'), item('a2', { kind: 'video', mime: 'video/mp4', duration_s: 15, size_bytes: 512000 })], total: 25, page: Number(u.searchParams.get('page')), page_size: 12 } } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount('/creative-review');
    expect(await screen.findByRole('heading', { name: 'Duyệt creative' })).toBeInTheDocument();
    const card = await screen.findByRole('group', { name: 'a1.png' });
    expect(within(card).getByRole('img', { name: 'Xem trước a1.png' })).toHaveAttribute('src', 'https://files.example/a1');
    expect(card).toHaveTextContent('Vinamilk');
    expect(card).toHaveTextContent('2,5 MB');
    expect(card).toHaveTextContent('Chờ kiểm tra thủ công');
    expect(card).toHaveTextContent('Phiên bản nội dung v3');
    expect(card).toHaveTextContent('PNG có dữ liệu thừa phía sau');
    expect(card).toHaveTextContent('ly_do_la');
    const vid = screen.getByLabelText('Xem trước a2.png');
    expect(vid.tagName).toBe('VIDEO');
    expect(screen.getByRole('group', { name: 'a2.png' })).toHaveTextContent('15 giây');
    expect(screen.getByText('25 tệp đang chờ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Trang 3' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/scan-review/queue') && c.query.includes('page=3'))).toBe(true));
  });

  it('trang thai rong', async () => {
    handlers.push(asAdmin(['view', 'approve']), on('/admin/v1/media/scan-review/queue', { items: [], total: 0, page: 1, page_size: 12 }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/creative-review');
    expect(await screen.findByText('Không có creative nào đang chờ kiểm tra thủ công.')).toBeInTheDocument();
  });

  it('tu choi can ly do (>=3 ky tu) roi gui decision + note + content_version', async () => {
    handlers.push(asAdmin(['view', 'approve']), on('/admin/v1/media/scan-review/queue', { items: [item('a1')], total: 1, page: 1, page_size: 12 }), on('/admin/v1/media/a1/scan-review', { id: 'a1', scan_state: 'failed' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/creative-review');
    const card = await screen.findByRole('group', { name: 'a1.png' });
    await userEvent.click(within(card).getByRole('button', { name: 'Từ chối' }));
    const dlg = await screen.findByRole('dialog', { name: 'Từ chối creative' });
    await userEvent.type(within(dlg).getByRole('textbox'), 'ab');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Xác nhận từ chối' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('tối thiểu 3 ký tự');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.type(within(dlg).getByRole('textbox'), 'c du lieu la');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Xác nhận từ chối' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'reject', note: 'abc du lieu la', content_version: 3 }));
  });

  it('duyet: gui approve kem phien ban; 409 content_changed hien thong bao va tai lai hang cho', async () => {
    let n = 0;
    handlers.push(
      asAdmin(['view', 'approve']),
      on('/admin/v1/media/scan-review/queue', () => { n += 1; return { items: [item('a1', { content_version: n === 1 ? 3 : 4 })], total: 1, page: 1, page_size: 12 }; }),
      on('/admin/v1/media/a1/scan-review', { error: { code: 'content_changed', message: 'Nội dung tệp đã thay đổi kể từ lúc bạn xem.' } }, 'POST', 409),
    );
    vi.stubGlobal('fetch', mockFetch());
    mount('/creative-review');
    const card = await screen.findByRole('group', { name: 'a1.png' });
    await userEvent.click(within(card).getByRole('button', { name: 'Duyệt' }));
    const dlg = await screen.findByRole('dialog', { name: 'Duyệt creative (xác nhận an toàn)' });
    await userEvent.type(within(dlg).getByRole('textbox'), 'da xem tay');
    await userEvent.click(within(dlg).getByRole('checkbox', { name: /Đồng thời duyệt nội dung/ })); // bo chon "duyet luon noi dung": chi xac nhan an toan (scan-review)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Xác nhận duyệt' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'approve', note: 'da xem tay', content_version: 3 }));
    expect(await screen.findByText(/Nội dung tệp đã thay đổi/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('group', { name: 'a1.png' })).toHaveTextContent('Phiên bản nội dung v4'));
  });

  it('khong co media:approve: thong bao khong co quyen, khong goi API hang cho', async () => {
    handlers.push(asAdmin(['view']));
    vi.stubGlobal('fetch', mockFetch());
    mount('/creative-review');
    expect(await screen.findByText('Không có quyền duyệt creative')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/scan-review/queue'))).toBe(false);
  });
});
