import { bs, fromHex, toHex, utf8 } from './encoding.js';

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  // Do dai khac nhau van duyet het do dai lon hon de khong ro ri thoi gian theo noi dung.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqualBytes(utf8(a), utf8(b));
}

async function hmacKey(secret: string | Uint8Array, hash: 'SHA-256' | 'SHA-1' | 'SHA-512' = 'SHA-256'): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>>> {
  const raw = typeof secret === 'string' ? utf8(secret) : secret;
  return crypto.subtle.importKey('raw', bs(raw), { name: 'HMAC', hash }, false, ['sign']);
}

export async function hmacSha256(secret: string | Uint8Array, data: string | Uint8Array): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, bs(typeof data === 'string' ? utf8(data) : data));
  return new Uint8Array(sig);
}

export async function hmacSha256Hex(secret: string | Uint8Array, data: string | Uint8Array): Promise<string> {
  return toHex(await hmacSha256(secret, data));
}

/** So sanh chu ky hex (chap nhan tien to "sha256=") theo thoi gian hang so. */
export async function verifyHmacSha256Hex(secret: string | Uint8Array, data: string | Uint8Array, signature: string): Promise<boolean> {
  const sig = signature.trim().replace(/^sha256=/i, '').toLowerCase();
  let provided: Uint8Array;
  try {
    provided = fromHex(sig);
  } catch {
    return false;
  }
  const expected = await hmacSha256(secret, data);
  return timingSafeEqualBytes(expected, provided);
}

export async function hmacRaw(hash: 'SHA-1' | 'SHA-256' | 'SHA-512', secret: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await hmacKey(secret, hash);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bs(data)));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bs(typeof data === 'string' ? utf8(data) : data));
  return toHex(new Uint8Array(d));
}
