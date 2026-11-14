// Duong media tren Cloudflare: kiem tra allow-list (khong phai antivirus) + cong quet + duyet tay co audit.
import { beforeAll, describe, expect, it } from 'vitest';
import { createCfCreativeValidator, validateCreativeBytes } from '../src/lib/cf-creative-validate.js';
import { scanVerdict } from '../src/routes/creatives-scan.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const cat = (...p: (number[] | Uint8Array)[]) => Uint8Array.from(p.flatMap((x) => [...x]));
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
const chunk = (type: string, body: number[] = []) => [...be32(body.length), ...tag(type), ...body, 0, 0, 0, 0];
export const png = (w: number, h: number, tail: number[] = []) => cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', [...be32(w), ...be32(h), 8, 2, 0, 0, 0]), chunk('IDAT', [1, 2, 3]), chunk('IEND'), tail);
export const jpeg = (w: number, h: number, eoi = true) => cat([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0, 2, 7, 7], eoi ? [0xff, 0xd9] : []);
const box = (type: string, body: number[] | Uint8Array) => cat(be32(8 + body.length), tag(type), body);
export function mp4(w: number, h: number, durS: number, opts: { brand?: string; noMoov?: boolean; trailing?: number[] } = {}) {
  const ts = 1000;
  const mvhd = box('mvhd', [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(ts), ...be32(durS * ts), ...new Array(80).fill(0)]);
  const tkhd = box('tkhd', [0, 0, 0, 7, ...be32(0), ...be32(0), ...be32(1), ...be32(0), ...be32(durS * ts), ...new Array(8).fill(0), ...new Array(8).fill(0), ...new Array(36).fill(0), ...be32(w << 16), ...be32(h << 16)]);
  const moov = box('moov', cat(mvhd, box('trak', tkhd)));
  return cat(box('ftyp', [...tag(opts.brand ?? 'isom'), 0, 0, 0, 0, ...tag('isom')]), opts.noMoov ? new Uint8Array() : moov, box('mdat', [1, 2, 3, 4]), opts.trailing ?? []);
}
const D = (o: Partial<Parameters<typeof validateCreativeBytes>[1]> = {}) => ({ mime: null, sizeBytes: null, w: null, h: null, durationS: null, ...o });

describe('validateCreativeBytes: allow-list hep', () => {
  it('png/jpg/mp4 hop le -> clean, kem sha256 + kich thuoc/thoi luong that', async () => {
    const p = await validateCreativeBytes(png(1920, 1080), D({ mime: 'image/png', w: 1920, h: 1080 }));
    expect(p).toMatchObject({ clean: true, facts: { kind: 'png', w: 1920, h: 1080 } });
    expect(p.facts.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await validateCreativeBytes(jpeg(1080, 1920), D({ mime: 'image/jpeg' }))).clean).toBe(true);
    const v = await validateCreativeBytes(mp4(1080, 1920, 15), D({ mime: 'video/mp4', w: 1080, h: 1920, durationS: 15, durationRange: [10, 30] }));
    expect(v).toMatchObject({ clean: true, facts: { kind: 'mp4', w: 1080, h: 1920, durationS: 15 } });
  });

  it.each([
    ['exe/PE', Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]), 'image/png', 'type_not_in_allowlist'],
    ['svg/html', new TextEncoder().encode('<svg onload=alert(1)>'), 'image/png', 'type_not_in_allowlist'],
    ['webm', Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]), 'video/webm', 'type_not_in_allowlist'],
    ['MIME khai bao sai', png(10, 10), 'image/jpeg', 'mime_mismatch'],
    ['PNG kem du lieu thua sau IEND (polyglot)', png(10, 10, [0x50, 0x4b, 3, 4]), 'image/png', 'png_trailing_data'],
    ['PNG cut', png(10, 10).subarray(0, 40), 'image/png', 'png_'],
    ['JPEG khong ket thuc FFD9', jpeg(10, 10, false), 'image/jpeg', 'jpeg_no_eoi'],
    ['MP4 brand quicktime', mp4(10, 10, 5, { brand: 'qt  ' }), 'video/mp4', 'mp4_brand_not_allowed'],
    ['MP4 khong co moov', mp4(10, 10, 5, { noMoov: true }), 'video/mp4', 'mp4_no_moov'],
    ['MP4 byte thua cuoi', mp4(10, 10, 5, { trailing: [1, 2, 3] }), 'video/mp4', 'mp4_trailing_bytes'],
    ['kich thuoc that khac khai bao', png(100, 100), 'image/png', 'dimensions_mismatch'],
    ['qua lon (bom giai nen)', png(20000, 20000), 'image/png', 'dimensions_out_of_range'],
  ])('%s -> needs_manual_review', async (_n, bytes, mime, why) => {
    const v = await validateCreativeBytes(bytes, D({ mime, w: _n.startsWith('kich') ? 1080 : null, h: _n.startsWith('kich') ? 1920 : null }));
    expect(v.clean).toBe(false);
    expect(v.reasons.join(',')).toContain(why);
  });

  it('thoi luong mp4 ngoai khoang cua loai man hinh / lech khai bao', async () => {
    const v = await validateCreativeBytes(mp4(1080, 1920, 90), D({ mime: 'video/mp4', durationS: 90, durationRange: [10, 30] }));
    expect(v.reasons).toContain('duration_out_of_range');
    expect((await validateCreativeBytes(mp4(1080, 1920, 15), D({ durationS: 60 }))).reasons).toContain('duration_mismatch');
  });
});

