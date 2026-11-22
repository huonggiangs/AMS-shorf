import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRuntime, type TestRuntime } from '@ams/runtime';
import { FakeMedia, FfmpegTools } from '../src/media.js';
import { MEDIA_TOPIC, createMediaWorker } from '../src/worker.js';
import { sniff } from '../src/sniff.js';

const NOW = '2026-01-01T00:00:00.000Z';
const hasFf = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

let rt: TestRuntime;
let n = 0;
beforeAll(async () => {
  rt = await createTestRuntime({ dialect: 'sqlite' });
  await rt.db.run("INSERT INTO tenants (id, name, created_at) VALUES ('T1','t',?)", [NOW]).catch(() => {});
  await rt.db.run("INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, created_at) VALUES ('C1','T1','k','k','K1','active',?)", [NOW]);
});
afterAll(() => rt.close());

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function seed(bytes: Uint8Array, o: { mime?: string; target?: string | null; w?: number | null; h?: number | null; state?: string } = {}): Promise<string> {
  const id = `CR${++n}`;
  const key = `media/C1/${id}/f.bin`;
  await rt.objects.put(key, bytes, o.mime ?? 'image/png');
  await rt.db.run(
    `INSERT INTO creatives (id, customer_id, name, target_type, px_w, px_h, kind, source, storage_key, mime, size_bytes, scan_state, review_state, state, created_at)
     VALUES (?,?,?,?,?,?,?, 'upload', ?,?,?, 'pending','pending',?,?)`,
    [id, 'C1', 'f', o.target === undefined ? 'tv' : o.target, o.w ?? null, o.h ?? null, 'image', key, o.mime ?? 'image/png', bytes.length, o.state ?? 'pending_review', NOW],
  );
  return id;
}
const row = async (id: string) => (await rt.db.query<Record<string, unknown>>('SELECT * FROM creatives WHERE id = ?', [id]))[0]!;

describe('sniff', () => {
  it('nhan dien magic bytes', () => {
    expect(sniff(PNG)).toBe('png');
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniff(Buffer.from('\0\0\0\x18ftypmp42'))).toBe('mp4');
    expect(sniff(Buffer.from('MZ\x90\0'))).toBeNull();
  });
});

