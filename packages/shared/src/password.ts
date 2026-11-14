import { scryptAsync } from '@noble/hashes/scrypt';
import { fromBase64, randomBytes, toBase64, utf8 } from './encoding.js';
import { timingSafeEqualBytes } from './hmac.js';

// Dinh dang: scrypt$N$r$p$saltB64$hashB64. Thuan JS (@noble) nen chay ca Node va Workers.
// R1-21: OWASP (scrypt N=2^16, r=8, p=2 tuong duong N=2^17,p=1) ma van < 128 MB bo nho (gioi han Workers). Hash cu (2^15,p=1) van xac minh duoc
// va duoc bam lai khi dang nhap thanh cong (passwordNeedsRehash).
const DEFAULT = { N: 2 ** 16, r: 8, p: 2, dkLen: 32 };

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export async function hashPassword(password: string, params: Partial<ScryptParams> = {}): Promise<string> {
  const { N, r, p } = { ...DEFAULT, ...params };
  const salt = randomBytes(16);
  const dk = await scryptAsync(utf8(password.normalize('NFKC')), salt, { N, r, p, dkLen: DEFAULT.dkLen, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${toBase64(salt)}$${toBase64(dk)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N > 2 ** 20) return false;
  const salt = fromBase64(parts[4]!);
  const expected = fromBase64(parts[5]!);
  const dk = await scryptAsync(utf8(password.normalize('NFKC')), salt, { N, r, p, dkLen: expected.length, maxmem: 128 * N * r * 2 });
  return timingSafeEqualBytes(dk, expected);
}

/** true neu ban bam luu tru yeu hon tham so muc tieu (de nang cap khi nguoi dung dang nhap dung mat khau). */
export function passwordNeedsRehash(stored: string, target: Partial<ScryptParams> = {}): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const t = { ...DEFAULT, ...target };
  return Number(parts[1]) < t.N || Number(parts[2]) < t.r || Number(parts[3]) < t.p;
}

/** Mat khau ngau nhien de doc (khong nham 0/O, l/1). */
export function randomPassword(len = 16): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(len);
  let s = '';
  for (const x of b) s += alphabet[x % alphabet.length];
  return s;
}
