// Bước 2: nhóm vùng ("+ Danh sách phát" = khung chứa nhiều thành phần trong MỘT phiên phát): cây lớp, thêm con, đưa vào/ra nhóm, sắp xếp, xóa/gỡ nhóm,
// payload lưu, tọa độ tương đối -> tuyệt đối trên khung và trong xem trước.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { UiProvider } from '../state/ui';
import { LivePreview } from '../components/LivePreview';
import { ZoneCanvas } from '../components/ZoneCanvas';
import { addZoneTo, deleteZone, flattenZones, moveSibling, relBox, absBox, setParent, ungroup, reindexTree } from '../lib/groups';
import { layoutError, newZone, type Zone } from '../lib/layout';

const posts: { url: string; body: Record<string, unknown> }[] = [];
const reply = (u: URL): unknown => {
  const p = u.pathname.replace('/api', '');
  if (p === '/auth/me') return { user: { id: 'u', email: 'a@b', name: 'A', role: 'admin' }, permissions: { overview: ['view'], schedule: ['view', 'write'], media: ['view'] } };
  if (p === '/admin/v1/media') return { items: [{ id: 'm1', name: 'Video A', kind: 'video', status: 'approved', mime: 'video/mp4', duration_sec: 30 }], total: 1 };
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
  // khung 400x400; riêng nhóm 'GROUP' (data-zone) rộng 200 x cao 100 để kiểm tra % theo NHÓM
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const g = this.getAttribute?.('data-group') === '1';
    const [w, h] = g ? [200, 100] : [400, 400];
    return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) };
  });
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
const tree = () => document.querySelector('[data-testid="layer-tree"]') as HTMLElement;
/** [tên, độ sâu]: 0 = vùng ngoài, 1 = vùng con trong nhóm */
const layers = () => Array.from(tree().querySelectorAll('.wz-layer')).map((e) => [e.querySelector('.nm')!.firstChild!.textContent, e.classList.contains('kid') ? 1 : 0] as const);
const coords = (name: string) => within(tree()).getByRole('button', { name: new RegExp(`^${name}`) }).querySelector('small')!.textContent;
const layer = (id: string) => tree().querySelector(`[data-layer="${id}"]`) as HTMLElement;
const click = (user: ReturnType<typeof userEvent.setup>, name: string | RegExp) => user.click(screen.getByRole('button', { name }));
async function groupWithKids(user: ReturnType<typeof userEvent.setup>) {
  await click(user, '+ Danh sách phát');
  await click(user, '+ Video');
  await click(user, '+ Văn bản');
  await click(user, '+ Ảnh');
}

