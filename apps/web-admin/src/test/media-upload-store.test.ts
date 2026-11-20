// Tai tep len kho: duong proxy (cung origin, phien + CSRF) va duong URL ky truc tiep, loi co ma ngan + log console da che chu ky.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redactUrl, uploadToStore } from '../pages/MediaPage';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });

describe('uploadToStore', () => {
  it('via=proxy: PUT /api/admin/v1/media/:id/content cung origin, credentials include, Content-Type = loai tep', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await uploadToStore('/admin/v1/media', { id: 'm1', url: '/api/admin/v1/media/m1/content', via: 'proxy' }, file);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toMatch(/\/admin\/v1\/media\/m1\/content$/);
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/png');
  });
  it('proxy loi: thong bao cua may chu kem ma loi', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'length_mismatch', message: 'Dung lượng không khớp.' } }), { status: 400 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(uploadToStore('/admin/v1/media', { id: 'm1', url: '/x', via: 'proxy' }, file)).rejects.toThrow(/Dung lượng không khớp\. \(mã length_mismatch\)/);
  });
  it('direct: 403 tu R2 -> "Kho tu choi chu ky/khoa" + ma UP-403; log console KHONG chua chu ky', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    await expect(uploadToStore('/admin/v1/media', { id: 'm1', url: 'https://acc.r2.cloudflarestorage.com/b/k.png?X-Amz-Signature=SECRET&X-Amz-Credential=KEY', via: 'direct' }, file)).rejects.toThrow(/Kho từ chối chữ ký\/khóa.*UP-403/);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('403');
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('KEY');
  });
  it('direct: loi mang/CORS -> thong bao CORS + ma UP-NET; 500 -> UP-500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(uploadToStore('/admin/v1/media', { id: 'm1', url: 'https://x.test/u?sig=1' }, file)).rejects.toThrow(/CORS.*UP-NET/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(uploadToStore('/admin/v1/media', { id: 'm1', url: 'https://x.test/u?sig=1' }, file)).rejects.toThrow(/UP-500/);
  });
  it('redactUrl chi giu origin + duong dan', () => {
    expect(redactUrl('https://a.r2.cloudflarestorage.com/b/k.png?X-Amz-Signature=abc')).toBe('https://a.r2.cloudflarestorage.com/b/k.png?…');
  });
});
