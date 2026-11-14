// Kiem tra van hanh dinh ky (P0-9): doc DB, mo/dong su co (ops_incidents), goi notifier co dedupe/cooldown.
// Chay: Docker = bo lap lich trong node.ts (moi 5 phut), Cloudflare = cron */10 trong worker.ts. Chi DOC du lieu nghiep vu, KHONG sua so cai.
import type { Runtime } from '@ams/runtime';
import { notifyIncident } from './notifier.js';

export type Severity = 'S1' | 'S2' | 'S3';
export type Component = 'api' | 'gateway' | 'db' | 'queue' | 'payments' | 'devices' | 'backup';

export interface Finding {
  key: string; // rule_key (co the co hau to ':<doi tuong>')
  severity: Severity;
  component: Component;
  title: string;
  detail: string; // chi cho quan tri
  publicNote: string; // an toan cho trang trang thai cong khai
  metric: number;
}

export interface Rule {
  group: string; // phan truoc dau ':' cua rule_key
  run(rt: Runtime): Promise<Finding[]>;
}

export interface OpsThresholds {
  webhookRejected1h: number;
  gateway5xx15m: number;
  api5xx15m: number;
  deviceOfflinePct: number;
  deviceOfflineCritPct: number;
  deviceMin: number;
  deviceOfflineMin: number;
  backupMaxAgeH: number;
  outboxStuckMin: number;
}

