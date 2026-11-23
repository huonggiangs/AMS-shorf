// "Chan doan dong bo" (admin /history): vi sao so luot xem dang 0 hoac thap? Doi chieu theo TUNG thiet bi:
//   nhip tim cuoi (devices.last_seen_at, ghi moi >= 10 phut) -> su kien gateway da nhan (device_event_stats, 24h) -> da luu vao bang su kien (ev_*) -> da dem vao bao cao.
// Chi noi bo (finance|devices|campaigns:view). Khong tra khoa, chu ky hay noi dung su kien, chi dem so.
import { getRt, num } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';

export type DiagCode = 'ok' | 'no_devices' | 'offline' | 'pending_trust' | 'blocked' | 'no_events' | 'all_rejected' | 'not_counted' | 'ingest_lag';

export const DIAG_TEXT: Record<DiagCode, string> = {
  ok: 'Đồng bộ bình thường: thiết bị đang gửi bằng chứng phát và hệ thống đã ghi nhận.',
  no_devices: 'Chưa có thiết bị nào đăng ký. Cài app lên màn hình rồi cấp quyền ở trang Thiết bị.',
  offline: 'Thiết bị đang offline (không gửi nhịp tim). Kiểm tra nguồn điện, mạng và app trên màn hình.',
  pending_trust: 'Thiết bị chưa được cấp quyền: các lượt phát vẫn được lưu nhưng CHƯA tính vào báo cáo. Vào Thiết bị > Cấp quyền, số liệu sẽ tự tính lại.',
  blocked: 'Thiết bị đang bị chặn nên không gửi được dữ liệu.',
  no_events: 'Thiết bị online nhưng chưa gửi lượt phát nào trong 24 giờ. App chưa phát quảng cáo của chiến dịch, hoặc chưa tới chu kỳ gửi (app gửi mỗi vài phút).',
  all_rejected: 'Máy chủ nhận dữ liệu nhưng từ chối toàn bộ. Xem cột lý do từ chối để biết app gửi sai gì (vd creative không thuộc lịch phát, lệch giờ máy).',
  not_counted: 'Đã nhận lượt phát nhưng chưa tính là lượt xem hợp lệ (phát chưa đủ 90% thời lượng hoặc đang chờ cấp quyền).',
  ingest_lag: 'Máy chủ đã nhận sự kiện nhưng chưa ghi xong vào cơ sở dữ liệu (đang chờ hàng đợi xử lý, thường vài phút). Nếu kéo dài, kiểm tra consumer của hàng đợi ams-ingest.',
};

export interface DeviceDiag {
  id: string;
  name: string | null;
  kind: string;
  location: string | null;
  trust_level: number;
  blocked: boolean;
  last_heartbeat_at: string | null;
  last_event_at: string | null;
  online: boolean;
  received_24h: number;
  accepted_24h: number;
  valid_24h: number;
  rejected_24h: number;
  stored_24h: number;
  rejected_by_reason: Record<string, number>;
  flagged_by_reason: Record<string, number>;
  aliases: Record<string, number>;
  code: DiagCode;
  explain: string;
}

const ONLINE_MS = 25 * 60_000; // last_seen_at chi ghi moi >= 10 phut

