// Chuong trinh phat song noi bo (migrations/0020): tep trong kho (chua gan chien dich) -> manifest cua thiet bi thang may; khong qua hop dong/thanh toan.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANIFEST_EPOCH_KEY, sha256Hex } from '@ams/shared';
import { attestForTest, seedAdFixture } from '../src/testing.js';
import { TestDevice, harness, type Harness } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let h: Harness;
let customerId: string;
const J = async (r: Response): Promise<any> => (await r.json()) as any;
const el = (reg: Record<string, unknown> = {}) => TestDevice.create(h, { kind: 'elevator', model: 'RK3568', os: 'android-11', app_version: '1.0.0', ...reg });
const bump = async () => {
  await h.rt.kv.incr(MANIFEST_EPOCH_KEY);
  await h.gw.manifests.invalidate();
};

async function libraryCreative(opts: { w?: number; h?: number; campaignId?: string | null; review?: string } = {}): Promise<{ id: string; sha256: string }> {
  const id = h.rt.id();
  const key = `test/${customerId}/${id}.mp4`;
  const bytes = new TextEncoder().encode(`library-${id}`);
  await h.rt.objects.put(key, bytes, 'video/mp4');
  await h.rt.db.run(
    `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, storage_key, mime, size_bytes, duration_s, scan_state, review_state, state, created_at)
     VALUES (?, ?, ?, ?, 'elevator', ?, ?, 'portrait', 'video', 'upload', ?, 'video/mp4', ?, 15, 'clean', ?, 'ready', ?)`,
    [id, opts.campaignId ?? null, customerId, `lib-${id}.mp4`, opts.w ?? 1080, opts.h ?? 1920, key, bytes.length, opts.review ?? 'approved', h.rt.clock.now().toISOString()],
  );
  await attestForTest(h.rt, id);
  return { id, sha256: await sha256Hex(bytes) };
}

async function program(o: { creatives: string[]; status?: string; regions?: string[]; startDate?: string | null; endDate?: string | null; header?: string | null; footer?: string | null; startMin?: number; endMin?: number }): Promise<string> {
  const id = h.rt.id();
  const now = h.rt.clock.now().toISOString();
  await h.rt.db.run(
    `INSERT INTO broadcast_programs (id, name, target_type, regions, start_date, end_date, start_min, end_min, priority, header, footer, status, version, created_at, updated_at)
     VALUES (?, 'Chuong trinh', 'elevator', ?, ?, ?, ?, ?, 3, ?, ?, ?, 1, ?, ?)`,
    [id, JSON.stringify(o.regions ?? []), o.startDate ?? null, o.endDate ?? null, o.startMin ?? 0, o.endMin ?? 1440, o.header ?? null, o.footer ?? null, o.status ?? 'published', now, now],
  );
  for (const [i, c] of o.creatives.entries()) await h.rt.db.run('INSERT INTO broadcast_program_items (program_id, creative_id, position) VALUES (?,?,?)', [id, c, i]);
  await bump();
  return id;
}

