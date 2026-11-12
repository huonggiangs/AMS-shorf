import type { Db, Runtime } from '@ams/runtime';
import { MANIFEST_EPOCH_KEY } from '@ams/shared';

/** Bao gateway xay lai manifest (trang thai chien dich vua doi). Goi SAU khi giao dich da commit; loi kv khong lam hong nghiep vu. */
export async function bumpManifest(rt: Runtime): Promise<void> {
  try {
    await rt.kv.incr(MANIFEST_EPOCH_KEY);
  } catch {
    /* gateway tu lam moi sau MANIFEST_BUILD_TTL_S */
  }
}

/** bigint/numeric/chuoi tu DB -> number (tien dong, nguyen; an toan toi 2^53) */
export function n(x: unknown): number {
  if (x === null || x === undefined) return 0;
  return typeof x === 'number' ? x : Number(x);
}

export const iso = (rt: Runtime): string => rt.clock.now().toISOString();

/**
 * Chay fn trong giao dich neu DB ho tro giao dich tuong tac (pg, sqlite). Tren D1 (interactiveTx=false)
 * giao dich KHONG hoan tac nen moi buoc tien deu la UPDATE co dieu kien + UNIQUE + buoc bu, khong dua vao rollback.
 */
export async function withTx<T>(db: Db, fn: (t: Db) => Promise<T>): Promise<T> {
  if (db.interactiveTx === false) return fn(db);
  return db.tx(fn);
}

export async function audit(
  db: Db,
  rt: Runtime,
  e: { actor?: string | null; action: string; type?: string; id?: string; customer?: string | null; ip?: string | null; diff?: unknown },
): Promise<void> {
  await db.run('INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, customer_id, ip, diff) VALUES (?,?,?,?,?,?,?,?,?)', [
    rt.id(), iso(rt), e.actor ?? null, e.action, e.type ?? null, e.id ?? null, e.customer ?? null, e.ip ?? null, e.diff === undefined ? null : JSON.stringify(e.diff),
  ]);
}

export async function notify(
  db: Db,
  rt: Runtime,
  e: { customer?: string | null; kind: string; title: string; body?: string; refType?: string; refId?: string },
): Promise<void> {
  await db.run('INSERT INTO notifications (id, admin_id, customer_id, kind, title, body, ref_type, ref_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
    rt.id(), null, e.customer ?? null, e.kind, e.title, e.body ?? null, e.refType ?? null, e.refId ?? null, iso(rt),
  ]);
}

/** 00:00 gio Viet Nam (UTC+7) cua ngay hien tai, dang ISO UTC */
export function startOfVnDayIso(now: Date): string {
  const vn = new Date(now.getTime() + 7 * 3600_000);
  vn.setUTCHours(0, 0, 0, 0);
  return new Date(vn.getTime() - 7 * 3600_000).toISOString();
}
