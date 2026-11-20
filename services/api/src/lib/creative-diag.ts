// Chan doan an toan gan voi creative (bang creative_diag, migration 0019): chi admin/audit xem; nguoi dung thuong chi thay `warnings` (cau chu tieng Viet don gian).
import type { Db } from '@ams/runtime';
import type { DriveDiag } from './drive-resolver.js';

export async function saveDiag(db: Pick<Db, 'run'>, creativeId: string, diag: DriveDiag, nowIso: string): Promise<void> {
  await db.run(
    'INSERT INTO creative_diag (creative_id, diag, created_at) VALUES (?,?,?) ON CONFLICT (creative_id) DO UPDATE SET diag = excluded.diag, created_at = excluded.created_at',
    [creativeId, JSON.stringify(diag), nowIso],
  );
}

export function parseDiag(raw: string | null | undefined): DriveDiag | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as DriveDiag;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
