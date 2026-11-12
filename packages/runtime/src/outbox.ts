// Outbox giao dich: viec phai xay ra SAU mot thay doi trang thai duoc ghi vao bang `outbox` CUNG giao dich voi thay doi do,
// roi mot bo xu ly (processOutbox) lam tung viec mot, idempotent, thu lai co lui, het lan thi 'dead'.
// Goi duoc tu Node (setInterval), Cloudflare (cron / Queue consumer) va test: chi can Runtime + bang handler, khong co khoa dong.
// Dam bao: AT-LEAST-ONCE. Moi handler PHAI idempotent (xem tung handler); dedupe_key UNIQUE chong ghi trung viec.
import type { Db, Runtime } from './types.js';

export interface OutboxMessage<P = unknown> {
  id: string;
  topic: string;
  payload: P;
  /** so lan da nhan (tinh ca lan dang chay) */
  attempts: number;
  dedupeKey: string;
}
export type OutboxHandler = (msg: OutboxMessage, rt: Runtime) => Promise<void>;
export type OutboxHandlers = Record<string, OutboxHandler>;

export interface OutboxOptions {
  /** so dong toi da moi vong (mac dinh 25) */
  limit?: number;
  /** so vong toi da (viec con sinh ra viec tiep trong cung lan goi); mac dinh 5 */
  rounds?: number;
  /** het so lan thu thi dat 'dead' (mac dinh 8) */
  maxAttempts?: number;
  /** thoi gian "thue" khi mot worker dang xu ly; qua han ma chua xong thi worker khac duoc nhan (mac dinh 60 giay) */
  leaseS?: number;
  /** lui luy thua: baseS * 2^(attempts-1), toi da capS (mac dinh 5 giay .. 900 giay) */
  backoffBaseS?: number;
  backoffCapS?: number;
}

export interface OutboxResult {
  processed: number;
  failed: number;
  dead: number;
  /** dong da nhan nhung worker khac xu ly truoc */
  skipped: number;
}

const iso = (rt: Pick<Runtime, 'clock'>, plusS = 0): string => new Date(rt.clock.now().getTime() + plusS * 1000).toISOString();

/**
 * Ghi mot viec vao outbox (goi BEN TRONG giao dich thay doi trang thai). Idempotent theo dedupeKey: tra true neu vua tao dong moi.
 * Tren D1 (khong co giao dich) goi ngay sau thay doi; viec bi sot do mat dien giua chung do bo doi soat cua tung chu de bu lai (vd. reconcileApprovals).
 */
export async function enqueueOutbox(
  db: Pick<Db, 'run'>,
  rt: Pick<Runtime, 'clock' | 'id'>,
  m: { topic: string; payload: unknown; dedupeKey: string; delayS?: number },
): Promise<boolean> {
  const r = await db.run(
    'INSERT INTO outbox (id, topic, payload, status, attempts, available_at, created_at, dedupe_key) VALUES (?,?,?,?,0,?,?,?) ON CONFLICT (dedupe_key) DO NOTHING',
    [rt.id(), m.topic, JSON.stringify(m.payload ?? null), 'pending', iso(rt, m.delayS ?? 0), iso(rt), m.dedupeKey],
  );
  return r.changes === 1;
}

/** Xu ly cac viec den han. Khong nem loi (loi cua handler duoc ghi lai va thu lai sau). */
export async function processOutbox(rt: Runtime, handlers: OutboxHandlers, opts: OutboxOptions = {}): Promise<OutboxResult> {
  const topics = Object.keys(handlers);
  const out: OutboxResult = { processed: 0, failed: 0, dead: 0, skipped: 0 };
  if (topics.length === 0) return out;
  const limit = opts.limit ?? 25;
  const maxAttempts = opts.maxAttempts ?? 8;
  const leaseS = opts.leaseS ?? 60;
  const base = opts.backoffBaseS ?? 5;
  const cap = opts.backoffCapS ?? 900;
  for (let round = 0; round < (opts.rounds ?? 5); round++) {
    const now = iso(rt);
    const due = await rt.db.query<{ id: string; topic: string; payload: string; attempts: number; dedupe_key: string }>(
      `SELECT id, topic, payload, attempts, dedupe_key FROM outbox WHERE status = 'pending' AND available_at <= ? AND topic IN (${topics.map(() => '?').join(',')}) ORDER BY available_at, id LIMIT ?`,
      [now, ...topics, limit],
    );
    if (due.length === 0) break;
    for (const row of due) {
      const attempts = Number(row.attempts);
      // chiem: UPDATE co dieu kien (attempts + available_at nhu luc doc) => dung mot worker thang; day available_at ra de lam hop dong thue
      const claim = await rt.db.run(
        "UPDATE outbox SET attempts = attempts + 1, available_at = ? WHERE id = ? AND status = 'pending' AND attempts = ? AND available_at <= ?",
        [iso(rt, leaseS), row.id, attempts, now],
      );
      if (claim.changes !== 1) {
        out.skipped++;
        continue;
      }
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        /* payload hong: de handler tu xu ly null */
      }
      try {
        await handlers[row.topic]!({ id: row.id, topic: row.topic, payload, attempts: attempts + 1, dedupeKey: row.dedupe_key }, rt);
        await rt.db.run("UPDATE outbox SET status = 'done', processed_at = ?, last_error = NULL WHERE id = ? AND status = 'pending'", [iso(rt), row.id]);
        out.processed++;
      } catch (e) {
        const msg = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);
        if (attempts + 1 >= maxAttempts) {
          await rt.db.run("UPDATE outbox SET status = 'dead', processed_at = ?, last_error = ? WHERE id = ? AND status = 'pending'", [iso(rt), msg, row.id]);
          out.dead++;
        } else {
          const delay = Math.min(cap, base * 2 ** attempts);
          await rt.db.run("UPDATE outbox SET available_at = ?, last_error = ? WHERE id = ? AND status = 'pending'", [iso(rt, delay), msg, row.id]);
          out.failed++;
        }
      }
    }
  }
  return out;
}

export async function outboxStats(db: Pick<Db, 'query'>): Promise<{ pending: number; done: number; dead: number }> {
  const rows = await db.query<{ status: string; n: unknown }>('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status');
  const m = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return { pending: m['pending'] ?? 0, done: m['done'] ?? 0, dead: m['dead'] ?? 0 };
}

/** Xoa dong da xong/da chet cu hon `keepDays` (mac dinh 14 ngay) de bang khong phinh. */
export async function pruneOutbox(db: Pick<Db, 'run'>, rt: Pick<Runtime, 'clock'>, keepDays = 14): Promise<number> {
  const cutoff = new Date(rt.clock.now().getTime() - keepDays * 86_400_000).toISOString();
  return (await db.run("DELETE FROM outbox WHERE status = 'done' AND processed_at < ?", [cutoff])).changes;
}
