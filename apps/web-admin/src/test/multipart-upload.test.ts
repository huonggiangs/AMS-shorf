// Tai tep lon TUNG PHAN: chia phan bang Blob.slice, thu lai 3 lan/phan voi lui dan, tien do %, huy, tiep tuc phien, ma loi UP-PART-<n>-<status>.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MULTIPART_BACKOFF_MS, MULTIPART_RETRIES, MULTIPART_THRESHOLD, UploadError, uploadMultipart, type PartSender, type UploadProgress } from '../lib/multipart';
import { uploadToStore } from '../pages/MediaPage';
import { isElevatorDims, videoLimitMb } from '../lib/creative';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
interface Call { method: string; path: string; body: any }
/** fetch gia lap cho init/complete/abort (cac phan di qua `sender`). */
function stubApi(init: Record<string, unknown>, opts: { completeStatus?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, req?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    calls.push({ method: req?.method ?? 'GET', path, body: req?.body ? JSON.parse(String(req.body)) : null });
    if (path.endsWith('/multipart/complete')) return opts.completeStatus && opts.completeStatus !== 200 ? json(opts.completeStatus, { error: { code: 'parts_missing', message: 'Còn thiếu phần.' } }) : json(200, { ok: true });
    if (path.endsWith('/multipart/abort')) return json(200, { ok: true, aborted: true });
    if (path.endsWith('/multipart')) return json(201, init);
    return json(404, {});
  }));
  return calls;
}
const readBuf = (b: Blob) => new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b); });
const file = (n: number) => new File([new Uint8Array(n).map((_, i) => i % 251)], 'v.mp4', { type: 'video/mp4' });
const base = { upload_id: 'U1', part_size: 40, total_parts: 3, size_bytes: 100, parts: [] as { n: number; etag: string; size: number }[] };
const ok = (n: number) => ({ status: 200, json: { ok: true, n, etag: `"e${n}"` } });

