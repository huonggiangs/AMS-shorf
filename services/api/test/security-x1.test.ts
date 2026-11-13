import { beforeAll, describe, expect, it } from 'vitest';
import { login, setup } from './helpers.js';
import type { Env } from './helpers.js';

let env: Env;
beforeAll(async () => {
  env = await setup();
}, 120_000);

const post = (path: string, body: unknown) => env.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('R1-01 moi nguoi noi bo luon mfa_required=1', () => {
  it('invite finance -> mfa_required=1; chua bat TOTP thi dang nhap chi nhan thu thach, khong co phien', async () => {
    const admin = await login(env, env.byRole('super_admin'));
    const before = env.rt.mail.outbox.length;
    const c = await admin.json<{ id: string }>('POST', '/admin/v1/users', { name: 'Ke Toan Moi', email: 'ketoan.moi@ams.vn', role: 'finance' });
    expect(c.status).toBe(201);
    const row = (await env.rt.db.query<{ mfa_required: number }>('SELECT mfa_required FROM admins WHERE id = ?', [c.body.id]))[0]!;
    expect(Number(row.mfa_required)).toBe(1);
    const mail = env.rt.mail.outbox[before]!;
    const token = decodeURIComponent((mail.text ?? mail.html).match(/token=([^\s"&<]+)/)![1]!);
    expect((await post('/auth/invite/accept', { token, password: 'MatKhau-Manh-2026' })).status).toBe(200);
    const lg = await post('/auth/login', { email: 'ketoan.moi@ams.vn', password: 'MatKhau-Manh-2026' });
    const b = (await lg.json()) as { mfa_required?: boolean; csrf_token?: string };
    expect(b.mfa_required).toBe(true);
    expect(b.csrf_token).toBeUndefined();
    const cookie = lg.headers.getSetCookie().map((x) => x.split(';')[0]!).filter((x) => !/=$/.test(x)).join('; ');
    const r = await env.app.request('/admin/v1/topups', { headers: { cookie } });
    expect(r.status).toBe(401);
  });
  it('moi vai tro noi bo khac cung mfa_required=1', async () => {
    const admin = await login(env, env.byRole('super_admin'));
    for (const role of ['content_manager', 'device_ops']) {
      const c = await admin.json<{ id: string }>('POST', '/admin/v1/users', { name: 'NV ' + role, email: `${role}.x1@ams.vn`, role });
      expect(c.status).toBe(201);
      expect(Number((await env.rt.db.query<{ m: number }>('SELECT mfa_required AS m FROM admins WHERE id = ?', [c.body.id]))[0]!.m)).toBe(1);
    }
  });
});

describe('R1-07 admin:write uy quyen khong tu cap vai tro vuot quyen cua minh', () => {
  it('content_manager + admin:write: moi finance / doi vai tro finance -> 403 escalation; moi vai tro trong tam quyen van duoc', async () => {
    const admin = await login(env, env.byRole('super_admin'));
    const cmEmail = env.byRole('content_manager');
    const users = (await admin.json('GET', '/admin/v1/users?filter=role:content_manager&page_size=50')).body.items as { id: string; email: string }[];
    const cmUser = users.find((u) => u.email === cmEmail)!;
    const cur = (await admin.json('GET', `/admin/v1/permissions/${cmUser.id}`)).body.permissions as Record<string, string[]>;
    const put = await admin.json('PUT', `/admin/v1/permissions/${cmUser.id}`, { permissions: { ...cur, admin: [...new Set([...(cur.admin ?? []), 'view', 'write'])] } });
    expect(put.status).toBe(200);
    const cm = await login(env, cmEmail);
    const inv = await cm.json<{ error: { code: string } }>('POST', '/admin/v1/users', { name: 'Chiem Quyen', email: 'chiem@ams.vn', role: 'finance' });
    expect(inv.status).toBe(403);
    expect(inv.body.error.code).toBe('escalation');
    expect((await env.rt.db.query('SELECT 1 AS x FROM admins WHERE email = ?', ['chiem@ams.vn'])).length).toBe(0);
    const fin = (await admin.json('GET', '/admin/v1/users?filter=role:device_ops&page_size=1')).body.items[0];
    const pr = await cm.json<{ error: { code: string } }>('PUT', `/admin/v1/users/${fin.id}`, { role: 'finance' });
    expect(pr.status).toBe(403);
    expect(pr.body.error.code).toBe('escalation');
    // vai tro cap thap hon (content_manager, quyen nam trong tay ho) van moi duoc
    expect((await cm.json('POST', '/admin/v1/users', { name: 'Dong Nghiep', email: 'dongnghiep@ams.vn', role: 'content_manager' })).status).toBe(201);
  });
});
