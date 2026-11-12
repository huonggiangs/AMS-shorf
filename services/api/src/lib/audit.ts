import type { Db, Runtime } from '@ams/runtime';

// Ghi audit_log (chi INSERT). Khong dua bi mat/PII thanh chu vao diff: dung redact() cho truong nhay cam.
export interface AuditEntry {
  action: string;
  objectType?: string | null;
  objectId?: string | null;
  customerId?: string | null;
  diff?: unknown;
}
export interface AuditCtx {
  rt: Runtime;
  ip: string;
  actorId: string | null;
}

export async function writeAudit(db: Db, a: AuditCtx, e: AuditEntry): Promise<void> {
  await db.run(
    'INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, customer_id, ip, diff) VALUES (?,?,?,?,?,?,?,?,?)',
    [a.rt.id(), a.rt.clock.now().toISOString(), a.actorId, e.action, e.objectType ?? null, e.objectId ?? null, e.customerId ?? null, a.ip, e.diff === undefined ? null : JSON.stringify(e.diff)],
  );
}

/** Chi giu cac truong thay doi: { field: { from, to } }; truong trong `redact` chi ghi "da doi". */
export function diffObjects(before: Record<string, unknown>, after: Record<string, unknown>, redact: readonly string[] = []): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    if (after[k] === undefined) continue;
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    out[k] = redact.includes(k) ? { from: '***', to: '***' } : { from: b, to: a };
  }
  return out;
}
