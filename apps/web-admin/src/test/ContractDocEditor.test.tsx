import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { previewText } from '../lib/ContractDocRender';

type Handler = (url: URL, method: string, body: Record<string, unknown> | null) => unknown;
let handlers: Handler[] = [];
const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    for (const h of handlers) {
      const r = h(url, method, body);
      if (r !== undefined) return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const perms = { overview: ['view'], admin: ['view', 'write', 'approve'], customers: ['view', 'write'], campaigns: ['view'] };
const me = (p: Record<string, string[]>) => ({ user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'super_admin' }, permissions: p });
const meFor = (m: unknown): Handler => (u) => (u.pathname === '/api/auth/me' ? m : undefined);
type Fn = (m: string, b: Record<string, unknown> | null) => unknown;
const on = (path: string, data: Fn | object, method = 'GET'): Handler => (u, m, b) => (u.pathname === `/api${path}` && m === method ? (typeof data === 'function' ? data(m, b) : data) : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};

const BASE = '/admin/v1/contract-docs';
const art = (key: string, title: string, body: string, numbered = true) => ({ key, title, body, numbered, overridden: false });
const detail = (over: Record<string, unknown> = {}) => ({
  id: 'D1', version: 1, status: 'draft', content_hash: null, computed_hash: 'a'.repeat(64), finalized_at: null, template_code: 'ads-service', template_version: 1, template_status: 'approved',
  variables: {}, effective_variables: { 'seller.name': 'Công ty ANIO', 'contract.no': 'HD-2026-001', 'payment.account': '' },
  articles: [art('parties', 'Các bên', 'Bên A: {{seller.name}}', false), art('payment', 'Thanh toán', 'Chuyển khoản vào {{payment.account}} cho hợp đồng {{contract.no}}.\n\n{{price_table}}')],
  price: { lines: [{ screen_type: 'Smart TV', region: 'HN', daypart: 'Cao điểm', frequency: '10', duration_s: '15', qty: 2, impression_price_vnd: '120.5' }], value_vnd: 1000, vat_rate: 10, vat_vnd: 100, total_vnd: 1100 },
  missing: ['payment.account'], text: '', ...over,
});
const VARS = { items: [{ key: 'seller.name', label: 'Bên A: tên pháp nhân', group: 'seller', source: 'auto' }, { key: 'payment.account', label: 'Tài khoản nhận tiền', group: 'payment', source: 'manual' }] };
const baseHandlers = (d: Record<string, unknown>) => [
  meFor(me(perms)),
  on('/admin/v1/contracts', { items: [{ id: 'C1', number: 'HD-2026-001', customer_name: 'Vinamilk' }], total: 1 }),
  on(`${BASE}/by-contract/C1`, { items: [{ id: 'D1', version: 1, status: d['status'] }] }),
  on(`${BASE}/templates`, { items: [{ id: 'T1', name: 'Mẫu', version: 1, status: 'draft', article_count: 2, draft_problems: ['Còn 1 chỗ trống'] }] }),
  on(`${BASE}/variables`, VARS),
  on(`${BASE}/D1`, d),
];

beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('previewText (xem truoc tren trinh duyet)', () => {
  it('thay bien, bao cho trong, danh so dieu, bo dau ` va **', () => {
    const r = previewText([art('a', 'Mở đầu', 'Bên **A**: {{seller.name}}', false), art('b', 'Giá', 'Tổng {{x.y}} `[luật sư]` {{price_table}}')], { 'seller.name': 'ANIO' }, { 'x.y': '5' }, ['1. dòng']);
    expect(r.missing).toEqual([]);
    expect(r.text).toContain('MỞ ĐẦU');
    expect(r.text).toContain('Bên A: ANIO');
    expect(r.text).toContain('Điều 1. Giá');
    expect(r.text).toContain('[luật sư]');
    expect(r.text).toContain('[Bảng giá dịch vụ]\n1. dòng');
    expect(r.text).not.toContain('`');
    expect(previewText([art('a', 'T', '{{no.co}}')], {}, {}, []).missing).toEqual(['no.co']);
  });
});