describe('media worker (ban gia)', () => {
  const mk = (o: Parameters<typeof createMediaWorker>[1] = {}) => createMediaWorker(rt, { media: new FakeMedia({ probe: { kind: 'image', width: 1, height: 1, durationS: null, codec: 'png', hasAudio: false, bitrate: null } }), ...o });

  it('tep sach: scan_state=clean, sha256 dung, idempotent', async () => {
    const id = await seed(PNG);
    const w = mk();
    expect((await w.process(id)).outcome).toBe('processed');
    const r = await row(id);
    expect(r['scan_state']).toBe('clean');
    expect(r['sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(r['codec']).toBe('png');
    expect((await w.process(id)).outcome).toBe('skipped');
  });

  it('tep qua kiem tra cau truc => clean ngay (khong con quet virus)', async () => {
    const id = await seed(PNG);
    expect((await mk().process(id)).scan_state).toBe('clean');
    expect((await row(id))['scan_state']).toBe('clean');
  });

  it('tu choi: sai magic bytes, lech MIME, qua lon, kich thuoc that khac khai bao', async () => {
    const w = mk();
    expect((await w.process(await seed(Buffer.from('MZ not media')))).code).toBe('unsupported_type');
    expect((await w.process(await seed(PNG, { mime: 'image/jpeg' }))).code).toBe('content_type_mismatch');
    expect((await w.process(await seed(PNG, { w: 1920, h: 1080 }))).code).toBe('creative_size_mismatch');
    const big = await seed(PNG, { target: 'elevator' });
    const w2 = mk({ maxBytes: 10 });
    expect((await w2.process(big)).code).toBe('file_too_large');
  });

  it('chua confirm (uploading) thi hoan lai; sweep va hang doi xu ly tep pending', async () => {
    const up = await seed(PNG, { state: 'uploading' });
    const w = mk();
    expect((await w.process(up)).outcome).toBe('deferred');
    const a = await seed(PNG);
    const b = await seed(PNG);
    w.subscribe();
    await rt.queue.send(MEDIA_TOPIC, { creative_id: a });
    await new Promise((r) => setTimeout(r, 100));
    expect((await row(a))['scan_state']).toBe('clean');
    expect(await w.sweep()).toBeGreaterThanOrEqual(1);
    expect((await row(b))['scan_state']).toBe('clean');
    expect((await row(up))['scan_state']).toBe('pending');
  });

  it('chuyen ma that bai khong lam hong creative; rendition duoc luu khi thanh cong', async () => {
    const id = await seed(PNG);
    const rend = { profile: 'tv-safe-webp', ext: 'webp', contentType: 'image/webp', body: new Uint8Array([1, 2, 3]), width: 1, height: 1, codec: 'webp' };
    await mk({ media: new FakeMedia({ renditions: [rend], probe: { kind: 'image', width: 1, height: 1, durationS: null, codec: 'png', hasAudio: false, bitrate: null } }) }).process(id);
    expect(await rt.objects.head(`renditions/C1/${id}/tv-safe-webp.webp`)).not.toBeNull();
    expect(await rt.objects.head(`renditions/C1/${id}/manifest.json`)).not.toBeNull();
  });
});

describe.skipIf(!hasFf)('ffmpeg that', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const gen = (name: string, args: string[]) => { const f = join(dir, name); execFileSync('ffmpeg', ['-y', '-v', 'error', ...args, f]); return new Uint8Array(readFileSync(f)); };

  it('probe + chuyen ma video thang may ve H.264 mp4 1080x1920, bo am thanh', async () => {
    const mp4 = gen('in.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=15:duration=11', '-f', 'lavfi', '-i', 'sine=duration=11', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest']);
    const id = `CR${++n}`;
    const key = `media/C1/${id}/v.mp4`;
    await rt.objects.put(key, mp4, 'video/mp4');
    await rt.db.run(
      `INSERT INTO creatives (id, customer_id, name, target_type, px_w, px_h, kind, source, storage_key, mime, size_bytes, scan_state, review_state, state, created_at)
       VALUES (?,'C1','v','elevator',1080,1920,'video','upload',?,'video/mp4',?,'pending','pending','pending_review',?)`,
      [id, key, mp4.length, NOW],
    );
    const w = createMediaWorker(rt, { media: new FfmpegTools() });
    expect((await w.process(id)).outcome).toBe('processed');
    const r = await row(id);
    expect(r['scan_state']).toBe('clean');
    expect(r['codec']).toBe('mpeg4');
    expect(r['duration_s']).toBe(11);
    const out = await rt.objects.get(`renditions/C1/${id}/tv-safe-h264.mp4`);
    expect(out).not.toBeNull();
    const p = await new FfmpegTools().probe(out!, 'mp4');
    expect(p).toMatchObject({ codec: 'h264', width: 1080, height: 1920, hasAudio: false });
  });

  it('anh PNG that -> webp; tep gia mao (magic PNG, ruot rac) bi tu choi', async () => {
    const png = gen('in.png', ['-f', 'lavfi', '-i', 'testsrc=size=1920x1080', '-frames:v', '1']);
    const id = await seed(png, { w: 1920, h: 1080 });
    const w = createMediaWorker(rt, { media: new FfmpegTools() });
    expect((await w.process(id)).outcome).toBe('processed');
    expect(await rt.objects.head(`renditions/C1/${id}/tv-safe-webp.webp`)).not.toBeNull();
    const fake = await seed(Buffer.concat([PNG.subarray(0, 8), Buffer.from('garbage garbage garbage')]));
    expect((await w.process(fake)).code).toBe('unreadable_media');
  });
});

describe('kho chung (tai len noi bo): moi dinh dang/codec, chuyen ma THAY tep goc', () => {
  async function seedLib(bytes: Uint8Array, name: string, mime: string): Promise<string> {
    const id = `CR${++n}`;
    const key = `media/C1/${id}/${name}`;
    await rt.objects.put(key, bytes, mime);
    await rt.db.run(
      `INSERT INTO creatives (id, customer_id, name, target_type, px_w, px_h, kind, source, storage_key, mime, size_bytes, uploader_kind, scan_state, review_state, state, created_at)
       VALUES (?,?,?,NULL,NULL,NULL,'video','upload',?,?,?,'internal','pending','pending','pending_review',?)`,
      [id, 'C1', name, key, mime, bytes.length, NOW],
    );
    return id;
  }
  const probeOf = (codec: string, w = 1920, h = 1080, dur = 120) => ({ kind: 'video' as const, width: w, height: h, durationS: dur, codec, hasAudio: true, bitrate: 4_000_000 });

  it('AVI/HEVC: khong rang buoc loai man/thoi luong (120 s, 1920x1080); chuyen sang MP4 H.264, THAY storage_key/mime, xoa tep goc, clean', async () => {
    const id = await seedLib(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 'phim.avi', 'video/x-msvideo');
    const fake = new FakeMedia({ probe: probeOf('hevc') });
    const w = createMediaWorker(rt, { media: fake });
    expect((await w.process(id)).outcome).toBe('processed');
    const r = await row(id);
    expect(r['scan_state']).toBe('clean');
    expect(r['mime']).toBe('video/mp4');
    expect(String(r['storage_key'])).toMatch(/v1-playable\.mp4$/);
    expect(r['px_w']).toBe(1280); // thong so tu ban chuyen ma (FakeMedia)
    expect(r['codec']).toBe('h264');
    expect(await rt.objects.head(`media/C1/${id}/phim.avi`)).toBeNull();
    expect(await rt.objects.head(String(r['storage_key']))).not.toBeNull();
    expect(fake.transcodes).toBe(1);
  });
  it('MP4 H.264 san co: khong chuyen ma lai, chi ghi kich thuoc/thoi luong that', async () => {
    const id = await seedLib(Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0mp42isom'), 'ok.mp4', 'video/mp4');
    const fake = new FakeMedia({ probe: probeOf('h264', 1080, 1920, 45) });
    await createMediaWorker(rt, { media: fake }).process(id);
    const r = await row(id);
    expect(fake.transcodes).toBe(0);
    expect(r).toMatchObject({ scan_state: 'clean', px_w: 1080, px_h: 1920, orientation: 'portrait', duration_s: 45 });
    expect(String(r['storage_key'])).toMatch(/ok\.mp4$/);
  });
  it('khong co ffmpeg: cho duyet thu cong voi ly do ro rang (khong tu choi, khong ket vinh vien o pending)', async () => {
    const id = await seedLib(new Uint8Array([9, 9, 9]), 'x.mkv', 'video/x-matroska');
    const res = await createMediaWorker(rt, { media: new FakeMedia({ unavailable: true }) }).process(id);
    expect(res.outcome).toBe('processed');
    const r = await row(id);
    expect(r['scan_state']).toBe('needs_manual_review');
    expect(String(r['review_note'])).toContain('media-worker');
  });
  it('tep khong doc duoc: tu choi voi thong bao tieng Viet', async () => {
    const id = await seedLib(new Uint8Array([0, 1]), 'hong.flv', 'video/x-flv');
    const res = await createMediaWorker(rt, { media: new FakeMedia({ probe: new Error('invalid data') }) }).process(id);
    expect(res.outcome).toBe('rejected');
    expect(res.code).toBe('unreadable_media');
  });
  it('chuyen ma loi: cho duyet thu cong, giu tep goc', async () => {
    const id = await seedLib(new Uint8Array([1, 2, 3]), 'l.rmvb', 'video/vnd.rn-realvideo');
    const bad = new FakeMedia({ probe: probeOf('rv40') });
    bad.toPlayableMp4 = async () => { throw new Error('ffmpeg crashed'); };
    await createMediaWorker(rt, { media: bad }).process(id);
    const r = await row(id);
    expect(r['scan_state']).toBe('needs_manual_review');
    expect(await rt.objects.head(`media/C1/${id}/l.rmvb`)).not.toBeNull();
  });
});

describe.skipIf(!hasFf)('kho chung voi ffmpeg that', () => {
  it.each([['avi', 'mpeg4'], ['mkv', 'libx265'], ['flv', 'flv'], ['webm', 'libvpx-vp9']])('chuyen .%s (%s) sang MP4 H.264 phat duoc', async (ext, codec) => {
    const dir = mkdtempSync(join(tmpdir(), 'lib-'));
    try {
      const f = join(dir, `in.${ext}`);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', codec, ...(ext === 'flv' ? ['-c:a', 'mp3'] : ext === 'webm' ? ['-c:a', 'libopus'] : ['-c:a', 'aac']), '-shortest', f], { stdio: 'ignore' });
      const bytes = readFileSync(f);
      const id = `CR${++n}`;
      const key = `media/C1/${id}/in.${ext}`;
      await rt.objects.put(key, bytes, 'video/x-test');
      await rt.db.run(
        `INSERT INTO creatives (id, customer_id, name, kind, source, storage_key, mime, size_bytes, uploader_kind, scan_state, review_state, state, created_at) VALUES (?,?,?,'video','upload',?,?,?,'internal','pending','pending','pending_review',?)`,
        [id, 'C1', `in.${ext}`, key, 'video/x-test', bytes.length, NOW],
      );
      const w = createMediaWorker(rt, { media: new FfmpegTools({ threads: 1 }) });
      expect((await w.process(id)).outcome).toBe('processed');
      const r = await row(id);
      expect(r).toMatchObject({ scan_state: 'clean', mime: 'video/mp4', px_w: 320, px_h: 180, codec: 'h264' });
      const out = await rt.objects.get(String(r['storage_key']));
      expect(sniff(out!)).toBe('mp4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
