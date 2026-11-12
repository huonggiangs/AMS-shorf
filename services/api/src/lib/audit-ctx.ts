import type { Db } from '@ams/runtime';
import { writeAudit, type AuditEntry } from './audit.js';
import type { Ctx } from './http.js';

/** Ghi audit tu ngu canh request (actor, ip lay san); `db` la giao dich dang chay de ghi cung luc voi thay doi. */
export async function audit(c: Ctx, db: Db, e: AuditEntry): Promise<void> {
  await writeAudit(db, { rt: c.get('rt'), ip: c.get('ip'), actorId: c.get('user')?.id ?? null }, e);
}
