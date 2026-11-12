import type { Runtime } from '@ams/runtime';
import { randomBytes } from '@ams/shared';
import { PAIR_CODE_TTL_S } from './protocol.js';

/** So 6 chu so dong deu (loai bo lech modulo). */
export function randomCode6(): string {
  for (;;) {
    const b = randomBytes(4);
    const n = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    if (n < 4_294_000_000) return String(n % 1_000_000).padStart(6, '0'); // 4.294e9 la boi so cua 1e6
  }
}

export interface IssuedCode {
  code: string;
  expiresAt: string;
}

/** Cap (hoac tra lai) ma ghep doi con han cua thiet bi. Ma het han chua dung bi xoa de giai phong so. */
export async function issuePairingCode(rt: Runtime, deviceId: string): Promise<IssuedCode> {
  const nowIso = rt.clock.now().toISOString();
  const existing = await rt.db.query<{ code: string; expires_at: string }>(
    'SELECT code, expires_at FROM pairing_codes WHERE device_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [deviceId, nowIso],
  );
  if (existing[0]) return { code: existing[0].code, expiresAt: existing[0].expires_at };
  const expiresAt = new Date(rt.clock.now().getTime() + PAIR_CODE_TTL_S * 1000).toISOString();
  for (let i = 0; i < 8; i++) {
    const code = randomCode6();
    await rt.db.run('DELETE FROM pairing_codes WHERE code = ? AND used_at IS NULL AND expires_at <= ?', [code, nowIso]);
    try {
      await rt.db.run('INSERT INTO pairing_codes (code, device_id, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)', [code, deviceId, expiresAt, nowIso]);
      return { code, expiresAt };
    } catch {
      /* trung khoa chinh: thu so khac */
    }
  }
  throw new Error('khong cap duoc ma ghep doi');
}

export type RedeemResult = { ok: true; deviceId: string } | { ok: false; reason: 'not_found' | 'expired' | 'used' };

/**
 * Dung khi nguoi dung nhap ma tren ung dung (API cong khach hang goi ham nay). Nguyen tu: ma chi dung duoc mot lan.
 * `userId` phai la end_users.id co that (khoa ngoai). Nang trust_level len it nhat 1 (tai khoan da lien ket).
 */
export async function redeemPairingCode(rt: Runtime, code: string, userId: string): Promise<RedeemResult> {
  const nowIso = rt.clock.now().toISOString();
  const rows = await rt.db.query<{ device_id: string; expires_at: string; used_at: string | null }>('SELECT device_id, expires_at, used_at FROM pairing_codes WHERE code = ?', [code]);
  const r = rows[0];
  if (!r) return { ok: false, reason: 'not_found' };
  if (r.used_at) return { ok: false, reason: 'used' };
  if (r.expires_at <= nowIso) return { ok: false, reason: 'expired' };
  const ok = await rt.db.tx(async (t) => {
    const u = await t.run('UPDATE pairing_codes SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?', [nowIso, code, nowIso]);
    if (u.changes !== 1) return false;
    await t.run('UPDATE devices SET user_id = ?, paired_at = ?, trust_level = CASE WHEN trust_level < 1 THEN 1 ELSE trust_level END WHERE id = ?', [userId, nowIso, r.device_id]);
    return true;
  });
  if (!ok) return { ok: false, reason: 'used' };
  await rt.kv.del(`dev:${r.device_id}`);
  return { ok: true, deviceId: r.device_id };
}
