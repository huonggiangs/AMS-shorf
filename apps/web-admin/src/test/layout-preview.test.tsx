// Mau bo cuc da vung + trinh xem truoc/phat thu (LivePreview) + gan tep vao vung trong chuong trinh phat song.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { LivePreview } from '../components/LivePreview';
import { ZoneEditor } from '../components/ZoneEditor';
import { PRESETS, clampZone, layoutError, newZone, type Zone } from '../lib/layout';
import { useState } from 'react';

type Handler = (url: URL, method: string, body: Record<string, unknown> | null) => { status?: number; body: unknown } | undefined;
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
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
const on = (path: string, data: unknown, method = 'GET', status = 200): Handler => (u, m) => (u.pathname === `/api${path}` && m === method ? { status, body: data } : undefined);
const me = (schedule: string[]): Handler => (u) => (u.pathname === '/api/auth/me' ? { body: { user: { id: 'u0', email: 's@ams.vn', name: 'Admin', role: 'admin' }, permissions: { overview: ['view'], customers: ['view'], media: ['view'], schedule } } } : undefined);
const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><UiProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></UiProvider></QueryClientProvider>);
};
const dlg = HTMLDialogElement.prototype as unknown as { close?: () => void; showModal?: () => void };
dlg.close ??= function (this: HTMLElement) { this.removeAttribute('open'); };
dlg.showModal ??= function (this: HTMLElement) { this.setAttribute('open', ''); };
const media = HTMLMediaElement.prototype as unknown as { play: () => Promise<void>; pause: () => void };
media.play = () => Promise.resolve();
media.pause = () => undefined;
beforeEach(() => { handlers = []; calls.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

const SYS = { id: 'sys_retail3', name: 'Bán lẻ 3 vùng', orientation: 'portrait', system: true, zones: [
  { id: 'bar', name: 'Thanh Chữ chạy', type: 'marquee', x: 0, y: 0, w: 100, h: 8, z: 2, transition: 'none', text: 'Giảm 50%' },
  { id: 'tvc', name: 'Video TVC', type: 'video', x: 0, y: 8, w: 100, h: 67, z: 0, transition: 'fade' },
  { id: 'qr', name: 'Mã QR Ưu đãi', type: 'qr', x: 25, y: 75, w: 50, h: 25, z: 0, transition: 'none' },
] };

describe('lib/layout', () => {
  it('clampZone giu vung trong khung; layoutError bat loi thuong gap', () => {
    const z = clampZone({ ...newZone('video', []), x: 90, y: 95, w: 50, h: 50 });
    expect(z.x + z.w).toBeLessThanOrEqual(100);
    expect(z.y + z.h).toBeLessThanOrEqual(100);
    expect(layoutError([])).toMatch(/ít nhất một vùng/);
    expect(layoutError([newZone('marquee', [])])).toMatch(/video hoặc ảnh/);
    expect(layoutError(PRESETS[2]!.zones)).toBe('');
    expect(layoutError([{ ...PRESETS[0]!.zones[0]!, id: 'a' }, { ...PRESETS[0]!.zones[0]!, id: 'a' }])).toMatch(/trùng/);
  });
});

describe('LivePreview', () => {
  const zones = PRESETS.find((p) => p.id === 'side-l')!.zones;
  it('ve dung cac vung (theo %), chu chay, dong ho, header/footer; phat video that cua vung', () => {
    const { container } = render(<LivePreview orientation="landscape" zones={zones} header="Chào mừng" footer="Hotline 1900" items={[{ id: 'v1', zoneId: 'main', kind: 'video', url: 'https://m/a.mp4', duration_s: 15, name: 'A' }, { id: 'i1', zoneId: 'side', kind: 'image', url: 'https://m/b.jpg', name: 'B' }]} />);
    expect(screen.getByText('Chào mừng')).toBeInTheDocument();
    expect(screen.getByText('Hotline 1900')).toBeInTheDocument();
    expect(container.querySelector('[data-zone="main"] video')?.getAttribute('src')).toBe('https://m/a.mp4');
    expect(container.querySelector('[data-zone="side"] img')?.getAttribute('src')).toBe('https://m/b.jpg');
    expect(container.querySelector('[data-zone="bar"]')?.textContent).toContain('Chào mừng quý khách');
    expect((container.querySelector('[data-zone="main"]') as HTMLElement).style.width).toBe('70%');
    expect(container.querySelector('[data-zone="clock"]')).not.toBeNull();
  });
  it('tep chua gan vung roi vao vung media dau; Tam dung / Phat; doi khung 9:16', async () => {
    const user = userEvent.setup();
    const { container } = render(<LivePreview orientation="landscape" zones={zones} items={[{ id: 'v1', zoneId: null, kind: 'video', url: 'https://m/a.mp4' }]} />);
    expect(container.querySelector('[data-zone="main"] video')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(screen.getByRole('button', { name: 'Phát' })).toBeInTheDocument();
    expect(container.querySelector('.lp-paused')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: '9:16' }));
    expect(screen.getByRole('img', { name: 'Xem trước 9:16' })).toBeInTheDocument();
  });
  it('vung khong co tep hien thong bao, tep khong co URL hien khung tam', () => {
    render(<LivePreview orientation="portrait" zones={PRESETS[1]!.zones} items={[{ id: 'x', zoneId: null, kind: 'image', url: null, name: 'Ảnh X' }]} />);
    expect(screen.getByText(/chưa có bản xem trước/)).toBeInTheDocument();
  });
});

describe('ZoneEditor', () => {
  function Host() {
    const [zones, setZones] = useState<Zone[]>(PRESETS[0]!.zones.map((z) => ({ ...z })));
    const [sel, setSel] = useState<string | null>(null);
    return <><ZoneEditor orientation="landscape" zones={zones} onChange={setZones} selected={sel} onSelect={setSel} /><output aria-label="json">{JSON.stringify(zones)}</output></>;
  }
  it('them vung chu chay, chon, sua noi dung + kich thuoc (bi kep trong khung), xoa vung', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: '+ Chữ chạy' }));
    const props = await screen.findByRole('group', { name: 'Thuộc tính vùng' });
    const text = within(props).getByLabelText('Nội dung chữ chạy');
    await user.clear(text);
    await user.type(text, 'Khuyen mai');
    const w = within(props).getByLabelText('Rộng (%)');
    await user.clear(w);
    await user.type(w, '300');
    const z = JSON.parse(screen.getByLabelText('json').textContent!) as Zone[];
    const bar = z.find((x) => x.type === 'marquee')!;
    expect(bar.text).toBe('Khuyen mai');
    expect(bar.x + bar.w).toBeLessThanOrEqual(100);
    await user.click(within(props).getByRole('button', { name: 'Xóa vùng này' }));
    expect((JSON.parse(screen.getByLabelText('json').textContent!) as Zone[]).length).toBe(1);
  });
});

