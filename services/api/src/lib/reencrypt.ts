// P2 / R1-21: ma hoa lai cac truong AES-GCM sang khoa ghi hien tai (key id) de co the go khoa cu.
// Idempotent, chay lai duoc, tung lo nho (D1/Workers co gioi han thoi gian). Cap nhat co dieu kien (UPDATE ... WHERE col = <gia tri cu>) nen khong
// de len ghi dong thoi. Khong in gia tri ban ro; chi tra bo dem.
import type { Db, Runtime } from '@ams/runtime';
import { decryptField, encryptField, fieldKeyRingFromEnv, type KeyRing } from '@ams/shared';
import { SETTING_WEBHOOK } from '../ops/notifier.js';

export interface ReencryptTarget { table: string; col: string; idCol: string; aad: (row: Record<string, unknown>) => string; extra?: string; }
export interface ReencryptCount { target: string; scanned: number; updated: number; failed: number; }
export interface ReencryptReport { primaryId: string; dryRun: boolean; counts: ReencryptCount[]; updated: number; failed: number; /** con ban ghi chua doi khoa (chay lai neu > 0 va updated > 0) */ pending: number; }

export const REENCRYPT_TARGETS: ReencryptTarget[] = [
  { table: 'customers', col: 'tax_code_enc', idCol: 'id', aad: () => 'customers.tax_code' },
  { table: 'admins', col: 'totp_secret_enc', idCol: 'id', aad: () => 'admins.totp_secret' },
  { table: 'end_users', col: 'email_enc', idCol: 'id', aad: () => 'end_users.email' },
  { table: 'end_users', col: 'phone_enc', idCol: 'id', aad: (r) => `phone:${String(r['id'])}` },
  { table: 'payouts', col: 'account_enc', idCol: 'id', aad: (r) => `payout:${String(r['id'])}` },
  { table: 'viewer_tax_authorizations', col: 'tax_code_enc', idCol: 'id', aad: (r) => `tax:${String(r['user_id'])}`, extra: 'user_id' },
];

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const notCurrent = (kid: string) => `v2:${likeEsc(kid)}:%`;

async function tableExists(db: Db, table: string): Promise<boolean> {
  try { await db.query(`SELECT 1 FROM ${table} WHERE 1 = 0`); return true; } catch { return false; }
}

async function rewrap(ring: KeyRing, token: string, aad: string): Promise<string> {
  return encryptField(ring, await decryptField(ring, token, aad), aad);
}

