import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaylistPlayer, WAIT_RETRY_MS, type PlayerItem, type PlayerState } from '../lib/playlistPlayer';

const vid = (id: string, duration?: number): PlayerItem => ({ id, type: 'video', duration });
const img = (id: string, duration?: number): PlayerItem => ({ id, type: 'image', duration });
const txt = (id: string, duration?: number): PlayerItem => ({ id, type: 'text', duration });

function setup(items: PlayerItem[], o: { loop?: boolean; isPreview?: boolean } = {}) {
  const states: PlayerState[] = [];
  const imp: string[] = [];
  const logs: string[] = [];
  const p = createPlaylistPlayer({ items, loop: o.loop ?? true, isPreview: o.isPreview, onState: (s) => states.push(s), onImpression: (i) => imp.push(i.id), onLog: (m) => logs.push(m) });
  return { p, states, imp, logs, idx: () => p.getState().index };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('playlistPlayer', () => {
  it('phát tuần tự: ảnh/text 8s mặc định hoặc theo duration, video chờ ended()', () => {
    const { p, idx } = setup([img('a'), txt('b', 3), vid('c'), img('d', 2)]);
    p.start();
    expect(idx()).toBe(0);
    vi.advanceTimersByTime(7999); expect(idx()).toBe(0);
    vi.advanceTimersByTime(1); expect(idx()).toBe(1);
    vi.advanceTimersByTime(3000); expect(idx()).toBe(2);
    vi.advanceTimersByTime(60_000); expect(idx()).toBe(2); // video: không tự chuyển
    p.ended(); expect(idx()).toBe(3);
    p.ended(); expect(idx()).toBe(3); // ended() bị bỏ qua nếu không phải video
  });
  it('video có duration do người dùng đặt thì cắt sau đó', () => {
    const { p, idx } = setup([vid('a', 5), img('b')]);
    p.start();
    vi.advanceTimersByTime(5000); expect(idx()).toBe(1);
  });
  it('loop bật: quay lại đầu; tắt: dừng ở cuối (finished)', () => {
    const on = setup([img('a', 1), img('b', 1)], { loop: true });
    on.p.start(); vi.advanceTimersByTime(2000);
    expect(on.idx()).toBe(0); expect(on.p.getState().phase).toBe('playing');
    const off = setup([img('a', 1), img('b', 1)], { loop: false });
    off.p.start(); vi.advanceTimersByTime(10_000);
    expect(off.p.getState().phase).toBe('finished');
    expect(off.idx()).toBe(1);
  });
  it('một video loop: seq tăng mỗi vòng để giao diện khởi động lại', () => {
    const { p } = setup([vid('a')]);
    p.start(); const s1 = p.getState().seq;
    p.ended();
    expect(p.getState()).toMatchObject({ index: 0, phase: 'playing' });
    expect(p.getState().seq).toBe(s1 + 1);
  });
  it('lỗi media: bỏ qua mục + ghi log, mục sau vẫn phát', () => {
    const { p, idx, logs } = setup([vid('a'), vid('b'), img('c')]);
    p.start();
    p.error('lỗi mạng');
    expect(idx()).toBe(1);
    expect(logs[0]).toMatch(/lỗi mạng/);
    p.ready(); p.ended();
    expect(idx()).toBe(2);
  });
  it('lỗi ở mục không phải mục đang phát (nạp sẵn) bị bỏ qua', () => {
    const { p, idx } = setup([vid('a'), vid('b')]);
    p.start(); p.error('x', 1);
    expect(idx()).toBe(0);
  });
  it('tất cả mục lỗi: màn hình chờ 8s rồi thử lại cả danh sách, không lặp vô hạn sát nhau', () => {
    const { p, states } = setup([vid('a'), vid('b')]);
    p.start();
    p.error('x'); p.error('x');
    expect(p.getState().phase).toBe('waiting');
    const n = states.length;
    vi.advanceTimersByTime(WAIT_RETRY_MS - 1);
    expect(p.getState().phase).toBe('waiting');
    expect(states.length).toBe(n); // không có thay đổi trạng thái trong lúc chờ
    vi.advanceTimersByTime(1);
    expect(p.getState()).toMatchObject({ phase: 'playing', index: 0 });
    // thử lại lỗi tiếp: lại chờ 8s
    p.error('x'); p.error('x');
    expect(p.getState().phase).toBe('waiting');
  });
  it('một mục duy nhất bị lỗi cũng vào màn hình chờ', () => {
    const { p } = setup([img('a')]);
    p.start(); p.error('x');
    expect(p.getState().phase).toBe('waiting');
  });
  it('mục thành công xóa bộ đếm lỗi (lỗi rải rác không gây chờ)', () => {
    const { p, idx } = setup([vid('a'), vid('b'), vid('c')]);
    p.start();
    p.error('x'); p.ready(); p.ended(); // a lỗi, b ok
    p.error('x'); // c lỗi
    expect(p.getState().phase).toBe('playing');
    expect(idx()).toBe(0);
  });
  it('xem trước KHÔNG gửi impression; chạy thật thì gửi mỗi lần bắt đầu một mục', () => {
    const pre = setup([img('a', 1), img('b', 1)], { isPreview: true });
    pre.p.start(); vi.advanceTimersByTime(3000);
    expect(pre.imp).toEqual([]);
    const live = setup([img('a', 1), img('b', 1)], { isPreview: false });
    live.p.start(); vi.advanceTimersByTime(2000);
    expect(live.imp).toEqual(['a', 'b', 'a']);
  });
  it('tạm dừng / tiếp tục giữ phần thời gian còn lại; stop hủy hẹn giờ', () => {
    const { p, idx } = setup([img('a', 10), img('b', 10)]);
    p.start(); vi.advanceTimersByTime(4000);
    p.pause(); vi.advanceTimersByTime(60_000);
    expect(idx()).toBe(0);
    p.resume(); vi.advanceTimersByTime(5999); expect(idx()).toBe(0);
    vi.advanceTimersByTime(1); expect(idx()).toBe(1);
    p.stop(); vi.advanceTimersByTime(60_000);
    expect(p.getState().phase).toBe('idle');
  });
  it('danh sách rỗng: idle', () => {
    const { p } = setup([]);
    p.start(); expect(p.getState().phase).toBe('idle');
  });
});