describe('Trang Mau bo cuc', () => {
  it('the mau: nhan huong, so vung, ten vung; mau he thong khong co Sua/Xoa; Su dung mau nay tao chuong trinh nhap', async () => {
    handlers.push(me(['view', 'write', 'delete']), on('/admin/v1/layout-templates', { items: [SYS, { ...SYS, id: 't2', name: 'Của tôi', system: false }], total: 2 }), on('/admin/v1/broadcast', { id: 'p1', name: 'x', items: [], layout: null }, 'POST', 201));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/templates');
    expect(await screen.findByText('Bán lẻ 3 vùng')).toBeInTheDocument();
    expect(screen.getAllByText(/Dọc 9:16 · 3 vùng: Thanh Chữ chạy · Video TVC · Mã QR Ưu đãi/)).toHaveLength(2);
    expect(screen.getByText(/Mẫu hệ thống/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sửa' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Xóa' })).toHaveLength(1);
    await user.click(screen.getAllByRole('button', { name: 'Sử dụng mẫu này' })[0]!);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/v1/broadcast')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/admin/v1/broadcast')!;
    expect(post.body).toMatchObject({ name: 'Bán lẻ 3 vùng (nháp)', target_type: 'elevator', creative_ids: [], layout: { template_id: 'sys_retail3', orientation: 'portrait' } });
    expect((post.body!.layout as { zones: unknown[] }).zones).toHaveLength(3);
  });

  it('tao mau moi: bat dau tu mau co san, luu gui orientation + zones', async () => {
    handlers.push(me(['view', 'write']), on('/admin/v1/layout-templates', { items: [], total: 0 }), on('/admin/v1/layout-templates', { ...SYS, id: 'n1', system: false }, 'POST', 201));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/templates');
    await user.click(await screen.findByRole('button', { name: 'Tạo mẫu bố cục' }));
    await user.type(await screen.findByLabelText('Tên mẫu'), 'Mau thu');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/v1/layout-templates')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ name: 'Mau thu', orientation: 'landscape' });
    expect((post.body!.zones as Zone[]).map((z) => z.type)).toEqual(['video', 'marquee']);
  });
});