describe('cong quet: chi creative clean duoc phat/duyet', () => {
  it('needs_manual_review bi chan ca khi allow_unscanned=true', () => {
    for (const allow of [false, true]) {
      const v = scanVerdict({ scan_state: 'needs_manual_review' }, allow);
      expect(v.ok).toBe(false);
      expect(v.code).toBe('creative_needs_manual_review');
    }
    expect(scanVerdict({ scan_state: 'clean' }, false).ok).toBe(true);
  });
});

describe('luong day du tren runtime (queue -> validator -> duyet tay co audit)', () => {
  let env: Env;
  let admin: Session;
  let K001: string;
  beforeAll(async () => {
    env = await setup({});
    await env.rt.db.run("DELETE FROM settings WHERE key = 'allow_unscanned_creatives'"); // that: khong cho phep tep chua quet
    K001 = env.seed.customers['K001']!;
    admin = await login(env, env.byRole('super_admin'));
    createCfCreativeValidator(env.rt).subscribe();
  }, 120_000);

  async function upload(name: string, mime: string, bytes: Uint8Array, dims: { width?: number; height?: number; duration_sec?: number }) {
    const r = await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name, content_type: mime, size_bytes: bytes.length, ...dims });
    expect(r.status).toBe(201);
    await env.rt.objects.put(r.body.key, bytes, mime);
    const cf = await admin.json('POST', `/admin/v1/media/${r.body.id}/confirm`, dims);
    expect(cf.status).toBe(200);
    await env.rt.queue.drain();
    return r.body.id as string;
  }
  const scan = async (id: string) => (await env.rt.db.query<{ scan_state: string; sha256: string | null }>('SELECT scan_state, sha256 FROM creatives WHERE id = ?', [id]))[0]!;

  it('png hop le -> clean (engine cf-validator-v1), co the duyet', async () => {
    const id = await upload('ok.png', 'image/png', png(1920, 1080), {});
    expect((await scan(id)).scan_state).toBe('clean');
    const v = (await env.rt.db.query<{ engine: string; verdict: string }>('SELECT engine, verdict FROM creative_validation WHERE creative_id = ?', [id]))[0]!;
    expect(v).toMatchObject({ engine: 'cf-validator-v1', verdict: 'clean' });
    expect((await admin.json('POST', `/admin/v1/media/${id}/approve`)).status).toBe(200);
  });

  it('png co du lieu thua -> needs_manual_review; approve thuong bi chan; admin duyet tay -> clean + audit; khong duyet lai duoc', async () => {
    const id = await upload('poly.png', 'image/png', png(1920, 1080, [0x50, 0x4b, 3, 4]), {});
    expect((await scan(id)).scan_state).toBe('needs_manual_review');
    const blocked = await admin.json('POST', `/admin/v1/media/${id}/approve`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('creative_needs_manual_review');
    const q = await admin.json('GET', '/admin/v1/media/scan-review/queue');
    expect(q.body.items.find((x: any) => x.id === id)?.reasons).toContain('png_trailing_data');
    expect((await admin.json('POST', `/admin/v1/media/${id}/scan-review`, { decision: 'approve', note: 'x' })).status).toBe(422); // ghi chu qua ngan
    expect((await admin.json('POST', `/admin/v1/media/${id}/scan-review`, { decision: 'approve', note: 'da xem tay, anh sach' })).status).toBe(200);
    expect((await scan(id)).scan_state).toBe('clean');
    expect((await admin.json('POST', `/admin/v1/media/${id}/scan-review`, { decision: 'approve', note: 'lan hai' })).status).toBe(409);
    const a = await env.rt.db.query<{ action: string }>("SELECT action FROM audit_log WHERE object_id = ? AND action LIKE 'media.scan_review.%'", [id]);
    expect(a.map((x) => x.action)).toEqual(['media.scan_review.approve']);
    const v = (await env.rt.db.query<{ engine: string }>('SELECT engine FROM creative_validation WHERE creative_id = ?', [id]))[0]!;
    expect(v.engine).toBe('manual');
  });

  it('admin tu choi -> khong bao gio phat (scan_state failed, review rejected), co audit', async () => {
    const id = await upload('poly2.png', 'image/png', png(1920, 1080, [0xde, 0xad]), {});
    expect((await scan(id)).scan_state).toBe('needs_manual_review');
    expect((await admin.json('POST', `/admin/v1/media/${id}/scan-review`, { decision: 'reject', note: 'tep co du lieu la' })).status).toBe(200);
    const row = (await env.rt.db.query<{ scan_state: string; review_state: string }>('SELECT scan_state, review_state FROM creatives WHERE id = ?', [id]))[0]!;
    expect(row).toMatchObject({ scan_state: 'failed', review_state: 'rejected' });
    expect(scanVerdict(row, true).ok).toBe(false);
    expect((await env.rt.db.query('SELECT 1 FROM audit_log WHERE object_id = ? AND action = ?', [id, 'media.scan_review.reject'])).length).toBe(1);
  });

  it('khong ghi de ket qua da co (media-worker VPS / admin): process tren scan_state<>pending bi bo qua; CF_VALIDATOR_MARK_CLEAN=0 => khong clean', async () => {
    const id = await upload('again.png', 'image/png', png(1920, 1080), {});
    const v = createCfCreativeValidator(env.rt);
    expect((await v.process(id)).outcome).toBe('skipped');
    await env.rt.db.run("UPDATE creatives SET scan_state = 'pending' WHERE id = ?", [id]);
    const strict = createCfCreativeValidator(env.rt, { markClean: false });
    expect((await strict.process(id)).outcome).toBe('needs_manual_review');
    expect((await scan(id)).scan_state).toBe('needs_manual_review');
  });

  it('sweep nhat creative pending bi mat tin nhan', async () => {
    const r = await admin.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'lost.png', content_type: 'image/png', size_bytes: png(1920, 1080).length });
    await env.rt.objects.put(r.body.key, png(1920, 1080), 'image/png');
    await env.rt.db.run("UPDATE creatives SET state = 'pending_review' WHERE id = ?", [r.body.id]); // gia lap: da confirm nhung tin nhan mat
    expect(await createCfCreativeValidator(env.rt).sweep()).toBeGreaterThanOrEqual(1);
    expect((await scan(r.body.id)).scan_state).toBe('clean');
  });
});
