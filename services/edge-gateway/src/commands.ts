// Lenh gui thiet bi (P0 muc 3): bang `device_commands` thay danh sach trong KV.
//   pending --(heartbeat tra ve)--> delivered --(thiet bi ack)--> acked | failed ;  pending|delivered --(qua han)--> expired
// Giao AT-LEAST-ONCE: lenh `delivered` ma chua ack duoc giao lai o heartbeat sau CMD_REDELIVER_S giay (lenh phai idempotent).
// Idempotency: UNIQUE (device_id, idempotency_key) => day lai cung khoa tra ve cung id, khong tao lenh moi, khong ghi audit moi.
// Duong nong (heartbeat) KHONG truy van DB moi lan: chi khi co co hieu `cmdflag:<device>` trong kv (dat luc enqueue, xoa khi het lenh mo),
// hoac khi heartbeat mang cmd_ack. Quet dinh ky (sweepCommands) het han lenh va dung lai co hieu bi mat.
import type { Runtime } from '@ams/runtime';

export const CMD_TTL_S = 7 * 24 * 3600;
export const MAX_OPEN_PER_DEVICE = 50;
export const MAX_DELIVERIES = 10;
export const MAX_DELIVER_PER_HEARTBEAT = 20;
const MAX_ARGS_BYTES = 2048;
export const CMD_TYPE_RE = /^[a-z][a-z0-9_.-]{0,39}$/;

export type CommandStatus = 'pending' | 'delivered' | 'acked' | 'failed' | 'expired';