describe('uploadMultipart', () => {
  it('chia dung phan bang Blob.slice, gui tuan tu theo thu tu 1..N, complete kem etag dung thu tu, tien do 0 -> 100%', async () => {
    const calls = stubApi(base);
    const sent: { url: string; size: number; first: number }[] = [];
    const sender: PartSender = async (url, blob, o) => {
      sent.push({ url, size: blob.size, first: new Uint8Array(await readBuf(blob))[0]! });
      o.onBytes(Math.floor(blob.size / 2)); // tien do trong phan
      return ok(sent.length);
    };
    const prog: UploadProgress[] = [];
    await uploadMultipart('/admin/v1/media', 'm1', file(100), { sender, onProgress: (p) => prog.push(p), sleep: async () => undefined });
    expect(sent.map((s) => s.size)).toEqual([40, 40, 20]);
    expect(sent.map((s) => s.url)).toEqual(['/api/admin/v1/media/m1/parts/1', '/api/admin/v1/media/m1/parts/2', '/api/admin/v1/media/m1/parts/3']);
    expect(sent.map((s) => s.first)).toEqual([0, 40, 80]); // noi dung moi phan dung vi tri
    const complete = calls.find((c) => c.path.endsWith('/multipart/complete'))!;
    expect(complete.body).toEqual({ parts: [{ n: 1, etag: '"e1"' }, { n: 2, etag: '"e2"' }, { n: 3, etag: '"e3"' }] });
    expect(prog[0]).toMatchObject({ loaded: 0, percent: 0, totalParts: 3 });
    expect(prog.at(-1)).toMatchObject({ loaded: 100, total: 100, percent: 100 });
    for (let i = 1; i < prog.length; i++) expect(prog[i]!.loaded).toBeGreaterThanOrEqual(prog[i - 1]!.loaded); // tien do khong lui
    expect(prog.some((p) => p.percent > 0 && p.percent < 100)).toBe(true);
  });

  it('thu lai moi phan toi da 3 lan voi lui dan (1s, 2s, 4s): 502 hai lan roi thanh cong', async () => {
    expect([MULTIPART_RETRIES, ...MULTIPART_BACKOFF_MS]).toEqual([3, 1000, 2000, 4000]);
    stubApi(base);
    let tries2 = 0;
    const sleeps: number[] = [];
    const sender: PartSender = async (_u, _b, _o) => {
      const n = [..._u.matchAll(/parts\/(\d+)/g)][0]![1];
      if (n === '2' && tries2++ < 2) return { status: 502, json: { error: { code: 'part_failed', message: 'x' } } };
      return ok(Number(n));
    };
    await uploadMultipart('/admin/v1/media', 'm1', file(100), { sender, sleep: async (ms) => { sleeps.push(ms); } });
    expect(tries2).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('het 3 lan thu van loi: ma UP-PART-<n>-<status>, noi ro phan n/N, KHONG goi complete va KHONG huy phien (de tai lai tiep tuc)', async () => {
    const calls = stubApi(base);
    let n2 = 0;
    const sender: PartSender = async (u) => (u.endsWith('/2') ? (n2++, { status: 503, json: { error: { message: 'Máy chủ bận' } } }) : ok(Number(u.split('/').pop())));
    const err = await uploadMultipart('/admin/v1/media', 'm1', file(100), { sender, sleep: async () => undefined }).catch((e) => e as UploadError) as UploadError;
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe('UP-PART-2-503');
    expect(err.message).toMatch(/phần 2\/3/);
    expect(err.message).toMatch(/UP-PART-2-503/);
    expect(err.message).toMatch(/Máy chủ bận/);
    expect(n2).toBe(1 + MULTIPART_RETRIES);
    expect(calls.some((c) => c.path.endsWith('/multipart/complete'))).toBe(false);
    expect(calls.some((c) => c.path.endsWith('/multipart/abort'))).toBe(false);
  });

  it('loi mang: UP-PART-<n>-NET; loi 4xx (403/409/422) khong thu lai', async () => {
    stubApi(base);
    let calls = 0;
    const net: PartSender = async () => { calls++; throw new TypeError('Failed to fetch'); };
    const e1 = await uploadMultipart('/admin/v1/media', 'm1', file(100), { sender: net, sleep: async () => undefined }).catch((e) => e as UploadError) as UploadError;
    expect(e1.code).toBe('UP-PART-1-NET');
    expect(calls).toBe(1 + MULTIPART_RETRIES);
    for (const st of [403, 409, 422, 400]) {
      let c = 0;
      const sender: PartSender = async () => { c++; return { status: st, json: { error: { message: 'Từ chối' } } }; };
      const e = await uploadMultipart('/admin/v1/media', 'm1', file(100), { sender, sleep: async () => undefined }).catch((x) => x as UploadError) as UploadError;
      expect(e.code, String(st)).toBe(`UP-PART-1-${st}`);
      expect(c, String(st)).toBe(1);
    }
  });

  it('huy giua chung: UP-ABORT, goi POST /multipart/abort, khong tai tiep phan sau', async () => {
    const calls = stubApi(base);
    const ctl = new AbortController();
    const sent: number[] = [];
    const sender: PartSender = async (u) => {
      const n = Number(u.split('/').pop());
      sent.push(n);
      if (n === 1) ctl.abort(); // nguoi dung bam huy sau khi phan 1 xong
      return ok(n);
    };
    const err = await uploadMultipart('/admin/v1/media', 'm1', file(100), { sender, signal: ctl.signal, sleep: async () => undefined }).catch((e) => e as UploadError) as UploadError;
    expect(err.code).toBe('UP-ABORT');
    expect(sent).toEqual([1]);
    expect(calls.some((c) => c.path.endsWith('/multipart/abort'))).toBe(true);
    expect(calls.some((c) => c.path.endsWith('/multipart/complete'))).toBe(false);
  });

  it('tiep tuc phien: phan da co o may chu khong gui lai, tien do bat dau tu phan da xong', async () => {
    const calls = stubApi({ ...base, parts: [{ n: 1, etag: '"old1"', size: 40 }] });
    const sent: number[] = [];
    const prog: UploadProgress[] = [];
    const sender: PartSender = async (u) => { const n = Number(u.split('/').pop()); sent.push(n); return ok(n); };
    await uploadMultipart('/admin/v1/media', 'm1', file(100), { sender, onProgress: (p) => prog.push(p), sleep: async () => undefined });
    expect(sent).toEqual([2, 3]);
    expect(prog[0]).toMatchObject({ loaded: 40, percent: 40 });
    expect(calls.find((c) => c.path.endsWith('/multipart/complete'))!.body.parts).toEqual([{ n: 1, etag: '"old1"' }, { n: 2, etag: '"e2"' }, { n: 3, etag: '"e3"' }]);
  });

  it('complete that bai (422): ma UP-COMPLETE-422 kem thong bao cua may chu; khoi tao that bai: UP-INIT-<status>', async () => {
    stubApi(base, { completeStatus: 422 });
    const sender: PartSender = async (u) => ok(Number(u.split('/').pop()));
    const e = await uploadMultipart('/admin/v1/media', 'm1', file(100), { sender, sleep: async () => undefined }).catch((x) => x as UploadError) as UploadError;
    expect(e.code).toBe('UP-COMPLETE-422');
    expect(e.message).toMatch(/Còn thiếu phần/);
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: { code: 'upload_expired', message: 'Phiên tải lên đã hết hạn.' } })));
    const e2 = await uploadMultipart('/admin/v1/media', 'm1', file(100), { sender, sleep: async () => undefined }).catch((x) => x as UploadError) as UploadError;
    expect(e2.code).toBe('UP-INIT-409');
    expect(e2.message).toMatch(/hết hạn/);
  });
});

describe('uploadToStore + gioi han', () => {
  it('via=multipart di qua uploadMultipart (khong PUT /content)', async () => {
    const calls = stubApi(base);
    const urls: string[] = [];
    await uploadToStore('/admin/v1/media', { id: 'm9', url: '/api/admin/v1/media/m9/multipart', via: 'multipart' }, file(100), { sender: async (u) => { urls.push(u); return ok(Number(u.split('/').pop())); }, sleep: async () => undefined });
    expect(urls).toHaveLength(3);
    expect(calls.some((c) => c.path.endsWith('/content'))).toBe(false);
  });
  it('nguong va tran: > 90 MB tai tung phan; video thang may 200 MB, TV/LED 100 MB', () => {
    expect(MULTIPART_THRESHOLD).toBe(90 * 1048576);
    expect(isElevatorDims(2160, 3840)).toBe(true);
    expect(isElevatorDims(720, 1280)).toBe(true);
    expect(isElevatorDims(1920, 1080)).toBe(false);
    expect(isElevatorDims(2400, 4267)).toBe(false);
    expect(videoLimitMb(2160, 3840)).toBe(200);
    expect(videoLimitMb(1080, 1920)).toBe(200);
    expect(videoLimitMb(1920, 1080)).toBe(100);
    expect(videoLimitMb(undefined, undefined)).toBe(100);
  });
});
