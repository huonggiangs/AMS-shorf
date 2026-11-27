// Mo phong DUNG luong goi cua app Signage Player (Ams.kt): dang ky (khong px/khu vuc) -> heartbeat -> manifest -> lenh message -> ack.
// Muc dich: chung minh phia may chu giao duoc chuong trinh phat song + thong bao cho thiet bi dang ky theo cach cua app.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANIFEST_EPOCH_KEY } from '@ams/shared';
import { enqueueCommand } from '../src/commands.js';
import { attestForTest, seedAdFixture } from '../src/testing.js';
import { TestDevice, harness, type Harness } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let h: Harness;
let customerId: string;
const J = async (r: Response): Promise<any> => (await r.json()) as any;
// body dang ky y het Ams.kt: pubkey, kind=elevator, model, os, app_version; KHONG co region/px_w/px_h/orientation
const appDevice = () => TestDevice.create(h, { kind: 'elevator', model: 'RK3566', os: 'Android 11', app_version: '1.1.1', region: undefined });

async function libraryCreative(): Promise<string> {
  const id = h.rt.id();
  const key = `test/${customerId}/${id}.mp4`;
  const bytes = new TextEncoder().encode(`app-flow-${id}`);
  await h.rt.objects.put(key, bytes, 'video/mp4');
  await h.rt.db.run(
    `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, storage_key, mime, size_bytes, duration_s, scan_state, review_state, state, created_at)
     VALUES (?, NULL, ?, ?, 'elevator', 1080, 1920, 'portrait', 'video', 'upload', ?, 'video/mp4', ?, 15, 'clean', 'approved', 'ready', ?)`,
    [id, customerId, `lib-${id}.mp4`, key, bytes.length, h.rt.clock.now().toISOString()],
  );
  await attestForTest(h.rt, id);
  return id;
}

async function program(creatives: string[], regions: string[] = []): Promise<string> {
  const id = h.rt.id();
  const now = h.rt.clock.now().toISOString();
  await h.rt.db.run(
    `INSERT INTO broadcast_programs (id, name, target_type, regions, start_min, end_min, priority, status, version, created_at, updated_at)
     VALUES (?, 'Chuong trinh', 'elevator', ?, 0, 1440, 3, 'published', 1, ?, ?)`,
    [id, JSON.stringify(regions), now, now],
  );
  for (const [i, c] of creatives.entries()) await h.rt.db.run('INSERT INTO broadcast_program_items (program_id, creative_id, position) VALUES (?,?,?)', [id, c, i]);
  await h.rt.kv.incr(MANIFEST_EPOCH_KEY);
  await h.gw.manifests.invalidate();
  return id;
}

beforeAll(async () => {
  h = await harness({ env: { HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000' }, fixture: { campaigns: 0 } });
  customerId = (await seedAdFixture(h.rt, { campaigns: 0 })).customerId;
}, 60_000);
afterAll(async () => h.close());

describe('luong cua app Signage Player voi gateway', () => {
  it('thiet bi vua dang ky (trust 0, khong khu vuc/px) nhan chuong trinh da xuat ban trong manifest', async () => {
    const c = await libraryCreative();
    const pid = await program([c]);
    const d = await appDevice();
    const hb = await J(await d.call('POST', '/v1/heartbeat', { state: 0, app_ver: '1.1.1', cache_used_mb: 0 }));
    expect(hb.ok).toBe(true);
    expect(hb.manifest_etag).toMatch(/^[0-9a-f]{16}$/);
    const m = await J(await d.call('GET', '/v1/manifest'));
    expect(m.schedule.map((s: any) => s.slot_id)).toContain(`bp_${pid}`);
    expect(m.creatives.find((x: any) => x.id === c)?.url).toMatch(/^https?:\/\//);
  });

  it('chuong trinh gioi han khu vuc van toi thiet bi chua khai khu vuc (nhom ALL)', async () => {
    const c = await libraryCreative();
    const pid = await program([c], ['HN']);
    const d = await appDevice();
    const m = await J(await d.call('GET', '/v1/manifest'));
    expect(m.schedule.map((s: any) => s.slot_id)).toContain(`bp_${pid}`);
  });

  it('thong bao khan (lenh message) toi o heartbeat ke tiep, ack ok => acked; giao lai khong lap sau ack', async () => {
    const d = await appDevice();
    const id = await enqueueCommand(h.rt, d.id, { type: 'message', args: { text: 'Khan: kiem tra', duration_s: 20 } });
    const hb1 = await J(await d.call('POST', '/v1/heartbeat', { state: 1, app_ver: '1.1.1' }));
    expect(hb1.commands).toEqual([{ id, type: 'message', args: { text: 'Khan: kiem tra', duration_s: 20 } }]);
    expect((await d.call('POST', '/v1/commands/ack', { acks: [{ id, status: 'ok' }] })).status).toBe(200);
    const hb2 = await J(await d.call('POST', '/v1/heartbeat', { state: 1 }));
    expect(hb2.commands).toEqual([]);
    expect((await h.rt.db.query<{ status: string }>('SELECT status FROM device_commands WHERE id = ?', [id]))[0]!.status).toBe('acked');
  });

  it('chu ky heartbeat server tra ve (de biet do tre thong bao): dang phat ~300 s, roi ~600 s (jitter +-20%)', async () => {
    const d = await appDevice();
    const playing = await J(await d.call('POST', '/v1/heartbeat', { state: 1 }));
    const idle = await J(await d.call('POST', '/v1/heartbeat', { state: 0 }));
    expect(playing.next_interval).toBeGreaterThanOrEqual(240);
    expect(playing.next_interval).toBeLessThanOrEqual(360);
    expect(idle.next_interval).toBeGreaterThanOrEqual(480);
    expect(idle.next_interval).toBeLessThanOrEqual(720);
  });

  it('dang ky lai cung khoa => cung device_id (ma thiet bi duy nhat, khong tao thiet bi thu hai)', async () => {
    const d = await appDevice();
    const again = await d.registerRaw({ kind: 'elevator', model: 'RK3566', os: 'Android 11', app_version: '1.1.1', region: undefined });
    expect(again.status).toBe(200);
    expect((await J(again)).device_id).toBe(d.id);
  });
  it('GET /media/* phuc vu tep da duyet (co Range) va tu choi tep khong thuoc creative approved', async () => {
    const c = await libraryCreative();
    const row = (await h.rt.db.query<{ storage_key: string }>('SELECT storage_key FROM creatives WHERE id = ?', [c]))[0]!;
    const url = '/media/' + row.storage_key.split('/').map(encodeURIComponent).join('/');
    const full = await h.gw.app.request(url);
    expect(full.status).toBe(200);
    const total = (await full.arrayBuffer()).byteLength;
    const part = await h.gw.app.request(url, { headers: { range: 'bytes=0-3' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-3/${total}`);
    expect((await part.arrayBuffer()).byteLength).toBe(4);
    expect((await h.gw.app.request(url, { headers: { range: `bytes=${total + 5}-` } })).status).toBe(416);
    await h.rt.objects.put('secret/x.bin', new Uint8Array([1, 2, 3]), 'application/octet-stream');
    expect((await h.gw.app.request('/media/secret/x.bin')).status).toBe(404);
    await h.rt.db.run("UPDATE creatives SET review_state = 'pending' WHERE id = ?", [c]);
    expect((await h.gw.app.request(url)).status).toBe(404);
  });
});
