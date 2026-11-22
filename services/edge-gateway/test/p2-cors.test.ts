// P2 (R1 CORS review): viewer routes khong cho `*`/`null` ngoai local/test, chi dung danh sach VIEWER_CORS_ORIGINS, luon Vary: Origin.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewerCors } from '../src/viewer.js';
import { harness, type Harness } from './helpers.js';

const open: Harness[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); vi.restoreAllMocks(); });
const pre = (h: Harness, origin: string, path = '/v1/wallet') => h.gw.app.request(path, { method: 'OPTIONS', headers: { origin } });

describe('P2 CORS viewer', () => {
  it('viewerCors: tat khi khong cau hinh; o production bo qua * va null (chi giu origin cu the)', () => {
    expect(viewerCors({})).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(viewerCors({ AMS_ENV: 'production', VIEWER_CORS_ORIGINS: '*' })).toBeNull();
    expect(viewerCors({ AMS_ENV: 'staging', VIEWER_CORS_ORIGINS: 'null' })).toBeNull();
    expect(viewerCors({ RUNTIME: 'cloudflare', VIEWER_CORS_ORIGINS: '*' })).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(viewerCors({ AMS_ENV: 'production', VIEWER_CORS_ORIGINS: '*, https://localhost' })).not.toBeNull();
    // gia tri co duong dan/ky tu dai dien khong hop le
    expect(viewerCors({ AMS_ENV: 'production', VIEWER_CORS_ORIGINS: 'https://*.example.com,https://a.example/x' })).toBeNull();
  });

  it('production: chi origin trong danh sach nhan Access-Control-Allow-Origin; * khong con la wildcard; khong co credentials', async () => {
    const h = await harness({ env: { AMS_ENV: 'production', FIELD_ENC_KEY: Buffer.alloc(32, 7).toString('base64'), SEPAY_WEBHOOK_SECRET: 'x'.repeat(32), VIEWER_CORS_ORIGINS: '*,https://localhost,capacitor://localhost' } });
    open.push(h);
    const ok = await pre(h, 'https://localhost');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://localhost');
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    expect(ok.headers.get('vary')).toContain('Origin');
    expect((await pre(h, 'capacitor://localhost')).status).toBe(204);
    for (const evil of ['https://evil.test', 'null', 'https://localhost.evil.test', 'http://localhost']) {
      const r = await pre(h, evil);
      expect(r.status).toBe(403);
      expect(r.headers.get('access-control-allow-origin')).toBeNull();
      expect(r.headers.get('access-control-allow-headers')).toBeNull();
    }
    // yeu cau that tu origin la: khong co header CORS
    const real = await h.gw.app.request('/v1/wallet', { headers: { origin: 'https://evil.test' } });
    expect(real.headers.get('access-control-allow-origin')).toBeNull();
    expect(real.headers.get('vary')).toContain('Origin');
  });

  it('local/test: * van dung duoc cho dev', async () => {
    const h = await harness({ env: { VIEWER_CORS_ORIGINS: '*' } });
    open.push(h);
    expect((await pre(h, 'https://anything.test')).headers.get('access-control-allow-origin')).toBe('https://anything.test');
  });
});

describe('P2 gioi han toc do va TRUST_PROXY', () => {
  it('manifest cong khai: gioi han theo IP, tra 429 + retry-after', async () => {
    const h = await harness({ env: { MANIFEST_PUBLIC_LIMIT_PER_MIN: '3' } });
    open.push(h);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await h.gw.app.request('/v1/manifest/g/ALL.all.tv', { headers: { 'x-forwarded-for': '1.2.3.4' } })).status);
    expect(codes.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(codes[3]).toBe(429);
    // IP khac co bo dem rieng
    expect((await h.gw.app.request('/v1/manifest/g/ALL.all.tv', { headers: { 'x-forwarded-for': '5.6.7.8' } })).status).not.toBe(429);
    const r = await h.gw.app.request('/v1/manifest/g/ALL.all.tv', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    expect(r.headers.get('retry-after')).toBeTruthy();
  });

  it('TRUST_PROXY=0: header IP do client dat khong tao bo dem rieng (khong xoay IP de ne gioi han)', async () => {
    const h = await harness({ env: { MANIFEST_PUBLIC_LIMIT_PER_MIN: '3', TRUST_PROXY: '0' } });
    open.push(h);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await h.gw.app.request('/v1/manifest/g/ALL.all.tv', { headers: { 'x-forwarded-for': `9.9.9.${i}` } })).status);
    expect(codes[3]).toBe(429);
    expect(codes[4]).toBe(429);
  });
});
