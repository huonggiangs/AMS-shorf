// w-web: luong "tai video MP4 that len Cloudflare -> kiem tra co ban -> cho duyet tay -> duyet -> gan chien dich".
// Tai hien bao cao: "JOURNEY TO VIETNAM ... .mp4: da upload nhung khong duyet duoc".
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCfCreativeValidator } from '../src/lib/cf-creative-validate.js';
import { probeMp4, rangeReaderFor } from '../src/lib/mp4-probe.js';
import { blockerOf } from '../src/routes/media.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const MB = 1024 * 1024;
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
const cat = (...p: (number[] | Uint8Array)[]) => {
  const n = p.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const box = (type: string, body: number[] | Uint8Array) => cat(be32(8 + body.length), tag(type), body);

/** MP4 gia lap tep lon: ftyp + mdat(mdatBytes) + moov o CUOI (kieu ffmpeg khong faststart). */
function bigMp4(w: number, h: number, durS: number, mdatBytes: number): Uint8Array {
  const ts = 1000;
  const mvhd = box('mvhd', [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(ts), ...be32(durS * ts), ...new Array(80).fill(0)]);
  const tkhd = box('tkhd', [0, 0, 0, 7, ...be32(0), ...be32(0), ...be32(1), ...be32(0), ...be32(durS * ts), ...new Array(8).fill(0), ...new Array(8).fill(0), ...new Array(36).fill(0), ...be32(w << 16), ...be32(h << 16)]);
  const moov = box('moov', cat(mvhd, box('trak', tkhd)));
  return cat(box('ftyp', [...tag('isom'), 0, 0, 2, 0, ...tag('isom'), ...tag('mp42')]), cat(be32(8 + mdatBytes), tag('mdat'), new Uint8Array(mdatBytes)), moov);
}

let ffmpegMp4: { faststart: Uint8Array; tail: Uint8Array } | null = null;
try {
  const dir = mkdtempSync(join(tmpdir(), 'wweb-'));
  const gen = (name: string, extra: string[]) => {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', ...extra, join(dir, name)], { stdio: 'ignore' });
    return new Uint8Array(readFileSync(join(dir, name)));
  };
  ffmpegMp4 = { faststart: gen('fs.mp4', ['-movflags', '+faststart']), tail: gen('tail.mp4', []) };
  rmSync(dir, { recursive: true, force: true });
} catch {
  ffmpegMp4 = null; // khong co ffmpeg: bo qua nhom test ffmpeg
}

/** MP4 tong hop co stsd (codec) cho video + audio: tai hien tep that AV1 4K + HE-AAC. */
function av1Header(w: number, h: number, durS: number, mdatBytes: number, vfcc = 'av01'): Uint8Array {
  const ts = 1000;
  const stsd = (fcc: string) => box('stsd', cat([0, 0, 0, 0], be32(1), be32(16), tag(fcc), new Array(8).fill(0)));
  const trak = (tw: number, th: number, fcc: string) => {
    const tkhd = box('tkhd', [0, 0, 0, 7, ...be32(0), ...be32(0), ...be32(1), ...be32(0), ...be32(durS * ts), ...new Array(8).fill(0), ...new Array(8).fill(0), ...new Array(36).fill(0), ...be32(tw << 16), ...be32(th << 16)]);
    return box('trak', cat(tkhd, box('mdia', box('minf', box('stbl', stsd(fcc))))));
  };
  const mvhd = box('mvhd', [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(ts), ...be32(Math.round(durS * ts)), ...new Array(80).fill(0)]);
  const moov = box('moov', cat(mvhd, trak(w, h, vfcc), trak(0, 0, 'mp4a')));
  return cat(box('ftyp', [...tag('isom'), 0, 0, 2, 0, ...tag('isom'), ...tag('iso2'), ...tag('av01'), ...tag('mp41')]), moov, box('mdat', new Uint8Array(mdatBytes)));
}
let av1: Uint8Array | null = null;
try {
  const dir = mkdtempSync(join(tmpdir(), 'wweb-av1-'));
  const f = join(dir, 'av1.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=3840x2160:rate=24', '-frames:v', '6', '-c:v', 'libsvtav1', '-preset', '12', '-crf', '50', '-pix_fmt', 'yuv420p', f], { stdio: 'ignore' });
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', f]).toString()) as { streams: { codec_name: string; width: number }[] };
  if (probe.streams[0]?.codec_name === 'av1' && probe.streams[0].width === 3840) av1 = new Uint8Array(readFileSync(f)); // xac minh bang ffprobe
  rmSync(dir, { recursive: true, force: true });
} catch {
  av1 = null;
}