beforeAll(async () => {
  h = await harness({ env: { HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000' }, fixture: { campaigns: 0 } });
  customerId = (await seedAdFixture(h.rt, { campaigns: 0 })).customerId;
}, 60_000);
afterAll(async () => h.close());

describe('chuong trinh phat song noi bo -> manifest', () => {
  it('chuong trinh da xuat ban dua tep trong kho vao manifest (slot/campaign_id = bp_<id>, dung thu tu, header/footer rieng); ban nhap thi khong', async () => {
    const a = await libraryCreative();
    const b = await libraryCreative();
    const draft = await program({ creatives: [a.id], status: 'draft' });
    const d = await el({ px_w: 1080, px_h: 1920, region: 'HN' });
    let m = await J(await d.call('GET', '/v1/manifest'));
    expect(m.creatives.map((c: any) => c.id)).not.toContain(a.id);
    expect(m.schedule.map((s: any) => s.slot_id)).not.toContain(`bp_${draft}`);

    const pid = await program({ creatives: [b.id, a.id], header: 'Chao mung', footer: 'Hotline 0365361688', startMin: 480, endMin: 1200 });
    m = await J(await d.call('GET', '/v1/manifest'));
    const slot = m.schedule.find((s: any) => s.slot_id === `bp_${pid}`);
    expect(slot).toMatchObject({ campaign_id: `bp_${pid}`, creative_ids: [b.id, a.id], start_min: 480, end_min: 1200, reward_points: 0, header: 'Chao mung', footer: 'Hotline 0365361688' });
    const cb = m.creatives.find((c: any) => c.id === b.id);
    expect(cb).toMatchObject({ campaign_id: `bp_${pid}`, sha256: b.sha256, px_w: 1080, px_h: 1920 });
  });

  it('loc theo khu vuc va ngay hieu luc; tep chua duyet hoac da gan chien dich bi loai', async () => {
    const x = await libraryCreative();
    const pHcm = await program({ creatives: [x.id], regions: ['HCM'] });
    const hn = await el({ px_w: 1080, px_h: 1920, region: 'HN' });
    const hcm = await el({ px_w: 1080, px_h: 1920, region: 'HCM' });
    expect((await J(await hn.call('GET', '/v1/manifest'))).schedule.map((s: any) => s.slot_id)).not.toContain(`bp_${pHcm}`);
    expect((await J(await hcm.call('GET', '/v1/manifest'))).schedule.map((s: any) => s.slot_id)).toContain(`bp_${pHcm}`);

    const y = await libraryCreative();
    const ended = await program({ creatives: [y.id], endDate: '2000-01-01' });
    const future = await program({ creatives: [y.id], startDate: '2999-01-01' });
    const m = await J(await hn.call('GET', '/v1/manifest'));
    expect(m.schedule.map((s: any) => s.slot_id)).not.toContain(`bp_${ended}`);
    expect(m.schedule.map((s: any) => s.slot_id)).not.toContain(`bp_${future}`);

    const pending = await libraryCreative({ review: 'pending' });
    const camp = (await seedAdFixture(h.rt, { campaigns: 1, targetType: 'elevator', px: { w: 1080, h: 1920 }, regions: null })).campaigns[0]!;
    const inCamp = await libraryCreative({ campaignId: camp.id, w: 768, h: 1366 });
    const pBad = await program({ creatives: [pending.id, inCamp.id] });
    await bump();
    const m2 = await J(await hn.call('GET', '/v1/manifest'));
    expect(m2.schedule.map((s: any) => s.slot_id)).not.toContain(`bp_${pBad}`);
    expect(m2.creatives.find((c: any) => c.id === pending.id)).toBeUndefined();
    expect(m2.creatives.find((c: any) => c.id === inCamp.id)?.campaign_id ?? camp.id).toBe(camp.id); // neu co trong manifest thi van thuoc chien dich, khong bi chuong trinh gianh lay
  });

  it('cung mot tep o hai chuong trinh: manifest chi co mot ban cua tep, ca hai slot deu tham chieu', async () => {
    const z = await libraryCreative();
    const p1 = await program({ creatives: [z.id] });
    const p2 = await program({ creatives: [z.id] });
    const d = await el({ px_w: 1080, px_h: 1920, region: 'DN' });
    const m = await J(await d.call('GET', '/v1/manifest'));
    expect(m.creatives.filter((c: any) => c.id === z.id)).toHaveLength(1);
    expect(m.schedule.find((s: any) => s.slot_id === `bp_${p1}`).creative_ids).toEqual([z.id]);
    expect(m.schedule.find((s: any) => s.slot_id === `bp_${p2}`).creative_ids).toEqual([z.id]);
  });

  it('chuong trinh co bo cuc da vung: slot co layout kem creative_ids theo vung; chuong trinh khong co bo cuc thi khong co truong layout', async () => {
    const a = await libraryCreative();
    const b = await libraryCreative();
    const c2 = await libraryCreative();
    const plain = await program({ creatives: [a.id] });
    const pid = await program({ creatives: [a.id, b.id, c2.id] });
    const zones = [
      { id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 80, z: 0, transition: 'fade' },
      { id: 'side', type: 'image', x: 0, y: 80, w: 50, h: 20, z: 1, transition: 'none' },
      { id: 'tick', type: 'marquee', x: 50, y: 80, w: 50, h: 20, z: 2, text: 'Xin chao', bg_color: '#DC2626' },
    ];
    const now = h.rt.clock.now().toISOString();
    await h.rt.db.run('INSERT INTO broadcast_program_layouts (program_id, template_id, orientation, zones, updated_at) VALUES (?,?,?,?,?)', [pid, null, 'portrait', JSON.stringify(zones), now]);
    await h.rt.db.run('INSERT INTO broadcast_item_zones (program_id, creative_id, zone_id) VALUES (?,?,?)', [pid, b.id, 'side']);
    await bump();
    const d = await el({ px_w: 1080, px_h: 1920, region: 'HN' });
    const m = await J(await d.call('GET', '/v1/manifest'));
    const slot = m.schedule.find((s: any) => s.slot_id === `bp_${pid}`);
    expect(slot.layout.orientation).toBe('portrait');
    expect(slot.layout.zones.find((z: any) => z.id === 'main').creative_ids).toEqual([a.id, c2.id]); // tep chua gan vung roi vao vung media dau
    expect(slot.layout.zones.find((z: any) => z.id === 'side').creative_ids).toEqual([b.id]);
    expect(slot.layout.zones.find((z: any) => z.id === 'tick').creative_ids).toBeUndefined();
    expect(slot.creative_ids).toEqual([a.id, b.id, c2.id]); // thiet bi cu van phat tuan tu nhu truoc
    expect(m.schedule.find((s: any) => s.slot_id === `bp_${plain}`).layout).toBeUndefined();
  });
  it('vung QR trong manifest mang qr_kind + url san sang (VietQR -> URL anh, URL -> noi dung, anh -> data URL); vung thoi tiet mang toa do', async () => {
    const a = await libraryCreative();
    const pid = await program({ creatives: [a.id] });
    const zones = [
      { id: 'main', type: 'video', x: 0, y: 0, w: 100, h: 60 },
      { id: 'q1', type: 'qr', x: 0, y: 60, w: 30, h: 30, qr: { mode: 'vietqr', vietqr: { bin: '970436', account: '0123456789', name: 'ANIO', amount: 50000, memo: 'Thanh toan' } } },
      { id: 'q2', type: 'qr', x: 30, y: 60, w: 30, h: 30, qr: { mode: 'url', value: 'https://anio.vn' } },
      { id: 'q3', type: 'qr', x: 60, y: 60, w: 20, h: 20, qr: { mode: 'image', value: 'data:image/png;base64,AAAA' } },
      { id: 'w', type: 'weather', x: 80, y: 60, w: 20, h: 20, weather: { mode: 'gps', lat: 21.0285, lon: 105.8542, label: 'Ha Noi' } },
    ];
    await h.rt.db.run('INSERT INTO broadcast_program_layouts (program_id, template_id, orientation, zones, updated_at) VALUES (?,?,?,?,?)', [pid, null, 'portrait', JSON.stringify(zones), h.rt.clock.now().toISOString()]);
    await bump();
    const d = await el({ px_w: 1080, px_h: 1920, region: 'HN' });
    const m = await J(await d.call('GET', '/v1/manifest'));
    const zs = m.schedule.find((s: any) => s.slot_id === `bp_${pid}`).layout.zones;
    const q1 = zs.find((z: any) => z.id === 'q1');
    expect(q1.qr_kind).toBe('image_url');
    expect(q1.url).toBe('https://img.vietqr.io/image/970436-0123456789-qr_only.png?amount=50000&addInfo=Thanh+toan&accountName=ANIO');
    expect(zs.find((z: any) => z.id === 'q2')).toMatchObject({ qr_kind: 'text', url: 'https://anio.vn' });
    expect(zs.find((z: any) => z.id === 'q3')).toMatchObject({ qr_kind: 'data_url', url: 'data:image/png;base64,AAAA' });
    expect(zs.find((z: any) => z.id === 'w').weather).toMatchObject({ mode: 'gps', lat: 21.0285, lon: 105.8542 });
  });
});

describe('nhom manifest rieng cua thiet bi (chuong trinh gan thiet bi, migration 0022)', () => {
  it('groupString/parseGroup hai chieu; duong cong khai khong tra nhom thiet bi', async () => {
    const { groupString, parseGroup } = await import('../src/manifest.js');
    const g = { region: 'HN', daypart: 'all', modelClass: 'elevator_1080x1920', device: 'dev_abc-1' };
    expect(groupString(g)).toBe('HN.all.elevator_1080x1920.d-dev_abc-1');
    expect(parseGroup(groupString(g))).toEqual(g);
    expect(parseGroup('HN.all.elevator_1080x1920')).toEqual({ region: 'HN', daypart: 'all', modelClass: 'elevator_1080x1920' });
    const res = await h.gw.app.request(`/v1/manifest/g/${encodeURIComponent(groupString(g))}`);
    expect(res.status).toBe(404);
  });

  it('thiet bi duoc chon nhan chuong trinh trong manifest rieng; thiet bi cung khu vuc khong nhan; bo chon thi tro ve nhom khu vuc', async () => {
    const a = await el({ region: 'DG', px_w: 1080, px_h: 1920, orientation: 'portrait' });
    const b = await el({ region: 'DG', px_w: 1080, px_h: 1920, orientation: 'portrait' });
    const lib = await libraryCreative();
    const pd = await program({ creatives: [lib.id] });
    await h.rt.db.run('INSERT INTO broadcast_program_devices (program_id, device_id) VALUES (?, ?)', [pd, a.id]);
    await bump();
    const ma = await J(await a.call('GET', '/v1/manifest'));
    const mb = await J(await b.call('GET', '/v1/manifest'));
    expect(ma.schedule.some((x: any) => x.slot_id === `bp_${pd}`)).toBe(true);
    expect(ma.group).toContain(`.d-${a.id}`);
    expect(mb.schedule.some((x: any) => x.slot_id === `bp_${pd}`)).toBe(false);
    expect(mb.group).not.toContain('.d-');
    await h.rt.db.run('DELETE FROM broadcast_program_devices WHERE program_id = ?', [pd]);
    await bump();
    expect((await J(await b.call('GET', '/v1/manifest'))).schedule.some((x: any) => x.slot_id === `bp_${pd}`)).toBe(true);
  });
});
