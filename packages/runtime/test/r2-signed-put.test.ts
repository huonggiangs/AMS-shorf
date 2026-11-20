// R2ObjectStore: chi ky URL khi du khoa S3; thieu mot cai -> signedPut=false (API nhan tep qua Worker); putStream ghi thang luong vao binding.
import { describe, expect, it } from 'vitest';
import { R2ObjectStore } from '../src/cloudflare/r2.js';

const full = { accountId: 'acc', accessKeyId: 'ak', secretAccessKey: 'sk', bucketName: 'b' };
describe('R2ObjectStore.signedPut', () => {
  it('du 4 bien -> true; thieu / rong bat ky bien nao -> false', () => {
    expect(new R2ObjectStore({} as never, full).signedPut).toBe(true);
    for (const k of Object.keys(full)) expect(new R2ObjectStore({} as never, { ...full, [k]: '' }).signedPut, k).toBe(false);
    expect(new R2ObjectStore({} as never, { accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: 'b' }).signedPut).toBe(false);
    expect(new R2ObjectStore({} as never, { ...full, secretAccessKey: '  ' }).signedPut).toBe(false);
  });
  it('putStream chuyen luong vao bucket.put kem contentType (khong doc ca tep)', async () => {
    const calls: { key: string; body: unknown; opts: any }[] = [];
    const s = new R2ObjectStore({ put: async (key: string, body: unknown, opts: unknown) => { calls.push({ key, body, opts }); } } as never, { ...full, accessKeyId: '' });
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); } });
    await s.putStream('k/a.png', body, 'image/png', 2);
    expect(calls[0]!.key).toBe('k/a.png');
    expect(calls[0]!.opts).toEqual({ httpMetadata: { contentType: 'image/png' } });
    expect(calls[0]!.body).toBeInstanceOf(ReadableStream);
  });
});
