// Lenh gui thiet bi tu web quan tri (w-dev). Bang `device_commands` + enqueue/ack nam o gateway (services/edge-gateway/src/commands.ts);
// file nay chi la lop admin: danh muc lenh cho phep + kiem tra args, ACL theo thiet bi, han muc toc do, idempotency, huy, dong thoi gian.
// KHONG phai realtime: thiet bi nhan lenh o heartbeat ke tiep (mac dinh vai phut), xem delivery_note.
import { Hono } from 'hono';
import { z } from 'zod';
import { CommandError, enqueueCommand } from '@ams/edge-gateway';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { conflict, notFound, tooMany, unprocessable } from '../lib/errors.js';
import { getRt, num, parseBody } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

export const CANCEL_RESULT = 'cancelled_by_admin';
export const DEFAULT_TTL_S = 3600;
export const MIN_TTL_S = 60;
export const MAX_TTL_S = 7 * 24 * 3600;

const okArgs = z.object({}).strict();
const scalar = z.union([z.string().max(100), z.number(), z.boolean()]);

export interface CmdDef {
  type: string;
  label: string;
  desc: string;
  args: z.ZodTypeAny;
  /** 'protocol' = nam trong docs/DEVICE-PROTOCOL.md muc 6 (app TV da xu ly); 'brainrot' = ten lenh LAN cua Brain-rot, can xac nhan app map duoc tu heartbeat */
  support: 'protocol' | 'brainrot';
  risky?: boolean;
}

export const COMMANDS: CmdDef[] = [
  { type: 'refresh_manifest', label: 'Tải lại lịch quảng cáo', desc: 'Buộc TV lấy manifest mới.', args: okArgs, support: 'protocol' },
  { type: 'reboot', label: 'Khởi động lại ứng dụng', desc: 'TV khởi động lại ứng dụng Brain-rot (không tắt nguồn TV).', args: okArgs, support: 'protocol', risky: true },
  { type: 'set_monitor', label: 'Chế độ giám sát', desc: 'Bật chế độ giám sát (heartbeat dày, state=3) để theo dõi sát thiết bị.', args: z.object({ on: z.boolean().default(true) }).strict(), support: 'protocol' },
  { type: 'lock', label: 'Khóa TV', desc: 'Khóa màn hình TV (màn khóa phụ huynh).', args: z.object({ reason: z.string().trim().max(120).optional() }).strict(), support: 'brainrot', risky: true },
  { type: 'unlock', label: 'Mở khóa TV', desc: 'Mở khóa TV.', args: okArgs, support: 'brainrot' },
  { type: 'message', label: 'Gửi thông báo lên TV', desc: 'Hiện một tin nhắn ngắn trên màn hình TV.', args: z.object({ text: z.string().trim().min(1, 'Nhập nội dung tin nhắn').max(200), seconds: z.number().int().min(5).max(120).default(15) }).strict(), support: 'brainrot' },
  { type: 'pause', label: 'Tạm dừng phát', desc: 'Tạm dừng nội dung đang phát (tùy ứng dụng phát có hỗ trợ).', args: okArgs, support: 'brainrot' },
  { type: 'resume', label: 'Tiếp tục phát', desc: 'Tiếp tục phát.', args: okArgs, support: 'brainrot' },
  {
    type: 'display-settings',
    label: 'Cài đặt giao diện TV',
    desc: 'Gửi các cặp khóa/giá trị giao diện (tối đa 10). Ý nghĩa do ứng dụng TV quyết định.',
    args: z.object({ settings: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'Tên khóa không hợp lệ'), scalar).refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 10, 'Từ 1 đến 10 mục') }).strict(),
    support: 'brainrot',
  },
];
const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const BY_TYPE = new Map(COMMANDS.map((c) => [c.type, c]));

/** Trang thai hien thi: `cancelled` suy ra tu failed + result cancelled_by_admin (khong them gia tri CHECK moi). */
export type CmdState = 'pending' | 'delivered' | 'acked' | 'failed' | 'expired' | 'cancelled';

