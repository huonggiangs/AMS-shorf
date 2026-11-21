// Hop thoai "Tai noi dung moi" MOT luong: chon tep -> tu kiem tra -> tu chuyen ma neu can (WebCodecs gia lap vi jsdom khong co) -> tai len (mot thanh) -> xong.
// Don tep ket: nut "Xoa tat ca tep bi ket"; the loi nhap lien ket can chuyen ma co nut "Chon tep tu may"; chan doan chi hien cho noi bo.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { isStuck } from '../pages/MediaPage';
import { MB, pickSettings, type SourceInfo } from '../lib/transcode-plan';

const m = vi.hoisted(() => ({ probe: vi.fn(), transcode: vi.fn(), supported: vi.fn(() => true) }));
vi.mock('../lib/transcode', async (orig) => ({ ...(await orig<typeof import('../lib/transcode')>()), probeVideo: m.probe, transcodeVideo: m.transcode, webCodecsSupported: m.supported }));

const dlgEl = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlgEl.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlgEl.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };

type Call = { method: string; path: string; body: unknown };
const calls: Call[] = [];
let routes: ((u: URL, method: string, body: any) => unknown | undefined)[] = [];
const mockFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    let body: any = null;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } } else if (init?.body) body = { blob: true, size: (init.body as Blob).size, type: (init.body as Blob).type };
    calls.push({ method, path: url.pathname, body });
    for (const r of routes) {
      const out = r(url, method, body);
      if (out !== undefined) return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
const at = (path: string, data: unknown, method = 'GET') => (u: URL, mth: string) => (u.pathname === `/api${path}` && mth === method ? data : undefined);
const me = (u: URL) => (u.pathname === '/api/auth/me' ? { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'admin' }, permissions: { overview: ['view'], customers: ['view'], media: ['view', 'write', 'approve', 'delete'] } } : undefined);
const customers = at('/admin/v1/customers', { items: [{ id: 'c1', legal_name: 'Vinamilk', short_name: 'Vinamilk', code: 'K001', credit_limit_vnd: 0, debt_vnd: 0, status: 'active' }], total: 1, page: 1, page_size: 200 });
const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={['/media']}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const src = (o: Partial<SourceInfo> = {}): SourceInfo => ({ width: 2160, height: 3840, durationSec: 20, codec: 'av1', container: 'webm', fps: 30, bitrateBps: 9e6, sizeBytes: 60 * MB, hasAudio: true, ...o });
const openDialog = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Tải nội dung mới/ }));
  const dlg = await screen.findByRole('dialog', { name: 'Tải nội dung' });
  await within(dlg).findByRole('option', { name: /Vinamilk/ });
  await userEvent.selectOptions(within(dlg).getByLabelText('Khách hàng sở hữu nội dung'), 'c1');
  return dlg;
};
const pickFile = async (dlg: HTMLElement, name = 'Silhouette of Vietnam 4K.webm', type = 'video/webm') => {
  const f = new File([new Uint8Array(1024)], name, { type });
  await userEvent.upload(within(dlg).getByLabelText('Chọn tệp để tải lên'), f);
  return f;
};
const uploadRoutes = (status = 'approved', extra: Record<string, unknown> = {}) => [
  (u: URL, mth: string) => (u.pathname === '/api/admin/v1/media/upload-url' && mth === 'POST' ? { id: 'n1', url: '/api/admin/v1/media/n1/content', method: 'PUT', via: 'proxy' } : undefined),
  (u: URL, mth: string) => (u.pathname === '/api/admin/v1/media/n1/content' && mth === 'PUT' ? { ok: true } : undefined),
  (u: URL, mth: string) => (u.pathname === '/api/admin/v1/media/n1/confirm' && mth === 'POST' ? { id: 'n1', name: 'x', status, warnings: [], ...extra } : undefined),
];

beforeEach(() => { calls.length = 0; routes = []; localStorage.clear(); m.probe.mockReset(); m.transcode.mockReset(); m.supported.mockReset(); m.supported.mockReturnValue(true); });
afterEach(() => vi.unstubAllGlobals());