describe('Bước 2: cây lớp thành phần', () => {
  it('"+ Danh sách phát" tạo NHÓM 10,10 · 50×50; Video/Văn bản/Ảnh thêm sau đó vào nhóm, xếp dọc, thụt vào dưới nhóm', async () => {
    const user = await openStep2();
    await click(user, '+ Danh sách phát');
    expect(layers()).toEqual([['Video 1', 0], ['Danh sách phát 2', 0]]);
    expect(coords('Danh sách phát 2')).toBe('10%, 10% · 50×50%');
    expect(layer(tree().querySelectorAll('.wz-layer')[1]!.getAttribute('data-layer')!).getAttribute('aria-pressed')).toBe('true'); // nhóm đang chọn
    await click(user, '+ Video');
    await click(user, '+ Văn bản');
    await click(user, '+ Ảnh');
    expect(layers()).toEqual([['Video 1', 0], ['Danh sách phát 2', 0], ['Video 1', 1], ['Văn bản 2', 1], ['Ảnh 3', 1]]);
    // cây: các con nằm trong .wz-kids của đúng nhóm, tách khỏi vùng ngoài
    const kids = tree().querySelector('.wz-kids')!;
    expect(kids.getAttribute('aria-label')).toBe('Thành phần trong Danh sách phát 2');
    expect(kids.querySelectorAll('.wz-kid')).toHaveLength(3);
    expect(kids.querySelector('.wz-kid.last')).toBe(kids.querySelectorAll('.wz-kid')[2]);
    expect(tree().querySelectorAll('.wz-node')).toHaveLength(2);
    // vị trí tương đối trong nhóm, xếp dọc (mỗi con nối đuôi con trước)
    const small = Array.from(kids.querySelectorAll('small')).map((s) => s.textContent);
    expect(small).toEqual(['0%, 0% · 100×50%', '0%, 50% · 100×15%', '0%, 65% · 100×35%']);
    expect(screen.getByTestId('add-target').textContent).toContain('Danh sách phát 2'); // đang chọn con -> thêm tiếp vào cùng nhóm
    expect(screen.getByTestId('rel-note').textContent).toContain('% của nhóm');
  });

  it('chọn vùng ngoài thì thêm ra ngoài nhóm; "+ Danh sách phát" luôn tạo nhóm mới (không lồng nhóm)', async () => {
    const user = await openStep2();
    await click(user, '+ Danh sách phát');
    await click(user, '+ Văn bản');
    await click(user, '+ Danh sách phát'); // đang chọn vùng con -> vẫn là nhóm ngoài
    expect(layers()).toEqual([['Video 1', 0], ['Danh sách phát 2', 0], ['Văn bản 1', 1], ['Danh sách phát 3', 0]]);
    await user.click(within(tree()).getByRole('button', { name: /^Video 1/ })); // vùng ngoài
    expect(screen.queryByTestId('add-target')).toBeNull();
    await click(user, '+ Chữ chạy');
    expect(layers().filter(([, d]) => d === 0).map(([n]) => n)).toEqual(['Video 1', 'Danh sách phát 2', 'Danh sách phát 3', 'Chữ chạy 4']);
  });

  it('nút ↑↓: vô hiệu ở anh em đầu/cuối; đổi chỗ vùng con trong nhóm; nhóm di chuyển cùng các con', async () => {
    const user = await openStep2();
    await groupWithKids(user);
    const kidRows = () => Array.from(tree().querySelectorAll('.wz-kid')) as HTMLElement[];
    const k = (i: number, w: 'Lên' | 'Xuống') => within(kidRows()[i]!).getByRole('button', { name: new RegExp(`^${w} `) }) as HTMLButtonElement;
    expect(k(0, 'Lên')).toBeDisabled();
    expect(k(0, 'Xuống')).toBeEnabled();
    expect(k(2, 'Xuống')).toBeDisabled();
    await user.click(k(0, 'Xuống'));
    expect(layers().filter(([, d]) => d === 1).map(([n]) => n)).toEqual(['Văn bản 1', 'Video 2', 'Ảnh 3']); // tên mặc định theo vị trí anh em (như vùng phẳng)
    expect(Array.from(tree().querySelectorAll('.wz-kid small')).map((s) => s.textContent)).toEqual(['0%, 50% · 100×15%', '0%, 0% · 100×50%', '0%, 65% · 100×35%']);
    expect(k(0, 'Lên')).toBeDisabled();
    // vùng ngoài: nhóm là cuối nên ↓ bị khóa, ↑ đưa cả nhóm lên trên Video 1 và các con đi cùng
    const top = (n: string, w: 'Lên' | 'Xuống') => screen.getByRole('button', { name: `${w} ${n}` }) as HTMLButtonElement;
    expect(top('Danh sách phát 2', 'Xuống')).toBeDisabled();
    expect(within(tree().querySelectorAll('.wz-node')[0]! as HTMLElement).getByRole('button', { name: 'Lên Video 1' })).toBeDisabled(); // vùng ngoài đầu tiên
    await user.click(top('Danh sách phát 2', 'Lên'));
    expect(layers().map(([n, d]) => `${d}:${n}`)).toEqual(['0:Danh sách phát 1', '1:Văn bản 1', '1:Video 2', '1:Ảnh 3', '0:Video 2']);
  });

  it('"Đưa vào nhóm": vùng ngoài vào nhóm (giữ vị trí nhìn thấy, đổi sang % nhóm), rồi ra ngoài (toạ độ tuyệt đối)', async () => {
    const user = await openStep2();
    await click(user, '+ Danh sách phát'); // nhóm 10,10 50x50
    await click(user, '+ Chữ chạy'); // con
    await user.click(within(tree()).getByRole('button', { name: /^Video 1/ })); // vùng ngoài 0,0 100x100
    const sel = screen.getByRole('combobox', { name: 'Đưa vào nhóm' }) as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['— Không (vùng ngoài nhóm) —', 'Danh sách phát 2']);
    await user.selectOptions(sel, sel.options[1]!.value);
    expect(layers()).toEqual([['Danh sách phát 1', 0], ['Chữ chạy 1', 1], ['Video 2', 1]]); // nhóm giờ là vùng ngoài duy nhất
    expect(Array.from(tree().querySelectorAll('.wz-kid small')).map((s) => s.textContent)).toEqual(['0%, 0% · 100×12%', '0%, 0% · 100×100%']); // vượt nhóm thì kẹp vào nhóm
    expect(coords('Video 2')).toBe('0%, 0% · 100×100%');
    // chữ chạy con (0,0,100x12 trong nhóm 10,10,50x50) ra ngoài => 10, 10, 50x6
    await user.click(within(tree()).getByRole('button', { name: /^Chữ chạy 1/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Đưa vào nhóm' }), '');
    expect(layers().map(([n, d]) => `${d}:${n}`)).toEqual(['0:Danh sách phát 1', '1:Video 1', '0:Chữ chạy 2']);
    expect(coords('Chữ chạy 2')).toBe('10%, 10% · 50×6%');
  });

  it('xóa nhóm: hỏi xác nhận, xóa luôn các con; hủy thì giữ nguyên; xóa một con không đụng nhóm', async () => {
    const user = await openStep2();
    await groupWithKids(user);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await user.click(within(tree().querySelector('.wz-kid')! as HTMLElement).getByRole('button', { name: /^Xóa .*\(trong/ }));
    expect(layers().filter(([, d]) => d === 1)).toHaveLength(2);
    expect(confirm).not.toHaveBeenCalled(); // xóa vùng con: không cần hỏi
    await user.click(screen.getByRole('button', { name: 'Xóa Danh sách phát 2' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('và 2 thành phần'));
    expect(layers()).toHaveLength(4); // hủy: còn Video 1 + nhóm + 2 con
    await user.click(screen.getByRole('button', { name: 'Xóa Danh sách phát 2' }));
    expect(layers()).toEqual([['Video 1', 0]]);
  });

  it('gỡ nhóm: giữ các con thành vùng ngoài với toạ độ tuyệt đối', async () => {
    const user = await openStep2();
    await click(user, '+ Danh sách phát');
    await click(user, '+ Video'); // 0,0,100x50 trong nhóm 10,10,50x50 -> 10,10,50x25
    await user.click(within(tree()).getByRole('button', { name: /^Danh sách phát 2/ }));
    await click(user, 'Gỡ nhóm');
    expect(layers()).toEqual([['Video 1', 0], ['Video 2', 0]]);
    expect(coords('Video 2')).toBe('10%, 10% · 50×25%');
  });

  it('payload lưu: nhóm (type group, không nội dung) + vùng con parent_id với toạ độ % nhóm, con đứng ngay sau nhóm', async () => {
    const user = await openStep2();
    await click(user, '+ Danh sách phát');
    await click(user, '+ Video');
    await click(user, '+ Văn bản');
    await click(user, /Bước tiếp theo/);
    await user.click(await screen.findByRole('button', { name: /Theo khu vực/ }));
    await click(user, /Bước tiếp theo/);
    await user.click(await screen.findByRole('button', { name: 'Lưu nháp' }));
    const post = await vi.waitFor(() => { const p = posts.find((x) => x.url.endsWith('/admin/v1/broadcast')); if (!p) throw new Error('chưa lưu'); return p; });
    const zs = (post.body as { layout: { zones: Record<string, unknown>[] } }).layout.zones;
    expect(zs.map((z) => [z.type, z.parent_id])).toEqual([['video', undefined], ['group', undefined], ['video', zs[1]!.id], ['text', zs[1]!.id]]);
    expect(zs[1]).toMatchObject({ type: 'group', x: 10, y: 10, w: 50, h: 50 });
    expect(zs[1]).not.toHaveProperty('playlist');
    expect(zs[2]).toMatchObject({ x: 0, y: 0, w: 100, h: 50, loop: true, playlist: [] });
    expect(zs[3]).toMatchObject({ x: 0, y: 50, w: 100, h: 15 });
  });

  it('giới hạn: tối đa 8 vùng ngoài (nút thêm bị khóa) nhưng vùng trong nhóm vẫn thêm được', async () => {
    const user = await openStep2();
    await click(user, '+ Danh sách phát');
    for (let i = 0; i < 6; i++) { await user.click(within(tree()).getByRole('button', { name: /^Video 1/ })); await click(user, '+ Chữ chạy'); }
    // đang chọn vùng ngoài -> 6 chữ chạy ngoài + Video 1 + nhóm = 8
    expect(screen.getByRole('button', { name: '+ Danh sách phát' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ Video' })).toBeDisabled();
    await user.click(within(tree()).getByRole('button', { name: /^Danh sách phát 2/ }));
    expect(screen.getByRole('button', { name: '+ Video' })).toBeEnabled(); // thêm vào nhóm
  });
});

describe('Khung thiết kế: nhóm + vùng con', () => {
  const g = (): Zone => ({ id: 'g', type: 'group', x: 10, y: 20, w: 50, h: 25, z: 0, transition: 'none' });
  const c = (extra: Partial<Zone> = {}): Zone => ({ id: 'c', type: 'text', x: 0, y: 0, w: 100, h: 40, z: 0, transition: 'none', text: 'Xin chào', parent_id: 'g', ...extra });
  const mount = (zones: Zone[], selected: string | null) => {
    const onChange = vi.fn();
    render(<ZoneCanvas orientation="landscape" zones={zones} selected={selected} onSelect={() => undefined} onChange={onChange} itemsOf={() => []} hidden={new Set()} />);
    return onChange;
  };

  it('nhóm là khung nét đứt; vùng con nằm BÊN TRONG phần tử nhóm và định vị theo % nhóm', () => {
    mount([g(), c({ x: 20, y: 50, w: 60, h: 40 })], null);
    const group = document.querySelector('[data-zone="g"]') as HTMLElement;
    expect(group.style.border).toContain('dashed');
    expect(group.style.left).toBe('10%');
    const child = group.querySelector('[data-zone="c"]') as HTMLElement;
    expect(child).not.toBeNull();
    expect(child.style.left).toBe('20%');
    expect(child.style.top).toBe('50%');
    expect(child.style.width).toBe('60%');
  });

  it('kéo vùng con: delta tính theo khung NHÓM (200×100px), kẹp trong nhóm; không làm nhóm di chuyển', () => {
    const onChange = mount([g(), c({ x: 10, y: 10, w: 50, h: 40 })], 'c');
    const child = document.querySelector('[data-zone="c"]') as HTMLElement;
    fireEvent.pointerDown(child, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(screen.getByTestId('zone-canvas'), { clientX: 90, clientY: 80, pointerId: 1 }); // +40px/200 = +20%, +30px/100 = +30%
    const out = onChange.mock.calls.at(-1)![0] as Zone[];
    expect(out.find((z) => z.id === 'c')).toMatchObject({ x: 30, y: 40, w: 50, h: 40 });
    expect(out.find((z) => z.id === 'g')).toMatchObject({ x: 10, y: 20, w: 50, h: 25 });
    fireEvent.pointerMove(screen.getByTestId('zone-canvas'), { clientX: 9000, clientY: 9000, pointerId: 1 });
    expect((onChange.mock.calls.at(-1)![0] as Zone[]).find((z) => z.id === 'c')).toMatchObject({ x: 50, y: 60 }); // kẹp: x+w<=100, y+h<=100 (% nhóm)
  });

  it('kéo tay nắm đổi kích thước của vùng con cũng theo % nhóm; kéo nhóm không đổi toạ độ vùng con', () => {
    const onChange = mount([g(), c({ x: 0, y: 0, w: 50, h: 40 })], 'c');
    fireEvent.pointerDown(document.querySelector('[data-handles="c"] [data-handle="se"]')!, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(screen.getByTestId('zone-canvas'), { clientX: 40, clientY: 10, pointerId: 1 }); // +20% rộng, +10% cao
    expect((onChange.mock.calls.at(-1)![0] as Zone[]).find((z) => z.id === 'c')).toMatchObject({ w: 70, h: 50 });
  });

  it('kéo nhóm: chỉ đổi x/y của nhóm (vùng con đi theo vì tương đối)', () => {
    const onChange = mount([g(), c()], 'g');
    fireEvent.pointerDown(document.querySelector('[data-zone="g"]')!, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(screen.getByTestId('zone-canvas'), { clientX: 140, clientY: 140, pointerId: 1 }); // khung 400: +10%
    const out = onChange.mock.calls.at(-1)![0] as Zone[];
    expect(out.find((z) => z.id === 'g')).toMatchObject({ x: 20, y: 30 });
    expect(out.find((z) => z.id === 'c')).toMatchObject({ x: 0, y: 0, w: 100, h: 40 });
  });
});

describe('Xem trước: nhóm', () => {
  it('vùng con được vẽ trong khung nhóm (toạ độ % nhóm) và phát nội dung của nó; nhóm không có nội dung riêng', () => {
    const zones = [
      { id: 'g', type: 'group', x: 10, y: 20, w: 50, h: 50, z: 0, transition: 'none' },
      { id: 'c', type: 'text', x: 0, y: 50, w: 100, h: 50, z: 0, transition: 'none', text: 'Giá 99k', parent_id: 'g' },
    ] as unknown as Zone[];
    render(<LivePreview orientation="portrait" zones={zones} items={[]} />);
    const g = document.querySelector('.lp-zone[data-zone="g"]') as HTMLElement;
    expect(g.classList.contains('lp-group')).toBe(true);
    const c = g.querySelector('.lp-zone[data-zone="c"]') as HTMLElement;
    expect(c.style.top).toBe('50%');
    expect(c.textContent).toBe('Giá 99k');
    expect(document.querySelectorAll('.lp-zone[data-zone="c"]')).toHaveLength(1);
  });
});

describe('lib/groups: thao tác thuần', () => {
  const base = (): Zone[] => [newZone('video', [])];
  it('relBox <-> absBox khứ hồi; flattenZones giống shared (bỏ nhóm, toạ độ tuyệt đối, group_id)', () => {
    const grp = { x: 10, y: 20, w: 50, h: 25 };
    const abs = { x: 20, y: 25, w: 25, h: 10 };
    expect(absBox(grp, relBox(grp, abs))).toEqual(abs);
    const a = addZoneTo(base(), 'group', null)!;
    const b = addZoneTo(a.zones, 'video', a.id)!;
    const f = flattenZones(b.zones);
    expect(f.map((z) => z.id)).toEqual([b.zones[0]!.id, b.id]);
    expect(f[1]).toMatchObject({ group_id: a.id, x: 10, y: 10, w: 50, h: 25 });
    expect('parent_id' in f[1]!).toBe(false);
  });
  it('moveSibling/setParent/ungroup/deleteZone giữ cây hợp lệ và z theo thứ tự', () => {
    let zs = base();
    const g = addZoneTo(zs, 'group', null)!;
    const k1 = addZoneTo(g.zones, 'text', g.id)!;
    const k2 = addZoneTo(k1.zones, 'image', g.id)!;
    zs = k2.zones;
    expect(zs.map((z) => z.parent_id ?? '-')).toEqual(['-', '-', g.id, g.id]);
    expect(zs.map((z) => z.z)).toEqual([0, 1, 0, 1]); // vùng ngoài theo thứ tự ngoài; con theo thứ tự trong nhóm
    expect(moveSibling(zs, k2.id, 1)).toBe(zs); // cuối: không đổi
    expect(moveSibling(zs, k2.id, -1).map((z) => z.id).slice(2)).toEqual([k2.id, k1.id]);
    expect(setParent(zs, k1.id, null)!.map((z) => z.parent_id ?? '-')).toEqual(['-', '-', g.id, '-']); // ra ngoài: đặt ngay sau khối nhóm cũ
    expect(setParent(zs, g.id, g.id)).toBeNull(); // nhóm không vào nhóm
    expect(ungroup(zs, g.id)!.map((z) => z.parent_id)).toEqual([undefined, undefined, undefined]);
    expect(deleteZone(zs, g.id).map((z) => z.id)).toEqual([zs[0]!.id]);
    expect(layoutError(zs)).toBe('');
    expect(layoutError(zs.map((z) => (z.id === k1.id ? { ...z, parent_id: 'khong-co' } : z)))).toMatch(/nhóm không hợp lệ/);
    expect(reindexTree(zs)).toEqual(zs);
  });
});