interface Row {
  id: string;
  device_id: string;
  type: string;
  args: string | null;
  status: string;
  idempotency_key: string | null;
  expires_at: string;
  created_by: string | null;
  created_at: string;
  delivered_at: string | null;
  deliveries: number;
  acked_at: string | null;
  result: string | null;
  created_by_name: string | null;
}
const SELECT = `SELECT k.id, k.device_id, k.type, k.args, k.status, k.idempotency_key, k.expires_at, k.created_by, k.created_at, k.delivered_at, k.deliveries, k.acked_at, k.result, a.name AS created_by_name
  FROM device_commands k LEFT JOIN admins a ON a.id = k.created_by`;

export function present(r: Row, nowIso: string) {
  const cancelled = r.status === 'failed' && r.result === CANCEL_RESULT;
  const overdue = (r.status === 'pending' || r.status === 'delivered') && r.expires_at <= nowIso;
  const state: CmdState = cancelled ? 'cancelled' : overdue ? 'expired' : (r.status as CmdState);
  const timeline: { at: string; event: string; note?: string }[] = [{ at: r.created_at, event: 'created', note: r.created_by_name ?? undefined }];
  if (r.delivered_at) timeline.push({ at: r.delivered_at, event: 'delivered', note: `lần giao ${num(r.deliveries)}` });
  if (r.acked_at) timeline.push({ at: r.acked_at, event: r.status === 'failed' ? 'failed' : 'acked', note: r.result ?? undefined });
  else if (cancelled) timeline.push({ at: r.acked_at ?? r.delivered_at ?? r.created_at, event: 'cancelled' });
  else if (r.status === 'failed') timeline.push({ at: r.delivered_at ?? r.created_at, event: 'failed', note: r.result ?? undefined });
  if (state === 'expired') timeline.push({ at: r.expires_at, event: 'expired' });
  return {
    id: r.id,
    device_id: r.device_id,
    type: r.type,
    label: BY_TYPE.get(r.type)?.label ?? r.type,
    args: r.args ? (JSON.parse(r.args) as Record<string, unknown>) : null,
    state,
    status: r.status,
    idempotency_key: r.idempotency_key,
    expires_at: r.expires_at,
    created_at: r.created_at,
    created_by: r.created_by_name,
    delivered_at: r.delivered_at,
    deliveries: num(r.deliveries),
    acked_at: r.acked_at,
    result: cancelled ? null : r.result,
    timeline,
  };
}

const createBody = z
  .object({
    type: z.string().trim().min(1).max(40),
    args: z.record(z.unknown()).optional(),
    ttl_s: z.number().int().min(MIN_TTL_S, `TTL tối thiểu ${MIN_TTL_S} giây`).max(MAX_TTL_S, 'TTL tối đa 7 ngày').default(DEFAULT_TTL_S),
    idempotency_key: z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,64}$/, 'Khóa chống trùng gồm 8-64 ký tự chữ, số, _ . : -').optional(),
  })
  .strict();