describe('Tai noi dung moi: MOT luong', () => {
  it('AV1 4K doc: bao can chuyen bang loi don gian, nut lon "Tu dong chuyen sang chuan phat duoc", mot thanh tien do chung (chuyen 0-60%, tai len 60%+), huy duoc, xong hien thong bao + da chuyen', async () => {
    routes.push(me, customers, ...uploadRoutes('approved'));
    vi.stubGlobal('fetch', mockFetch());
    m.probe.mockResolvedValue(src());
    let release!: (f: File) => void;
    let onProg!: (p: { fraction: number; processedSec: number; elapsedSec: number }) => void;
    m.transcode.mockImplementation((_f: File, _s: unknown, o: { onProgress: typeof onProg }) => { onProg = o.onProgress; return new Promise<File>((r) => { release = r; }); });
    mount();
    const dlg = await openDialog();
    await pickFile(dlg);
    const verdict = await within(dlg).findByRole('status', { name: 'Kết quả kiểm tra' });
    expect(verdict).toHaveTextContent('cần chuyển sang chuẩn phát được');
    expect(within(dlg).getByRole('list', { name: 'Lý do' })).not.toHaveTextContent('AV1'); // ngon ngu don gian: khong lo ten codec o muc chinh
    expect(within(dlg).getByLabelText('Dành cho loại màn hình')).toHaveValue('elevator');
    const btn = within(dlg).getByRole('button', { name: 'Tự động chuyển sang chuẩn phát được' });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(m.transcode).toHaveBeenCalled());
    // thong so theo loai man: thang may 1080x1920 vua khung
    expect(m.transcode.mock.calls[0]![1]).toMatchObject({ width: 1080, height: 1920, fit: 'contain', fps: 30 });
    act(() => onProg({ fraction: 0.5, processedSec: 10, elapsedSec: 20 }));
    const bar = await within(dlg).findByRole('progressbar', { name: 'Tiến độ tải lên' });
    expect(bar).toHaveAttribute('aria-valuenow', '30'); // 50% chuyen ma = 30% tong
    expect(bar).toHaveTextContent('Đang chuyển sang chuẩn phát được… 50%');
    expect(bar).toHaveTextContent('còn khoảng 20 giây');
    expect(calls.some((c) => c.path.endsWith('/upload-url'))).toBe(false); // chua tai len khi chua chuyen xong
    release(new File([new Uint8Array(2048)], 'Silhouette of Vietnam 4K-h264.mp4', { type: 'video/mp4' }));
    const done = await within(dlg).findByRole('status', { name: 'Tải lên xong' });
    const up = calls.find((c) => c.path.endsWith('/upload-url'))!;
    expect(up.body).toMatchObject({ name: 'Silhouette of Vietnam 4K-h264.mp4', content_type: 'video/mp4', size_bytes: 2048, width: 1080, height: 1920, duration_sec: 20, customer_id: 'c1' });
    expect(calls.some((c) => c.method === 'PUT' && c.path.endsWith('/n1/content'))).toBe(true);
    expect(calls.some((c) => c.path.endsWith('/n1/confirm'))).toBe(true);
    expect(done).toHaveTextContent('tự động duyệt');
    expect(done).toHaveTextContent('Đã chuyển sang chuẩn phát được');
  });

  it('nhap tu lien ket: gui kem format + overlay (mo ta hien thi), overlay sai thi chan truoc khi gui', async () => {
    routes.push(me, customers, (u: URL, mth: string) => (u.pathname === '/api/admin/v1/media/import' && mth === 'POST' ? { id: 'l1', status: 'processing' } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount();
    const dlg = await openDialog();
    await userEvent.type(within(dlg).getByLabelText('Liên kết Google Drive hoặc Dropbox'), 'https://drive.google.com/file/d/1cfoXZesra4gI_XZNDOFXMpYXo2BgFIvF/view?usp=sharing');
    await userEvent.type(within(dlg).getByLabelText('Liên kết voucher / QR (https)'), 'http://sai.vn');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Nhập từ liên kết' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('https://');
    expect(calls.some((c) => c.path.endsWith('/media/import'))).toBe(false);
    await userEvent.clear(within(dlg).getByLabelText('Liên kết voucher / QR (https)'));
    await userEvent.type(within(dlg).getByLabelText('Liên kết voucher / QR (https)'), 'https://anio.vn/v/abc');
    await userEvent.type(within(dlg).getByLabelText('Tiêu đề'), 'Giam 20%');
    await userEvent.selectOptions(within(dlg).getByLabelText('Định dạng quảng cáo'), 'l_banner');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Nhập từ liên kết' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/media/import'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/media/import'))!.body).toMatchObject({ source: 'drive', customer_id: 'c1', format: 'l_banner', overlay: { headline: 'Giam 20%', qr: { url: 'https://anio.vn/v/abc' } } });
  });

  it('huy giua chung khi dang chuyen: dung, bao "Da huy chuyen video", KHONG tai gi len', async () => {
    routes.push(me, customers, ...uploadRoutes());
    vi.stubGlobal('fetch', mockFetch());
    m.probe.mockResolvedValue(src());
    const { TranscodeError } = await vi.importActual<typeof import('../lib/transcode-plan')>('../lib/transcode-plan');
    m.transcode.mockImplementation((_f: File, _s: unknown, o: { signal: AbortSignal }) => new Promise<File>((_r, rej) => o.signal.addEventListener('abort', () => rej(new TranscodeError('canceled', 'huy')))));
    mount();
    const dlg = await openDialog();
    await pickFile(dlg);
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Tự động chuyển sang chuẩn phát được' }));
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(within(dlg).getByRole('alert')).toHaveTextContent(/hủy/i));
    expect(calls.some((c) => c.path.endsWith('/upload-url'))).toBe(false);
  });

  it('tep dat chuan (H.264 MP4 9:16 1080x1920 20 giay): "Tai len" binh thuong, KHONG chuyen ma', async () => {
    routes.push(me, customers, ...uploadRoutes('pending'));
    vi.stubGlobal('fetch', mockFetch());
    m.probe.mockResolvedValue(src({ codec: 'avc', container: 'mp4', width: 1080, height: 1920, sizeBytes: 10 * MB }));
    mount();
    const dlg = await openDialog();
    await pickFile(dlg, 'qc.mp4', 'video/mp4');
    expect(await within(dlg).findByRole('status', { name: 'Kết quả kiểm tra' })).toHaveTextContent('đạt chuẩn');
    expect(within(dlg).queryByLabelText(/Tự động chuyển sang chuẩn phát được \(khuyên dùng\)/)).toBeNull();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Tải lên' }));
    expect(await within(dlg).findByRole('status', { name: 'Tải lên xong' })).toHaveTextContent('hàng chờ duyệt');
    expect(m.transcode).not.toHaveBeenCalled();
    expect(calls.find((c) => c.path.endsWith('/upload-url'))!.body).toMatchObject({ name: 'qc.mp4', content_type: 'video/mp4', width: 1080, height: 1920 });
  });

  it('VP9 (chap nhan, nen chuyen): hop "Tu dong chuyen" mac dinh BAT, bo tich thi tai tep goc', async () => {
    routes.push(me, customers, ...uploadRoutes('pending'));
    vi.stubGlobal('fetch', mockFetch());
    m.probe.mockResolvedValue(src({ codec: 'vp9', width: 1080, height: 1920, sizeBytes: 12 * MB }));
    mount();
    const dlg = await openDialog();
    await pickFile(dlg);
    const box = await within(dlg).findByLabelText(/Tự động chuyển sang chuẩn phát được \(khuyên dùng\)/);
    expect(box).toBeChecked();
    expect(within(dlg).getByRole('button', { name: 'Tự động chuyển sang chuẩn phát được' })).toBeEnabled();
    await userEvent.click(box);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Tải lên' }));
    await within(dlg).findByRole('status', { name: 'Tải lên xong' });
    expect(m.transcode).not.toHaveBeenCalled();
    expect(calls.find((c) => c.path.endsWith('/upload-url'))!.body).toMatchObject({ name: 'Silhouette of Vietnam 4K.webm', content_type: 'video/webm' });
  });

  it('video qua dai (232 giay): chan cho den khi tich "Cat lay 30 giay dau"; sau do chuyen + cat', async () => {
    routes.push(me, customers, ...uploadRoutes());
    vi.stubGlobal('fetch', mockFetch());
    m.probe.mockResolvedValue(src({ durationSec: 232.5 }));
    m.transcode.mockResolvedValue(new File([new Uint8Array(100)], 'a-h264.mp4', { type: 'video/mp4' }));
    mount();
    const dlg = await openDialog();
    await pickFile(dlg);
    const btn = await within(dlg).findByRole('button', { name: 'Tự động chuyển sang chuẩn phát được' });
    expect(btn).toBeDisabled();
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Cắt lấy 30 giây đầu');
    await userEvent.click(within(dlg).getByLabelText(/Cắt lấy 30 giây đầu/));
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await within(dlg).findByRole('status', { name: 'Tải lên xong' });
    expect(m.transcode.mock.calls[0]![1]).toMatchObject({ trimEndSec: 30, outDurationSec: 30 });
    expect(calls.find((c) => c.path.endsWith('/upload-url'))!.body).toMatchObject({ duration_sec: 30 });
  });

  it('trinh duyet khong ho tro WebCodecs: bao than thien 1 dong, khong cho bam', async () => {
    routes.push(me, customers);
    vi.stubGlobal('fetch', mockFetch());
    m.supported.mockReturnValue(false);
    m.probe.mockResolvedValue(src());
    mount();
    const dlg = await openDialog();
    await pickFile(dlg);
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Hãy dùng Chrome hoặc Edge mới nhất trên máy tính.');
    expect(within(dlg).getByRole('button', { name: 'Tự động chuyển sang chuẩn phát được' })).toBeDisabled();
  });

  it('loi chuyen ma tu trinh duyet (khong giai ma duoc): thong bao tieng Viet + huong dan, tep chua tai len', async () => {
    routes.push(me, customers, ...uploadRoutes());
    vi.stubGlobal('fetch', mockFetch());
    m.probe.mockResolvedValue(src());
    const { TranscodeError, TRANSCODE_MESSAGES } = await vi.importActual<typeof import('../lib/transcode-plan')>('../lib/transcode-plan');
    m.transcode.mockRejectedValue(new TranscodeError('decode_unsupported', TRANSCODE_MESSAGES.decode_unsupported));
    mount();
    const dlg = await openDialog();
    await pickFile(dlg);
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Tự động chuyển sang chuẩn phát được' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Chrome hoặc Edge mới nhất trên máy tính');
    expect(calls.some((c) => c.path.endsWith('/upload-url'))).toBe(false);
  });

  it('chuyen ma ra tep van vuot tran dung luong: tu choi truoc khi tai len', async () => {
    routes.push(me, customers, ...uploadRoutes());
    vi.stubGlobal('fetch', mockFetch());
    m.probe.mockResolvedValue(src());
    const big = new File([new Uint8Array(8)], 'a-h264.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 201 * MB });
    m.transcode.mockResolvedValue(big);
    mount();
    const dlg = await openDialog();
    await pickFile(dlg);
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Tự động chuyển sang chuẩn phát được' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('vượt dung lượng');
    expect(calls.some((c) => c.path.endsWith('/upload-url'))).toBe(false);
  });

  it('tep sai loai (.exe): bao ngay, khong goi gi', async () => {
    routes.push(me, customers);
    vi.stubGlobal('fetch', mockFetch());
    mount();
    const dlg = await openDialog();
    const input = within(dlg).getByLabelText('Chọn tệp để tải lên');
    await userEvent.upload(input, new File([new Uint8Array(4)], 'a.exe', { type: 'application/x-msdownload' }), { applyAccept: false });
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Chỉ nhận video MP4, MOV, WebM');
    expect(m.probe).not.toHaveBeenCalled();
  });

  it('thong so chuyen ma khop pickSettings (thang may mac dinh)', () => {
    expect(pickSettings(src(), 'elevator').settings).toMatchObject({ width: 1080, height: 1920, videoBps: 7_000_000, keyFrameSec: 2 });
  });
});