export class CommandError extends Error {
  constructor(public code: 'device_not_found' | 'queue_full' | 'invalid_command', message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface EnqueueOptions {
  /** khu trung theo thiet bi: cung khoa => cung lenh (khong tao moi) */
  idempotencyKey?: string;
  ttlS?: number;
  /** admins.id (hoac dinh danh he thong) — ghi vao audit_log */
  createdBy?: string | null;
  ip?: string | null;
}

export interface DeviceCommand {
  id: string;
  device_id: string;
  type: string;
  args: Record<string, unknown> | null;
  status: CommandStatus;
  idempotency_key: string | null;
  expires_at: string;
  created_by: string | null;
  created_at: string;
  delivered_at: string | null;
  deliveries: number;
  acked_at: string | null;
  result: string | null;
}

const flagKey = (deviceId: string) => `cmdflag:${deviceId}`;
const iso = (rt: Runtime, plusS = 0) => new Date(rt.clock.now().getTime() + plusS * 1000).toISOString();

/**
 * Day lenh cho thiet bi; tra id (da co neu trung idempotencyKey). Ghi lenh + audit_log trong MOT batch nguyen tu
 * (audit chi ghi khi chinh lan goi nay tao lenh).
 */
export async function enqueueCommand(rt: Runtime, deviceId: string, cmd: { type: string; args?: Record<string, unknown> }, opts: EnqueueOptions = {}): Promise<string> {
  if (!CMD_TYPE_RE.test(cmd.type)) throw new CommandError('invalid_command', 'type lenh khong hop le (a-z, 0-9, _ . -; toi da 40 ky tu).');
  const args = cmd.args === undefined ? null : JSON.stringify(cmd.args);
  if (args !== null && args.length > MAX_ARGS_BYTES) throw new CommandError('invalid_command', `args vuot ${MAX_ARGS_BYTES} byte.`);
  const dev = (await rt.db.query<{ id: string }>('SELECT id FROM devices WHERE id = ?', [deviceId]))[0];
  if (!dev) throw new CommandError('device_not_found', 'Thiet bi khong ton tai.');
  const key = opts.idempotencyKey ?? null;
  if (key !== null) {
    const ex = (await rt.db.query<{ id: string }>('SELECT id FROM device_commands WHERE device_id = ? AND idempotency_key = ?', [deviceId, key]))[0];
    if (ex) return ex.id;
  }
  const open = Number((await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM device_commands WHERE device_id = ? AND status IN ('pending','delivered')", [deviceId]))[0]?.n ?? 0);
  if (open >= MAX_OPEN_PER_DEVICE) throw new CommandError('queue_full', `Thiet bi da co ${open} lenh dang cho.`);
  const id = rt.id();
  const now = iso(rt);
  const expires = iso(rt, opts.ttlS ?? CMD_TTL_S);
  await rt.db.batch([
    {
      sql: `INSERT INTO device_commands (id, device_id, type, args, status, idempotency_key, expires_at, created_by, created_at, deliveries)
            VALUES (?,?,?,?, 'pending', ?,?,?,?,0) ON CONFLICT (device_id, idempotency_key) DO NOTHING`,
      params: [id, deviceId, cmd.type, args, key, expires, opts.createdBy ?? null, now],
    },
    {
      sql: `INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, customer_id, ip, diff)
            SELECT ?,?,?,?,?,?,NULL,?,? WHERE EXISTS (SELECT 1 FROM device_commands WHERE id = ?)`,
      params: [rt.id(), now, opts.createdBy ?? null, 'device.command.enqueue', 'device', deviceId, opts.ip ?? null, JSON.stringify({ command_id: id, type: cmd.type, idempotency_key: key, expires_at: expires }), id],
    },
  ]);
  if (key !== null) {
    // dong thoi: co the thang khoa o cau lenh tren; tra id thang cuoc
    const row = (await rt.db.query<{ id: string }>('SELECT id FROM device_commands WHERE device_id = ? AND idempotency_key = ?', [deviceId, key]))[0];
    if (row && row.id !== id) return row.id;
  }
  await rt.kv.set(flagKey(deviceId), '1', opts.ttlS ?? CMD_TTL_S).catch(() => undefined);
  return id;
}

export interface Delivered {
  id: string;
  type: string;
  args?: Record<string, unknown>;
}

/** Heartbeat co can truy van DB khong? (co hieu trong kv, hoac thiet bi vua ack). */
export async function hasCommandFlag(rt: Runtime, deviceId: string): Promise<boolean> {
  return (await rt.kv.get(flagKey(deviceId)).catch(() => '1')) !== null; // kv loi: an toan hon la hoi DB
}

/**
 * Lay lenh can giao: pending, hoac delivered qua `redeliverAfterS` ma chua ack; con han; chua vuot MAX_DELIVERIES.
 * Danh dau delivered bang UPDATE co dieu kien (heartbeat dong thoi khong giao cung mot lenh hai lan trong cung nhip).
 * Het lenh mo => xoa co hieu.
 */
export async function takeDeliverable(rt: Runtime, deviceId: string, redeliverAfterS: number): Promise<Delivered[]> {
  const nowIso = iso(rt);
  const again = iso(rt, -redeliverAfterS);
  const rows = await rt.db.query<{ id: string; type: string; args: string | null; status: string; delivered_at: string | null }>(
    `SELECT id, type, args, status, delivered_at FROM device_commands
      WHERE device_id = ? AND expires_at > ? AND deliveries < ? AND (status = 'pending' OR (status = 'delivered' AND delivered_at <= ?))
      ORDER BY created_at, id LIMIT ?`,
    [deviceId, nowIso, MAX_DELIVERIES, again, MAX_DELIVER_PER_HEARTBEAT],
  );
  const out: Delivered[] = [];
  for (const r of rows) {
    const claim = await rt.db.run(
      `UPDATE device_commands SET status = 'delivered', delivered_at = ?, deliveries = deliveries + 1
        WHERE id = ? AND expires_at > ? AND ((status = 'pending') OR (status = 'delivered' AND delivered_at <= ?))`,
      [nowIso, r.id, nowIso, again],
    );
    if (claim.changes !== 1) continue;
    let args: Record<string, unknown> | undefined;
    if (r.args) {
      try {
        args = JSON.parse(r.args) as Record<string, unknown>;
      } catch {
        /* args hong: giao khong kem args */
      }
    }
    out.push({ id: r.id, type: r.type, ...(args ? { args } : {}) });
  }
  if (rows.length === 0) {
    const open = Number((await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM device_commands WHERE device_id = ? AND status IN ('pending','delivered') AND expires_at > ? AND deliveries < ?", [deviceId, nowIso, MAX_DELIVERIES]))[0]?.n ?? 0);
    if (open === 0) await rt.kv.del(flagKey(deviceId)).catch(() => undefined);
  }
  return out;
}

export interface AckItem {
  id: string;
  /** 'ok' (mac dinh) -> acked; 'failed' -> failed */
  status?: 'ok' | 'failed';
  result?: string;
}

/**
 * Thiet bi xac nhan. Idempotent: ack lai lenh da acked/failed khong doi gi (van tinh la "da biet"). Lenh khong thuoc thiet bi => unknown.
 * Cho phep ack ca lenh da `expired` (thiet bi lam xong muon): ghi nhan su that.
 */
export async function ackCommands(rt: Runtime, deviceId: string, items: AckItem[]): Promise<{ acked: number; known: number; unknown: string[] }> {
  const now = iso(rt);
  let acked = 0;
  let known = 0;
  const unknown: string[] = [];
  for (const it of items) {
    const st: CommandStatus = it.status === 'failed' ? 'failed' : 'acked';
    const r = await rt.db.run(
      "UPDATE device_commands SET status = ?, acked_at = ?, result = ? WHERE id = ? AND device_id = ? AND status IN ('pending','delivered','expired')",
      [st, now, it.result ? it.result.slice(0, 500) : null, it.id, deviceId],
    );
    if (r.changes === 1) {
      acked++;
      known++;
    } else if ((await rt.db.query('SELECT 1 AS x FROM device_commands WHERE id = ? AND device_id = ?', [it.id, deviceId]))[0]) known++;
    else unknown.push(it.id);
  }
  return { acked, known, unknown };
}

/** Quet dinh ky: het han -> expired; giao qua MAX_DELIVERIES lan khong ack -> failed; dung lai co hieu cho thiet bi con lenh mo. */
export async function sweepCommands(rt: Runtime): Promise<{ expired: number; failed: number; reflagged: number }> {
  const now = iso(rt);
  const expired = (await rt.db.run("UPDATE device_commands SET status = 'expired' WHERE status IN ('pending','delivered') AND expires_at <= ?", [now])).changes;
  const failed = (await rt.db.run("UPDATE device_commands SET status = 'failed', result = 'max_deliveries' WHERE status = 'delivered' AND deliveries >= ?", [MAX_DELIVERIES])).changes;
  const devs = await rt.db.query<{ device_id: string }>("SELECT DISTINCT device_id FROM device_commands WHERE status IN ('pending','delivered') AND expires_at > ? LIMIT 1000", [now]);
  let reflagged = 0;
  for (const d of devs) {
    if ((await rt.kv.get(flagKey(d.device_id)).catch(() => null)) === null) {
      await rt.kv.set(flagKey(d.device_id), '1', CMD_TTL_S).catch(() => undefined);
      reflagged++;
    }
  }
  return { expired, failed, reflagged };
}

export async function listCommands(rt: Runtime, deviceId: string, status?: CommandStatus): Promise<DeviceCommand[]> {
  const rows = await rt.db.query<Omit<DeviceCommand, 'args'> & { args: string | null }>(
    `SELECT id, device_id, type, args, status, idempotency_key, expires_at, created_by, created_at, delivered_at, deliveries, acked_at, result FROM device_commands
      WHERE device_id = ?${status ? ' AND status = ?' : ''} ORDER BY created_at, id`,
    status ? [deviceId, status] : [deviceId],
  );
  return rows.map((r) => ({ ...r, deliveries: Number(r.deliveries), args: r.args ? (JSON.parse(r.args) as Record<string, unknown>) : null }));
}