/** `/admin/v1/devices/:id/commands` — gan trong deviceRoutes. Chi tai khoan noi bo (requireInternal o app.ts) co quyen devices; khach khong thay duoc. */
export function deviceCommandRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  /** Thiet bi phai ton tai (404 neu khong); moi lenh/lenh-theo-id deu bi rang buoc voi device_id tren duong dan (chong IDOR giua cac thiet bi). */
  async function loadDevice(c: Ctx): Promise<{ id: string; blocked: number; trust_level: number; last_seen_at: string | null; status: string }> {
    const rt = getRt(c);
    const d = (await rt.db.query<{ id: string; blocked: number; trust_level: number; last_seen_at: string | null; status: string }>('SELECT id, blocked, trust_level, last_seen_at, status FROM devices WHERE id = ?', [c.req.param('id') ?? '']))[0];
    if (!d) throw notFound('Không tìm thấy thiết bị.');
    return d;
  }

  r.get('/', requirePerm('devices', 'view'), async (c) => {
    const rt = getRt(c);
    const d = await loadDevice(c);
    const st = c.req.query('status');
    const rows = await rt.db.query<Row>(`${SELECT} WHERE k.device_id = ?${st && ['pending', 'delivered', 'acked', 'failed', 'expired'].includes(st) ? ' AND k.status = ?' : ''} ORDER BY k.created_at DESC, k.id DESC LIMIT 100`, st && ['pending', 'delivered', 'acked', 'failed', 'expired'].includes(st) ? [d.id, st] : [d.id]);
    const nowIso = rt.clock.now().toISOString();
    return c.json({ items: rows.map((x) => present(x, nowIso)), total: rows.length, delivery: deliveryInfo(rt.config.env), types: COMMANDS.map(({ type, label, desc, support, risky }) => ({ type, label, desc, support, risky: !!risky })) });
  });

  r.get('/:cid', requirePerm('devices', 'view'), async (c) => {
    const rt = getRt(c);
    const d = await loadDevice(c);
    const row = (await rt.db.query<Row>(`${SELECT} WHERE k.id = ? AND k.device_id = ?`, [c.req.param('cid') ?? '', d.id]))[0];
    if (!row) throw notFound('Không tìm thấy lệnh.');
    return c.json(present(row, rt.clock.now().toISOString()));
  });

  r.post('/', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const d = await loadDevice(c);
    const b = await parseBody(c, createBody);
    const def = BY_TYPE.get(b.type);
    if (!def) throw unprocessable(`Loại lệnh "${b.type}" không được hỗ trợ.`, 'command_type_unsupported', { allowed: COMMANDS.map((x) => x.type) });
    const parsed = def.args.safeParse(b.args ?? {});
    if (!parsed.success) throw unprocessable(`Tham số lệnh không hợp lệ: ${parsed.error.issues[0]?.message ?? 'sai định dạng'}.`, 'command_args_invalid', parsed.error.flatten());
    const args = parsed.data as Record<string, unknown>;
    const hasArgs = Object.keys(args).length > 0;
    const key = b.idempotency_key ?? c.req.header('idempotency-key') ?? undefined;
    if (key !== undefined && !/^[A-Za-z0-9_.:-]{8,64}$/.test(key)) throw unprocessable('Khóa chống trùng gồm 8-64 ký tự chữ, số, _ . : -', 'validation_error');
    // gui lai cung khoa: tra lenh cu (khong tao moi, khong tinh han muc); khac loai/tham so => 409
    if (key) {
      const ex = (await rt.db.query<Row>(`${SELECT} WHERE k.device_id = ? AND k.idempotency_key = ?`, [d.id, key]))[0];
      if (ex) {
        if (ex.type !== b.type || canon(ex.args ? (JSON.parse(ex.args) as unknown) : {}) !== canon(args)) throw conflict('Khóa chống trùng này đã được dùng cho một lệnh khác.', 'idempotency_conflict');
        return c.json({ ...present(ex, rt.clock.now().toISOString()), replayed: true }, 200);
      }
    }
    if (Number(d.blocked) === 1) throw conflict('Thiết bị đang bị chặn, không gửi lệnh.', 'device_blocked');
    if (num(d.trust_level) < 1) throw conflict('Thiết bị chưa ghép mã. Hãy ghép mã hiển thị trên TV trước khi gửi lệnh.', 'device_not_paired');
    // han muc: theo nguoi dung (60 lenh/10 phut) va theo thiet bi (20 lenh/10 phut)
    const bucket = Math.floor(rt.clock.now().getTime() / 600_000);
    if ((await rt.kv.incr(`rl:devcmd:u:${u.id}:${bucket}`, 600)) > 60) throw tooMany('Bạn gửi lệnh quá nhiều, thử lại sau ít phút.', 300);
    if ((await rt.kv.incr(`rl:devcmd:d:${d.id}:${bucket}`, 600)) > 20) throw tooMany('Thiết bị này nhận quá nhiều lệnh trong thời gian ngắn, thử lại sau ít phút.', 300);
    let id: string;
    try {
      id = await enqueueCommand(rt, d.id, { type: b.type, ...(hasArgs ? { args } : {}) }, { ttlS: b.ttl_s, createdBy: u.id, ip: c.get('ip') ?? null, ...(key ? { idempotencyKey: key } : {}) });
    } catch (e) {
      if (e instanceof CommandError) {
        if (e.code === 'queue_full') throw tooMany('Thiết bị đang có quá nhiều lệnh chờ. Hủy bớt lệnh cũ hoặc chờ TV xử lý.', 300, 'queue_full');
        if (e.code === 'device_not_found') throw notFound('Không tìm thấy thiết bị.');
        throw unprocessable(e.message, 'command_invalid');
      }
      throw e;
    }
    const row = (await rt.db.query<Row>(`${SELECT} WHERE k.id = ?`, [id]))[0]!;
    return c.json({ ...present(row, rt.clock.now().toISOString()), replayed: false }, 201);
  });

  // Huy: chi lenh chua xong. `delivered` co the TV da thuc thi (khong the thu hoi): ghi ro trong phan hoi.
  r.post('/:cid/cancel', requirePerm('devices', 'write'), async (c) => {
    const rt = getRt(c);
    const d = await loadDevice(c);
    const cid = c.req.param('cid') ?? '';
    const row = (await rt.db.query<Row>(`${SELECT} WHERE k.id = ? AND k.device_id = ?`, [cid, d.id]))[0];
    if (!row) throw notFound('Không tìm thấy lệnh.');
    const nowIso = rt.clock.now().toISOString();
    let changed = 0;
    await rt.db.tx(async (db) => {
      changed = (await db.run("UPDATE device_commands SET status = 'failed', result = ?, acked_at = NULL WHERE id = ? AND device_id = ? AND status IN ('pending','delivered')", [CANCEL_RESULT, cid, d.id])).changes;
      if (changed === 1) await auditCtx(c, db, { action: 'device.command.cancel', objectType: 'device', objectId: d.id, diff: { command_id: cid, type: row.type, was: row.status } });
    });
    if (changed !== 1) throw conflict('Lệnh đã hoàn tất, hết hạn hoặc đã hủy, không thể hủy nữa.', 'command_not_cancellable', { state: present(row, nowIso).state });
    const after = (await rt.db.query<Row>(`${SELECT} WHERE k.id = ?`, [cid]))[0]!;
    return c.json({ ...present(after, nowIso), cancel_note: row.status === 'delivered' ? 'Lệnh đã được giao cho TV trước khi hủy; TV có thể đã thực thi.' : null });
  });

  return r;
}

