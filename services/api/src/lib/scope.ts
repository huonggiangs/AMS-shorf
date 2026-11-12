// Pham vi du lieu cua tai khoan ngoai, ap dung TRONG SQL (khong loc o tang ung dung).
//  - customer: moi thu co customer_id = khach cua minh
//  - partner : chi chien dich duoc giao (campaign_grants con han) cua khach do; media do minh tai len hoac thuoc chien dich duoc giao
import type { AuthUser } from '../types.js';
import type { SqlFrag } from './http.js';

export function campaignScope(u: AuthUser, alias: string, nowIso: string): SqlFrag | null {
  if (u.kind === 'internal') return null;
  if (!u.customerId) return { sql: '1 = 0', params: [] };
  if (u.kind === 'customer') return { sql: `${alias}.customer_id = ?`, params: [u.customerId] };
  return {
    sql: `${alias}.customer_id = ? AND ${alias}.id IN (SELECT g.campaign_id FROM campaign_grants g WHERE g.admin_id = ? AND (g.expires_at IS NULL OR g.expires_at > ?))`,
    params: [u.customerId, u.id, nowIso],
  };
}

export function mediaScope(u: AuthUser, alias: string, nowIso: string): SqlFrag | null {
  if (u.kind === 'internal') return null;
  if (!u.customerId) return { sql: '1 = 0', params: [] };
  if (u.kind === 'customer') return { sql: `${alias}.customer_id = ?`, params: [u.customerId] };
  return {
    sql: `${alias}.customer_id = ? AND (${alias}.uploaded_by = ? OR ${alias}.campaign_id IN (SELECT g.campaign_id FROM campaign_grants g WHERE g.admin_id = ? AND (g.expires_at IS NULL OR g.expires_at > ?)))`,
    params: [u.customerId, u.id, u.id, nowIso],
  };
}

/** Ghep nhieu manh WHERE (bo qua null). */
export function andFrags(...frags: (SqlFrag | null)[]): SqlFrag {
  const f = frags.filter((x): x is SqlFrag => !!x);
  if (!f.length) return { sql: '1 = 1', params: [] };
  return { sql: f.map((x) => `(${x.sql})`).join(' AND '), params: f.flatMap((x) => x.params) };
}
