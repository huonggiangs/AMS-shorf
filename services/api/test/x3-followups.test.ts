import { beforeAll, describe, expect, it } from 'vitest';
import { enqueueOutbox } from '@ams/runtime';
import { login, setup } from './helpers.js';
import type { Env } from './helpers.js';
import { createOutboxHandlers, pruneOutboxAll } from '../src/outbox.js';
import { processOutbox } from '@ams/runtime';
import { createFinancePort } from '../src/finance/index.js';

let env: Env;
const post = (path: string, body: unknown) => env.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeAll(async () => {
  env = await setup();
}, 120_000);

const tokenOf = (m: { text?: string; html: string }) => decodeURIComponent((m.text ?? m.html).match(/token=([^\s"&<]+)/)![1]!);

describe('x3: loi moi (info + chinh sach mat khau)', () => {
  it('GET /auth/invite/info tra ten/vai tro/khach, khong lo bi mat, khong tieu thu token; token sai -> 404', async () => {
    const admin = await login(env, env.byRole('super_admin'));
    const before = env.rt.mail.outbox.length;
    const c = await admin.json('POST', '/admin/v1/users', { name: 'Nguoi Duoc Moi', email: 'duocmoi@ams.vn', role: 'content_manager' });
    expect(c.status).toBe(201);
    const token = tokenOf(env.rt.mail.outbox[before]!);
    const info = await env.app.request(`/auth/invite/info?token=${encodeURIComponent(token)}`);
    expect(info.status).toBe(200);
    const b = (await info.json()) as Record<string, unknown>;
    expect(b).toMatchObject({ name: 'Nguoi Duoc Moi', role: 'content_manager', email: 'duocmoi@ams.vn' });
    expect(JSON.stringify(b)).not.toMatch(/token|hash|password|secret/i);
    // goi lai van duoc (khong tieu thu)
    expect((await env.app.request(`/auth/invite/info?token=${encodeURIComponent(token)}`)).status).toBe(200);
    expect((await env.app.request('/auth/invite/info?token=khong-ton-tai-0123456789')).status).toBe(404);
    expect((await env.app.request('/auth/invite/info')).status).toBe(404);
    // mat khau 10 ky tu chu+so (cu duoc chap nhan) nay bi tu choi; token van dung duoc
    const weak = await post('/auth/invite/accept', { token, password: 'abcdefgh12' });
    expect(weak.status).toBe(422);
    expect(((await weak.json()) as { error: { code: string } }).error.code).toBe('weak_password');
    expect((await post('/auth/invite/accept', { token, password: 'Abcdefghijk1' })).status).toBe(200);
    // da dung -> info 404
    expect((await env.app.request(`/auth/invite/info?token=${encodeURIComponent(token)}`)).status).toBe(404);
  });

  it('info bi gioi han toc do', async () => {
    let last = 0;
    for (let i = 0; i < 40; i++) last = (await env.app.request('/auth/invite/info?token=sai-sai-sai-sai-' + i, { headers: { 'x-forwarded-for': '9.9.9.9' } })).status;
    expect(last).toBe(429);
  });
});

describe('x3: quan tri dat lai mat khau', () => {
  it('dat co force_password_change, huy phien, doi mat khau cu', async () => {
    const admin = await login(env, env.byRole('super_admin'));
    const email = env.byRole('finance');
    const id = (await env.rt.db.query<{ id: string }>('SELECT id FROM admins WHERE email = ?', [email]))[0]!.id;
    const weak = await admin.json('POST', `/admin/v1/users/${id}/reset-password`, { password: 'short1A' });
    expect(weak.status).toBe(422);
    const r = await admin.json('POST', `/admin/v1/users/${id}/reset-password`, { password: 'TamThoi-Mat-Khau-77' });
    expect(r.status).toBe(200);
    expect(await env.rt.db.query('SELECT 1 FROM settings WHERE key = ?', [`force_password_change:${id}`])).toHaveLength(1);
    expect((await post('/auth/login', { email, password: env.cred(email).password })).status).toBe(401);
    expect((await post('/auth/login', { email, password: 'TamThoi-Mat-Khau-77' })).status).toBe(200);
    // khong tu dat lai cho chinh minh
    const me = (await admin.json<{ user: { id: string } }>('GET', '/auth/me')).body;
    const selfId = (me as { user?: { id: string }; id?: string }).user?.id ?? (me as { id?: string }).id;
    expect((await admin.json('POST', `/admin/v1/users/${selfId}/reset-password`, { password: 'TamThoi-Mat-Khau-78' })).status).toBe(403);
  });
});

describe('x3: outbox thu', () => {
  it('createOutboxHandlers gop mail.send: loi SMTP duoc thu lai, het loi thi gui', async () => {
    const rt = env.rt;
    const orig = rt.mail.send.bind(rt.mail);
    let fail = true;
    (rt.mail as { send: unknown }).send = async (m: Parameters<typeof orig>[0]) => {
      if (fail) throw new Error('smtp down');
      return orig(m);
    };
    try {
      await enqueueOutbox(rt.db, rt, { topic: 'mail.send', dedupeKey: 'x3:mail:1', payload: { to: 'a@b.vn', subject: 'chao', html: '<p>x</p>' } });
      const h = createOutboxHandlers(() => Promise.resolve(createFinancePort()));
      const r1 = await processOutbox(rt, h, { rounds: 1 });
      expect(r1.failed).toBe(1);
      fail = false;
      rt.clock.advance(60_000);
      const before = rt.mail.outbox.length;
      const r2 = await processOutbox(rt, h, { rounds: 1 });
      expect(r2.processed).toBeGreaterThanOrEqual(1);
      expect(rt.mail.outbox.length).toBe(before + 1);
    } finally {
      (rt.mail as { send: unknown }).send = orig;
    }
  });

  it('pruneOutboxAll xoa mail.send da gui > 6 gio (link moi dang ro) nhung giu thu dang cho', async () => {
    const rt = env.rt;
    await enqueueOutbox(rt.db, rt, { topic: 'mail.send', dedupeKey: 'x3:mail:old', payload: { to: 'a@b.vn', subject: 's', html: 'token=abc' } });
    await enqueueOutbox(rt.db, rt, { topic: 'mail.send', dedupeKey: 'x3:mail:pending', payload: { to: 'a@b.vn', subject: 's', html: 'token=def' } });
    const sent = new Date(rt.clock.now().getTime() - 7 * 3_600_000).toISOString();
    await rt.db.run("UPDATE outbox SET status = 'done', processed_at = ? WHERE dedupe_key = 'x3:mail:old'", [sent]);
    await pruneOutboxAll(rt);
    expect(await rt.db.query("SELECT 1 FROM outbox WHERE dedupe_key = 'x3:mail:old'")).toHaveLength(0);
    expect(await rt.db.query("SELECT 1 FROM outbox WHERE dedupe_key = 'x3:mail:pending'")).toHaveLength(1);
  });
});
