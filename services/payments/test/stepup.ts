import type { TestRuntime } from '@ams/runtime';
import { encryptField, generateTotpSecret, totp } from '@ams/shared';
import { NOW } from './helpers.js';

const secrets = new Map<string, string>();

/** Tao tai khoan noi bo that trong bang admins co TOTP (de test step-up). */
export async function mkAdmin(rt: TestRuntime, id: string, role = 'finance', o: { totp?: boolean } = {}): Promise<void> {
  const secret = generateTotpSecret();
  const enc = o.totp === false ? null : await encryptField(rt.config.env['FIELD_ENC_KEY']!, secret, 'admins.totp_secret');
  await rt.db.run(
    "INSERT INTO admins (id, tenant_id, email, name, role, account_kind, status, totp_secret_enc, mfa_required, created_at) VALUES (?,?,?,?,?, 'internal', 'active', ?, 1, ?)",
    [id, 'T1', `${id.toLowerCase()}@ams.test`, id, role, enc, NOW],
  );
  secrets.set(id, secret);
}

/** Ma TOTP hien tai; xoa dau 'da dung' de goi lai nhieu lan trong cung cua so (tru khi reuse=true). */
export async function code(rt: TestRuntime, id: string, o: { reuse?: boolean } = {}): Promise<string> {
  const now = rt.clock.now().getTime();
  if (!o.reuse) await rt.kv.del(`totp:used:${id}:${Math.floor(now / 30_000)}`);
  return totp(secrets.get(id)!, now);
}