async function doColumns(rt: Runtime, ring: KeyRing, limit: number, dryRun: boolean): Promise<{ counts: ReencryptCount[]; pending: number }> {
  const counts: ReencryptCount[] = [];
  let pending = 0;
  for (const t of REENCRYPT_TARGETS) {
    const name = `${t.table}.${t.col}`;
    const c: ReencryptCount = { target: name, scanned: 0, updated: 0, failed: 0 };
    counts.push(c);
    if (!(await tableExists(rt.db, t.table))) continue;
    const sel = `SELECT ${t.idCol} AS id, ${t.col} AS tok${t.extra ? `, ${t.extra}` : ''} FROM ${t.table} WHERE ${t.col} IS NOT NULL AND ${t.col} NOT LIKE ? ESCAPE '\\' ORDER BY ${t.idCol} LIMIT ?`;
    const rows = await rt.db.query<Record<string, unknown>>(sel, [notCurrent(ring.primaryId), limit]);
    for (const r of rows) {
      c.scanned++;
      try {
        const next = await rewrap(ring, String(r['tok']), t.aad(r));
        if (!dryRun) {
          const res = await rt.db.run(`UPDATE ${t.table} SET ${t.col} = ? WHERE ${t.idCol} = ? AND ${t.col} = ?`, [next, r['id'], r['tok']]);
          if (res.changes > 0) c.updated++;
        } else c.updated++;
      } catch { c.failed++; }
    }
    const left = await rt.db.query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${t.col} IS NOT NULL AND ${t.col} NOT LIKE ? ESCAPE '\\'`, [notCurrent(ring.primaryId)]);
    pending += Number(left[0]?.n ?? 0);
  }
  return { counts, pending };
}

const SEPAY_FIELDS: [string, string][] = [['account_no_enc', 'settings.sepay.account_no'], ['secret_enc', 'settings.sepay.secret'], ['apikey_enc', 'settings.sepay.apikey']];

async function doSettings(rt: Runtime, ring: KeyRing, dryRun: boolean): Promise<{ counts: ReencryptCount[]; pending: number }> {
  const counts: ReencryptCount[] = [];
  let pending = 0;
  const cur = (t: unknown) => typeof t === 'string' && t.startsWith(`v2:${ring.primaryId}:`);
  // settings.sepay (JSON)
  const sc: ReencryptCount = { target: 'settings.sepay.*', scanned: 0, updated: 0, failed: 0 };
  counts.push(sc);
  const row = (await rt.db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'sepay'"))[0];
  if (row) {
    try {
      const obj = JSON.parse(row.value) as Record<string, unknown>;
      let changed = false;
      for (const [f, aad] of SEPAY_FIELDS) {
        const tok = obj[f];
        if (typeof tok !== 'string' || !tok) continue;
        sc.scanned++;
        if (cur(tok)) continue;
        try { obj[f] = await rewrap(ring, tok, aad); changed = true; sc.updated++; } catch { sc.failed++; pending++; }
      }
      if (changed && !dryRun) {
        const res = await rt.db.run("UPDATE settings SET value = ? WHERE key = 'sepay' AND value = ?", [JSON.stringify(obj), row.value]);
        if (res.changes === 0) { pending += sc.updated; sc.updated = 0; }
      }
    } catch { sc.failed++; }
  }
  // settings ops.alert_webhook (chuoi ma hoa truc tiep)
  const wc: ReencryptCount = { target: `settings.${SETTING_WEBHOOK}`, scanned: 0, updated: 0, failed: 0 };
  counts.push(wc);
  const w = (await rt.db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [SETTING_WEBHOOK]))[0];
  if (w?.value) {
    wc.scanned++;
    if (!cur(w.value)) {
      try {
        const next = await rewrap(ring, w.value, 'settings.ops_alert_webhook');
        if (!dryRun) await rt.db.run('UPDATE settings SET value = ? WHERE key = ? AND value = ?', [next, SETTING_WEBHOOK, w.value]);
        wc.updated++;
      } catch { wc.failed++; pending++; }
    }
  }
  return { counts, pending };
}

async function doWebhooks(rt: Runtime, ring: KeyRing, limit: number, dryRun: boolean): Promise<{ counts: ReencryptCount[]; pending: number }> {
  const c: ReencryptCount = { target: 'payment_webhooks.payload.accountNumber_enc', scanned: 0, updated: 0, failed: 0 };
  if (!(await tableExists(rt.db, 'payment_webhooks'))) return { counts: [c], pending: 0 };
  const where = `payload LIKE '%"accountNumber_enc":"%' AND payload NOT LIKE ? ESCAPE '\\'`;
  const arg = `%"accountNumber_enc":"v2:${likeEsc(ring.primaryId)}:%`;
  const rows = await rt.db.query<{ id: string; payload: string }>(`SELECT id, payload FROM payment_webhooks WHERE ${where} ORDER BY id LIMIT ?`, [arg, limit]);
  for (const r of rows) {
    c.scanned++;
    try {
      const obj = JSON.parse(r.payload) as Record<string, unknown>;
      const tok = obj['accountNumber_enc'];
      if (typeof tok !== 'string') continue;
      obj['accountNumber_enc'] = await rewrap(ring, tok, 'payment_webhooks.accountNumber');
      if (!dryRun) {
        const res = await rt.db.run('UPDATE payment_webhooks SET payload = ? WHERE id = ? AND payload = ?', [JSON.stringify(obj), r.id, r.payload]);
        if (res.changes > 0) c.updated++;
      } else c.updated++;
    } catch { c.failed++; }
  }
  const left = await rt.db.query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM payment_webhooks WHERE ${where}`, [arg]);
  return { counts: [c], pending: Number(left[0]?.n ?? 0) };
}

/** Mot lo (limit dong moi cot). Goi lap lai cho den khi `pending` = 0 hoac `updated` = 0. */
export async function reencryptFields(rt: Runtime, opts: { limit?: number; dryRun?: boolean } = {}): Promise<ReencryptReport> {
  const ring = fieldKeyRingFromEnv(rt.config.env);
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const dryRun = !!opts.dryRun;
  const a = await doColumns(rt, ring, limit, dryRun);
  const b = await doSettings(rt, ring, dryRun);
  const d = await doWebhooks(rt, ring, limit, dryRun);
  const counts = [...a.counts, ...b.counts, ...d.counts];
  const updated = counts.reduce((s, x) => s + x.updated, 0);
  const failed = counts.reduce((s, x) => s + x.failed, 0);
  // sau lo nay: pending tinh lai theo so con lai (dryRun: gom ca phan se doi)
  const pending = a.pending + b.pending + d.pending;
  return { primaryId: ring.primaryId, dryRun, counts, updated, failed, pending };
}
