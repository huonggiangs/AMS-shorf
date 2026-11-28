import { describe, expect, it } from 'vitest';
import { IMAGE_DEFAULT_S, ITEM_DURATION_MAX_S, PLAYLIST_MAX_ITEMS, itemImpressionSchema, itemPlayS, legacyItemId, legacyMirror, playlistMediaIds, playlistSchema, playlistTotalS, playlistUnknownVideos, programIdOf, uuidV5, zoneLoop, zonePlaylist } from '../src/index.js';

const U1 = '0190a000-0000-7000-8000-000000000001';
const U2 = '0190a000-0000-7000-8000-000000000002';
const U3 = '0190a000-0000-7000-8000-000000000003';

describe('uuidV5', () => {
  it('khop vector chuan RFC 4122 (DNS namespace, python.org)', () => {
    expect(uuidV5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });
  it('on dinh va phan biet theo vung/tep', () => {
    expect(legacyItemId('main', 'c1')).toBe(legacyItemId('main', 'c1'));
    expect(legacyItemId('main', 'c1')).not.toBe(legacyItemId('side', 'c1'));
    expect(legacyItemId('main', 'c1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('playlistSchema', () => {
  it('chap nhan video/anh/van ban; lam sach text; bo truong la', () => {
    const r = playlistSchema.parse([
      { id: U1, type: 'video', name: 'V', media_id: 'cr1', foo: 1 },
      { id: U2, type: 'image', name: 'I', media_id: 'cr2', duration: 12.4, style: { color: '#fff' } },
      { id: U3, type: 'text', name: 'T', text_content: 'Xin chao\u0007', rich: '<p onclick="x()"><b>Dam</b><script>alert(1)</script></p>', style: { color: '#fff', background: 'rgb(0,0,0)', font_size: 40, align: 'center', bold: true, junk: 1 } },
    ]);
    expect(r[0]).toEqual({ id: U1, type: 'video', name: 'V', media_id: 'cr1' });
    expect(r[1]!.duration).toBe(12);
    expect(r[1]!.style).toBeUndefined(); // style chi cho van ban
    expect(r[2]!.rich).toBe('<p><b>Dam</b></p>');
    expect(r[2]!.rich).not.toMatch(/script|onclick/);
    expect(r[2]!.text_content).toBe('Dam');
    expect(r[2]!.style).toEqual({ color: '#FFFFFF', background: '#000000', font_size: 40, align: 'center', bold: true });
  });
  it('van ban thuan khong rich: giu, bo ky tu dieu khien', () => {
    const r = playlistSchema.parse([{ id: U1, type: 'text', name: 'T', text_content: 'a\u0000b\nc' }]);
    expect(r[0]!.text_content).toBe('ab\nc');
  });
  it('tu choi: loai/kieu sai, thieu nguon, ca hai nguon, url http, text co media, rong, id trung, qua nhieu', () => {
    const bad = (x: unknown): boolean => !playlistSchema.safeParse(x).success;
    expect(bad([{ id: 'x', type: 'video', name: 'a', media_id: 'c' }])).toBe(true);
    expect(bad([{ id: U1, type: 'gif', name: 'a', media_id: 'c' }])).toBe(true);
    expect(bad([{ id: U1, type: 'video', name: 'a' }])).toBe(true);
    expect(bad([{ id: U1, type: 'video', name: 'a', media_id: 'c', url: 'https://a.vn/x.mp4' }])).toBe(true);
    expect(bad([{ id: U1, type: 'image', name: 'a', url: 'http://a.vn/x.jpg' }])).toBe(true);
    expect(bad([{ id: U1, type: 'image', name: 'a', url: 'javascript:alert(1)' }])).toBe(true);
    expect(bad([{ id: U1, type: 'text', name: 'a', text_content: 'x', media_id: 'c' }])).toBe(true);
    expect(bad([{ id: U1, type: 'text', name: 'a', text_content: '   ' }])).toBe(true);
    expect(bad([{ id: U1, type: 'video', name: 'a', media_id: 'c', duration: 0 }])).toBe(true);
    expect(bad([{ id: U1, type: 'video', name: 'a', media_id: 'c', duration: ITEM_DURATION_MAX_S + 1 }])).toBe(true);
    expect(bad([{ id: U1, type: 'video', name: 'a', media_id: 'c' }, { id: U1, type: 'video', name: 'b', media_id: 'd' }])).toBe(true);
    const many = Array.from({ length: PLAYLIST_MAX_ITEMS + 1 }, (_, i) => ({ id: `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`, type: 'text', name: 'n', text_content: 'x' }));
    expect(bad(many)).toBe(true);
    expect(bad(many.slice(0, PLAYLIST_MAX_ITEMS))).toBe(false);
    expect(bad([{ id: U1, type: 'image', name: 'a', url: 'https://cdn.example.vn/a.jpg' }])).toBe(false);
  });
});

describe('zonePlaylist (tuong thich nguoc)', () => {
  it('vung cu: creative_ids + durations -> muc co id on dinh', () => {
    const z = { id: 'main', type: 'image', creative_ids: ['a', 'b', 'a'], durations: { b: 20, c: 5 } };
    const p = zonePlaylist(z, (id) => (id === 'a' ? { kind: 'video', name: 'Phim A' } : undefined));
    expect(p).toEqual([
      { id: legacyItemId('main', 'a'), type: 'video', name: 'Phim A', media_id: 'a' },
      { id: legacyItemId('main', 'b'), type: 'image', name: 'b', media_id: 'b', duration: 20 },
    ]);
    expect(zonePlaylist(z)).toEqual(zonePlaylist(z)); // tat dinh
  });
  it('mot creative, khong co gi, va playlist co san duoc giu nguyen', () => {
    expect(zonePlaylist({ id: 'z', type: 'video', creative_id: 'x' })[0]).toMatchObject({ type: 'video', media_id: 'x' });
    expect(zonePlaylist({ id: 'z' })).toEqual([]);
    const pl = [{ id: U1, type: 'text' as const, name: 't', text_content: 'a' }];
    expect(zonePlaylist({ id: 'z', playlist: pl, creative_ids: ['q'] })).toBe(pl);
    expect(zonePlaylist({ id: 'z', playlist: [] })).toEqual([]);
  });
  it('loop mac dinh true', () => {
    expect(zoneLoop({})).toBe(true);
    expect(zoneLoop({ loop: false })).toBe(false);
  });
});

describe('thoi luong', () => {
  const items = [
    { id: U1, type: 'video' as const, name: 'v', media_id: 'v1' },
    { id: U2, type: 'image' as const, name: 'i', media_id: 'i1' },
    { id: U3, type: 'text' as const, name: 't', text_content: 'x', duration: 3 },
  ];
  it('mac dinh anh/van ban 8 s, video theo thoi luong that, dat tay thang', () => {
    expect(IMAGE_DEFAULT_S).toBe(8);
    expect(itemPlayS(items[1]!)).toBe(8);
    expect(itemPlayS({ type: 'text' })).toBe(8);
    expect(itemPlayS(items[0]!)).toBeNull();
    expect(itemPlayS(items[0]!, { v1: 31.5 })).toBe(31.5);
    expect(itemPlayS({ ...items[0]!, duration: 10 }, { v1: 31.5 })).toBe(10);
    expect(playlistTotalS(items, { v1: 30 })).toBe(30 + 8 + 3);
    expect(playlistTotalS(items)).toBe(8 + 3);
    expect(playlistUnknownVideos(items)).toBe(1);
    expect(playlistUnknownVideos(items, { v1: 5 })).toBe(0);
  });
  it('legacyMirror + playlistMediaIds', () => {
    const l = [...items, { id: 'x', type: 'video' as const, name: 'dup', media_id: 'v1', duration: 9 }];
    expect(legacyMirror(l)).toEqual({ creative_ids: ['v1', 'i1'], durations: {} });
    expect(legacyMirror([{ ...items[1]!, duration: 15 }])).toEqual({ creative_ids: ['i1'], durations: { i1: 15 } });
    expect(playlistMediaIds(l)).toEqual(['v1', 'i1']);
  });
});

describe('item_impression', () => {
  const ok = { type: 'item_impression', log_id: U1, program_id: 'bp_abc', zone_id: 'main', item_id: U2, item_type: 'video', played_at: '2026-11-28T03:00:00.000Z' };
  it('hop le / sai', () => {
    expect(itemImpressionSchema.safeParse(ok).success).toBe(true);
    expect(itemImpressionSchema.safeParse({ ...ok, played_at: 'hom qua' }).success).toBe(false);
    expect(itemImpressionSchema.safeParse({ ...ok, log_id: 'abc' }).success).toBe(false);
    expect(itemImpressionSchema.safeParse({ ...ok, item_type: 'gif' }).success).toBe(false);
    expect(programIdOf('bp_abc')).toBe('abc');
    expect(programIdOf('abc')).toBe('abc');
  });
});
