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

describe('R2ObjectStore multipart (binding)', () => {
  it('createMultipartUpload -> resumeMultipartUpload(key, uploadId).uploadPart/complete/abort, phan luong di qua FixedLengthStream', async () => {
    const log: string[] = [];
    const bucket = {
      createMultipartUpload: async (key: string, o: any) => { log.push(`create ${key} ${o.httpMetadata.contentType}`); return { uploadId: 'U1' }; },
      resumeMultipartUpload: (key: string, id: string) => ({
        uploadPart: async (n: number, v: unknown) => { log.push(`part ${key} ${id} ${n} ${v instanceof Uint8Array ? 'bytes' : 'stream'}`); return { partNumber: n, etag: `e${n}` }; },
        complete: async (parts: unknown) => { log.push(`complete ${JSON.stringify(parts)}`); },
        abort: async () => { log.push(`abort ${id}`); throw new Error('da het han'); },
      }),
    };
    const s = new R2ObjectStore(bucket as never, { ...full, accessKeyId: '' });
    expect(await s.multipartCreate('k/a.mp4', 'video/mp4')).toEqual({ uploadId: 'U1' });
    expect(await s.multipartUploadPart('k/a.mp4', 'U1', 1, new Uint8Array([1, 2]), 2)).toEqual({ etag: 'e1' });
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([3])); c.close(); } });
    expect(await s.multipartUploadPart('k/a.mp4', 'U1', 2, body, 1)).toEqual({ etag: 'e2' });
    await s.multipartComplete('k/a.mp4', 'U1', [{ n: 2, etag: 'e2' }, { n: 1, etag: 'e1' }]);
    await s.multipartAbort('k/a.mp4', 'U1'); // loi abort bi nuot (idempotent)
    expect(log).toEqual(['create k/a.mp4 video/mp4', 'part k/a.mp4 U1 1 bytes', 'part k/a.mp4 U1 2 stream', 'complete [{"partNumber":1,"etag":"e1"},{"partNumber":2,"etag":"e2"}]', 'abort U1']);
    await expect(s.multipartUploadPart('k/a.mp4', 'U1', 3, new Uint8Array([1]), 5)).rejects.toThrow('part_size_mismatch');
  });
});