/** Thong tin giao lenh (trung thuc): polling theo heartbeat, KHONG realtime. Gia tri lay tu cau hinh gateway (HB_*_S), mac dinh 600 giay khi ranh. */
export function deliveryInfo(env: Record<string, string | undefined>) {
  const n = (k: string, d: number) => (env[k] && Number.isFinite(Number(env[k])) ? Number(env[k]) : d);
  const idle = n('HB_IDLE_S', 600);
  const playing = n('HB_PLAYING_S', 300);
  const paired = n('HB_PAIRED_S', 0);
  const eff = (x: number) => (paired > 0 ? Math.min(x, Math.max(30, paired)) : x);
  return {
    mode: 'heartbeat_polling' as const,
    realtime: false,
    heartbeat_playing_s: eff(playing),
    heartbeat_idle_s: eff(idle),
    paired_cap_s: paired > 0 ? Math.max(30, paired) : null,
    redeliver_after_s: n('CMD_REDELIVER_S', 120),
    note: `Lệnh KHÔNG tới TV ngay: TV chỉ nhận lệnh ở lần heartbeat kế tiếp (khoảng ${Math.round(eff(playing) / 60)}–${Math.round(eff(idle) / 60)} phút, có jitter ±20%, kéo dài hơn khi hệ thống tải cao). Trạng thái "đã xác nhận" chỉ có khi TV gửi ACK thật.`,
  };
}
