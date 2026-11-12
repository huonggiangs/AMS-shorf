import { bs, fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from './encoding.js';

// Ma hoa truong AES-256-GCM. Dinh dang: v1:<ivB64>:<ctB64> (ct gom ca tag 16 byte).
async function importKey(keyB64: string): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>>> {
  const raw = fromBase64(keyB64);
  if (raw.length !== 32) throw new Error('FIELD_ENC_KEY phai la 32 byte (base64)');
  return crypto.subtle.importKey('raw', bs(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function generateFieldKey(): string {
  return toBase64(randomBytes(32));
}

export async function encryptField(keyB64: string, plaintext: string, aad?: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = randomBytes(12);
  const params = { name: 'AES-GCM', iv: bs(iv), ...(aad ? { additionalData: bs(utf8(aad)) } : {}) };
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, key, bs(utf8(plaintext))));
  return `v1:${toBase64(iv)}:${toBase64(ct)}`;
}

export async function decryptField(keyB64: string, token: string, aad?: string): Promise<string> {
  const parts = token.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('dinh dang truong ma hoa khong hop le');
  const key = await importKey(keyB64);
  const params = { name: 'AES-GCM', iv: bs(fromBase64(parts[1]!)), ...(aad ? { additionalData: bs(utf8(aad)) } : {}) };
  const pt = await crypto.subtle.decrypt(params, key, bs(fromBase64(parts[2]!)));
  return fromUtf8(new Uint8Array(pt));
}