export async function syncDiagnostics(c: Ctx): Promise<{ generated_at: string; window_hours: 24; summary: { code: DiagCode; explain: string; devices: number; online: number; events_accepted_24h: number; events_rejected_24h: number; stored_24h: number; ingest_gap: number; last_event_at: string | null; queue_lag_s: number | null }; devices: DeviceDiag[] }> {
  const rt = getRt(c);
  const now = rt.clock.now();
  const nowMs = now.getTime();
  const hourFrom = new Date(nowMs - 24 * 3600_000).toISOString().slice(0, 13);
  const tsFrom = new Date(nowMs - 24 * 3600_000).toISOString();
  const kind = c.req.query('kind');
  const devs = await rt.db.query<{ id: string; name: string | null; kind: string; trust_level: number; blocked: number; last_seen_at: string | null; loc: string | null }>(
    `SELECT d.id, d.name, d.kind, d.trust_level, d.blocked, d.last_seen_at, l.name AS loc
       FROM devices d LEFT JOIN device_profiles dp ON dp.device_id = d.id LEFT JOIN locations l ON l.id = dp.location_id
      WHERE d.deleted_at IS NULL ${kind ? 'AND d.kind = ?' : ''} ORDER BY d.last_seen_at DESC LIMIT 300`,
    kind ? [kind] : [],
  );
  const stats = await rt.db.query<{ device_id: string; reason: string; n: number; last_at: string }>(
    'SELECT device_id, reason, SUM(n) AS n, MAX(last_at) AS last_at FROM device_event_stats WHERE hour >= ? GROUP BY device_id, reason',
    [hourFrom],
  );
  const lastEv = await rt.db.query<{ device_id: string; last_at: string }>('SELECT device_id, MAX(last_at) AS last_at FROM device_event_stats GROUP BY device_id');
  const impStored = await rt.db.query<{ device_id: string; n: number }>('SELECT device_id, COUNT(*) AS n FROM ev_ad_impression WHERE ts >= ? AND device_id IS NOT NULL GROUP BY device_id', [tsFrom]);
  const popStored = await rt.db.query<{ device_id: string; n: number }>('SELECT device_id, COUNT(*) AS n FROM ev_proof_of_play WHERE ts >= ? AND device_id IS NOT NULL GROUP BY device_id', [tsFrom]);

  const byDev = new Map<string, { reason: string; n: number }[]>();
  for (const s of stats) (byDev.get(s.device_id) ?? byDev.set(s.device_id, []).get(s.device_id)!).push({ reason: s.reason, n: num(s.n) });
  const lastBy = new Map(lastEv.map((r) => [r.device_id, r.last_at]));
  const storedBy = new Map<string, number>();
  for (const r of [...impStored, ...popStored]) storedBy.set(r.device_id, (storedBy.get(r.device_id) ?? 0) + num(r.n));

  const out: DeviceDiag[] = devs.map((d) => {
    const rows = byDev.get(d.id) ?? [];
    const get = (k: string): number => rows.find((r) => r.reason === k)?.n ?? 0;
    const sub = (prefix: string): Record<string, number> => Object.fromEntries(rows.filter((r) => r.reason.startsWith(prefix)).map((r) => [r.reason.slice(prefix.length), r.n]));
    const rejectedBy = sub('rej:');
    const rejected = Object.values(rejectedBy).reduce((a, b) => a + b, 0);
    const accepted = get('accepted');
    const received = accepted + rejected;
    const valid = get('valid');
    const stored = storedBy.get(d.id) ?? 0;
    const online = !!d.last_seen_at && nowMs - Date.parse(d.last_seen_at) <= ONLINE_MS;
    let code: DiagCode = 'ok';
    if (Number(d.blocked) === 1) code = 'blocked';
    else if (!online) code = 'offline';
    else if (Number(d.trust_level) < 1 && d.kind !== 'tv') code = 'pending_trust';
    else if (received === 0) code = 'no_events';
    else if (accepted === 0 && rejected > 0) code = 'all_rejected';
    else if (accepted > stored + Math.max(2, Math.floor(accepted * 0.1))) code = 'ingest_lag';
    else if (accepted > 0 && valid === 0) code = 'not_counted';
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      location: d.loc,
      trust_level: Number(d.trust_level),
      blocked: Number(d.blocked) === 1,
      last_heartbeat_at: d.last_seen_at,
      last_event_at: lastBy.get(d.id) ?? null,
      online,
      received_24h: received,
      accepted_24h: accepted,
      valid_24h: valid,
      rejected_24h: rejected,
      stored_24h: stored,
      rejected_by_reason: rejectedBy,
      flagged_by_reason: sub('flag:'),
      aliases: sub('alias:'),
      code,
      explain: DIAG_TEXT[code],
    };
  });

  const screens = out.filter((d) => d.kind !== 'tv' || d.received_24h > 0 || d.online);
  const pool = screens.length ? screens : out;
  const onlineN = pool.filter((d) => d.online).length;
  const accepted = pool.reduce((s, d) => s + d.accepted_24h, 0);
  const rejected = pool.reduce((s, d) => s + d.rejected_24h, 0);
  const stored = pool.reduce((s, d) => s + d.stored_24h, 0);
  const gap = Math.max(0, accepted - stored);
  const lastEvent = pool.map((d) => d.last_event_at).filter((x): x is string => !!x).sort().pop() ?? null;
  let code: DiagCode;
  if (pool.length === 0) code = 'no_devices';
  else {
    const codes = pool.map((d) => d.code);
    const pri: DiagCode[] = ['ok', 'ingest_lag', 'not_counted', 'all_rejected', 'pending_trust', 'no_events', 'offline', 'blocked'];
    const nOk = codes.filter((x) => x === 'ok').length;
    // neu co thiet bi tot thi bao tot; con lai: bao nguyen nhan pho bien nhat
    if (nOk > 0 && nOk >= pool.length / 2) code = 'ok';
    else {
      const cnt = new Map<DiagCode, number>();
      for (const x of codes) if (x !== 'ok') cnt.set(x, (cnt.get(x) ?? 0) + 1);
      code = [...cnt].sort((a, b) => b[1] - a[1] || pri.indexOf(b[0]) - pri.indexOf(a[0]))[0]?.[0] ?? 'ok';
    }
  }
  return {
    generated_at: now.toISOString(),
    window_hours: 24,
    summary: {
      code,
      explain: DIAG_TEXT[code],
      devices: pool.length,
      online: onlineN,
      events_accepted_24h: accepted,
      events_rejected_24h: rejected,
      stored_24h: stored,
      ingest_gap: gap,
      last_event_at: lastEvent,
      queue_lag_s: gap > 0 && lastEvent ? Math.max(0, Math.round((nowMs - Date.parse(lastEvent)) / 1000)) : null,
    },
    devices: out,
  };
}
