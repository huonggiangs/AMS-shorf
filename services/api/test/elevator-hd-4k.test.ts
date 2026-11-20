// Thang may doc 9:16 tu HD (720x1280) den 4K (2160x3840): kiem tra creative (fitsTarget/inferTarget/videoSpecProblem/gioi han dung luong),
// tai len (upload-url + confirm voi MP4 H.264/H.265 tong hop) va tao vi tri man hinh. Chon manifest theo bac: services/edge-gateway/test/signage.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { ELEVATOR_TIERS, elevatorTierFor, isElevatorResolution, signageModelClass } from '@ams/shared';
import { fitsTarget, inferTarget, sizeLimitBytes, videoSpecProblem, MB } from '../src/lib/creative.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
const cat = (...p: (number[] | Uint8Array)[]) => {
  const out = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const box = (type: string, body: number[] | Uint8Array) => cat(be32(8 + body.length), tag(type), body);
/** MP4 tong hop co stsd (codec video) + audio mp4a */
function mp4(w: number, h: number, durS: number, vfcc: string): Uint8Array {
  const ts = 1000;
  const stsd = (fcc: string) => box('stsd', cat([0, 0, 0, 0], be32(1), be32(16), tag(fcc), new Array(8).fill(0)));
  const trak = (tw: number, th: number, fcc: string) => {
    const tkhd = box('tkhd', [0, 0, 0, 7, ...be32(0), ...be32(0), ...be32(1), ...be32(0), ...be32(durS * ts), ...new Array(8).fill(0), ...new Array(8).fill(0), ...new Array(36).fill(0), ...be32(tw << 16), ...be32(th << 16)]);
    return box('trak', cat(tkhd, box('mdia', box('minf', box('stbl', stsd(fcc))))));
  };
  const mvhd = box('mvhd', [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(ts), ...be32(Math.round(durS * ts)), ...new Array(80).fill(0)]);
  return cat(box('ftyp', [...tag('isom'), 0, 0, 2, 0, ...tag('isom'), ...tag('mp41')]), box('moov', cat(mvhd, trak(w, h, vfcc), trak(0, 0, 'mp4a'))), box('mdat', new Uint8Array(1000)));
}

describe('thang may HD-4K: quy tac kich thuoc (fitsTarget / inferTarget)', () => {
  it('nhan moi do phan giai doc 9:16 tu 720x1280 den 2160x3840, gom 768x1366 (sai so nho)', () => {
    for (const [w, h] of [[720, 1280], [768, 1366], [1080, 1920], [1440, 2560], [2160, 3840], [900, 1600], [1200, 2133]]) {
      expect(fitsTarget('elevator', w!, h!).ok, `${w}x${h}`).toBe(true);
      expect(inferTarget(w!, h!)).toBe('elevator');
    }
    expect(ELEVATOR_TIERS.map((t) => `${t.w}x${t.h}`)).toEqual(['720x1280', '768x1366', '1080x1920', '1440x2560', '2160x3840']);
  });
  it('tu choi ngang 16:9, vuong, sai ti le, thap hon HD, cao hon 4K', () => {
    for (const [w, h] of [[1920, 1080], [3840, 2160], [1280, 720], [1000, 1000], [1080, 1800], [540, 960], [360, 640], [2400, 4267], [4320, 7680]]) {
      expect(fitsTarget('elevator', w!, h!).ok, `${w}x${h}`).toBe(false);
      expect(isElevatorResolution(w!, h!)).toBe(false);
    }
    const msg = fitsTarget('elevator', 1920, 1080).message;
    expect(msg).toMatch(/720×1280/);
    expect(msg).toMatch(/2160×3840/);
    expect(msg).toMatch(/1920×1080/);
  });
  it('bac gan nhat KHONG VUOT: khong day 4K cho man HD, khong day len bac cao hon', () => {
    expect(elevatorTierFor(720, 1280)).toEqual({ w: 720, h: 1280 });
    expect(elevatorTierFor(1079, 1919)).toEqual({ w: 1080, h: 1920 }); // sai so +-2%
    expect(elevatorTierFor(1000, 1778)).toEqual({ w: 768, h: 1366 });
    expect(elevatorTierFor(1439, 2559)).toEqual({ w: 1440, h: 2560 });
    expect(elevatorTierFor(1400, 2489)).toEqual({ w: 1080, h: 1920 });
    expect(elevatorTierFor(4000, 7000)).toEqual({ w: 2160, h: 3840 });
    expect(elevatorTierFor(600, 1000)).toEqual({ w: 720, h: 1280 }); // duoi HD: bac thap nhat
    expect(signageModelClass('elevator', 1080, 1794)).toBe('elevator_1080x1920');
    expect(signageModelClass('elevator', null, null)).toBe('elevator');
    expect(signageModelClass('led_p5', 512, 256)).toBe('led_p5_512x256');
  });
  it('TV va LED khong doi: TV 16:9; LED dung kich thuoc bang', () => {
    expect(fitsTarget('tv', 1920, 1080).ok).toBe(true);
    expect(fitsTarget('tv', 1080, 1920).ok).toBe(false);
    expect(fitsTarget('led_p5', 512, 256).ok).toBe(true);
    expect(inferTarget(2160, 3840)).toBe('elevator');
  });
});

describe('thang may HD-4K: video (codec, do phan giai, dung luong)', () => {
  it('thang may: H.264 va H.265 den 4K; tren 4K, AV1 bi tu choi voi thong bao neu ro codec + bitrate + dung luong', () => {
    expect(videoSpecProblem({ w: 2160, h: 3840, codec: 'avc1' }, 'elevator')).toBeNull();
    expect(videoSpecProblem({ w: 2160, h: 3840, codec: 'hvc1' }, 'elevator')).toBeNull();
    expect(videoSpecProblem({ w: 1440, h: 2560, codec: 'hev1' }, 'elevator')).toBeNull();
    const av1 = videoSpecProblem({ w: 2160, h: 3840, codec: 'av01' }, 'elevator')!;
    expect(av1.code).toBe('unsupported_codec');
    expect(av1.message).toMatch(/H\.264/);
    expect(av1.message).toMatch(/H\.265/);
    expect(av1.message).toMatch(/16 Mbps/);
    expect(av1.message).toMatch(/100 MB/);
    const big = videoSpecProblem({ w: 4320, h: 7680, codec: 'avc1' }, 'elevator')!;
    expect(big.code).toBe('video_resolution_too_high');
    expect(big.message).toMatch(/2160×3840/);
  });
  it('TV/LED/khong ro loai: giu nguyen H.264 <= Full HD (khong H.265, khong 4K)', () => {
    for (const t of [undefined, null, 'tv', 'led_p5'] as const) {
      expect(videoSpecProblem({ w: 3840, h: 2160, codec: 'avc1' }, t)?.code, String(t)).toBe('video_resolution_too_high');
      expect(videoSpecProblem({ w: 1920, h: 1080, codec: 'hvc1' }, t)?.code, String(t)).toBe('unsupported_codec');
      expect(videoSpecProblem({ w: 1920, h: 1080, codec: 'avc1' }, t)).toBeNull();
    }
  });
  it('dung luong: thang may <= Full HD 30 MB (nhu cu); 2K/4K toi 100 MB (tran video); khach bi han muc tai khoan', () => {
    expect(sizeLimitBytes('elevator', null, 1080)).toBe(30 * MB);
    expect(sizeLimitBytes('elevator', null)).toBe(30 * MB);
    expect(sizeLimitBytes('elevator', null, 1440)).toBe(100 * MB);
    expect(sizeLimitBytes('elevator', null, 2160)).toBe(100 * MB);
    expect(sizeLimitBytes('elevator', 30, 2160)).toBe(30 * MB);
    expect(sizeLimitBytes('tv', null, 2160)).toBe(500 * MB);
    expect(sizeLimitBytes('led_p5', null, 512)).toBe(50 * MB);
  });
});

describe('thang may HD-4K: API tai len + vi tri man hinh', () => {
  let env: Env;
  let admin: Session;
  let K001: string;
  beforeAll(async () => {
    env = await setup({});
    K001 = env.seed.customers['K001']!;
    admin = await login(env, env.byRole('super_admin'));
  }, 120_000);
  const up = (o: Record<string, unknown>) => admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'v.mp4', content_type: 'video/mp4', size_bytes: 20 * MB, duration_sec: 20, ...o });

  it('upload-url: nhan 720x1280, 768x1366, 1440x2560, 2160x3840 (thang may); tu choi ngang cho thang may', async () => {
    for (const [w, h] of [[720, 1280], [768, 1366], [1440, 2560], [2160, 3840]]) {
      const r = await up({ width: w, height: h, target_type: 'elevator' });
      expect(r.status, `${w}x${h}: ${JSON.stringify(r.body)}`).toBe(201);
    }
    const land = await up({ width: 1920, height: 1080, target_type: 'elevator' });
    expect(land.status).toBe(422);
    expect(land.body.error.code).toBe('creative_size_mismatch');
    const land4k = await up({ width: 3840, height: 2160, target_type: 'elevator' });
    expect(land4k.status).toBe(422);
    expect((await up({ width: 540, height: 960, target_type: 'elevator' })).status).toBe(422);
    expect((await up({ width: 4320, height: 7680, target_type: 'elevator' })).status).toBe(422);
  });
  it('upload-url: video 4K doc 80 MB duoc (thang may), 4K 120 MB bi tu choi (tran 100 MB); 1080x1920 40 MB van bi tu choi (tran 30 MB)', async () => {
    expect((await up({ width: 2160, height: 3840, size_bytes: 80 * MB })).status).toBe(201);
    const big = await up({ width: 2160, height: 3840, size_bytes: 120 * MB });
    expect(big.status).toBe(422);
    expect(big.body.error.code).toBe('file_too_large');
    expect(big.body.error.message).toMatch(/100 MB/);
    const fhd = await up({ width: 1080, height: 1920, size_bytes: 40 * MB });
    expect(fhd.status).toBe(422);
    expect(fhd.body.error.message).toMatch(/30 MB/);
    // TV 4K ngang van bi tu choi nhu cu
    expect((await up({ width: 3840, height: 2160, size_bytes: 40 * MB })).body.error.code).toBe('video_resolution_too_high');
  });
  it('confirm: MP4 H.265 2160x3840 20 giay duoc nhan cho thang may; AV1 bi tu choi; H.265 1080p ngang (TV) bi tu choi', async () => {
    const put = async (bytes: Uint8Array, dims: Record<string, number> | null) => {
      const r = await up({ size_bytes: bytes.length, ...(dims ?? {}) });
      expect(r.status).toBe(201);
      await env.rt.objects.put(r.body.key, bytes, 'video/mp4');
      return r.body.id as string;
    };
    const ok = await put(mp4(2160, 3840, 20, 'hvc1'), null);
    const c1 = await admin.json('POST', `/admin/v1/media/${ok}/confirm`, {});
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body).toMatchObject({ width: 2160, height: 3840 });
    const ok264 = await put(mp4(1440, 2560, 20, 'avc1'), null);
    expect((await admin.json('POST', `/admin/v1/media/${ok264}/confirm`, {})).status).toBe(200);
    const av1 = await put(mp4(2160, 3840, 20, 'av01'), null);
    const c2 = await admin.json('POST', `/admin/v1/media/${av1}/confirm`, {});
    expect(c2.status).toBe(422);
    expect(c2.body.error.code).toBe('unsupported_codec');
    expect(c2.body.error.message).toMatch(/H\.265/);
    const tv = await put(mp4(1920, 1080, 20, 'hvc1'), null);
    expect((await admin.json('POST', `/admin/v1/media/${tv}/confirm`, {})).body.error.code).toBe('unsupported_codec');
  });
  it('POST /screens: vi tri thang may nhan 720x1280, 1440x2560, 2160x3840; tu choi 1920x1080, 1000x1000', async () => {
    for (const resolution of ['720×1280', '1440×2560', '2160×3840', '1080×1920', '768×1366']) {
      const r = await admin.json('POST', '/admin/v1/screens', { name: `Chung cu ${resolution}`, type: 'elevator', resolution, screens: 1, region: 'Hà Nội' });
      expect(r.status, `${resolution}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
    }
    for (const resolution of ['1920×1080', '1000×1000', '540×960']) {
      const r = await admin.json('POST', '/admin/v1/screens', { name: 'Sai', type: 'elevator', resolution, screens: 1, region: 'Hà Nội' });
      expect(r.status, resolution).toBe(422);
      expect(r.body.error.code).toBe('bad_resolution');
    }
  });
});
