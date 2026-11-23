// vol-fix: lenh am luong tren workerd THAT: web (api Worker) -> D1 -> gateway Worker (heartbeat) -> thiet bi ao ky Ed25519 -> ack -> web.
import { describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { totp } from '@ams/shared';
import { Dev, getWorld, type World } from '../src/world.js';

const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]!);
async function adminSession(w: World, email: string, password: string, totpSecret: string) {
  const r1 = await w.api('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
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
  return async (method: string, path: string, body?: unknown) => {
    const r = await w.api('/api' + path, { method, headers: { cookie, 'x-csrf-token': csrf, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
}

describe('am luong tren workerd', () => {
  it('TV da ghep + thang may da cap quyen: set_volume qua heartbeat, ack kem ket qua, web thay "acked" + huy hieu caps + ETA', async () => {
    const w = await getWorld();
    const s = await seed(w.rt, { log: false, deviceCount: 1 });
    const adm = s.credentials.find((c) => c.role === 'super_admin' && c.status === 'active')!;
    const api = await adminSession(w, adm.email, adm.password!, adm.totpSecret!);
    const tv = await Dev.create(w, { kind: 'tv' }); // da ghep ma
    const el = await Dev.create(w, { kind: 'elevator', pair: false, region: 'HN' });
    expect((await api('POST', `/admin/v1/devices/${el.id}/approve`, {})).status).toBe(200);
    for (const d of [tv, el]) {
      const c = await api('POST', `/admin/v1/devices/${d.id}/commands`, { type: 'set_volume', args: { percent: 42 } });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const hb = await d.call('POST', '/v1/heartbeat', { state: 1, volume: 10, caps: ['set_volume'] });
      expect(hb.status, await hb.clone().text()).toBe(200);
      const body: any = await hb.json();
      expect(body.commands).toEqual([{ id: c.body.id, type: 'set_volume', args: { percent: 42 } }]);
      const ack = await d.call('POST', '/v1/commands/ack', { acks: [{ id: c.body.id, status: 'ok', result: JSON.stringify({ applied_percent: 42, mode: 'system' }) }] });
      expect(ack.status).toBe(200);
      const list = await api('GET', `/admin/v1/device-groups/devices?q=${d.id}`);
      const row = list.body.items.find((x: any) => x.id === d.id);
      expect(row, JSON.stringify(list.body).slice(0, 300)).toMatchObject({ can_set_volume: true, caps: ['set_volume'], controllable: true });
      expect(row.volume_cmd).toMatchObject({ state: 'acked', applied_percent: 42, mode: 'system' });
      expect(Date.parse(row.next_heartbeat_at)).toBeGreaterThan(Date.parse(row.last_heartbeat_at));
    }
  });
});