export function thresholds(env: Record<string, string | undefined>): OpsThresholds {
  const f = (k: string, d: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    webhookRejected1h: f('OPS_WEBHOOK_REJECTED_1H', 3),
    gateway5xx15m: f('OPS_GATEWAY_5XX_15M', 5),
    api5xx15m: f('OPS_API_5XX_15M', 10),
    deviceOfflinePct: f('OPS_DEVICE_OFFLINE_PCT', 30),
    deviceOfflineCritPct: f('OPS_DEVICE_OFFLINE_CRIT_PCT', 60),
    deviceMin: f('OPS_DEVICE_MIN', 20),
    deviceOfflineMin: f('OPS_DEVICE_OFFLINE_MIN', 15),
    backupMaxAgeH: f('OPS_BACKUP_MAX_AGE_HOURS', 26),
    outboxStuckMin: f('OPS_OUTBOX_STUCK_MIN', 10),
  };
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const iso = (rt: Runtime, minusMs = 0): string => new Date(rt.clock.now().getTime() - minusMs).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;
async function one(rt: Runtime, sql: string, params: unknown[] = []): Promise<Record<string, unknown>> {
  return (await rt.db.query<Record<string, unknown>>(sql, params))[0] ?? {};
}
/** Tong bo dem ops_counters trong `ms` gan nhat (tinh theo o 10 phut: lam tron xuong o chua moc). */
async function counterSum(rt: Runtime, name: string, ms: number): Promise<number> {
  const from = new Date(Math.floor((rt.clock.now().getTime() - ms) / 600_000) * 600_000).toISOString().slice(0, 16);
  return num((await one(rt, 'SELECT COALESCE(SUM(n),0) AS n FROM ops_counters WHERE name = ? AND bucket >= ?', [name, from]))['n']);
}

export function defaultRules(t: OpsThresholds): Rule[] {
  return [
    {
      group: 'webhook',
      async run(rt) {
        const out: Finding[] = [];
        const rejected = num((await one(rt, "SELECT COUNT(*) AS n FROM payment_webhooks WHERE signature_ok = 0 AND received_at >= ?", [iso(rt, HOUR)]))['n']);
        const e5 = await counterSum(rt, 'sepay_webhook_5xx', 30 * MIN);
        const stuck = num((await one(rt, 'SELECT COUNT(*) AS n FROM payment_webhooks WHERE signature_ok = 1 AND processed_at IS NULL AND received_at < ? AND received_at >= ?', [iso(rt, 10 * MIN), iso(rt, 48 * HOUR)]))['n']);
        if (e5 >= 1) out.push({ key: 'webhook:5xx', severity: 'S1', component: 'payments', title: 'Webhook SePay trả lỗi 5xx', detail: `${e5} phản hồi 5xx trong 30 phút qua. SePay sẽ gửi lại; kiểm tra log API và RUNBOOK mục SePay.`, publicNote: 'Nhận thanh toán tự động đang gặp sự cố.', metric: e5 });
        if (rejected >= t.webhookRejected1h) out.push({ key: 'webhook:rejected', severity: 'S2', component: 'payments', title: 'Webhook SePay bị từ chối nhiều (4xx)', detail: `${rejected} webhook sai chữ ký/bị tắt trong 1 giờ. Có thể bí mật webhook lệch hoặc có kẻ thăm dò.`, publicNote: 'Nhận thanh toán tự động có thể chậm.', metric: rejected });
        if (stuck > 0) out.push({ key: 'webhook:stuck', severity: 'S2', component: 'payments', title: 'Webhook SePay nhận nhưng chưa xử lý', detail: `${stuck} webhook hợp lệ quá 10 phút chưa xử lý xong; job đối soát SePay sẽ bù, nếu kéo dài hãy kiểm tra.`, publicNote: 'Nhận thanh toán tự động có thể chậm.', metric: stuck });
        return out;
      },
    },
    {
      group: 'ledger',
      async run(rt) {
        // Cung dinh nghia voi reconcileLedger (services/payments/src/jobs.ts) nhung CHI DOC (khong ghi audit/thong bao moi lan).
        const rows = await rt.db.query<Record<string, unknown>>(
          `SELECT w.customer_id AS customer_id, COALESCE(e.b,0) AS b, COALESCE(e.r,0) AS r, COALESCE(e.s,0) AS s, w.balance_vnd AS wb, w.reserved_vnd AS wr, w.spent_vnd AS ws
           FROM ad_wallets w LEFT JOIN (
             SELECT customer_id,
               SUM(CASE WHEN kind IN ('topup','adjust') THEN amount_vnd WHEN kind IN ('spend','refund') THEN -amount_vnd ELSE 0 END) AS b,
               SUM(CASE WHEN kind = 'reserve' THEN amount_vnd WHEN kind IN ('release','spend') THEN -amount_vnd ELSE 0 END) AS r,
               SUM(CASE WHEN kind = 'spend' THEN amount_vnd ELSE 0 END) AS s
             FROM wallet_entries GROUP BY customer_id) e ON e.customer_id = w.customer_id`,
        );
        let drift = 0;
        for (const x of rows) if (num(x['b']) !== num(x['wb']) || num(x['r']) !== num(x['wr']) || num(x['s']) !== num(x['ws'])) drift++;
        const orphans = num((await one(rt, `SELECT COUNT(*) AS n FROM topups t WHERE t.status = 'credited' AND t.provider IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wallet_entries e WHERE e.kind = 'topup' AND e.ref_type = 'topup' AND e.ref_id = t.id)`))['n']);
        const out: Finding[] = [];
        if (drift + orphans > 0) out.push({ key: 'ledger:drift', severity: 'S1', component: 'payments', title: 'Ví lệch sổ cái', detail: `${drift} ví lệch số dư/giữ/chi so với wallet_entries, ${orphans} lần nạp đã ghi nhưng thiếu dòng sổ cái. Dừng nạp/chi tiêu tự động và xem RUNBOOK (đối soát).`, publicNote: 'Thanh toán và số dư đang được kiểm tra đối soát.', metric: drift + orphans });
        const disc = num((await one(rt, "SELECT COUNT(*) AS n FROM revenue_discrepancies WHERE status = 'open'"))['n']);
        if (disc > 0) out.push({ key: 'ledger:revenue_discrepancy', severity: 'S2', component: 'payments', title: 'Doanh thu lệch với impression', detail: `${disc} chênh lệch đang mở trong revenue_discrepancies (job đối soát doanh thu).`, publicNote: 'Đối soát doanh thu đang được kiểm tra.', metric: disc });
        const last = await one(rt, "SELECT status, started_at FROM reconcile_runs WHERE kind = 'revenue' ORDER BY started_at DESC LIMIT 1");
        if (last['status'] === 'error') out.push({ key: 'ledger:reconcile_error', severity: 'S3', component: 'payments', title: 'Job đối soát lần gần nhất lỗi', detail: `reconcile_runs (revenue) lần ${String(last['started_at'])} kết thúc bằng lỗi.`, publicNote: '', metric: 1 });
        return out;
      },
    },
    {
      group: 'queue',
      async run(rt) {
        const out: Finding[] = [];
        const dead = num((await one(rt, "SELECT COUNT(*) AS n FROM outbox WHERE status = 'dead'"))['n']);
        const stuck = num((await one(rt, "SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending' AND available_at < ?", [iso(rt, t.outboxStuckMin * MIN)]))['n']);
        if (dead > 0) out.push({ key: 'queue:outbox_dead', severity: 'S2', component: 'queue', title: 'Outbox có việc chết (dead-letter)', detail: `${dead} việc outbox hết số lần thử (bảng outbox, status=dead): duyệt chiến dịch/giữ tiền/manifest có thể chưa xong. Xem RUNBOOK 4.1.`, publicNote: 'Một số tác vụ nền đang chậm.', metric: dead });
        if (stuck > 0) out.push({ key: 'queue:outbox_backlog', severity: 'S2', component: 'queue', title: 'Outbox tồn đọng', detail: `${stuck} việc outbox quá ${t.outboxStuckMin} phút chưa được worker xử lý.`, publicNote: 'Một số tác vụ nền đang chậm.', metric: stuck });
        // Redis queue (Docker) co deadCount; Cloudflare Queues thi khong co API tuong duong -> bo qua.
        const q = rt.queue as unknown as { deadCount?: (topic: string) => Promise<number> };
        if (typeof q.deadCount === 'function') {
          try {
            const d = num(await q.deadCount('ingest.events'));
            if (d > 0) out.push({ key: 'queue:ingest_dead', severity: 'S2', component: 'queue', title: 'Hàng đợi sự kiện có tin chết', detail: `${d} tin trong ams:q:ingest.events:dead: lượt hiển thị có thể chưa tính tiền. Phát lại theo RUNBOOK 4.1.`, publicNote: 'Ghi nhận lượt hiển thị đang chậm.', metric: d });
          } catch {
            /* redis hong: kiem tra khac se bao */
          }
        }
        return out;
      },
    },
    {
      group: 'gateway',
      async run(rt) {
        const out: Finding[] = [];
        const g = await counterSum(rt, 'gateway_5xx', 15 * MIN);
        const a = await counterSum(rt, 'api_5xx', 15 * MIN);
        if (g >= t.gateway5xx15m) out.push({ key: 'gateway:5xx', severity: g >= t.gateway5xx15m * 10 ? 'S1' : 'S2', component: 'gateway', title: 'Gateway thiết bị trả lỗi 5xx', detail: `${g} phản hồi 5xx trong ~15 phút (ngưỡng ${t.gateway5xx15m}).`, publicNote: 'Kết nối thiết bị đang gặp lỗi gián đoạn.', metric: g });
        if (a >= t.api5xx15m) out.push({ key: 'api:5xx', severity: 'S2', component: 'api', title: 'API quản trị trả lỗi 5xx', detail: `${a} phản hồi 5xx trong ~15 phút (ngưỡng ${t.api5xx15m}).`, publicNote: 'Trang quản trị đang gặp lỗi gián đoạn.', metric: a });
        return out;
      },
    },
    {
      group: 'backup',
      async run(rt) {
        const env = rt.config.env;
        const kinds = (env['OPS_BACKUP_KINDS'] ?? (rt.config.runtime === 'cloudflare' ? 'd1' : 'postgres')).split(',').map((s) => s.trim()).filter(Boolean);
        if (env['OPS_BACKUP_CHECK'] === '0') return [];
        const out: Finding[] = [];
        const maxH = thresholds(env).backupMaxAgeH;
        const first = String((await one(rt, 'SELECT MIN(first_started_at) AS t FROM ops_job_runs'))['t'] ?? '');
        const graceOver = !first || new Date(first).getTime() < rt.clock.now().getTime() - maxH * HOUR;
        for (const k of kinds) {
          const ok = await one(rt, 'SELECT MAX(finished_at) AS t FROM ops_backups WHERE kind = ? AND ok = 1', [k]);
          const bad = await one(rt, 'SELECT MAX(finished_at) AS t FROM ops_backups WHERE kind = ? AND ok = 0', [k]);
          const okT = ok['t'] ? String(ok['t']) : null;
          const badT = bad['t'] ? String(bad['t']) : null;
          if (badT && (!okT || badT > okT)) out.push({ key: `backup:failed:${k}`, severity: 'S2', component: 'backup', title: `Sao lưu ${k} lần gần nhất thất bại`, detail: `Báo cáo lỗi lúc ${badT}, chưa có bản thành công sau đó.`, publicNote: '', metric: 1 });
          if (okT ? new Date(okT).getTime() < rt.clock.now().getTime() - maxH * HOUR : graceOver) {
            out.push({ key: `backup:stale:${k}`, severity: 'S2', component: 'backup', title: `Sao lưu ${k} quá cũ hoặc chưa có`, detail: okT ? `Bản thành công mới nhất: ${okT} (quá ${maxH} giờ).` : 'Chưa nhận báo cáo sao lưu nào (POST /ops/backup-report).', publicNote: '', metric: okT ? Math.round((rt.clock.now().getTime() - new Date(okT).getTime()) / HOUR) : 9999 });
          }
        }
        return out;
      },
    },
    {
      group: 'devices',
      async run(rt) {
        const r = await one(rt, "SELECT COUNT(*) AS total, SUM(CASE WHEN last_seen_at IS NULL OR last_seen_at < ? THEN 1 ELSE 0 END) AS off FROM devices WHERE kind = 'tv' AND status = 'active' AND blocked = 0", [iso(rt, t.deviceOfflineMin * MIN)]);
        const total = num(r['total']);
        const off = num(r['off']);
        if (total < t.deviceMin) return [];
        const pct = Math.round((off * 100) / total);
        if (pct < t.deviceOfflinePct) return [];
        return [{ key: 'devices:offline_ratio', severity: pct >= t.deviceOfflineCritPct ? 'S1' : 'S2', component: 'devices', title: 'Nhiều thiết bị TV mất kết nối', detail: `${off}/${total} TV đang hoạt động không có heartbeat quá ${t.deviceOfflineMin} phút (${pct}%, ngưỡng ${t.deviceOfflinePct}%).`, publicNote: 'Nhiều thiết bị đang mất kết nối với hệ thống.', metric: pct }];
      },
    },
    {
      group: 'jobs',
      async run(rt) {
        const rows = await rt.db.query<Record<string, unknown>>('SELECT job, last_error_at, last_success_at FROM ops_job_runs WHERE last_error_at IS NOT NULL AND last_error_at >= ?', [iso(rt, 30 * MIN)]);
        return rows
          .filter((j) => !j['last_success_at'] || String(j['last_error_at']) > String(j['last_success_at']))
          .map((j) => ({ key: `jobs:${String(j['job'])}`, severity: 'S3' as const, component: 'api' as const, title: `Job nền "${String(j['job'])}" đang lỗi`, detail: 'Xem ops_job_runs.last_error.', publicNote: '', metric: 1 }));
      },
    },
  ];
}

/** Boc mot job nen: ghi nhip chay/thanh cong/loi vao ops_job_runs. Khong bao gio nem them loi ghi nhip. */
export async function withJobRun<T>(rt: Runtime, job: string, fn: () => Promise<T>): Promise<T> {
  const now = rt.clock.now().toISOString();
  try {
    await rt.db.run(
      'INSERT INTO ops_job_runs (job, first_started_at, last_started_at, runs) VALUES (?,?,?,1) ON CONFLICT (job) DO UPDATE SET last_started_at = excluded.last_started_at, runs = ops_job_runs.runs + 1',
      [job, now, now],
    );
  } catch {
    /* chua migrate */
  }
  try {
    const r = await fn();
    await rt.db.run('UPDATE ops_job_runs SET last_success_at = ? WHERE job = ?', [rt.clock.now().toISOString(), job]).catch(() => undefined);
    return r;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    await rt.db.run('UPDATE ops_job_runs SET last_error_at = ?, last_error = ?, failures = failures + 1 WHERE job = ?', [rt.clock.now().toISOString(), msg, job]).catch(() => undefined);
    throw e;
  }
}

export const COOLDOWN_MIN: Record<Severity, number> = { S1: 30, S2: 240, S3: 1440 };
export function cooldownMs(env: Record<string, string | undefined>, s: Severity): number {
  const v = Number(env[`OPS_COOLDOWN_${s}_MIN`]);
  return (Number.isFinite(v) && v > 0 ? v : COOLDOWN_MIN[s]) * MIN;
}
const RANK: Record<Severity, number> = { S1: 1, S2: 2, S3: 3 };

interface IncidentRow {
  id: string;
  rule_key: string;
  severity: Severity;
  status: string;
  last_notified_at: string | null;
}

export interface OpsRunResult {
  findings: number;
  opened: string[];
  reminded: string[];
  resolved: string[];
  ruleErrors: string[];
}

/**
 * Chay mot luot kiem tra. Quy tac:
 *  - phat hien moi (chua co su co chua dong cho rule_key) -> mo su co + thong bao `opened`;
 *  - da co: cap nhat last_seen/occurrences; nhac lai (`reminder`) khi het cooldown (S1 30', S2 4h, S3 24h) hoac muc nang len; su co `acked` khong bi nhac;
 *  - het dieu kien -> `resolved` tu dong + thong bao (neu truoc do da thong bao).
 * Rule nem loi thi KHONG dong su co cua nhom do (khong biet that).
 */
export async function runOpsChecks(rt: Runtime, opts: { rules?: Rule[]; notify?: boolean } = {}): Promise<OpsRunResult> {
  const env = rt.config.env;
  const rules = opts.rules ?? defaultRules(thresholds(env));
  const res: OpsRunResult = { findings: 0, opened: [], reminded: [], resolved: [], ruleErrors: [] };
  const now = rt.clock.now();
  const nowIso = now.toISOString();
  const findings: Finding[] = [];
  const okGroups = new Set<string>();
  for (const r of rules) {
    try {
      findings.push(...(await r.run(rt)));
      okGroups.add(r.group);
    } catch (e) {
      res.ruleErrors.push(`${r.group}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }
  res.findings = findings.length;
  const active = await rt.db.query<IncidentRow>("SELECT id, rule_key, severity, status, last_notified_at FROM ops_incidents WHERE status <> 'resolved'");
  const byKey = new Map(active.map((a) => [a.rule_key, a]));
  const send = opts.notify !== false;
  for (const f of findings) {
    const cur = byKey.get(f.key);
    if (!cur) {
      const id = rt.id();
      try {
        await rt.db.run(
          'INSERT INTO ops_incidents (id, rule_key, severity, component, title, detail, public_note, metric_value, status, occurrences, opened_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [id, f.key, f.severity, f.component, f.title, f.detail, f.publicNote || null, f.metric, 'open', 1, nowIso, nowIso],
        );
      } catch {
        continue; // chay dua voi lan chay khac (chi muc duy nhat): lan chay kia da mo
      }
      res.opened.push(f.key);
      if (send) await notifyIncident(rt, { id, ruleKey: f.key, severity: f.severity, title: f.title, detail: f.detail, component: f.component }, 'opened');
      continue;
    }
    await rt.db.run('UPDATE ops_incidents SET last_seen_at = ?, occurrences = occurrences + 1, severity = ?, title = ?, detail = ?, public_note = ?, metric_value = ? WHERE id = ?', [nowIso, f.severity, f.title, f.detail, f.publicNote || null, f.metric, cur.id]);
    const escalated = RANK[f.severity] < RANK[cur.severity];
    const due = !cur.last_notified_at || now.getTime() - new Date(cur.last_notified_at).getTime() >= cooldownMs(env, f.severity);
    if (send && cur.status !== 'acked' && (escalated || due)) {
      res.reminded.push(f.key);
      await notifyIncident(rt, { id: cur.id, ruleKey: f.key, severity: f.severity, title: f.title, detail: f.detail, component: f.component }, 'reminder');
    }
  }
  const live = new Set(findings.map((f) => f.key));
  for (const a of active) {
    const group = a.rule_key.split(':')[0]!;
    if (live.has(a.rule_key) || !okGroups.has(group)) continue;
    await rt.db.run("UPDATE ops_incidents SET status = 'resolved', resolved_at = ? WHERE id = ? AND status <> 'resolved'", [nowIso, a.id]);
    res.resolved.push(a.rule_key);
    if (send && a.last_notified_at) {
      const row = (await rt.db.query<{ title: string; detail: string | null; component: string }>('SELECT title, detail, component FROM ops_incidents WHERE id = ?', [a.id]))[0];
      if (row) await notifyIncident(rt, { id: a.id, ruleKey: a.rule_key, severity: a.severity, title: row.title, detail: row.detail ?? '', component: row.component }, 'resolved');
    }
  }
  return res;
}

/** Xoa bo dem/nhat ky cu (goi hang ngay): ops_counters > 3 ngay, ops_notifications > 90 ngay, su co da dong > 180 ngay. */
export async function pruneOps(rt: Runtime): Promise<void> {
  const d = (days: number) => new Date(rt.clock.now().getTime() - days * 86_400_000).toISOString();
  await rt.db.run('DELETE FROM ops_counters WHERE bucket < ?', [d(3).slice(0, 16)]).catch(() => undefined);
  await rt.db.run('DELETE FROM ops_notifications WHERE sent_at < ?', [d(90)]).catch(() => undefined);
  await rt.db.run("DELETE FROM ops_incidents WHERE status = 'resolved' AND resolved_at < ?", [d(180)]).catch(() => undefined);
}
