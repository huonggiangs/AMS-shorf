// Bước 2: vùng "Danh sách phát" (playlist): thêm/sắp xếp/sửa/xóa mục, thời lượng mặc định, loop, payload lưu, xem trước tuần tự.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { LivePreview } from '../components/LivePreview';
import type { Zone } from '../lib/layout';

const posts: { url: string; body: Record<string, unknown> }[] = [];
const reply = (u: URL): unknown => {
  const p = u.pathname.replace('/api', '');
  if (p === '/auth/me') return { user: { id: 'u', email: 'a@b', name: 'A', role: 'admin' }, permissions: { overview: ['view'], schedule: ['view', 'write'], media: ['view'] } };
  if (p === '/admin/v1/media') return { items: [{ id: 'm1', name: 'Video A', kind: 'video', status: 'approved', mime: 'video/mp4', duration_sec: 30 }, { id: 'm2', name: 'Poster', kind: 'image', status: 'approved', mime: 'image/jpeg' }, { id: 'm3', name: 'Clip YouTube', kind: 'video', status: 'approved', mime: 'video/mp4', delivery: 'stream' }], total: 3 };
  return { items: [], total: 0 };
};
class PE extends MouseEvent { pointerId = 1; constructor(t: string, i?: PointerEventInit) { super(t, i); } }
(window as unknown as { PointerEvent: unknown }).PointerEvent ??= PE;
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };
beforeEach(() => {
  posts.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(i), 'http://localhost');
    if (init?.method === 'POST') posts.push({ url: u.pathname, body: JSON.parse(String(init.body ?? '{}')) });
    return new Response(JSON.stringify(reply(u)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
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
const layers = () => Array.from(document.querySelectorAll('.wz-3 > div:first-child .wz-layer .nm')).map((e) => e.firstChild?.textContent);
const rowNames = () => Array.from(document.querySelectorAll('[data-item] .nm')).map((e) => e.firstChild?.textContent);
const addItem = async (user: ReturnType<typeof userEvent.setup>, t: 'Video' | 'Ảnh' | 'Text', media?: string) => {
  await user.click(screen.getByRole('button', { name: `Thêm mục ${t}` }));
  if (media) await user.selectOptions(await screen.findByRole('combobox', { name: 'Chọn tệp' }), media);
  await user.click(screen.getByRole('button', { name: 'Xong' }));
};

describe('Bước 2: danh sách phát', () => {
  it('nút "+ Danh sách phát" cạnh "+ Mã QR" trong lưới 2 cột; tạo NHÓM (khung chứa), thành phần thêm sau đó vào nhóm; vùng Ảnh con có playlist rỗng, loop bật', async () => {
    const user = await openStep2();
    const add = document.querySelector('.wz-add')!;
    const labels = Array.from(add.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels.length % 2).toBe(0);
    expect(labels.indexOf('+ Danh sách phát')).toBe(labels.indexOf('+ Mã QR') + 1);
    await user.click(screen.getByRole('button', { name: '+ Danh sách phát' }));
    expect(layers()).toEqual(['Video 1', 'Danh sách phát 2']);
    expect(await screen.findByTestId('group-props')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Ảnh' }));
    expect(layers()).toEqual(['Video 1', 'Danh sách phát 2', 'Ảnh 1']); // 'Ảnh 1' là vùng con (đánh số trong nhóm)
    expect(await screen.findByText(/Danh sách phát \(0 mục\)/)).toBeInTheDocument(); // vùng Ảnh dùng kiến trúc playlist
    expect((screen.getByLabelText(/Lặp lại/) as HTMLInputElement).checked).toBe(true);
  });

  it('thêm mục, mặc định 8s (ảnh/text), video lấy thời lượng thật, tổng thời lượng, ghi đè rồi xóa về metadata', async () => {
    const user = await openStep2();
    await user.click(await screen.findByText('Video 1', { selector: '.nm' }));
    await addItem(user, 'Video', 'm1');
    await addItem(user, 'Ảnh', 'm2');
    await addItem(user, 'Text');
    expect(rowNames()).toEqual(['Video A', 'Poster', 'Text 1']);
    const sec = (n: string) => screen.getByLabelText(`Số giây hiển thị ${n}`) as HTMLInputElement;
    expect(sec('Video A').placeholder).toBe('30');
    expect(sec('Video A').value).toBe('');
    expect(sec('Poster').value).toBe('8');
    expect(sec('Text 1').value).toBe('8');
    expect(screen.getByTestId('pl-total').textContent).toContain('46s'); // 30 + 8 + 8
    fireEvent.change(sec('Video A'), { target: { value: '10' } });
    expect(screen.getByTestId('pl-total').textContent).toContain('26s');
    fireEvent.change(sec('Video A'), { target: { value: '' } });
    expect(sec('Video A').value).toBe('');
    expect(screen.getByTestId('pl-total').textContent).toContain('46s');
  });

  it('sắp xếp bằng nút ↑↓ và kéo thả, xóa mục, bật/tắt loop', async () => {
    const user = await openStep2();
    await user.click(await screen.findByText('Video 1', { selector: '.nm' }));
    await addItem(user, 'Video', 'm1');
    await addItem(user, 'Ảnh', 'm2');
    await addItem(user, 'Text');
    await user.click(screen.getByRole('button', { name: 'Lên Text 1' }));
    expect(rowNames()).toEqual(['Video A', 'Text 1', 'Poster']);
    await user.click(screen.getByRole('button', { name: 'Xuống Video A' }));
    expect(rowNames()).toEqual(['Text 1', 'Video A', 'Poster']);
    const dt = { setData: () => undefined, getData: () => '', effectAllowed: '' };
    const rows = () => Array.from(document.querySelectorAll('[data-item]'));
    fireEvent.dragStart(rows()[2]!, { dataTransfer: dt });
    fireEvent.dragOver(rows()[0]!, { dataTransfer: dt });
    fireEvent.drop(rows()[0]!, { dataTransfer: dt });
    expect(rowNames()).toEqual(['Poster', 'Text 1', 'Video A']);
    await user.click(screen.getByRole('button', { name: 'Xóa Text 1' }));
    expect(rowNames()).toEqual(['Poster', 'Video A']);
    expect(screen.getByText(/Danh sách phát \(2 mục\)/)).toBeInTheDocument();
    const loop = screen.getByLabelText(/Lặp lại/) as HTMLInputElement;
    await user.click(loop);
    expect(loop.checked).toBe(false);
  });

  it('Sửa mục: đổi tệp (có nhãn [Link]), sửa nội dung/màu của Text bằng trình soạn rich text sẵn có', async () => {
    const user = await openStep2();
    await user.click(await screen.findByText('Video 1', { selector: '.nm' }));
    await addItem(user, 'Video', 'm1');
    await user.click(screen.getByRole('button', { name: 'Sửa Video A' }));
    const picker = screen.getByRole('combobox', { name: 'Chọn tệp' });
    expect(within(picker).getByRole('option', { name: '[Link] Clip YouTube' })).toBeInTheDocument();
    expect(within(picker).queryByRole('option', { name: /Poster/ })).toBeNull(); // mục video chỉ chọn video
    await user.selectOptions(picker, 'm3');
    expect(rowNames()).toEqual(['Clip YouTube']);
    await user.click(screen.getByRole('button', { name: 'Xong' }));
    await addItem(user, 'Text');
    await user.click(screen.getByRole('button', { name: 'Sửa Text 1' }));
    expect(screen.getByLabelText('Nội dung văn bản', { selector: '[contenteditable]' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Màu nền'), { target: { value: '#ff0000' } });
    fireEvent.change(screen.getByLabelText('Cỡ chữ'), { target: { value: '40' } });
    expect((screen.getByLabelText('Màu nền') as HTMLInputElement).value).toBe('#ff0000');
    expect((screen.getByLabelText('Cỡ chữ') as HTMLInputElement).value).toBe('40');
    fireEvent.change(screen.getByLabelText('Tên mục'), { target: { value: 'Khuyến mãi' } });
    expect(rowNames()).toContain('Khuyến mãi');
  });

  it('payload lưu: playlist + loop trong vùng, đồng bộ creative_ids/durations cũ và item_zones', async () => {
    const user = await openStep2();
    await user.click(await screen.findByText('Video 1', { selector: '.nm' }));
    await addItem(user, 'Video', 'm1');
    await addItem(user, 'Ảnh', 'm2');
    await addItem(user, 'Text');
    fireEvent.change(screen.getByLabelText('Số giây hiển thị Poster'), { target: { value: '' } }); // trống -> lưu mặc định 8
    await user.click(screen.getByLabelText(/Lặp lại/));
    await user.click(screen.getByRole('button', { name: /Bước tiếp theo/ }));
    await user.click(await screen.findByRole('button', { name: /Theo khu vực/ }));
    await user.click(screen.getByRole('button', { name: /Bước tiếp theo/ }));
    await user.click(await screen.findByRole('button', { name: 'Lưu nháp' }));
    const post = await vi.waitFor(() => { const p = posts.find((x) => x.url.endsWith('/admin/v1/broadcast')); if (!p) throw new Error('chưa lưu'); return p; });
    const b = post.body as { creative_ids: string[]; item_zones: Record<string, string>; layout: { zones: (Zone & { playlist: { type: string; media_id?: string; duration?: number; name: string; id: string }[] })[] } };
    const z = b.layout.zones[0]!;
    expect(z.loop).toBe(false);
    expect(z.playlist.map((i) => [i.type, i.media_id, i.duration])).toEqual([['video', 'm1', undefined], ['image', 'm2', 8], ['text', undefined, 8]]);
    expect(z.playlist.every((i) => /^[0-9a-f-]{36}$/.test(i.id))).toBe(true);
    expect(z.creative_ids).toEqual(['m1', 'm2']);
    expect(z.durations).toEqual({ m2: 8 });
    expect(b.creative_ids).toEqual(['m1', 'm2']);
    expect(b.item_zones).toEqual({ m1: z.id, m2: z.id });
  });
});

describe('Xem trước danh sách phát', () => {
  const zone = (playlist: unknown[], loop = true): Zone => ({ id: 'z1', type: 'playlist', x: 0, y: 0, w: 100, h: 100, z: 0, transition: 'none', playlist, loop } as unknown as Zone);
  const t = (id: string, text: string, duration = 3) => ({ id, type: 'text', name: id, text_content: text, duration });

  it('phát tuần tự các mục text rồi lặp lại khi Loop bật', () => {
    vi.useFakeTimers();
    try {
      render(<LivePreview orientation="portrait" zones={[zone([t('a', 'Một'), t('b', 'Hai')])]} items={[]} />);
      const active = () => document.querySelector('.lp-slot[data-active="1"]')?.textContent;
      expect(active()).toBe('Một');
      act(() => { vi.advanceTimersByTime(3000); });
      expect(active()).toBe('Hai');
      act(() => { vi.advanceTimersByTime(3000); });
      expect(active()).toBe('Một');
    } finally { vi.useRealTimers(); }
  });

  it('Loop tắt: dừng ở mục cuối', () => {
    vi.useFakeTimers();
    try {
      render(<LivePreview orientation="portrait" zones={[zone([t('a', 'Một'), t('b', 'Hai')], false)]} items={[]} />);
      act(() => { vi.advanceTimersByTime(30_000); });
      expect(document.querySelector('.lp-slot[data-active="1"]')?.textContent).toBe('Hai');
      expect(screen.getByTestId('pl-view').getAttribute('data-phase')).toBe('finished');
    } finally { vi.useRealTimers(); }
  });

  it('mục media không có nguồn bị bỏ qua + log; tất cả lỗi -> màn hình chờ 8s rồi thử lại', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const bad = [{ id: 'v1', type: 'video', name: 'V1', media_id: 'nope' }, { id: 'v2', type: 'image', name: 'V2', media_id: 'nope2' }];
      render(<LivePreview orientation="portrait" zones={[zone([bad[0], t('ok', 'Còn phát được'), bad[1]].slice(0, 2))]} items={[]} />);
      expect(document.querySelector('.lp-slot[data-active="1"]')?.textContent).toBe('Còn phát được'); // v1 bị bỏ qua
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); vi.useRealTimers(); }
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const allBad = [{ id: 'v1', type: 'video', name: 'V1', media_id: 'x' }, { id: 'v2', type: 'image', name: 'V2', media_id: 'y' }];
      render(<LivePreview orientation="portrait" zones={[zone(allBad)]} items={[]} />);
      expect(screen.getAllByTestId('pl-wait').length).toBeGreaterThan(0);
      act(() => { vi.advanceTimersByTime(8000); });
      // thử lại cả danh sách: vẫn lỗi hết -> lại chờ (không quay vòng liên tục)
      expect(screen.getAllByTestId('pl-wait').length).toBeGreaterThan(0);
    } finally { vi.useRealTimers(); }
  });

  it('video: có thẻ <video> thứ hai nạp sẵn mục kế tiếp (ẩn) để không nháy đen khi hết video', () => {
    const items = [{ id: 'm1', zoneId: null, kind: 'video' as const, url: 'http://x/1.mp4' }, { id: 'm2', zoneId: null, kind: 'video' as const, url: 'http://x/2.mp4' }];
    const pl = [{ id: 'p1', type: 'video', name: 'A', media_id: 'm1' }, { id: 'p2', type: 'video', name: 'B', media_id: 'm2' }];
    render(<LivePreview orientation="portrait" zones={[zone(pl)]} items={items} />);
    const vids = Array.from(document.querySelectorAll('video'));
    expect(vids).toHaveLength(2);
    const slotOf = (v: Element) => v.closest('.lp-slot')!;
    expect(vids.map((v) => [v.getAttribute('src'), slotOf(v).getAttribute('data-active')])).toEqual(expect.arrayContaining([['http://x/1.mp4', '1'], ['http://x/2.mp4', '0']]));
    expect(vids.every((v) => v.getAttribute('preload') === 'auto')).toBe(true);
    // hết video 1 -> chuyển sang video đã nạp sẵn, thẻ cũ nạp tiếp mục kế
    const first = vids.find((v) => v.getAttribute('src') === 'http://x/1.mp4')!;
    fireEvent.loadedData(first);
    fireEvent.ended(first);
    expect(document.querySelector('.lp-slot[data-active="1"] video')?.getAttribute('src')).toBe('http://x/2.mp4');
    expect(document.querySelectorAll('video')).toHaveLength(2);
  });
});
