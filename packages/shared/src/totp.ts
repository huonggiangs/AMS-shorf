import { fromBase32, randomBytes, toBase32 } from './encoding.js';
import { hmacRaw, timingSafeEqualStr } from './hmac.js';

export type TotpAlgo = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface TotpOptions {
  digits?: number; // mac dinh 6
  period?: number; // mac dinh 30 s
  algo?: TotpAlgo; // mac dinh SHA-1 (tuong thich Google Authenticator)
}

/** HOTP (RFC 4226) voi khoa tho. */
export async function hotp(key: Uint8Array, counter: number | bigint, digits = 6, algo: TotpAlgo = 'SHA-1'): Promise<string> {
  const msg = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const h = await hmacRaw(algo, key, msg);
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** TOTP (RFC 6238) tu khoa tho. `timeMs` mac dinh la bay gio. */
export async function totpFromKey(key: Uint8Array, timeMs: number = Date.now(), opts: TotpOptions = {}): Promise<string> {
  const period = opts.period ?? 30;
  const counter = Math.floor(timeMs / 1000 / period);
  return hotp(key, counter, opts.digits ?? 6, opts.algo ?? 'SHA-1');
}

/** TOTP tu bi mat base32 (dang luu tren admins.totp_secret_enc sau khi giai ma). */
export async function totp(secretBase32: string, timeMs: number = Date.now(), opts: TotpOptions = {}): Promise<string> {
  return totpFromKey(fromBase32(secretBase32), timeMs, opts);
}

/** Xac minh ma, cho lech +-window buoc (mac dinh 1). Tra ve so buoc khop hoac null (de chong dung lai ma). */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  opts: TotpOptions & { timeMs?: number; window?: number } = {},
): Promise<{ ok: true; counter: number } | { ok: false }> {
  const digits = opts.digits ?? 6;
  const clean = code.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return { ok: false };
  const period = opts.period ?? 30;
  const now = Math.floor((opts.timeMs ?? Date.now()) / 1000 / period);
  const w = opts.window ?? 1;
  const key = fromBase32(secretBase32);
  let found: number | null = null;
  for (let d = -w; d <= w; d++) {
    const expect = await hotp(key, now + d, digits, opts.algo ?? 'SHA-1');
    if (timingSafeEqualStr(expect, clean) && found === null) found = now + d;
  }
  return found === null ? { ok: false } : { ok: true, counter: found };
}

export function generateTotpSecret(bytes = 20): string {
  return toBase32(randomBytes(bytes));
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'AMS'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
