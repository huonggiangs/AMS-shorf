// Bo test hop dong ObjectStore: chay CUNG mot bo cho MemoryObjectStore va FsObjectStore.
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryObjectStore, TestClock } from '../src/memory.js';
import { FsObjectStore } from '../src/fs.js';
import type { ObjectStore } from '../src/types.js';

const dirs: string[] = [];
const clock = new TestClock('2026-01-01T00:00:00Z');
const enc = (s: string) => new TextEncoder().encode(s);

const factories: [string, () => Promise<ObjectStore>][] = [
  ['memory', async () => new MemoryObjectStore(clock)],
  ['fs', async () => {
    const d = await mkdtemp(join(tmpdir(), 'ams-fs-'));
    dirs.push(d);
    return new FsObjectStore({ dir: join(d, 'objects'), signingSecret: 'test-secret', clock });
  }],
];
afterAll(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

describe.each(factories)('ObjectStore contract: %s', (_n, make) => {
  it('put/get/head khop nhau, ghi de duoc, khoa khong ton tai tra null', async () => {
    const s = await make();
    expect(await s.get('media/c1/a.png')).toBeNull();
    expect(await s.head('media/c1/a.png')).toBeNull();
    await s.put('media/c1/a.png', new Uint8Array([1, 2, 3]), 'image/png');
    expect(Array.from((await s.get('media/c1/a.png'))!)).toEqual([1, 2, 3]);
    expect(await s.head('media/c1/a.png')).toEqual({ size: 3, contentType: 'image/png' });
    await s.put('media/c1/a.png', new Uint8Array([9]), 'image/jpeg');
    expect(await s.head('media/c1/a.png')).toEqual({ size: 1, contentType: 'image/jpeg' });
  });
  it('get tra ban sao: sua ket qua khong doi du lieu da luu', async () => {
    const s = await make();
    await s.put('k/x.bin', new Uint8Array([5, 5]), 'application/octet-stream');
    (await s.get('k/x.bin'))![0] = 0;
    expect((await s.get('k/x.bin'))![0]).toBe(5);
  });
  it('tep rong va tep lon', async () => {
    const s = await make();
    await s.put('k/empty', new Uint8Array(0), 'text/plain');
    expect(await s.head('k/empty')).toEqual({ size: 0, contentType: 'text/plain' });
    const big = new Uint8Array(3 * 1024 * 1024).fill(7);
    await s.put('k/big.mp4', big, 'video/mp4');
    expect((await s.head('k/big.mp4'))!.size).toBe(big.length);
    expect((await s.get('k/big.mp4'))![big.length - 1]).toBe(7);
  });
  it('delete idempotent; list theo tien to chuoi, co thu tu va gioi han', async () => {
    const s = await make();
    for (const k of ['renditions/c1/a/x.mp4', 'renditions/c1/b/y.mp4', 'renditions/c2/z.mp4', 'media/c1/o.png']) await s.put(k, enc(k), 'x/y');
    expect((await s.list!('renditions/c1')).map((e) => e.key)).toEqual(['renditions/c1/a/x.mp4', 'renditions/c1/b/y.mp4']);
    expect((await s.list!('renditions/')).length).toBe(3);
    expect((await s.list!('ren')).length).toBe(3);
    expect((await s.list!('', 2)).length).toBe(2);
    expect((await s.list!('renditions/c1/a/x.mp4'))[0]).toEqual({ key: 'renditions/c1/a/x.mp4', size: 'renditions/c1/a/x.mp4'.length });
    await s.delete!('renditions/c1/a/x.mp4');
    await s.delete!('renditions/c1/a/x.mp4'); // lan hai khong loi
    await s.delete!('khong/ton/tai');
    expect(await s.head('renditions/c1/a/x.mp4')).toBeNull();
    expect((await s.list!('renditions/c1')).map((e) => e.key)).toEqual(['renditions/c1/b/y.mp4']);
  });
  it('putSigned/getSigned tra URL va header Content-Type', async () => {
    const s = await make();
    const p = await s.putSigned('media/c1/a.mp4', 'video/mp4', 60, { maxBytes: 10 });
    expect(p.url).toContain('media/c1/a.mp4');
    expect(p.headers['Content-Type']).toBe('video/mp4');
    expect(await s.getSigned('media/c1/a.mp4', 60)).toContain('media/c1/a.mp4');
  });
  it('khoang trang, unicode, dau cham ben trong ten', async () => {
    const s = await make();
    const k = 'media/c1/01HX/ten tep (1) - Quang cao.v2.mp4';
    await s.put(k, enc('v'), 'video/mp4');
    expect((await s.head(k))!.size).toBe(1);
    const k2 = 'media/c1/01HX/quảng-cáo.png';
    await s.put(k2, enc('vv'), 'image/png');
    expect((await s.get(k2))!.length).toBe(2);
  });
});

describe('FsObjectStore: an toan duong dan, ghi nguyen tu, URL ky', () => {
  const mk = async () => {
    const d = await mkdtemp(join(tmpdir(), 'ams-fs-'));
    dirs.push(d);
    const s = new FsObjectStore({ dir: join(d, 'objects'), signingSecret: 'sek', clock });
    return { d, s, root: join(d, 'objects') };
  };

  it.each(['../x', 'a/../../x', '/etc/passwd', 'a//b', 'a/./b', '.meta/x', 'a/.hidden', 'a\\b', 'a/b/', '', 'a\0b', 'x'.repeat(1025)])('tu choi khoa nguy hiem %j', async (k) => {
    const { s, d } = await mk();
    await expect(s.put(k, enc('x'), 'text/plain')).rejects.toThrow();
    await expect(s.get(k)).rejects.toThrow();
    await expect(s.head(k)).rejects.toThrow();
    await expect(s.delete(k)).rejects.toThrow();
    await expect(s.putSigned(k, 'text/plain', 5)).rejects.toThrow();
    // khong co gi bi ghi ra ngoai goc
    expect((await readdir(d)).filter((n) => n !== 'objects')).toEqual([]);
  });

  it('khong doc/ghi xuyen symlink thoat goc', async () => {
    const { s, d, root } = await mk();
    await s.put('a/ok.txt', enc('ok'), 'text/plain');
    const outside = join(d, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(root, 'link'));
    await expect(s.get('link/secret.txt')).rejects.toThrow();
    await expect(s.put('link/new.txt', enc('x'), 'text/plain')).rejects.toThrow();
    expect((await readdir(outside)).sort()).toEqual(['secret.txt']);
  });

  it('ghi nguyen tu: khong con tep tam, doc dong thoi chi thay ban cu hoac ban moi day du', async () => {
    const { s, root } = await mk();
    const a = new Uint8Array(512 * 1024).fill(1);
    const b = new Uint8Array(512 * 1024).fill(2);
    await s.put('k/f.bin', a, 'application/octet-stream');
    let bad = 0;
    let stop = false;
    const reader = (async () => {
      while (!stop) {
        const g = await s.get('k/f.bin');
        if (!g || g.length !== a.length || new Set([g[0], g[g.length - 1], g[1000]]).size !== 1) bad++;
      }
    })();
    for (let i = 0; i < 20; i++) await s.put('k/f.bin', i % 2 ? a : b, 'application/octet-stream');
    stop = true;
    await reader;
    expect(bad).toBe(0);
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('ghi song song nhieu khoa khac nhau', async () => {
    const { s } = await mk();
    await Promise.all(Array.from({ length: 30 }, (_, i) => s.put(`p/${i}/f.bin`, enc(String(i)), 'text/plain')));
    expect((await s.list('p/')).length).toBe(30);
  });

  it('content-type: sidecar giu nguyen; tep chep tay khong co sidecar suy ra tu duoi tep', async () => {
    const { s, root } = await mk();
    await s.put('m/a.bin', enc('x'), 'video/mp4; codecs="avc1"');
    expect((await s.head('m/a.bin'))!.contentType).toBe('video/mp4; codecs="avc1"');
    await mkdir(join(root, 'renditions'), { recursive: true });
    await writeFile(join(root, 'renditions', 'hand.webm'), 'x');
    await writeFile(join(root, 'renditions', 'noext'), 'x');
    expect((await s.head('renditions/hand.webm'))!.contentType).toBe('video/webm');
    expect((await s.head('renditions/noext'))!.contentType).toBe('application/octet-stream');
    expect((await s.list('')).map((e) => e.key)).not.toContain('.meta');
    expect((await s.list('')).every((e) => !e.key.startsWith('.'))).toBe(true);
  });

  it('thu muc khong phai tep thi get/head tra null', async () => {
    const { s } = await mk();
    await s.put('d/e/f.txt', enc('x'), 'text/plain');
    expect(await s.get('d/e')).toBeNull();
    expect(await s.head('d')).toBeNull();
    expect(await s.get('d/e/f.txt/x')).toBeNull();
  });

  it('URL ky: dung, het han, sua khoa/loai/gioi han deu bi tu choi', async () => {
    const { s } = await mk();
    const p = await s.putSigned('media/c1/a.png', 'image/png', 900, { maxBytes: 1000 });
    const u = new URL(p.url, 'http://x');
    expect(u.pathname).toBe('/api/storage/upload/media/c1/a.png');
    expect(s.verifySigned('put', 'media/c1/a.png', u.searchParams)).toEqual({ ok: true, contentType: 'image/png', maxBytes: 1000 });
    expect(s.verifySigned('put', 'media/c1/b.png', u.searchParams).ok).toBe(false);
    expect(s.verifySigned('get', 'media/c1/a.png', u.searchParams).ok).toBe(false);
    const t1 = new URLSearchParams(u.searchParams); t1.set('ct', 'video/mp4');
    const t2 = new URLSearchParams(u.searchParams); t2.set('max', '999999');
    expect(s.verifySigned('put', 'media/c1/a.png', t1).ok).toBe(false);
    expect(s.verifySigned('put', 'media/c1/a.png', t2).ok).toBe(false);
    const g = new URL(await s.getSigned('media/c1/a.png', 300), 'http://x');
    expect(g.pathname).toBe('/api/storage/object/media/c1/a.png');
    expect(s.verifySigned('get', 'media/c1/a.png', g.searchParams).ok).toBe(true);
    clock.advance(301_000);
    expect(s.verifySigned('get', 'media/c1/a.png', g.searchParams)).toEqual({ ok: false, reason: 'expired' });
    expect(s.verifySigned('put', 'media/c1/a.png', new URLSearchParams()).reason).toBe('missing');
    clock.set('2026-01-01T00:00:00Z');
  });

  it('khoa ky khac nhau => chu ky khong dung cheo', async () => {
    const { s, root } = await mk();
    const other = new FsObjectStore({ dir: root, signingSecret: 'khac', clock });
    const u = new URL(await s.getSigned('a/b.png', 60), 'http://x');
    expect(other.verifySigned('get', 'a/b.png', u.searchParams).ok).toBe(false);
  });

  it('tao thu muc goc neu chua co va tep that nam duoi goc voi quyen doc', async () => {
    const { s, root } = await mk();
    await s.put('renditions/c/x/a.mp4', enc('hi'), 'video/mp4');
    expect(await readFile(join(root, 'renditions/c/x/a.mp4'), 'utf8')).toBe('hi');
  });
});
