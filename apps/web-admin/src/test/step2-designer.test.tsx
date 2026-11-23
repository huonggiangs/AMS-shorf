// Buoc 2 "Thiet ke phan vung": 3 cot, keo tha/doi kich thuoc bang pointer events, dong bo o so, phim mui ten, mau nhanh, thu tu lop va tu lieu.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';

const reply = (u: URL): unknown => {
  const p = u.pathname.replace('/api', '');
  if (p === '/auth/me') return { user: { id: 'u', email: 'a@b', name: 'A', role: 'admin' }, permissions: { overview: ['view'], schedule: ['view', 'write'], media: ['view'] } };
  if (p === '/admin/v1/media') return { items: [{ id: 'm1', name: 'Video A', kind: 'video', status: 'approved', mime: 'video/mp4' }, { id: 'm2', name: 'Video B', kind: 'video', status: 'approved', mime: 'video/mp4' }], total: 2 };
  return { items: [], total: 0 };
};
// jsdom: PointerEvent + kich thuoc khung (400 x 400 px => 1px = 0,25%)
class PE extends MouseEvent { pointerId = 1; constructor(t: string, i?: PointerEventInit) { super(t, i); } }
(window as unknown as { PointerEvent: unknown }).PointerEvent ??= PE;
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (i: RequestInfo | URL) => new Response(JSON.stringify(reply(new URL(String(i), 'http://localhost'))), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, toJSON: () => ({}) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function openStep2() {
  const user = userEvent.setup();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={['/broadcast?new=1']}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
  await user.type(await screen.findByPlaceholderText(/Ưu đãi cuối năm/), 'CT');
  await user.click(screen.getByRole('button', { name: /Bước tiếp theo/ }));
  await screen.findByText('Thêm thành phần');
  return user;
}
const num = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const canvas = () => screen.getByTestId('zone-canvas');
const layers = () => Array.from(document.querySelectorAll('.wz-3 > div:first-child .wz-layer .nm')).map((e) => e.firstChild?.textContent);

describe('Bước 2: thiết kế phân vùng', () => {
  it('bố cục 3 cột: danh sách lớp, khung chuẩn DOOH đúng tỉ lệ, thêm thành phần + mẫu nhanh + xem trước + thuộc tính', async () => {
    await openStep2();
    expect(screen.getByText(/Danh sách lớp thành phần \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('540 × 960 · CHUẨN HIỂN THỊ DOOH')).toBeInTheDocument();
    expect(canvas().style.aspectRatio.replace(/\s/g, '')).toBe('9/16');
    for (const t of ['Video', 'Ảnh', 'Chữ chạy', 'Văn bản', 'Đồng hồ', 'Thời tiết', 'Mã QR']) expect(screen.getByRole('button', { name: `+ ${t}` })).toBeInTheDocument();
    for (const t of ['Toàn màn hình', 'Chia đôi 50/50', '3 vùng + Chữ chạy', '👁 Xem trước']) expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
  });

  it('mẫu nhanh xin xác nhận trước khi thay các vùng hiện có', async () => {
    const user = await openStep2();
    const conf = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Chia đôi 50/50' }));
    expect(layers()).toEqual(['Video 1']); // từ chối: giữ nguyên
    await user.click(screen.getByRole('button', { name: 'Chia đôi 50/50' }));
    expect(conf).toHaveBeenCalledTimes(2);
    expect(layers()).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '3 vùng + Chữ chạy' }));
    expect(layers()).toHaveLength(3);
  });

  it('kéo di chuyển (lưới 1%), đổi kích thước bằng tay nắm, đồng bộ hai chiều với ô số và không vượt khung', async () => {
    const user = await openStep2();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Chia đôi 50/50' }));
    const top = canvas().querySelector('[data-zone]') as HTMLElement; // vùng trên: 0,0,100x50
    fireEvent.pointerDown(top, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(await screen.findByText('Thuộc tính thành phần')).toBeInTheDocument();
    fireEvent.pointerMove(canvas(), { clientX: 100, clientY: 140, pointerId: 1 }); // +40px = +10%
    expect(num('Y (%)').value).toBe('10');
    fireEvent.pointerMove(canvas(), { clientX: 100, clientY: 4000, pointerId: 1 }); // kẹp trong khung
    expect(num('Y (%)').value).toBe('50');
    fireEvent.pointerUp(canvas());
    // tay nắm: cạnh trên (n) kéo xuống 20px = 5%
    fireEvent.pointerDown(canvas().querySelector('[data-handle="n"]')!, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas(), { clientX: 0, clientY: -40, pointerId: 1 });
    expect(num('Y (%)').value).toBe('40');
    expect(num('Cao (%)').value).toBe('60');
    fireEvent.pointerUp(canvas());
    // ô số -> khung (đồng bộ hai chiều); x bị kẹp để vùng không vượt khung
    const sel = () => canvas().querySelector<HTMLElement>('[aria-pressed="true"]')!;
    fireEvent.change(num('X (%)'), { target: { value: '20' } });
    expect(sel().style.left).toBe('0%'); // w=100 nên x về 0
    fireEvent.change(num('Rộng (%)'), { target: { value: '50' } });
    fireEvent.change(num('X (%)'), { target: { value: '30' } });
    expect(sel().style.left).toBe('30%');
    expect(sel().style.width).toBe('50%');
    fireEvent.change(num('X (%)'), { target: { value: '90' } });
    expect(num('X (%)').value).toBe('50');
  });

  it('phím mũi tên nhích 1%, Shift 5%, Alt đổi kích thước', async () => {
    const user = await openStep2();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Chia đôi 50/50' }));
    const z = canvas().querySelector('[data-zone]') as HTMLElement; // 0,0,100x50
    z.focus();
    fireEvent.keyDown(z, { key: 'ArrowDown' });
    expect(num('Y (%)').value).toBe('1');
    fireEvent.keyDown(z, { key: 'ArrowDown', shiftKey: true });
    expect(num('Y (%)').value).toBe('6');
    fireEvent.keyDown(z, { key: 'ArrowUp', altKey: true });
    expect(num('Cao (%)').value).toBe('49');
    fireEvent.keyDown(z, { key: 'ArrowUp' });
    expect(num('Y (%)').value).toBe('5');
  });

  it('thứ tự lớp (lên/xuống), ẩn/hiện, xóa vùng', async () => {
    const user = await openStep2();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '3 vùng + Chữ chạy' }));
    expect(layers()).toEqual(['Video 1', 'Ảnh 2', 'Chữ chạy 3']);
    await user.click(screen.getByRole('button', { name: 'Xuống Video 1' }));
    expect(layers()).toEqual(['Ảnh 1', 'Video 2', 'Chữ chạy 3']); // tên mặc định theo thứ tự
    await user.click(screen.getByRole('button', { name: 'Lên Chữ chạy 3' }));
    expect(layers()).toEqual(['Ảnh 1', 'Chữ chạy 2', 'Video 3']);
    expect(layers()).toEqual(['Ảnh 1', 'Chữ chạy 2', 'Video 3']);
    await user.click(screen.getByRole('button', { name: 'Ẩn Video 3' }));
    expect(screen.getByRole('button', { name: 'Hiện Video 3' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa Ảnh 1' }));
    expect(layers()).toEqual(['Chữ chạy 1', 'Video 2']);
  });

  it('tư liệu: thêm, kéo thả đổi thứ tự, chuyển cảnh có nhãn mới; vùng đồng hồ/chữ chạy có thuộc tính riêng', async () => {
    const user = await openStep2();
    await user.click(await screen.findByText('Video 1', { selector: '.nm' }));
    const add = await screen.findByRole('combobox', { name: /Thêm tư liệu/ });
    await user.selectOptions(add, 'm1');
    await user.selectOptions(screen.getByRole('combobox', { name: /Thêm tư liệu/ }), 'm2');
    const rows = () => Array.from(document.querySelectorAll('[data-media]')).map((e) => e.getAttribute('data-media'));
    expect(rows()).toEqual(['m1', 'm2']);
    const dt = { setData: () => undefined, getData: () => '', effectAllowed: '' };
    fireEvent.dragStart(document.querySelector('[data-media="m2"]')!, { dataTransfer: dt });
    fireEvent.dragOver(document.querySelector('[data-media="m1"]')!, { dataTransfer: dt });
    fireEvent.drop(document.querySelector('[data-media="m1"]')!, { dataTransfer: dt });
    expect(rows()).toEqual(['m2', 'm1']);
    const tr = screen.getByRole('combobox', { name: 'Hiệu ứng chuyển cảnh' });
    expect(within(tr).getAllByRole('option').map((o) => o.textContent)).toEqual(['Mặc định (Cắt trực tiếp)', 'Mờ dần (Crossfade)', 'Trượt sang trái', 'Trượt sang phải', 'Phóng to mượt']);
    await user.click(screen.getByRole('button', { name: '+ Đồng hồ' }));
    await user.selectOptions(await screen.findByLabelText('Định dạng giờ'), '12');
    expect(screen.getByLabelText('Múi giờ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Chữ chạy' }));
    await user.selectOptions(await screen.findByLabelText('Hướng chạy'), 'right');
    expect((screen.getByLabelText('Hướng chạy') as HTMLSelectElement).value).toBe('right');
  });
});