describe('Tep ket / loi', () => {
  const card = (id: string, extra: Record<string, unknown>) => ({ id, name: `${id}.mp4`, kind: 'video', mime: 'video/mp4', width: null, height: null, size_bytes: null, status: 'processing', owner_name: 'Vinamilk', scan_state: 'pending', scan_reasons: [], content_version: 1, blocker: null, warnings: [], ...extra });
  it('isStuck: dang xu ly qua 30 phut va khong con tien do, hoac nhap lien ket that bai', () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    expect(isStuck({ status: 'processing', created_at: '2026-11-20T11:00:00Z', transfer: null }, now)).toBe(true);
    expect(isStuck({ status: 'processing', created_at: '2026-11-20T11:45:00Z', transfer: null }, now)).toBe(false);
    expect(isStuck({ status: 'processing', created_at: '2026-11-20T11:00:00Z', transfer: { kind: 'multipart', status: 'open', bytes_done: 1 } }, now)).toBe(false);
    expect(isStuck({ status: 'processing', created_at: '2026-11-20T11:59:00Z', transfer: { kind: 'import', status: 'failed', bytes_done: 0 } }, now)).toBe(true);
    expect(isStuck({ status: 'approved', created_at: '2020-01-01T00:00:00Z', transfer: null }, now)).toBe(false);
  });

  it('bo loc "Dang xu ly": "Xoa tat ca tep bi ket" chi chon tep ket, hoi xac nhan (go XOA khi > 5), roi bulk-delete', async () => {
    const old = (i: number) => card(`s${i}`, { created_at: '2026-11-20T01:00:00Z' });
    const fresh = card('fresh', { created_at: new Date().toISOString() });
    const items = [...Array.from({ length: 6 }, (_, i) => old(i)), fresh];
    routes.push(me, customers, (u: URL, mth: string) => (u.pathname === '/api/admin/v1/media/bulk-delete' && mth === 'POST' ? { requested: 6, deleted_count: 6, skipped_count: 0, freed_bytes: 0, deleted: [], skipped: [] } : undefined),
      (u: URL, mth: string) => (u.pathname === '/api/admin/v1/media' && mth === 'GET' ? { items, total: items.length, page: 1, page_size: 9 } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Đang xử lý' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Xóa tất cả tệp bị kẹt' }));
    const dlg = await screen.findByRole('dialog', { name: 'Xóa các tệp đã chọn' });
    expect(dlg).toHaveTextContent('Xóa 6 tệp đã chọn?'); // tep moi (fresh) khong bi chon
    const go = within(dlg).getByRole('button', { name: 'Xóa 6 tệp' });
    expect(go).toBeDisabled(); // phai go XOA
    await userEvent.type(within(dlg).getByLabelText('Gõ XOA để xác nhận'), 'XOA');
    await userEvent.click(go);
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/bulk-delete'))?.body).toEqual({ ids: ['s0', 's1', 's2', 's3', 's4', 's5'] }));
  });

  it('the loi nhap Drive can chuyen ma: nut "Chon tep tu may" (khong phai Thu lai); chan doan ky thuat chi hien cho noi bo', async () => {
    const msg = 'Tệp này cần chuyển sang H.264. Hãy tải tệp về máy rồi kéo vào ô tải lên. Hệ thống sẽ tự chuyển. Lý do: Video dùng codec AV1 mà màn thang máy không phát được ổn định.';
    const c = card('d1', { status: 'rejected', kind: 'link', source: 'gdrive', mime: null, reject_reason: msg, blocker: { code: 'import_failed', action: 'retry', message: msg }, transfer: { kind: 'import', status: 'failed', bytes_done: 0, error_code: 'unsupported_codec', error_message: msg }, diag: { code: 'drive_quota', http: 403, content_type: 'text/html', title: 'Quota exceeded', snippet: 'Too many users', final_url: 'drive.usercontent.google.com/download?id' } });
    routes.push(me, customers, (u: URL, mth: string) => (u.pathname === '/api/admin/v1/media' && mth === 'GET' ? { items: [c], total: 1, page: 1, page_size: 9 } : undefined));
    vi.stubGlobal('fetch', mockFetch());
    mount();
    const why = await screen.findByRole('status', { name: 'Vì sao chưa duyệt được' });
    expect(why).toHaveTextContent('Tệp này cần chuyển sang H.264');
    expect(within(why).queryByRole('button', { name: 'Thử lại' })).toBeNull();
    await userEvent.click(within(why).getByRole('button', { name: 'Chọn tệp từ máy' }));
    expect(await screen.findByRole('dialog', { name: 'Tải nội dung' })).toBeInTheDocument();
    expect(screen.getByText('Chi tiết kỹ thuật (quản trị)')).toBeInTheDocument();
  });
});
