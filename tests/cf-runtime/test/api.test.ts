// Worker api tren workerd: dang nhap admin (scrypt + TOTP that), upload creative (presign + R2 cuc bo), outbox -> JOBS_QUEUE -> validator, cron.
import { describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { totp } from '@ams/shared';
import { getWorld, waitFor, type World } from '../src/world.js';

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
  if (b1.mfa_required) {
    const r2 = await w.api('/api/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mfa_token: b1.mfa_token, code: await totp(totpSecret, Date.now()) }) });
    expect(r2.status).toBe(200);
    jar = [...jar, ...cookiesOf(r2)];
    csrf = ((await r2.json()) as any).csrf_token;
  }
  const cookie = jar.filter((c) => !/=$/.test(c)).join('; ');
  const json = async (method: string, path: string, body?: unknown) => {
    const r = await w.api('/api' + path, { method, headers: { cookie, 'x-csrf-token': csrf, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  return { json, loginMs };
}

describe('api Worker tren workerd', () => {
  it('dang nhap admin (mat khau scrypt tham so that + TOTP), chong replay TOTP, upload creative -> R2 -> validator -> clean', async () => {
    const w = await getWorld();
    const s = await seed(w.rt, { log: false, deviceCount: 130 });
    const admin = s.credentials.find((c) => c.role === 'super_admin' && c.status === 'active')!;
    const ses = await adminSession(w, admin.email, admin.password!, admin.totpSecret!);
    console.log(`[do] dang nhap admin (scrypt) tren workerd: ${ses.loginMs} ms`);
    const me = await ses.json('GET', '/admin/v1/me');
    expect([200, 404]).toContain(me.status);
    // TOTP da dung khong dung lai duoc (D1 counters nguyen tu)
    const r1 = await w.api('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: admin.password }) });
    const b1: any = await r1.json();
    const code = await totp(admin.totpSecret!, Date.now());
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