describe('Chuong trinh phat song: bo cuc + xem truoc', () => {
  const prog = { id: 'p1', name: 'CT da vung', target_type: 'elevator', regions: [], start_min: 0, end_min: 1440, priority: 3, status: 'draft', item_count: 1, version: 1, header: null, footer: null, layout: { template_id: null, orientation: 'portrait', zones: SYS.zones }, items: [{ creative_id: 'm1', position: 0, name: 'Quang cao', kind: 'video', review_state: 'approved', state: 'ready', ready: true, in_campaign: false, zone_id: 'tvc' }] };
  it('Xem truoc: tai URL that cua tep va phat o dung vung', async () => {
    handlers.push(me(['view', 'write']), on('/admin/v1/broadcast', { items: [prog], total: 1 }), on('/admin/v1/broadcast/p1', prog), on('/admin/v1/media/m1', { id: 'm1', name: 'Quang cao', kind: 'video', mime: 'video/mp4', status: 'approved', preview_url: 'https://m/sig/a.mp4', duration_sec: 15 }));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/broadcast');
    await user.click(await screen.findByRole('button', { name: 'Xem trước' }));
    const live = await screen.findByTestId('live-preview');
    await waitFor(() => expect(live.querySelector('[data-zone="tvc"] video')?.getAttribute('src')).toBe('https://m/sig/a.mp4'));
    expect(live.querySelector('[data-zone="bar"]')?.textContent).toContain('Giảm 50%');
  });
  it('Sua (wizard 4 buoc): di qua cac buoc, Luu nhap gui layout + item_zones + device_ids', async () => {
    handlers.push(me(['view', 'write']), on('/admin/v1/broadcast', { items: [prog], total: 1 }), on('/admin/v1/broadcast/p1', prog), on('/admin/v1/broadcast/p1', prog, 'PUT'), on('/admin/v1/media', { items: [], total: 0 }), on('/admin/v1/broadcast/devices-pick', { items: [{ id: 'd1', name: 'TM-01', region: 'HN', kind: 'elevator', online: true }], truncated: false }));
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    mount('/broadcast');
    await user.click(await screen.findByRole('button', { name: 'Sửa' }));
    expect(await screen.findByText('01. Thông tin chung')).toBeInTheDocument();
    expect(screen.getByText('04. Lập lịch & Phát hành')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Bước tiếp theo/ }));
    expect(await screen.findByText(/Danh sách lớp thành phần \(3\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Bước tiếp theo/ }));
    await user.click(await screen.findByRole('button', { name: 'Chọn từng thiết bị' }));
    await user.click(await screen.findByLabelText('Chọn TM-01'));
    await user.click(screen.getByRole('button', { name: /Bước tiếp theo/ }));
    await user.click(await screen.findByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({ creative_ids: ['m1'], item_zones: { m1: 'tvc' }, device_ids: ['d1'], layout: { orientation: 'portrait' } });
    expect((put.body!.layout as { zones: unknown[] }).zones).toHaveLength(3);
  });
});
