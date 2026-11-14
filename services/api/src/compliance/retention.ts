// Chinh sach luu giu bang su kien ev_* (settings.retention_policy, so ngay; 0 = khong tu xoa). Ban ClickHouse dung TTL trong DDL rieng (packages/db/clickhouse).
// Khong dung vao so cai bat bien (wallet_entries, wallet_ledger, audit_log). Moc cat toi thieu 7 ngay (RETENTION_MIN_DAYS) de khong pha doi soat/hoa don.
import type { Db, Runtime } from '@ams/runtime';
import { DEFAULT_RETENTION, RETENTION_SETTINGS_KEY, parseRetentionPolicy, retentionCutoff } from '@ams/shared';
import type { RetentionPolicy } from '@ams/shared';
import { writeAudit } from '../lib/audit.js';
import { jsonParse } from '../lib/http.js';

export async function loadRetentionPolicy(db: Db): Promise<RetentionPolicy> {
  const raw = (await db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [RETENTION_SETTINGS_KEY]))[0]?.value;
  return parseRetentionPolicy(jsonParse<unknown>(raw, DEFAULT_RETENTION));
}

const TABLES: { key: keyof RetentionPolicy; table: string; col: string; hour?: boolean }[] = [
  { key: 'ev_heartbeat_days', table: 'ev_heartbeat', col: 'ts' },
  { key: 'ev_ad_impression_days', table: 'ev_ad_impression', col: 'ts' },
  { key: 'ev_proof_of_play_days', table: 'ev_proof_of_play', col: 'ts' },
  { key: 'impression_hourly_days', table: 'impression_hourly', col: 'hour' },
];

export interface RetentionResult {
  policy: RetentionPolicy;
  deleted: Record<string, number>;
  cutoffs: Record<string, string | null>;
}

/** Xoa su kien qua han. dryRun = chi dem. */
export async function runRetention(rt: Runtime, opts: { dryRun?: boolean; actorId?: string | null } = {}): Promise<RetentionResult> {
  const policy = await loadRetentionPolicy(rt.db);
  const deleted: Record<string, number> = {};
  const cutoffs: Record<string, string | null> = {};
  for (const t of TABLES) {
    const cut = retentionCutoff(rt.clock.now(), policy[t.key]);
    cutoffs[t.table] = cut;
    if (!cut) continue;
    if (opts.dryRun) {
      const r = (await rt.db.query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${t.col} < ?`, [cut]))[0];
      deleted[t.table] = Number(r?.n ?? 0);
    } else {
      deleted[t.table] = (await rt.db.run(`DELETE FROM ${t.table} WHERE ${t.col} < ?`, [cut])).changes;
    }
  }
  const total = Object.values(deleted).reduce((a, b) => a + b, 0);
  if (!opts.dryRun && total > 0) await writeAudit(rt.db, { rt, ip: 'job', actorId: opts.actorId ?? null }, { action: 'compliance.retention.run', objectType: 'retention', diff: { deleted, cutoffs } });
  return { policy, deleted, cutoffs };
}
