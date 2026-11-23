// Worker api tren workerd: dang nhap admin (scrypt + TOTP that), upload creative (presign + R2 cuc bo), outbox -> JOBS_QUEUE -> validator, cron.
import { describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { totp } from '@ams/shared';
import { seedAdFixture } from '@ams/edge-gateway/testing';
import { uuidv7 } from '@ams/shared';
import { Dev, getWorld, seedMoney, waitFor, type World } from '../src/world.js';

const png = (w: number, h: number) => {
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const ch = (t: string, b: number[] = []) => [...be(b.length), ...[...t].map((c) => c.charCodeAt(0)), ...b, 0, 0, 0, 0];
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ch('IHDR', [...be(w), ...be(h), 8, 2, 0, 0, 0]), ...ch('IDAT', [1, 2, 3]), ...ch('IEND')]);
};
const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]!);

async function adminSession(w: World, email: string, password: string, totpSecret: string) {
  const t0 = Date.now();
  const r1 = await w.api('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const loginMs = Date.now() - t0;
  expect(r1.status).toBe(200);
  const b1: any = await r1.json();
  let jar = cookiesOf(r1);
  let csrf: string = b1.csrf_token ?? '';
  let usedCode = '';
  if (b1.mfa_required) {
    usedCode = await totp(totpSecret, Date.now());
    const r2 = await w.api('/api/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mfa_token: b1.mfa_token, code: usedCode }) });
    expect(r2.status).toBe(200);
    jar = [...jar, ...cookiesOf(r2)];
    csrf = ((await r2.json()) as any).csrf_token;
  }
  const cookie = jar.filter((c) => !/=$/.test(c)).join('; ');
  const json = async (method: string, path: string, body?: unknown) => {
    const r = await w.api('/api' + path, { method, headers: { cookie, 'x-csrf-token': csrf, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  return { json, loginMs, usedCode };
}

let seeded: Awaited<ReturnType<typeof seed>> | null = null;

describe('api Worker tren workerd', () => {
  it('dang nhap admin (mat khau scrypt tham so that + TOTP), chong replay TOTP, upload creative -> R2 -> validator -> clean', async () => {
    const w = await getWorld();
    const s = await seed(w.rt, { log: false, deviceCount: 130 });
    seeded = s;
    const admin = s.credentials.find((c) => c.role === 'super_admin' && c.status === 'active')!;
    const ses = await adminSession(w, admin.email, admin.password!, admin.totpSecret!);
    console.log(`[do] dang nhap admin (scrypt) tren workerd: ${ses.loginMs} ms`);
    const me = await ses.json('GET', '/admin/v1/me');
    expect([200, 404]).toContain(me.status);
    // TOTP da dung khong dung lai duoc (D1 counters nguyen tu)
    const r1 = await w.api('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: admin.password }) });
    const b1: any = await r1.json();
    const code = ses.usedCode; // dung lai dung ma da dung (tranh bien cua so 30 giay khi may tai)
    const v = await w.api('/api/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mfa_token: b1.mfa_token, code }) });
    expect(v.status).toBe(401); // cung ma TOTP vua dung o session tren (cung 30 giay) -> replay bi chan

    // D1: toi da 100 tham so/cau lenh. Danh sach 130 thiet bi (IN (...130)) va thao tac hang loat 150 id phai chay duoc.
    const lst = await ses.json('GET', '/admin/v1/devices?page_size=150');
    expect(lst.status, JSON.stringify(lst.body).slice(0, 300)).toBe(200);
    expect((lst.body.items ?? lst.body.data ?? []).length).toBeGreaterThan(100);
    const ids = Array.from({ length: 150 }, (_, i) => `NOPE${String(i).padStart(4, '0')}`);
    const bulk = await ses.json('POST', '/admin/v1/devices/bulk', { action: 'block', ids });
    expect(bulk.status, JSON.stringify(bulk.body).slice(0, 300)).toBe(200);
    expect(bulk.body).toMatchObject({ updated: 0, requested: 150 });

    const K001 = s.customers['K001']!;
    const bytes = png(1920, 1080);
    const up = await ses.json('POST', '/admin/v1/media/upload-url', { customer_id: K001, name: 'ok.png', content_type: 'image/png', size_bytes: bytes.length });
    expect(up.status).toBe(201);
    expect(String(up.body.upload_url ?? up.body.url ?? JSON.stringify(up.body))).toMatch(/X-Amz-Signature|signature/i); // presign SigV4 tren workerd (WebCrypto)
    await w.rt.objects.put(up.body.key, bytes, 'image/png'); // R2 binding cuc bo (thay cho PUT toi endpoint S3)
    const cf = await ses.json('POST', `/admin/v1/media/${up.body.id}/confirm`, {});
    expect(cf.status).toBe(200);
    const row = await waitFor(async () => {
      const r = (await w.rt.db.query<{ scan_state: string; sha256: string | null }>('SELECT scan_state, sha256 FROM creatives WHERE id = ?', [up.body.id]))[0];
      return r && r.scan_state !== 'pending' ? r : false;
    }, 'validator xu ly creative (outbox -> JOBS_QUEUE)');
    expect(row.scan_state).toBe('clean');
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cron: scheduled() cua api va gateway chay het (outbox, purge kv_counters, ops) khong loi', async () => {
    const w = await getWorld();
    await w.rt.kv.incrBy('test:expired', 1, 1);
    await new Promise((r) => setTimeout(r, 2200));
    for (const cron of ['* * * * *', '*/10 * * * *', '15 2 * * *']) await w.apiScheduled(cron);
    await w.gwScheduled('* * * * *');
    await new Promise((r) => setTimeout(r, 500));
    expect((await w.rt.db.query('SELECT 1 FROM kv_counters WHERE k = ?', ['test:expired'])).length).toBe(0);
  });
});

// Luot xem tu thiet bi toi trang /history va dashboard khach — tren workerd that (gateway Worker + hang doi ams-ingest + consumer + D1 + api Worker).
// Thiet bi gui DUNG dinh dang cua Signage Player (proof_of_play) va Mindo (impression) -> bao cao admin va cong khach tra dung so, khach khac 0.
describe('bao cao luot xem tren workerd', () => {
  it('Signage Player + Mindo gui -> consumer ghi -> /admin/v1/reports/views va /portal/v1/reports/views dem dung; IDOR; chan doan', async () => {
    const w = await getWorld();
    const s = seeded;
    expect(s, 'can api.test dau tien (gieo du lieu demo)').toBeTruthy();
    const cred = (email: string) => s!.credentials.find((c) => c.email === email)!;
    const supers = s!.credentials.filter((c) => c.role === 'super_admin' && c.status === 'active');
    const admin = cred(supers[supers.length - 1]!.email);
    if (supers.length === 1) await new Promise((r) => setTimeout(r, 31_000)); // ma TOTP cua test dau da dung trong cua so 30 giay (chong replay)
    const adminS = await adminSession(w, admin.email, admin.password!, admin.totpSecret!);
    const lan = cred('lan@vinamilk.example');
    const lanS = await adminSession(w, lan.email, lan.password!, lan.totpSecret!);
    const dang = cred('dang@unilever.example');
    const dangS = await adminSession(w, dang.email, dang.password!, dang.totpSecret!);

    // chien dich thang may (Signage Player) + chien dich TV (Mindo) cua khach K001
    const K001 = s!.customers['K001']!;
    const el = await seedAdFixture(w.rt, { campaigns: 1, creativesPerCampaign: 1, targetType: 'elevator', px: { w: 1080, h: 1920 }, regions: null, durationS: 15 });
    const elCamp = el.campaigns[0]!;
    const elCre = elCamp.creatives[0]!.id;
    await w.rt.db.run('UPDATE campaigns SET customer_id = ? WHERE id = ?', [K001, elCamp.id]);
    await w.rt.db.run('UPDATE creatives SET customer_id = ? WHERE id = ?', [K001, elCre]);
    await w.rt.kv.incr('manifest:epoch');

    // --- Signage Player: dang ky (kind elevator, px khai), heartbeat, manifest, chua cap quyen -> luu nhung chua tinh
    const lift = await Dev.create(w, { kind: 'elevator', pair: false });
    await w.rt.db.run("INSERT INTO device_profiles (device_id, px_w, px_h, orientation) VALUES (?, 1080, 1920, 'portrait') ON CONFLICT (device_id) DO UPDATE SET px_w = 1080, px_h = 1920", [lift.id]);
    expect((await lift.call('POST', '/v1/heartbeat', { state: 1, app_ver: '1.14' })).status).toBe(200);
    const mf: any = await (await lift.call('GET', '/v1/manifest')).json();
    expect(JSON.stringify(mf)).toContain(elCre);
    const t = Date.now();
    const pop = (ms: number, off: number) => ({ type: 'proof_of_play', event_id: uuidv7(t + off), ts: new Date(t + off - 3000).toISOString(), creative_id: elCre, duration_ms: ms });
    const r1: any = await (await lift.events([pop(15000, -1), pop(15000, -2)])).json();
    expect(r1).toMatchObject({ accepted: 2, valid: 0, flagged: 2, rejected: [] });
    // cap quyen qua API admin that -> luot phat cu duoc tinh lai
    const ap = await adminS.json('POST', `/admin/v1/devices/${lift.id}/approve`, { name: 'Thang máy CF-1' });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const r2: any = await (await lift.events([pop(14000, -3), pop(5000, -4)])).json();
    expect(r2).toMatchObject({ accepted: 2, valid: 1, flagged: 1 });

    await waitFor(async () => Number((await w.rt.db.query<any>('SELECT COUNT(*) AS n FROM ev_proof_of_play WHERE device_id = ?', [lift.id]))[0].n) === 4 || false, 'consumer ghi 4 proof_of_play (hang doi ams-ingest)');
    const rep = await adminS.json('GET', `/admin/v1/reports/views?campaign_id=${elCamp.id}`);
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    expect(rep.body.totals.views).toBe(3); // 2 tinh lai + 1 moi hop le; 1 qua ngan khong tinh
    expect(rep.body.by_device[0]).toMatchObject({ id: lift.id, views: 3 });

    // --- cong khach K001 thay dung 3; khach khac 0; khong thay thiet bi
    const mine = await lanS.json('GET', '/portal/v1/reports/views');
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.totals.views).toBeGreaterThanOrEqual(3);
    expect(mine.body.by_campaign.find((c: any) => c.id === elCamp.id)).toMatchObject({ views: 3 });
    expect(JSON.stringify(mine.body)).not.toContain(lift.id);
    expect((await dangS.json('GET', '/portal/v1/reports/views')).body.by_campaign.some((c: any) => c.id === elCamp.id)).toBe(false);
    expect((await dangS.json('GET', `/portal/v1/reports/views?campaign_id=${elCamp.id}`)).status).toBe(404);

    // --- chan doan
    const diag = await adminS.json('GET', '/admin/v1/history/diagnostics');
    expect(diag.status).toBe(200);
    expect(diag.body.devices.find((d: any) => d.id === lift.id)).toMatchObject({ accepted_24h: 4, valid_24h: 1 });

    // --- Mindo (TV): impression dung dinh dang AdsRules.toWire; thiet bi TV da ghep
    const m = await seedMoney(w);
    const tv = await Dev.create(w);
    await tv.call('GET', '/v1/manifest');
    await w.rt.db.run('UPDATE campaigns SET customer_id = ? WHERE id = ?', [K001, m.campaignIds[0]!]);
    const c0 = m.fixture.campaigns[0]!;
    const imp = (off: number) => ({ type: 'impression', event_id: uuidv7(t + off), ts: new Date(t + off - 3000).toISOString(), campaign_id: c0.id, creative_id: c0.creatives[0]!.id, slot_id: c0.slotId, vcr_pct: 100, played_ms: 15000 });
    expect(await (await tv.events([imp(-10), imp(-11), imp(-12)])).json()).toMatchObject({ accepted: 3, valid: 3 });
    await waitFor(async () => Number((await w.rt.db.query<any>('SELECT COUNT(*) AS n FROM ev_ad_impression WHERE campaign_id = ?', [c0.id]))[0].n) === 3 || false, 'consumer ghi 3 impression');
    const tvRep = await lanS.json('GET', `/portal/v1/reports/views?campaign_id=${c0.id}`);
    expect(tvRep.body.totals.views).toBe(3);
    const hist = await lanS.json('GET', `/portal/v1/history?campaign_id=${c0.id}`);
    expect(hist.body.items.length).toBe(3);
  });
});
