import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

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
const admin = { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'super_admin' }, permissions: { overview: ['view'], admin: ['view', 'write', 'approve'], finance: ['view', 'write', 'approve'], customers: ['view', 'write', 'approve'], campaigns: ['view'] } };
const cust = { user: { id: 'u2', email: 'k@x', name: 'Lan', role: 'customer', customer_id: 'K001' }, permissions: { campaigns: ['view'], finance: ['view'] }, customer_scope: { customer_id: 'K001', code: 'K001', name: 'Vinamilk' } };
const meFor = (me: unknown): Handler => (u) => (u.pathname === '/api/auth/me' ? me : undefined);
type Fn = (m: string, b: Record<string, unknown> | null) => unknown;
const on = (path: string, data: Fn | object, method = 'GET'): Handler => (u, m, b) => (u.pathname === `/api${path}` && m === method ? (typeof data === 'function' ? data(m, b) : data) : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const list = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 20 });

beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('p4: cong chap nhan dieu khoan (khach hang)', () => {
  const pending = { pending: [{ id: 'L1', kind: 'terms', version: '2026-01', title: 'Điều khoản sử dụng', sha256: 'a'.repeat(64), published_at: '2026-01-01T00:00:00Z', body_md: 'Noi dung dieu khoan can doc' }], required: true };
  it('chan giao dien, nut chi bat khi tick dong y, gui accept kem sha256 roi vao ung dung', async () => {
    let accepted = false;
    handlers.push(meFor(cust), on('/portal/v1/legal/pending', () => (accepted ? { pending: [], required: false } : pending)), on('/portal/v1/legal/accept', (_m, b) => { accepted = true; return { recorded: (b?.acceptances as unknown[]).length, pending: [], required: false }; }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/finance');
    const dlg = await screen.findByRole('dialog', { name: 'Chấp nhận điều khoản' });
    expect(within(dlg).getByText(/Noi dung dieu khoan can doc/)).toBeInTheDocument();
    const btn = within(dlg).getByRole('button', { name: 'Đồng ý và tiếp tục' });
    expect(btn).toBeDisabled();
    await userEvent.click(within(dlg).getByRole('checkbox'));
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(calls.find((c) => c.path === '/api/portal/v1/legal/accept')?.body).toEqual({ acceptances: [{ document_id: 'L1', sha256: 'a'.repeat(64) }] }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chấp nhận điều khoản' })).toBeNull());
  });
  it('khong co van ban cho chap nhan (hoac loi tai) thi khong chan', async () => {
    handlers.push(meFor(cust));
    vi.stubGlobal('fetch', mockFetch());
    mount('/finance');
    await screen.findByRole('heading', { name: 'Lịch sử xem quảng cáo' });
    expect(screen.queryByRole('dialog', { name: 'Chấp nhận điều khoản' })).toBeNull();
  });
  it('nhan vien noi bo khong bi chan va khong goi cong portal', async () => {
    handlers.push(meFor(admin));
    vi.stubGlobal('fetch', mockFetch());
    mount('/legal');
    await screen.findByRole('heading', { name: 'Văn bản pháp lý' });
    expect(calls.some((c) => c.path.startsWith('/api/portal/v1/legal'))).toBe(false);
  });
});

describe('p4: quan tri van ban phap ly', () => {
  const doc = { id: 'D1', kind: 'terms', version: '2026-01', title: 'Điều khoản sử dụng (nháp)', status: 'draft', requires_acceptance: true, published_at: null };
  it('phat hanh can xac nhan luat su da duyet; gui confirm_lawyer_approved', async () => {
    handlers.push(meFor(admin), on('/admin/v1/legal/documents', list([doc])), on('/admin/v1/legal/documents/D1', { ...doc, body_md: 'x'.repeat(30), draft_problems: ['con ghi chu [LUAT SU]'], acceptances: 0 }), on('/admin/v1/legal/documents/D1/publish', { id: 'D1', status: 'published' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/legal');
    expect(await screen.findByText('Điều khoản sử dụng (nháp)')).toBeInTheDocument();
    expect(screen.getByText(/BẢN NHÁP/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Phát hành' }));
    const dlg = await screen.findByRole('dialog', { name: 'Phát hành văn bản' });
    const submit = within(dlg).getByRole('button', { name: 'Phát hành' });
    expect(submit).toBeDisabled();
    await userEvent.click(within(dlg).getByLabelText(/luật sư đã duyệt/));
    await userEvent.click(await within(dlg).findByLabelText(/Vẫn phát hành/));
    await userEvent.click(submit);
    await waitFor(() => expect(calls.find((c) => c.path === '/api/admin/v1/legal/documents/D1/publish')?.body).toMatchObject({ confirm_lawyer_approved: true, allow_draft_markers: true }));
  });
});

describe('p4: cong no + hoa don dien tu', () => {
  it('cong no: tong hop + bang khoan phai thu bang tieng Viet', async () => {
    handlers.push(meFor(admin), on('/admin/v1/billing/summary', { by_state: { overdue: { count: 2, remaining_vnd: 5000000 } }, total_outstanding_vnd: 8000000, auto_pause_events: 1 }),
      on('/admin/v1/billing/receivables', list([{ id: 'R1', customer: 'Unilever', period: '2026-10', amount_vnd: 5000000, paid_vnd: 0, remaining_vnd: 5000000, due_date: '2026-10-31', days_past_due: 14, credit_limit_vnd: 0, state: 'overdue' }])));
    vi.stubGlobal('fetch', mockFetch());
    mount('/billing');
    expect(await screen.findByText('Unilever')).toBeInTheDocument();
    expect(screen.getAllByText('Quá hạn').length).toBeGreaterThan(1);
    expect(screen.getByText('Không giới hạn')).toBeInTheDocument();
    expect(screen.getByText('2 khoản')).toBeInTheDocument();
  });
  it('nhac no: luu cai dat gui dung mang moc ngay', async () => {
    handlers.push(meFor(admin), on('/admin/v1/billing/settings', { settings: { reminder_offsets_days: [-3, 0, 7], auto_pause_after_days: 30, enforce_credit_limit: true, low_balance_email: true, send_emails: true } }),
      on('/admin/v1/billing/settings', () => ({ settings: {} }), 'PUT'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/billing');
    await userEvent.click(await screen.findByRole('button', { name: 'Nhắc nợ' }));
    const offs = await screen.findByLabelText(/Mốc gửi email nhắc/);
    expect(offs).toHaveValue('-3, 0, 7');
    await userEvent.clear(offs);
    await userEvent.type(offs, '-2, 5, 10');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/api/admin/v1/billing/settings')?.body).toMatchObject({ reminder_offsets_days: [-2, 5, 10], auto_pause_after_days: 30 }));
  });
  it('hoa don dien tu: nha cung cap that thieu cau hinh duoc bao ro; chung tu cho nhap so', async () => {
    handlers.push(meFor(admin), on('/admin/v1/einvoices/settings', { settings: { provider: 'misa', sandbox: true, series: 'C26TAA', template_code: '1', auto_issue: false, auto_adjust_on_refund: true }, providers: ['manual', 'misa', 'viettel'], connection: { configured: false, missing: ['EINVOICE_MISA_SANDBOX_URL'] } }),
      on('/admin/v1/einvoices', list([{ id: 'E1', invoice_id: 'I1', customer: 'Vinamilk', period: '2026-10', kind: 'original', provider: 'manual', status: 'pending', einvoice_no: null, total_vnd: 1100000, sandbox: false }])),
      on('/admin/v1/einvoices/E1/confirm', { id: 'E1', status: 'issued' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/billing');
    await userEvent.click(await screen.findByRole('button', { name: 'Hóa đơn điện tử' }));
    expect(await screen.findByText(/EINVOICE_MISA_SANDBOX_URL/)).toBeInTheDocument();
    expect(screen.getByText(/không nhập ở đây/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Nhập số hóa đơn' }));
    const dlg = await screen.findByRole('dialog', { name: 'Nhập số hóa đơn' });
    await userEvent.type(within(dlg).getByLabelText('Số hóa đơn'), '0000123');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/api/admin/v1/einvoices/E1/confirm')?.body).toMatchObject({ einvoice_no: '0000123' }));
  });
  it('khach hang thay hoa don dien tu cua minh o trang Thanh toan', async () => {
    handlers.push(meFor(cust), on('/portal/v1/einvoices', list([{ id: 'E1', kind: 'original', einvoice_no: '0000456', series: 'C26TAA', lookup_code: 'ABC123', total_vnd: 1100000 }])));
    vi.stubGlobal('fetch', mockFetch());
    mount('/finance');
    expect(await screen.findByText('0000456')).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
  });
});

describe('p4: du lieu ca nhan va KYC', () => {
  it('DSR xuat du lieu: goi execute va hien nut; yeu cau da xu ly khong con nut', async () => {
    handlers.push(meFor(admin), on('/admin/v1/compliance/dsr', list([{ id: 'Q1', kind: 'export', subject_type: 'customer_contact', subject_id: 'A1', customer: 'Vinamilk', requester: 'Lan', state: 'requested', created_at: '2026-11-10T01:00:00Z', due_at: '2026-11-13T01:00:00Z' }, { id: 'Q2', kind: 'anonymize', subject_type: 'end_user', subject_id: 'U9', state: 'completed', created_at: '2026-11-01T01:00:00Z', due_at: '2026-11-04T01:00:00Z' }])),
      on('/admin/v1/compliance/dsr/Q1/execute', { id: 'Q1', state: 'completed', summary: {}, export: { subject: 'A1' } }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    mount('/compliance');
    expect(await screen.findByText(/Xuất dữ liệu/, { selector: 'button' })).toBeInTheDocument();
    expect(screen.getAllByText('Đã hoàn tất').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Thực hiện ẩn danh' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Xuất dữ liệu' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/admin/v1/compliance/dsr/Q1/execute' && c.method === 'POST')).toBe(true));
  });
  it('luu giu du lieu: hien chinh sach va so dong se xoa', async () => {
    handlers.push(meFor(admin), on('/admin/v1/compliance/retention', { policy: { ev_heartbeat_days: 30, ev_ad_impression_days: 400, ev_proof_of_play_days: 400, impression_hourly_days: 800 }, preview: { ev_heartbeat: 12 } }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/compliance');
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu giữ dữ liệu' }));
    expect((await screen.findAllByDisplayValue('400')).length).toBe(2);
    expect(screen.getByText(/12 dòng/)).toBeInTheDocument();
  });
  it('KYC: hang cho duyet, mo ho so, duyet voi co nganh han che', async () => {
    handlers.push(meFor(admin),
      on('/admin/v1/compliance/kyc', list([{ customer_id: 'K9', customer: 'Bia Sài Gòn', industry: 'Đồ uống', state: 'submitted', pending_docs: 1, restricted_industry: false, submitted_at: '2026-11-10T01:00:00Z' }])),
      on('/admin/v1/compliance/kyc/K9', { customer: { id: 'K9', name: 'Bia Sài Gòn', industry: 'Đồ uống' }, profile: { state: 'submitted', business_reg_no: '0301234567', restricted_industry: false, restricted_categories: [] }, documents: [{ id: 'F1', doc_type: 'industry_licence', file_name: 'gpkd.pdf', size_bytes: 2048, state: 'pending', preview_url: 'https://obj/x' }] }),
      on('/admin/v1/compliance/kyc/K9/decision', { state: 'approved' }, 'POST'));
    vi.stubGlobal('fetch', mockFetch());
    mount('/kyc');
    expect(await screen.findByText('Bia Sài Gòn')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Xem xét' }));
    expect(await screen.findByText('Giấy phép ngành nghề')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'gpkd.pdf' })).toHaveAttribute('href', 'https://obj/x');
    await userEvent.click(screen.getByLabelText(/ngành hạn chế \(cần duyệt lần hai/));
    await userEvent.click(screen.getByLabelText('Rượu bia'));
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt hồ sơ' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/api/admin/v1/compliance/kyc/K9/decision')?.body).toMatchObject({ decision: 'approve', restricted_industry: true, restricted_categories: ['alcohol'] }));
  });
  it('khach hang thay muc ho so phap ly trong Ho so cua toi', async () => {
    handlers.push(meFor(cust), on('/portal/v1/kyc', { profile: { state: 'draft', business_reg_no: null }, documents: [] }));
    vi.stubGlobal('fetch', mockFetch());
    mount('/profile');
    expect(await screen.findByText('Hồ sơ pháp lý doanh nghiệp')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Nộp hồ sơ để duyệt' })).toBeInTheDocument();
  });
});
