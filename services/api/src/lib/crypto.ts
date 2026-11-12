import type { Runtime } from '@ams/runtime';
import { decryptField, encryptField, randomBytes, sha256Hex, toBase64Url, blindIndex } from '@ams/shared';
import { HttpError } from './errors.js';

export function fieldKey(rt: Runtime): string {
  const k = rt.config.env['FIELD_ENC_KEY'];
  if (!k) throw new HttpError(500, 'config_missing', 'Máy chủ chưa cấu hình khóa mã hóa trường.');
  return k;
}
export const encField = (rt: Runtime, plain: string, aad: string) => encryptField(fieldKey(rt), plain, aad);
export const decField = (rt: Runtime, token: string, aad: string) => decryptField(fieldKey(rt), token, aad);
export const hashIndex = (rt: Runtime, label: string, value: string) => blindIndex(fieldKey(rt), label, value);

export const AAD = {
  taxCode: 'customers.tax_code',
  totp: 'admins.totp_secret',
} as const;

/** Token ngau nhien (base64url) va ban bam SHA-256 de luu DB. */
export async function newToken(bytes = 32): Promise<{ token: string; hash: string }> {
  const token = toBase64Url(randomBytes(bytes));
  return { token, hash: await sha256Hex(token) };
}
export const hashToken = (t: string) => sha256Hex(t);