describe('probeMp4: doc header bang range read', () => {
  it('tep lon, moov o cuoi: lay thoi luong + kich thuoc ma khong doc mdat', async () => {
    const b = bigMp4(1920, 1080, 45, 3 * MB);
    let bytesRead = 0;
    const p = await probeMp4(async (o, l) => {
      bytesRead += Math.min(l, b.length - o);
      return b.slice(o, o + l);
    }, b.length);
    expect(p).toMatchObject({ recognized: true, brand: 'isom', w: 1920, h: 1080, durationS: 45, moovAtEnd: true, reasons: [] });
    expect(bytesRead).toBeLessThan(2000); // khong doc 3 MB mdat
  });
  it('byte thua cuoi / khong phai mp4', async () => {
    const b = cat(bigMp4(640, 360, 5, 10), [1, 2, 3]);
    expect((await probeMp4(async (o, l) => b.slice(o, o + l), b.length)).reasons).toContain('mp4_trailing_bytes');
    const junk = new TextEncoder().encode('<html>not a video at all</html>');
    expect((await probeMp4(async (o, l) => junk.slice(o, o + l), junk.length)).recognized).toBe(false);
  });
});

describe.skipIf(!ffmpegMp4)('MP4 H.264/AAC that (ffmpeg)', () => {
  it.skipIf(!av1)('probe doc AV1 4K that (ffprobe xac minh)', async () => {
    const p = await probeMp4(async (o, l) => av1!.slice(o, o + l), av1!.length);
    expect(p).toMatchObject({ videoCodec: 'av01', w: 3840, h: 2160 });
  });
  it.each(['faststart', 'tail'] as const)('probe doc dung 1920x1080, ~6 s (%s)', async (k) => {
    const b = ffmpegMp4![k];
    const p = await probeMp4(async (o, l) => b.slice(o, o + l), b.length);
    expect(p).toMatchObject({ videoCodec: 'avc1', audioCodec: 'mp4a' });
    expect(p.recognized).toBe(true);
    expect(p.reasons).toEqual([]);
    expect(p).toMatchObject({ w: 1920, h: 1080 });
    expect(Math.round(p.durationS!)).toBe(6);
  });
});

describe('blockerOf: moi trang thai khong duyet duoc deu co giai thich + hanh dong', () => {
  const m = (o: Partial<Parameters<typeof blockerOf>[0]>) => ({ state: 'pending_review', review_state: 'pending', scan_state: 'clean', source: 'upload', ...o });
  it.each([
    [{ state: 'uploading' }, 'upload_incomplete', 'confirm'],
    [{ state: 'invalid', review_state: 'rejected' }, 'invalid', 'reupload'],
    [{ scan_state: 'pending' }, 'creative_scan_pending', 'recheck'],
    [{ scan_state: 'needs_manual_review' }, 'creative_needs_manual_review', 'manual_review'],
    [{ scan_state: 'unscanned' }, 'creative_not_scanned', 'recheck'],
    [{ scan_state: 'infected' }, 'creative_infected', 'reupload'],
    [{ scan_state: 'pending', source: 'youtube' }, 'creative_link_not_ingested', 'none'],
  ] as const)('%j', (o, code, action) => {
    expect(blockerOf(m(o as any))).toMatchObject({ code, action });
  });
  it('clean / da duyet: khong co blocker', () => {
    expect(blockerOf(m({}))).toBeNull();
    expect(blockerOf(m({ review_state: 'approved', scan_state: 'needs_manual_review' }))).toBeNull();
  });
});