describe('trang Soạn hợp đồng', () => {
  it('chon hop dong tu ?contract=, hien ban soan, xem truoc va canh bao thong tin trong; go bien cap nhat xem truoc, luu gui dung du lieu', async () => {
    handlers.push(...baseHandlers(detail()), on(`${BASE}/D1`, (_m, b) => detail({ variables: (b as { variables: Record<string, string> }).variables }), 'PUT'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/contract-docs?contract=C1');
    const prev = await screen.findByTestId('doc-preview');
    await waitFor(() => expect(prev.textContent).toContain('Bên A: Công ty ANIO'));
    expect(prev.textContent).toContain('Điều 1. Thanh toán');
    expect(prev.textContent).toContain('Chuyển khoản vào ……………');
    expect(prev.textContent).toContain('120.5 ₫/lượt');
    expect(screen.getByText(/Còn 1 thông tin trống: payment.account/)).toBeInTheDocument();
    const saveBtn = screen.getByRole('button', { name: 'Lưu bản soạn' });
    expect(saveBtn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Tài khoản nhận tiền'), '0123 VCB');
    expect(prev.textContent).toContain('Chuyển khoản vào 0123 VCB cho hợp đồng HD-2026-001.');
    expect(screen.getByText('Chưa lưu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tải PDF/ })).toBeDisabled(); // phai luu truoc
    await userEvent.click(saveBtn);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === `/api${BASE}/D1`)?.body).toEqual({ variables: { 'payment.account': '0123 VCB' }, article_overrides: {} }));
  });

  it('sua dieu khoan gui article_overrides, khoi phuc theo mau', async () => {
    handlers.push(...baseHandlers(detail()), on(`${BASE}/D1`, () => detail(), 'PUT'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/contract-docs?contract=C1');
    await screen.findByTestId('doc-preview');
    await userEvent.click(await screen.findByRole('button', { name: /Điều 1\. Thanh toán/ }));
    const ta = screen.getByLabelText('Nội dung Thanh toán');
    await userEvent.clear(ta);
    await userEvent.type(ta, 'Nội dung mới Đặng');
    expect(screen.getByTestId('doc-preview').textContent).toContain('Nội dung mới Đặng');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bản soạn' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ article_overrides: { payment: { title: 'Thanh toán', body: 'Nội dung mới Đặng' } } }));
  });

  it('tai PDF goi dung duong dan; chot ban can tick xac nhan va gui content_hash', async () => {
    handlers.push(...baseHandlers(detail({ missing: [] })), on(`${BASE}/D1/finalize`, { id: 'D1', status: 'final' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    const createUrl = vi.fn(() => 'blob:x');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    mount('/contract-docs?contract=C1');
    await screen.findByTestId('doc-preview');
    await userEvent.click(screen.getByRole('button', { name: /Tải PDF/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'GET' && c.path === `/api${BASE}/D1/pdf`)).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Chốt bản ký…' }));
    const dlg = await screen.findByRole('dialog', { name: 'Chốt bản ký' });
    const go = within(dlg).getByRole('button', { name: 'Chốt bản ký' });
    expect(go).toBeDisabled();
    await userEvent.click(within(dlg).getByRole('checkbox'));
    await userEvent.click(go);
    await waitFor(() => expect(calls.find((c) => c.path === `/api${BASE}/D1/finalize`)?.body).toEqual({ content_hash: 'a'.repeat(64) }));
  });

  it('ban da chot: khong sua, khong co nut chot; mau chua duyet hien canh bao BAN NHAP', async () => {
    handlers.push(...baseHandlers(detail({ status: 'final', content_hash: 'b'.repeat(64), computed_hash: 'b'.repeat(64) })));
    vi.stubGlobal('fetch', mockFetch());
    mount('/contract-docs?contract=C1');
    await screen.findByTestId('doc-preview');
    expect(screen.queryByRole('button', { name: 'Lưu bản soạn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chốt bản ký…' })).toBeNull();
    expect(screen.getByLabelText('Tài khoản nhận tiền')).toBeDisabled();
  });

  it('nguoi chi co customers:write khong thay nut chot; mau nhap hien canh bao', async () => {
    handlers.push(meFor(me({ overview: ['view'], customers: ['view', 'write'] })), ...baseHandlers(detail({ template_status: 'draft' })).slice(1));
    vi.stubGlobal('fetch', mockFetch());
    mount('/contract-docs?contract=C1');
    await screen.findByTestId('doc-preview');
    expect(screen.getByText(/Mẫu này chưa được luật sư duyệt/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chốt bản ký…' })).toBeNull();
  });
});

describe('mau hop dong va logo', () => {
  it('duyet mau: can tick luat su duyet, gui xac nhan + allow_draft_markers khi con dau hieu nhap', async () => {
    handlers.push(...baseHandlers(detail()), on(`${BASE}/templates/T1/approve`, { id: 'T1', status: 'approved' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/contract-docs');
    await userEvent.click(await screen.findByRole('button', { name: 'Mẫu hợp đồng' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Xác nhận luật sư đã duyệt' }));
    const dlg = await screen.findByRole('dialog', { name: 'Duyệt mẫu hợp đồng' });
    const go = within(dlg).getByRole('button', { name: 'Duyệt mẫu' });
    expect(go).toBeDisabled();
    const boxes = within(dlg).getAllByRole('checkbox');
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[1]!);
    await userEvent.click(go);
    await waitFor(() => expect(calls.find((c) => c.path === `/api${BASE}/templates/T1/approve`)?.body).toMatchObject({ confirm_lawyer_approved: true, allow_draft_markers: true }));
  });

  it('logo: mac dinh la chu ANIO; tai len gui base64 + content_type, tu choi tep sai loai', async () => {
    handlers.push(meFor(me(perms)), on(`${BASE}/logo`, { is_default: true, default_text: 'ANIO', logo: null }), on(`${BASE}/logo`, { is_default: false, logo: { width: 64, height: 64 } }, 'PUT'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/contract-docs');
    await userEvent.click(await screen.findByRole('button', { name: 'Logo watermark' }));
    expect(await screen.findByText(/Đang dùng logo chữ mặc định/)).toBeInTheDocument();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, new File(['x'], 'a.gif', { type: 'image/gif' }), { applyAccept: false });
    expect(await screen.findByText('Chỉ nhận ảnh PNG hoặc JPEG.')).toBeInTheDocument();
    await userEvent.upload(input, new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === `/api${BASE}/logo`)?.body).toEqual({ content_type: 'image/png', data_base64: 'iVBORw==' }));
  });
});
