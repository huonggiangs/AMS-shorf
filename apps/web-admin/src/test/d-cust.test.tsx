// d-cust: xoa thiet bi (don le + hang loat, hop xac nhan liet ke ten), sua/xoa khach hang (kiem tra MST, ly do chan), nhap mau hop dong tu may tinh.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { TAX_RE, validateCustomerForm } from '../components/CustomerEdit';
import { checkImportFile } from '../components/TemplateImport';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Reply = { status?: number; body: unknown } | undefined;
type Handler = (url: URL, method: string, body: any) => Reply;
let handlers: Handler[] = [];
const reqs: { method: string; path: string; search: string; body: any; blob?: boolean }[] = [];
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const isBlob = typeof Blob !== 'undefined' && init?.body instanceof Blob;
    const body = init?.body && !isBlob ? JSON.parse(String(init.body)) : null;
    reqs.push({ method, path: url.pathname, search: url.search, body, blob: isBlob });
    for (const h of handlers) {
      const r = h(url, method, body);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const on = (path: string, data: unknown, method = 'GET', status = 200): Handler => (u, m) => (u.pathname === `/api${path}` && m === method ? { status, body: data } : undefined);
const admin = (extra: Record<string, string[]> = {}): Handler => (u) => (u.pathname === '/api/auth/me' ? { body: { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'super_admin' }, permissions: { overview: ['view'], devices: ['view', 'write', 'delete'], customers: ['view', 'write', 'delete'], admin: ['view', 'write'], ...extra } } } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };
beforeEach(() => { handlers = []; reqs.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

const dev = (i: number) => ({ id: `d${i}`, name: `TV phòng ${i}`, kind: 'tv', model: 'BRAVIA', os: 'android', owner_name: null, app_version: '1.0', region: 'Hà Nội', status: 'online', trust_level: 1, pairing_state: 'paired', paired_at: '2026-11-01T00:00:00Z', views: 3 });

describe('helpers', () => {
  it('MST 10 so hoac 10 so-3 so; kiem tra hop le ho so; kiem tra tep nhap', () => {
    expect(TAX_RE.test('0312345678')).toBe(true);
    expect(TAX_RE.test('0312345678-001')).toBe(true);
    expect(TAX_RE.test('12345')).toBe(false);
    expect(validateCustomerForm({ legal_name: '', tax_code: '', email: '' }, [])).toContain('tên pháp lý');
    expect(validateCustomerForm({ legal_name: 'A', tax_code: '12', email: '' }, [])).toContain('Mã số thuế');
    expect(validateCustomerForm({ legal_name: 'A', tax_code: '', email: 'x' }, [])).toContain('Email');
    expect(validateCustomerForm({ legal_name: 'A', tax_code: '0312345678', email: 'a@b.vn' }, [{ name: '' }])).toContain('liên hệ #1');
    expect(validateCustomerForm({ legal_name: 'A', tax_code: '', email: '' }, [])).toBe('');
    expect(checkImportFile({ name: 'a.exe', size: 5 })).toContain('.docx');
    expect(checkImportFile({ name: 'a.docx', size: 3 * 1024 * 1024 })).toContain('2 MB');
    expect(checkImportFile({ name: 'a.DOCX', size: 100 })).toBe('');
    expect(checkImportFile({ name: 'a.json', size: 0 })).toContain('rỗng');
  });
});

describe('Devices: xoa thiet bi', () => {
  it('chon 2 thiet bi -> Xoa -> hop xac nhan liet ke ten -> POST /devices/bulk-delete {ids}', async () => {
    handlers.push(admin(), on('/admin/v1/devices', { items: [dev(1), dev(2), dev(3)], total: 3, page: 1, page_size: 20 }), on('/admin/v1/devices/bulk-delete', { deleted: 2, requested: 2, skipped: [], ids: ['d1', 'd2'] }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/devices');
    await screen.findByText('TV phòng 1');
    const boxes = screen.getAllByRole('checkbox', { name: 'select' });
    await user.click(boxes[0]!);
    await user.click(boxes[1]!);
    await user.click(await screen.findByRole('button', { name: 'Xóa' }));
    const d = await screen.findByRole('dialog', { name: 'Xóa thiết bị' });
    expect(d).toHaveTextContent('Xóa 2 thiết bị?');
    expect(within(d).getByRole('list', { name: 'Thiết bị sẽ xóa' })).toHaveTextContent('TV phòng 1');
    expect(d).toHaveTextContent('TV phòng 2');
    expect(d).not.toHaveTextContent('TV phòng 3');
    await user.click(within(d).getByRole('button', { name: 'Xóa 2 thiết bị' }));
    await waitFor(() => expect(reqs.find((r) => r.method === 'POST' && r.path === '/api/admin/v1/devices/bulk-delete')?.body).toEqual({ ids: ['d1', 'd2'] }));
  });

  it('khong co devices:delete -> khong co nut Xoa o thao tac hang loat', async () => {
    handlers.push(admin({ devices: ['view', 'write'] }), on('/admin/v1/devices', { items: [dev(1)], total: 1, page: 1, page_size: 20 }));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/devices');
    await screen.findByText('TV phòng 1');
    await user.click(screen.getAllByRole('checkbox', { name: 'select' })[0]!);
    expect(await screen.findByRole('button', { name: 'Chặn' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull();
  });

  it('ngan keo: nut "Xoa thiet bi" -> DELETE /devices/:id', async () => {
    handlers.push(admin(), on('/admin/v1/devices', { items: [dev(1)], total: 1, page: 1, page_size: 20 }), on('/admin/v1/devices/d1', dev(1)), on('/admin/v1/devices/d1', { deleted: 1, requested: 1, skipped: [], ids: ['d1'] }, 'DELETE'));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/devices?open=d1');
    await user.click(await screen.findByRole('button', { name: 'Xóa thiết bị' }));
    const d = await screen.findByRole('dialog', { name: 'Xóa thiết bị' });
    await user.click(within(d).getByRole('button', { name: 'Xóa 1 thiết bị' }));
    await waitFor(() => expect(reqs.some((r) => r.method === 'DELETE' && r.path === '/api/admin/v1/devices/d1')).toBe(true));
  });
});

const cust = { id: 'c1', code: 'K001', legal_name: 'Công ty Sữa Việt', short_name: 'Sữa Việt', tax_code: '0312345678', address: '1 Lê Lợi', phone: '0900', email: 'a@b.vn', status: 'cooperating', credit_limit_vnd: 0, debt_vnd: 0, updated_at: '2026-11-01T00:00:00Z', notes: null, contacts: [{ id: 'ct1', name: 'Chị Lan', phone: '0901', email: 'lan@x.vn', is_primary: 1 }] };

describe('Customers: sua / xoa', () => {
  it('Sua ho so: MST sai bi chan o trinh duyet; MST dung -> PATCH kem if_updated_at va lien he; ma khach hang chi doc', async () => {
    handlers.push(admin(), on('/admin/v1/customers', { items: [cust], total: 1, page: 1, page_size: 8 }), on('/admin/v1/customers/c1', cust), on('/admin/v1/customers/c1', cust, 'PATCH'));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/customers?open=c1');
    await user.click(await screen.findByRole('button', { name: 'Sửa hồ sơ' }));
    const d = await screen.findByRole('dialog', { name: 'Sửa khách hàng' });
    expect(within(d).getByLabelText('Mã khách hàng (không đổi được)')).toHaveAttribute('readonly');
    const tax = within(d).getByLabelText('Mã số thuế');
    await user.clear(tax);
    await user.type(tax, '123');
    await user.click(within(d).getByRole('button', { name: 'Lưu' }));
    expect(await within(d).findByText(/Mã số thuế gồm 10 số/)).toBeInTheDocument();
    expect(reqs.some((r) => r.method === 'PATCH')).toBe(false);
    await user.clear(tax);
    await user.type(tax, '0109876543');
    await user.type(within(d).getByLabelText('Ghi chú nội bộ'), 'VIP');
    await user.click(within(d).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(reqs.some((r) => r.method === 'PATCH')).toBe(true));
    const p = reqs.find((r) => r.method === 'PATCH')!;
    expect(p.path).toBe('/api/admin/v1/customers/c1');
    expect(p.body).toMatchObject({ tax_code: '0109876543', notes: 'VIP', if_updated_at: '2026-11-01T00:00:00Z', status: 'cooperating' });
    expect(p.body.code).toBeUndefined();
    expect(p.body.contacts).toEqual([expect.objectContaining({ id: 'ct1', name: 'Chị Lan', is_primary: true })]);
  });

  it('Xoa bi chan: hien day du ly do (chien dich, so du vi, cong no) va khong con nut xoa', async () => {
    const blockers = [{ code: 'active_campaigns', message: 'Còn 2 chiến dịch đang hoạt động/chờ duyệt: Tết, Hè.' }, { code: 'wallet_balance', message: 'Ví quảng cáo còn số dư 500.000 ₫.' }, { code: 'unpaid_receivables', message: 'Còn 1 khoản công nợ chưa thanh toán.' }];
    handlers.push(admin(), on('/admin/v1/customers', { items: [cust], total: 1, page: 1, page_size: 8 }), on('/admin/v1/customers/c1', cust),
      on('/admin/v1/customers/c1', { error: { code: 'customer_has_blockers', message: 'Không thể xóa khách hàng', details: { blockers } } }, 'DELETE', 409));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/customers?open=c1');
    await user.click(await screen.findByRole('button', { name: 'Xóa khách hàng' }));
    const d = await screen.findByRole('dialog', { name: 'Xóa khách hàng' });
    await user.click(within(d).getByRole('button', { name: 'Xóa khách hàng' }));
    const alert = await within(d).findByRole('alert');
    expect(alert).toHaveTextContent('Chưa thể xóa khách hàng này');
    expect(alert).toHaveTextContent('2 chiến dịch');
    expect(alert).toHaveTextContent('500.000');
    expect(alert).toHaveTextContent('công nợ');
    expect(within(d).queryByRole('button', { name: 'Xóa khách hàng' })).toBeNull();
  });

  it('khong co customers:delete / write -> khong co nut Sua, Xoa', async () => {
    handlers.push(admin({ customers: ['view'] }), on('/admin/v1/customers', { items: [cust], total: 1, page: 1, page_size: 8 }), on('/admin/v1/customers/c1', cust));
    vi.stubGlobal('fetch', mockFetch());
    mount('/customers?open=c1');
    await screen.findByText('Tạo hợp đồng từ mẫu');
    expect(screen.queryByRole('button', { name: 'Sửa hồ sơ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa khách hàng' })).toBeNull();
  });
});

describe('Hop dong mau: nhap tu may tinh', () => {
  const tpl = { id: 't1', code: 'ads-service', version: 1, name: 'Mẫu gốc', status: 'draft', article_count: 1, draft_problems: [] };
  const previewBody = { source: 'docx', name: 'Mau moi', articles: [{ key: 'doi_tuong', title: 'Đối tượng', body: 'Bên A cung cấp cho {{customer.legal_name}}.' }], issues: [], warnings: ['Mẫu còn chỗ trống dạng [...]'], mapped: [{ from: '{{customer.name}}', to: '{{customer.legal_name}}' }] };

  it('chon tep -> gui byte len import-preview, hien xem truoc + canh bao; sua ten; luu -> POST /templates voi import_source', async () => {
    handlers.push(admin(), on('/admin/v1/contract-docs/templates', { items: [tpl] }), on('/admin/v1/contract-docs/templates/import-preview', previewBody, 'POST'), on('/admin/v1/contract-docs/templates', { ...tpl, id: 't2' }, 'POST', 201));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/contract-docs');
    await user.click(await screen.findByRole('button', { name: 'Mẫu hợp đồng' }));
    await user.click(await screen.findByRole('button', { name: 'Nhập mẫu từ máy tính' }));
    const d = await screen.findByRole('dialog', { name: 'Nhập mẫu hợp đồng từ máy tính' });
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'Mau moi.docx');
    await user.upload(within(d).getByLabelText(/Tệp mẫu/), file);
    expect(await within(d).findByText(/Xem trước · 1 điều khoản/)).toBeInTheDocument();
    const pre = reqs.find((r) => r.path === '/api/admin/v1/contract-docs/templates/import-preview')!;
    expect(pre.blob).toBe(true);
    expect(pre.search).toContain('filename=Mau+moi.docx');
    expect(d).toHaveTextContent('Mẫu còn chỗ trống');
    expect(d).toHaveTextContent('Đã đổi 1 trường');
    const name = within(d).getByLabelText('Tên mẫu');
    await user.clear(name);
    await user.type(name, 'Mẫu nhập tháng 11');
    await user.click(within(d).getByRole('button', { name: 'Lưu thành bản nháp mới' }));
    await waitFor(() => expect(reqs.some((r) => r.method === 'POST' && r.path === '/api/admin/v1/contract-docs/templates')).toBe(true));
    const save = reqs.find((r) => r.method === 'POST' && r.path === '/api/admin/v1/contract-docs/templates')!;
    expect(save.body).toMatchObject({ name: 'Mẫu nhập tháng 11', import_source: 'docx', articles: previewBody.articles });
  });

  it('tep sai loai bi tu choi o trinh duyet (khong goi may chu); loi may chu hien tieng Viet; co issues thi khong cho luu', async () => {
    handlers.push(admin(), on('/admin/v1/contract-docs/templates', { items: [tpl] }), on('/admin/v1/contract-docs/templates/import-preview', { ...previewBody, issues: [{ code: 'unknown_variable', message: 'Biến {{bien.la}} không có trong danh mục biến.' }] }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/contract-docs');
    await user.click(await screen.findByRole('button', { name: 'Mẫu hợp đồng' }));
    await user.click(await screen.findByRole('button', { name: 'Nhập mẫu từ máy tính' }));
    const d = await screen.findByRole('dialog', { name: 'Nhập mẫu hợp đồng từ máy tính' });
    const input = within(d).getByLabelText(/Tệp mẫu/);
    const loose = userEvent.setup({ applyAccept: false });
    await loose.upload(input as HTMLInputElement, new File(['x'], 'virus.exe'));
    expect(await within(d).findByText(/Chỉ nhập được tệp/)).toBeInTheDocument();
    expect(reqs.some((r) => r.path.endsWith('import-preview'))).toBe(false);
    await user.upload(input, new File(['x'], 'a.txt'));
    expect(await within(d).findByText(/Chưa lưu được/)).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Lưu thành bản nháp mới' })).toBeDisabled();
  });

  it('Xuat mau ra file: GET /templates/:id/export; khong co admin:write thi khong co nut nhap', async () => {
    handlers.push(admin({ admin: ['view'] }), on('/admin/v1/contract-docs/templates', { items: [tpl] }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/contract-docs');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Mẫu hợp đồng' }));
    expect(await screen.findByRole('button', { name: 'Xuất mẫu ra file' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nhập mẫu từ máy tính' })).toBeNull();
  });
});