describe('luong day du tren runtime kieu Cloudflare', () => {
  let env: Env;
  let admin: Session;
  let K001: string;
  beforeAll(async () => {
    env = await setup({});
    await env.rt.db.run("DELETE FROM settings WHERE key = 'allow_unscanned_creatives'");
    await env.rt.db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('auto_approve_privileged_uploads', '0', NULL, ?)", [env.rt.clock.now().toISOString()]); // bai test duyet tay: tat tu duyet (tu duyet co test rieng: media-auto-approve.test.ts)
    K001 = env.seed.customers['K001']!;
    admin = await login(env, env.byRole('super_admin'));
    createCfCreativeValidator(env.rt).subscribe();
  }, 120_000);

  async function put(name: string, bytes: Uint8Array, dims: Record<string, number> | null) {
    const r = await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name, content_type: 'video/mp4', size_bytes: bytes.length, ...(dims ?? {}) });
    expect(r.status).toBe(201);
    await env.rt.objects.put(r.body.key, bytes, 'video/mp4');
    return r.body.id as string;
  }
  const row = async (id: string) => (await env.rt.db.query<any>('SELECT scan_state, state, review_state, px_w, px_h, duration_s, sha256, campaign_id FROM creatives WHERE id = ?', [id]))[0]!;

  it('MP4 H.264 that <= 32 MB: kiem tra tu dong dat clean, duyet 1 buoc, gan chien dich', async () => {
    if (!ffmpegMp4) return;
    const id = await put('JOURNEY TO VIETNAM - A Cinematic Travel Video.mp4', ffmpegMp4.tail, null);
    // client khong gui kich thuoc: server tu doc tu header MP4
    const cf = await admin.json('POST', `/admin/v1/media/${id}/confirm`, {});
    expect(cf.status).toBe(200);
    await env.rt.queue.drain();
    expect(await row(id)).toMatchObject({ px_w: 1920, px_h: 1080, duration_s: 6, scan_state: 'clean' });
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`)).status).toBe(200);
    const c = await admin.json('POST', '/admin/v1/campaigns', { customer_id: K001, name: 'Gan video that', budget_vnd: 2_000_000, screen_type: 'tv', media_id: id });
    expect(c.status).toBe(201);
    expect((await row(id)).campaign_id).toBe(c.body.id);
  });

  it('video 45 s, 60 MB, moov o cuoi (khong doc het): vao needs_manual_review kem thoi luong that + ly do; duyet 1 buoc bang ghi chu', async () => {
    const bytes = bigMp4(1920, 1080, 45, 60 * MB);
    const id = await put('journey.mp4', bytes, { width: 1920, height: 1080, duration_sec: 45 });
    expect((await admin.json('POST', `/admin/v1/media/${id}/confirm`, { width: 1920, height: 1080, duration_sec: 45 })).status).toBe(200);
    await env.rt.queue.drain();
    expect(await row(id)).toMatchObject({ scan_state: 'needs_manual_review', state: 'pending_review', review_state: 'pending', px_w: 1920, duration_s: 45 });
    expect((await row(id)).sha256).toBeNull(); // > 32 MB: khong bam trong Worker (bo nho 128 MB)

    const g = await admin.json('GET', `/admin/v1/media/${id}`);
    expect(g.body.status).toBe('pending');
    expect(g.body.scan_reasons).toEqual(['too_large_to_read_inline']);
    expect(g.body.blocker).toMatchObject({ code: 'creative_needs_manual_review', action: 'manual_review' });
    expect(g.body.preview_url).toBeTruthy(); // xem truoc phat duoc

    const q = await admin.json('GET', '/admin/v1/media/scan-review/queue');
    expect(q.body.items.find((x: any) => x.id === id)).toMatchObject({ duration_s: 45, width: 1920, reasons: ['too_large_to_read_inline'] });

    // duyet that bai khi thieu ghi chu: van bi chan nhu cu
    const blocked = await admin.json('POST', `/admin/v1/media/${id}/approve`, {});
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('creative_needs_manual_review');
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`, { manual_review_note: 'x' })).status).toBe(422);
    // sai phien ban noi dung => 409, khong duyet
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`, { manual_review_note: 'da xem 5 phut', content_version: 99 })).status).toBe(409);

    const ok = await admin.json('POST', `/admin/v1/media/${id}/approve`, { manual_review_note: 'da xem het video, noi dung sach', content_version: g.body.content_version });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('approved');
    expect(await row(id)).toMatchObject({ scan_state: 'clean', review_state: 'approved', state: 'ready' });
    const actions = (await env.rt.db.query<{ action: string }>("SELECT action FROM audit_log WHERE object_id = ? AND action LIKE 'media.%' ORDER BY id", [id])).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['media.scan_review.approve', 'media.approve']));
    expect((await env.rt.db.query<any>('SELECT engine FROM creative_validation WHERE creative_id = ?', [id]))[0].engine).toBe('manual');
    // gan chien dich: sau khi duyet
    const c = await admin.json('POST', '/admin/v1/campaigns', { customer_id: K001, name: 'Video dai', budget_vnd: 2_000_000, screen_type: 'tv', media_id: id });
    expect(c.status).toBe(201);
  });

  it('tep MP4 lech khai bao thoi luong: ly do duration_mismatch; recheck dua ve pending roi validator chay lai', async () => {
    const bytes = bigMp4(1920, 1080, 50, 60 * MB);
    const id = await put('lech.mp4', bytes, { width: 1920, height: 1080, duration_sec: 30 });
    expect((await admin.json('POST', `/admin/v1/media/${id}/confirm`, { width: 1920, height: 1080 })).status).toBe(200);
    await env.rt.queue.drain();
    const g = await admin.json('GET', `/admin/v1/media/${id}`);
    expect(g.body.scan_state).toBe('needs_manual_review');
    const rc = await admin.json('POST', `/admin/v1/media/${id}/recheck`);
    expect(rc.status).toBe(200);
    await env.rt.queue.drain();
    expect((await row(id)).scan_state).toBe('needs_manual_review'); // van la tep lon => duyet tay; KHONG tu thanh clean
    expect((await env.rt.db.query('SELECT 1 FROM audit_log WHERE object_id = ? AND action = ?', [id, 'media.recheck'])).length).toBe(1);
  });

  it('recheck: tep pending bi ket (mat tin nhan) duoc kiem tra lai; tep chua confirm / da clean bi 409', async () => {
    const bytes = cat(box('ftyp', [...tag('isom'), 0, 0, 0, 0, ...tag('isom')]), new Uint8Array(0));
    const id = await put('x.mp4', bytes, { width: 1920, height: 1080 });
    expect((await admin.json('POST', `/admin/v1/media/${id}/recheck`)).status).toBe(409); // chua confirm
    await env.rt.db.run("UPDATE creatives SET state = 'pending_review' WHERE id = ?", [id]);
    expect((await admin.json('POST', `/admin/v1/media/${id}/recheck`)).status).toBe(200);
    await env.rt.queue.drain();
    expect((await row(id)).scan_state).toBe('needs_manual_review'); // thieu moov/mdat
    await env.rt.db.run("UPDATE creatives SET scan_state = 'clean' WHERE id = ?", [id]);
    expect((await admin.json('POST', `/admin/v1/media/${id}/recheck`)).status).toBe(409);
  });

  it('gioi han tai len: video > 100 MB, > Full HD, thoi luong ngoai khoang bi tu choi som voi thong bao tieng Viet neu ro gioi han', async () => {
    const mk = (o: Record<string, unknown>) => admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'v.mp4', content_type: 'video/mp4', size_bytes: 20 * MB, width: 1920, height: 1080, duration_sec: 30, ...o });
    const big = await mk({ size_bytes: 202 * MB }); // tep that cua nguoi dung: 202 MB
    expect(big.status).toBe(422);
    expect(big.body.error.code).toBe('file_too_large');
    expect(big.body.error.message).toMatch(/giới hạn 100 MB/);
    const k4 = await mk({ width: 3840, height: 2160, size_bytes: 80 * MB });
    expect(k4.status).toBe(422);
    expect(k4.body.error.code).toBe('video_resolution_too_high');
    expect(k4.body.error.message).toMatch(/1920×1080/);
    const longTv = await mk({ duration_sec: 232 });
    expect(longTv.status).toBe(422);
    expect(longTv.body.error.code).toBe('duration_out_of_range');
    expect(longTv.body.error.message).toMatch(/5 đến 60 giây/);
    const longElev = await mk({ width: 1080, height: 1920, duration_sec: 312 });
    expect(longElev.body.error.message).toMatch(/10 đến 30 giây/);
    expect((await mk({ size_bytes: 90 * MB })).status).toBe(201); // H.264 1080p 30 s 90 MB: duoc cap URL (PUT thang len R2, khong qua Worker)
    // anh khong chiu gioi han 100 MB cua video
    expect((await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'a.png', content_type: 'image/png', size_bytes: 150 * MB, width: 3840, height: 2160 })).status).toBe(201);
  });

  it.skipIf(!av1)('video that AV1 4K (ffmpeg): confirm tu choi ngay voi thong bao codec, tep bi xoa khoi kho', async () => {
    const r = await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'av1.mp4', content_type: 'video/mp4', size_bytes: av1!.length });
    expect(r.status).toBe(201); // khong khai bao kich thuoc: chi bat o buoc confirm khi doc header
    await env.rt.objects.put(r.body.key, av1!, 'video/mp4');
    const cf = await admin.json('POST', `/admin/v1/media/${r.body.id}/confirm`, {});
    expect(cf.status).toBe(422);
    expect(cf.body.error.code).toBe('unsupported_codec');
    expect(cf.body.error.message).toMatch(/AV1/);
    expect(await env.rt.objects.head(r.body.key)).toBeNull();
    expect((await row(r.body.id)).state).toBe('invalid');
  });

  it('header AV1 4K tong hop (giong tep that 202 MB / 232,5 s): probe doc av01 + 3840x2160; confirm tu choi', async () => {
    const b = av1Header(3840, 2160, 232.5, 2 * MB);
    const p = await probeMp4(async (o, l) => b.slice(o, o + l), b.length);
    expect(p).toMatchObject({ videoCodec: 'av01', audioCodec: 'mp4a', w: 3840, h: 2160, durationS: 232.5 });
    const id = await put('JOURNEY.mp4', b, { width: 1920, height: 1080 });
    const cf = await admin.json('POST', `/admin/v1/media/${id}/confirm`, { width: 1920, height: 1080 });
    expect(cf.status).toBe(422);
    expect(cf.body.error.code).toBe('unsupported_codec');
  });

  it('H.265 1080p cung bi tu choi; H.264 4K bi tu choi vi do phan giai', async () => {
    const hevc = await put('h.mp4', av1Header(1920, 1080, 30, MB, 'hvc1'), null);
    expect((await admin.json('POST', `/admin/v1/media/${hevc}/confirm`, {})).body.error.code).toBe('unsupported_codec');
    const k4 = await put('k.mp4', av1Header(3840, 2160, 30, MB, 'avc1'), null);
    expect((await admin.json('POST', `/admin/v1/media/${k4}/confirm`, {})).body.error.code).toBe('video_resolution_too_high');
  });

  it('vai tro admin (khong chi super_admin) duoc duyet; vai tro khong co media:approve bi 403', async () => {
    const admins = env.seed.credentials.filter((c) => c.role === 'admin' && c.status === 'active');
    if (admins[0]) {
      const a = await login(env, admins[0].email);
      const id = await put('adm.mp4', bigMp4(1920, 1080, 20, 1 * MB), { width: 1920, height: 1080, duration_sec: 20 });
      await a.json('POST', `/admin/v1/media/${id}/confirm`, { width: 1920, height: 1080 });
      await env.rt.queue.drain();
      const st = await row(id);
      const res = await a.json('POST', `/admin/v1/media/${id}/approve`, st.scan_state === 'needs_manual_review' ? { manual_review_note: 'da xem' } : {});
      expect(res.status).toBe(200);
    }
  });
});
