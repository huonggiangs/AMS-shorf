// Logic thuan cua anh dai dien (tao o trinh duyet): kich thuoc, thoi diem lay khung, chon tep can tao, nen duoi 150 KB, URL.
import { describe, expect, it } from 'vitest';
import { BACKFILL_MAX_PER_LOAD, THUMB_MAX_BYTES, encodeUnderLimit, needsThumbnail, pickBackfill, resolveThumbUrl, seekTime, thumbSize, uploadDoneMessage } from '../lib/thumbnail';

describe('thumbSize', () => {
  it('co ve rong 320 px giu ti le', () => {
    expect(thumbSize(1920, 1080)).toEqual({ w: 320, h: 180 });
    expect(thumbSize(1080, 1920)).toEqual({ w: 320, h: 569 });
  });
  it('anh nho hon 320 px khong bi phong to; kich thuoc hong -> 0', () => {
    expect(thumbSize(200, 100)).toEqual({ w: 200, h: 100 });
    expect(thumbSize(0, 100)).toEqual({ w: 0, h: 0 });
    expect(thumbSize(NaN, 100)).toEqual({ w: 0, h: 0 });
    expect(thumbSize(5000, 1).h).toBe(1);
  });
});

describe('seekTime', () => {
  it('~1 s, hoac 10% thoi luong neu video ngan', () => {
    expect(seekTime(30)).toBe(1);
    expect(seekTime(10)).toBe(1);
    expect(seekTime(5)).toBe(0.5);
    expect(seekTime(0)).toBe(0);
    expect(seekTime(null)).toBe(0);
    expect(seekTime(Infinity)).toBe(0);
  });
});

describe('encodeUnderLimit', () => {
  it('giam chat luong den khi <= 150 KB', async () => {
    const tried: number[] = [];
    const r = await encodeUnderLimit(async (q) => { tried.push(q); return { size: q > 0.5 ? 200_000 : 100_000 }; });
    expect(r?.size).toBe(100_000);
    expect(tried).toEqual([0.7, 0.55, 0.4]);
  });
  it('khong dat duoc -> null; loi encode -> null', async () => {
    expect(await encodeUnderLimit(async () => ({ size: THUMB_MAX_BYTES + 1 }))).toBeNull();
    expect(await encodeUnderLimit(async () => null)).toBeNull();
    expect((await encodeUnderLimit(async () => ({ size: THUMB_MAX_BYTES })))?.size).toBe(THUMB_MAX_BYTES);
  });
});

describe('needsThumbnail / pickBackfill', () => {
  const v = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'video', mime: 'video/mp4', status: 'approved', source: 'upload', thumb_url: null, size_bytes: 5_000_000, ...extra });
  it('video/anh tai len chua co anh -> can; da co anh, dang xu ly, tep lien ket, anh qua lon -> khong', () => {
    expect(needsThumbnail(v('a'))).toBe(true);
    expect(needsThumbnail(v('a', { thumb_url: '/api/x' }))).toBe(false);
    expect(needsThumbnail(v('a', { status: 'processing' }))).toBe(false);
    expect(needsThumbnail(v('a', { kind: 'link', source: 'youtube', mime: null }))).toBe(false);
    expect(needsThumbnail(v('a', { kind: 'image', mime: 'image/png', size_bytes: 30 * 1048576 }))).toBe(false);
    expect(needsThumbnail(v('a', { kind: 'image', mime: 'image/png', size_bytes: 1048576 }))).toBe(true);
  });
  it('toi da vai tep moi lan, bo qua tep da thu', () => {
    const items = ['1', '2', '3', '4', '5'].map((i) => v(i));
    expect(pickBackfill(items, new Set()).map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(BACKFILL_MAX_PER_LOAD).toBe(3);
    expect(pickBackfill(items, new Set(['1', '2'])).map((x) => x.id)).toEqual(['3', '4', '5']);
    expect(pickBackfill([v('z', { thumb_url: '/api/y' })], new Set())).toEqual([]);
  });
});

describe('resolveThumbUrl / uploadDoneMessage', () => {
  it('duong API tuong doi giu nguyen hoac them tien to; URL tuyet doi giu nguyen; rong -> null', () => {
    expect(resolveThumbUrl('/api/admin/v1/media/1/thumbnail?v=2')).toBe('/api/admin/v1/media/1/thumbnail?v=2');
    expect(resolveThumbUrl('/admin/v1/media/1/thumbnail', '/api')).toBe('/api/admin/v1/media/1/thumbnail');
    expect(resolveThumbUrl('https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
    expect(resolveThumbUrl(null)).toBeNull();
    expect(resolveThumbUrl('')).toBeNull();
  });
  it('thong bao sau khi tai len phan biet da duyet / cho duyet', () => {
    expect(uploadDoneMessage('approved')).toContain('tự động duyệt');
    expect(uploadDoneMessage('pending')).toContain('hàng chờ duyệt');
    expect(uploadDoneMessage(null)).toContain('hàng chờ duyệt');
  });
});
