import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRuntime, type TestRuntime } from '@ams/runtime';
import { ClamdScanner, FakeScanner } from '../src/clamav.js';
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
  const mk = (o: Parameters<typeof createMediaWorker>[1] = {}) => createMediaWorker(rt, { scanner: new FakeScanner(), media: new FakeMedia({ probe: { kind: 'image', width: 1, height: 1, durationS: null, codec: 'png', hasAudio: false, bitrate: null } }), ...o });

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

  it('EICAR: infected + tu choi, khong bao gio clean', async () => {
    const eicar = Buffer.concat([PNG, Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')]);
    const id = await seed(eicar);
    const res = await mk().process(id);
    expect(res).toMatchObject({ outcome: 'rejected', code: 'malware_detected' });
    const r = await row(id);
    expect(r['scan_state']).toBe('infected');
    expect(r['review_state']).toBe('rejected');
    expect(r['state']).toBe('invalid');
  });

  it('clamd khong san sang: unscanned (khong phai clean); bat buoc thi giu pending', async () => {
    const id = await seed(PNG);
    expect((await mk({ scanner: new FakeScanner({ down: true }) }).process(id)).scan_state).toBe('unscanned');
    expect((await row(id))['scan_state']).toBe('unscanned');
    const id2 = await seed(PNG);
    expect((await mk({ scanner: new FakeScanner({ down: true }), clamRequired: true }).process(id2)).outcome).toBe('deferred');
    expect((await row(id2))['scan_state']).toBe('pending');
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

describe('clamd TCP adapter (server gia)', () => {
  function fakeClamd(reply: string) {
    return new Promise<{ port: number; got: Buffer[]; close(): void }>((resolve) => {
      const got: Buffer[] = [];
      const srv = createServer((s) => {
        let all = Buffer.alloc(0);
        s.on('data', (d) => {
          got.push(d);
          all = Buffer.concat([all, d]);
          if (all.subarray(-4).equals(Buffer.alloc(4))) s.end(reply + '\0');
        });
      });
      srv.listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as { port: number }).port, got, close: () => srv.close() }));
    });
  }
  it('OK / FOUND / loi / khong ket noi', async () => {
    const ok = await fakeClamd('stream: OK');
    expect(await new ClamdScanner({ host: '127.0.0.1', port: ok.port, chunkSize: 4 }).scan(Buffer.from('hello world'))).toEqual({ status: 'clean' });
    expect(Buffer.concat(ok.got).toString('latin1').startsWith('zINSTREAM\0')).toBe(true);
    ok.close();
    const bad = await fakeClamd('stream: Win.Test.EICAR_HDB-1 FOUND');
    expect(await new ClamdScanner({ host: '127.0.0.1', port: bad.port }).scan(Buffer.from('x'))).toEqual({ status: 'infected', signature: 'Win.Test.EICAR_HDB-1' });
    bad.close();
    const err = await fakeClamd('INSTREAM size limit exceeded. ERROR');
    expect((await new ClamdScanner({ host: '127.0.0.1', port: err.port }).scan(Buffer.from('x'))).status).toBe('unavailable');
    err.close();
    expect((await new ClamdScanner({ host: '127.0.0.1', port: 1, timeoutMs: 500 }).scan(Buffer.from('x'))).status).toBe('unavailable');
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
    const w = createMediaWorker(rt, { scanner: new FakeScanner(), media: new FfmpegTools() });
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
    const w = createMediaWorker(rt, { scanner: new FakeScanner(), media: new FfmpegTools() });
    expect((await w.process(id)).outcome).toBe('processed');
    expect(await rt.objects.head(`renditions/C1/${id}/tv-safe-webp.webp`)).not.toBeNull();
    const fake = await seed(Buffer.concat([PNG.subarray(0, 8), Buffer.from('garbage garbage garbage')]));
    expect((await w.process(fake)).code).toBe('unreadable_media');
  });
});
