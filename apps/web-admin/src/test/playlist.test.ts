import { describe, expect, it } from 'vitest';
import { hydrateZones, itemDurationS, legacyMirror, newItem, playlistTotalS, withPlaylist, zonePlaylist, ITEM_DEFAULT_S } from '../lib/playlist';
import { newZone, type Zone } from '../lib/layout';
import { carryItems } from '../components/BroadcastWizard';

const vz = (extra: Partial<Zone> = {}): Zone => ({ id: 'z1', type: 'video', x: 0, y: 0, w: 100, h: 100, z: 0, transition: 'fade', ...extra });

describe('playlist: parse vùng cũ -> playlist', () => {
  it('creative_ids + durations -> playlist, video để trống = theo metadata, ảnh cũ giữ 5s', () => {
    const pl = zonePlaylist({ type: 'video', creative_ids: ['a', 'b', 'c'], durations: { a: 12 } }, { kindOf: (id) => (id === 'c' ? 'image' : 'video'), nameOf: (id) => `N-${id}` });
    expect(pl.map((i) => [i.media_id, i.type, i.duration, i.name])).toEqual([['a', 'video', 12, 'N-a'], ['b', 'video', undefined, 'N-b'], ['c', 'image', 5, 'N-c']]);
    expect(new Set(pl.map((i) => i.id)).size).toBe(3);
    expect(pl[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('creative_id đơn; vùng ảnh cũ -> type image; không có gì -> rỗng; đã có playlist -> giữ nguyên', () => {
    expect(zonePlaylist({ type: 'image', creative_id: 'x' })[0]).toMatchObject({ type: 'image', media_id: 'x', duration: 5 });
    expect(zonePlaylist({ type: 'video' })).toEqual([]);
    const own = [newItem('text')];
    expect(zonePlaylist({ type: 'video', creative_ids: ['q'], playlist: own })).toBe(own);
  });
  it('hydrateZones: ghép creative_ids/item_zones cấp chương trình vào đúng vùng, vùng đầu nhận mục chưa gán', () => {
    const zs: Zone[] = [vz({ id: 'top' }), vz({ id: 'bot', type: 'image' }), { ...vz({ id: 'bar', type: 'marquee' }) }];
    const out = hydrateZones(zs, [{ creative_id: 'a', zone_id: 'bot', kind: 'image', name: 'Poster' }, { creative_id: 'b', zone_id: null, kind: 'video' }, { creative_id: 'c', zone_id: 'gone' }], {});
    expect(out[0]!.playlist!.map((i) => i.media_id)).toEqual(['b', 'c']);
    expect(out[1]!.playlist!.map((i) => [i.media_id, i.type, i.name])).toEqual([['a', 'image', 'Poster']]);
    expect(out[0]!.loop).toBe(true);
    expect(out[2]!.playlist).toBeUndefined();
  });
});

describe('playlist: thời lượng, loop, đồng bộ trường cũ', () => {
  it('mặc định 8s cho ảnh/text, video theo metadata và chỉ ghi đè khi người dùng đặt', () => {
    expect(newItem('image').duration).toBe(ITEM_DEFAULT_S);
    expect(newItem('text').duration).toBe(8);
    expect(newItem('video').duration).toBeUndefined();
    const v = newItem('video', [], { media_id: 'v' });
    expect(itemDurationS(v, 30)).toBe(30);
    expect(itemDurationS({ ...v, duration: 10 }, 30)).toBe(10);
    const { duration: _d, ...cleared } = { ...v, duration: 10 };
    void _d;
    expect(itemDurationS(cleared, 30)).toBe(30);
  });
  it('tổng thời lượng', () => {
    const items = [newItem('video', [], { media_id: 'v' }), newItem('image'), newItem('text', [], { duration: 4 })];
    expect(playlistTotalS(items, (id) => (id === 'v' ? 30 : null))).toBe(30 + 8 + 4);
    expect(playlistTotalS(items)).toBe(12);
  });
  it('vùng mới: playlist rỗng + loop mặc định true (video, ảnh, danh sách phát)', () => {
    for (const t of ['video', 'image', 'playlist'] as const) expect(newZone(t, [])).toMatchObject({ playlist: [], loop: true });
    expect(newZone('qr', [])).not.toHaveProperty('playlist');
  });
  it('withPlaylist ghi playlist + loop và đồng bộ creative_ids/durations (không trùng, bỏ text)', () => {
    const items = [newItem('video', [], { media_id: 'a' }), newItem('text'), newItem('image', [], { media_id: 'b', duration: 6 }), newItem('video', [], { media_id: 'a', duration: 9 })];
    const z = withPlaylist(vz(), items, false);
    expect(z.loop).toBe(false);
    expect(z.playlist).toHaveLength(4);
    expect(z.creative_ids).toEqual(['a', 'b']);
    expect(z.durations).toEqual({ b: 6 });
    expect(legacyMirror([]).durations).toBeNull();
  });
  it('đổi bố cục giữ nguyên danh sách phát (chuyển sang vùng media đầu tiên)', () => {
    const old = [withPlaylist(vz({ id: 'o' }), [newItem('video', [], { media_id: 'a' })], false)];
    const out = carryItems(old, [vz({ id: 'n1', type: 'marquee' }), vz({ id: 'n2' })]);
    expect(out[0]!.playlist).toBeUndefined();
    expect(out[1]!.playlist!.map((i) => i.media_id)).toEqual(['a']);
    expect(out[1]!.loop).toBe(false);
  });
});
