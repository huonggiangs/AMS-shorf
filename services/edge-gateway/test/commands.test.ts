import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommandError, ackCommands, enqueueCommand, listCommands, sweepCommands } from '../src/commands.js';
import { MAX_DELIVERIES, MAX_OPEN_PER_DEVICE } from '../src/commands.js';
import { TestDevice, harness, type Harness } from './helpers.js';

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;

describe.each(['sqlite', 'postgres'] as const)('device_commands (%s)', (dialect) => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness({ dialect, env: { HB_MIN_GAP_S: '0', CMD_REDELIVER_S: '120' } });
  });
  afterAll(async () => h.close());
  const hb = async (d: TestDevice, body: Record<string, unknown> = {}) => (await J(await d.call('POST', '/v1/heartbeat', body))).commands as { id: string; type: string; args?: unknown }[];
  const status = async (id: string) => (await h.rt.db.query<{ status: string }>('SELECT status FROM device_commands WHERE id = ?', [id]))[0]!.status;

  it('enqueue ghi pending + audit_log; heartbeat giao va danh dau delivered (kem args)', async () => {
    const d = await TestDevice.create(h);
    const id = await enqueueCommand(h.rt, d.id, { type: 'set_monitor', args: { on: true } }, { createdBy: 'admin-1', ip: '10.0.0.1' });
    expect(await status(id)).toBe('pending');
    const audit = await h.rt.db.query<{ actor_id: string; object_id: string; diff: string; ip: string }>("SELECT actor_id, object_id, diff, ip FROM audit_log WHERE action = 'device.command.enqueue' AND object_id = ?", [d.id]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: 'admin-1', ip: '10.0.0.1' });
    expect(JSON.parse(audit[0]!.diff)).toMatchObject({ command_id: id, type: 'set_monitor' });
    expect(await hb(d)).toEqual([{ id, type: 'set_monitor', args: { on: true } }]);
    const [c] = await listCommands(h.rt, d.id);
    expect(c).toMatchObject({ status: 'delivered', deliveries: 1, created_by: 'admin-1' });
    expect(c!.delivered_at).not.toBeNull();
  });

  it('ack qua POST /v1/commands/ack: acked, ack lai idempotent, id la/thiet bi khac -> unknown', async () => {
    const d = await TestDevice.create(h);
    const other = await TestDevice.create(h);
    const id = await enqueueCommand(h.rt, d.id, { type: 'refresh_manifest' });
    await hb(d);
    const foreign = await enqueueCommand(h.rt, other.id, { type: 'reboot' });
    const r1 = await J(await d.call('POST', '/v1/commands/ack', { acks: [{ id }, { id: foreign }, { id: 'nope' }] }));
    expect(r1).toMatchObject({ ok: true, acked: 1, known: 1, unknown: [foreign, 'nope'] });
    expect(await status(id)).toBe('acked');
    expect(await status(foreign)).toBe('pending'); // khong ack ho thiet bi khac
    const r2 = await J(await d.call('POST', '/v1/commands/ack', { acks: [{ id }] }));
    expect(r2).toMatchObject({ acked: 0, known: 1, unknown: [] });
    expect(await hb(d)).toEqual([]);
    // ack chua ky bi tu choi
    const bad = await h.gw.app.request('/v1/commands/ack', { method: 'POST', body: JSON.stringify({ acks: [{ id }] }) });
    expect(bad.status).toBe(401);
  });

  it('ack failed + result; body sai -> 422', async () => {
    const d = await TestDevice.create(h);
    const id = await enqueueCommand(h.rt, d.id, { type: 'reboot' });
    await hb(d);
    expect((await d.call('POST', '/v1/commands/ack', { acks: [{ id, status: 'failed', result: 'khong ho tro' }] })).status).toBe(200);
    expect((await listCommands(h.rt, d.id))[0]).toMatchObject({ status: 'failed', result: 'khong ho tro' });
    expect((await d.call('POST', '/v1/commands/ack', { acks: [] })).status).toBe(422);
  });

  it('idempotency_key duy nhat theo thiet bi: day lai => cung id, mot dong, mot audit; thiet bi khac cung khoa => lenh rieng', async () => {
    const d = await TestDevice.create(h);
    const e = await TestDevice.create(h);
    const a = await enqueueCommand(h.rt, d.id, { type: 'reboot' }, { idempotencyKey: 'k-1' });
    const b = await enqueueCommand(h.rt, d.id, { type: 'reboot' }, { idempotencyKey: 'k-1' });
    const c = await enqueueCommand(h.rt, e.id, { type: 'reboot' }, { idempotencyKey: 'k-1' });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(await listCommands(h.rt, d.id)).toHaveLength(1);
    expect(Number((await h.rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'device.command.enqueue' AND object_id = ?", [d.id]))[0]!.n)).toBe(1);
    // dong thoi
    const ids = await Promise.all(Array.from({ length: 5 }, () => enqueueCommand(h.rt, d.id, { type: 'reboot' }, { idempotencyKey: 'k-race' })));
    expect(new Set(ids).size).toBe(1);
    expect((await listCommands(h.rt, d.id)).filter((x) => x.idempotency_key === 'k-race')).toHaveLength(1);
    // khong khoa: moi lan mot lenh
    await enqueueCommand(h.rt, d.id, { type: 'reboot' });
    await enqueueCommand(h.rt, d.id, { type: 'reboot' });
    expect((await listCommands(h.rt, d.id)).filter((x) => x.idempotency_key === null)).toHaveLength(2);
  });

  it('giao lai khi chua ack: khong giao trong cua so 120 s, giao lai sau do (deliveries tang); ack dung giao lai', async () => {
    const d = await TestDevice.create(h);
    const id = await enqueueCommand(h.rt, d.id, { type: 'refresh_manifest' });
    expect((await hb(d)).map((x) => x.id)).toEqual([id]);
    h.rt.clock.advance(30_000);
    expect(await hb(d)).toEqual([]); // vua giao
    h.rt.clock.advance(100_000);
    expect((await hb(d)).map((x) => x.id)).toEqual([id]);
    expect((await listCommands(h.rt, d.id))[0]!.deliveries).toBe(2);
    expect(await status(id)).toBe('delivered');
    await ackCommands(h.rt, d.id, [{ id }]);
    h.rt.clock.advance(200_000);
    expect(await hb(d)).toEqual([]);
  });

  it('het han: khong giao lenh qua han; sweep dat expired; ack muon van ghi nhan acked', async () => {
    const d = await TestDevice.create(h);
    const id = await enqueueCommand(h.rt, d.id, { type: 'refresh_manifest' }, { ttlS: 60 });
    const live = await enqueueCommand(h.rt, d.id, { type: 'reboot' });
    h.rt.clock.advance(61_000);
    expect((await hb(d)).map((x) => x.id)).toEqual([live]); // lenh het han khong duoc giao
    const sw = await sweepCommands(h.rt);
    expect(sw.expired).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toBe('expired');
    expect(await status(live)).toBe('delivered');
    expect((await ackCommands(h.rt, d.id, [{ id }])).acked).toBe(1);
    expect(await status(id)).toBe('acked');
  });

  it('giao qua MAX_DELIVERIES ma khong ack -> sweep dat failed(max_deliveries), ngung giao', async () => {
    const d = await TestDevice.create(h);
    const id = await enqueueCommand(h.rt, d.id, { type: 'reboot' });
    for (let i = 0; i < MAX_DELIVERIES; i++) {
      expect((await hb(d)).map((x) => x.id)).toEqual([id]);
      h.rt.clock.advance(121_000);
    }
    expect(await hb(d)).toEqual([]);
    await sweepCommands(h.rt);
    expect((await listCommands(h.rt, d.id))[0]).toMatchObject({ status: 'failed', result: 'max_deliveries', deliveries: MAX_DELIVERIES });
  });

  it('co hieu kv: heartbeat khong hoi DB khi khong co co hieu; sweep dung lai co hieu bi mat', async () => {
    const d = await TestDevice.create(h);
    const id = await enqueueCommand(h.rt, d.id, { type: 'reboot' });
    await h.rt.kv.del(`cmdflag:${d.id}`); // mo phong kv mat khoa
    expect(await hb(d)).toEqual([]); // duong nong bo qua DB
    expect((await sweepCommands(h.rt)).reflagged).toBeGreaterThanOrEqual(1);
    expect((await hb(d)).map((x) => x.id)).toEqual([id]);
    await ackCommands(h.rt, d.id, [{ id }]);
    await hb(d); // het lenh mo -> xoa co hieu
    expect(await h.rt.kv.get(`cmdflag:${d.id}`)).toBeNull();
  });

  it('kiem tra dau vao: thiet bi la, type sai, args qua lon, hang doi day', async () => {
    const d = await TestDevice.create(h);
    await expect(enqueueCommand(h.rt, 'khong-co', { type: 'reboot' })).rejects.toMatchObject({ code: 'device_not_found' });
    await expect(enqueueCommand(h.rt, d.id, { type: 'Reboot Now!' })).rejects.toBeInstanceOf(CommandError);
    await expect(enqueueCommand(h.rt, d.id, { type: 'x', args: { s: 'a'.repeat(3000) } })).rejects.toMatchObject({ code: 'invalid_command' });
    for (let i = 0; i < MAX_OPEN_PER_DEVICE; i++) await enqueueCommand(h.rt, d.id, { type: 'reboot' });
    await expect(enqueueCommand(h.rt, d.id, { type: 'reboot' })).rejects.toMatchObject({ code: 'queue_full' });
  });

  it('lenh duoc giao theo thu tu tao, toi da 20 moi heartbeat', async () => {
    const d = await TestDevice.create(h);
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await enqueueCommand(h.rt, d.id, { type: 'refresh_manifest' }));
    expect((await hb(d)).map((x) => x.id)).toEqual(ids.slice(0, 20));
    expect((await hb(d, { cmd_ack: ids.slice(0, 20) })).map((x) => x.id)).toEqual(ids.slice(20));
  });
});
