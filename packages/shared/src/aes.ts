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

// ---- Vong khoa (key ring): xoay FIELD_ENC_KEY khong ngung he thong -------------------------------------------------
// Dinh dang moi: v2:<kid>:<ivB64>:<ctB64>. Dinh dang cu v1:<iv>:<ct> (khong co kid) van giai ma duoc (thu lan luot cac khoa).
// Cau hinh (env):
//   FIELD_ENC_KEY       khoa hien tai/legacy (base64 32 byte). Id cua no la `k0`.
//   FIELD_ENC_KEYS      danh sach `id:base64` phan tach dau phay, vd `k2:AAAA...,k1:BBBB...`. Khoa dau tien la khoa ghi (primary).
//   FIELD_ENC_KEY_ID    ep id khoa ghi (dung khi muon giai ma bang khoa moi truoc khi chuyen ghi sang khoa moi).
//   FIELD_INDEX_KEY     khoa HMAC cho chi muc mu (blind index). KHONG DUOC DOI: dat bang khoa goc truoc khi xoay.
export interface KeyRing {
  readonly primaryId: string;
  /** id -> khoa base64 */
  readonly keys: ReadonlyMap<string, string>;
  /** khoa HMAC cho blindIndex (on dinh qua cac lan xoay) */
  readonly indexKey: string;
}
export type FieldKey = string | KeyRing;
export const LEGACY_KEY_ID = 'k0';
const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function checkKeyLen(b64: string, what: string): void {
  let n = 0;
  try { n = fromBase64(b64).length; } catch { /* de bao loi ben duoi */ }
  if (n !== 32) throw new Error(`${what} phai la 32 byte (base64)`);
}

/** Dung vong khoa tu bien moi truong. Nem loi neu khong co khoa nao / khoa sai do dai / id trung. */
export function fieldKeyRingFromEnv(env: Record<string, string | undefined>): KeyRing {
  const keys = new Map<string, string>();
  const list = (env['FIELD_ENC_KEYS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const item of list) {
    const i = item.indexOf(':');
    const id = i > 0 ? item.slice(0, i) : '';
    const key = i > 0 ? item.slice(i + 1) : '';
    if (!KID_RE.test(id)) throw new Error('FIELD_ENC_KEYS: id khoa khong hop le (dung A-Za-z0-9_- toi da 32 ky tu)');
    if (keys.has(id)) throw new Error(`FIELD_ENC_KEYS: id khoa trung (${id})`);
    checkKeyLen(key, `FIELD_ENC_KEYS[${id}]`);
    keys.set(id, key);
  }
  const legacy = env['FIELD_ENC_KEY'];
  if (legacy) {
    checkKeyLen(legacy, 'FIELD_ENC_KEY');
    if (![...keys.values()].includes(legacy)) {
      if (keys.has(LEGACY_KEY_ID)) throw new Error('FIELD_ENC_KEYS: id k0 danh rieng cho FIELD_ENC_KEY');
      keys.set(LEGACY_KEY_ID, legacy);
    }
  }
  if (keys.size === 0) throw new Error('thieu FIELD_ENC_KEY (hoac FIELD_ENC_KEYS)');
  const forced = env['FIELD_ENC_KEY_ID']?.trim();
  let primaryId: string;
  if (forced) {
    if (!keys.has(forced)) throw new Error(`FIELD_ENC_KEY_ID=${forced} khong co trong vong khoa`);
    primaryId = forced;
  } else if (list.length > 0) {
    primaryId = list[0]!.slice(0, list[0]!.indexOf(':'));
  } else {
    primaryId = LEGACY_KEY_ID;
  }
  const idx = env['FIELD_INDEX_KEY'] || legacy || keys.get(primaryId)!;
  checkKeyLen(idx, 'FIELD_INDEX_KEY');
  return { primaryId, keys, indexKey: idx };
}

const isRing = (k: FieldKey): k is KeyRing => typeof k !== 'string';

export async function encryptField(key: FieldKey, plaintext: string, aad?: string): Promise<string> {
  const kb64 = isRing(key) ? key.keys.get(key.primaryId)! : key;
  const ck = await importKey(kb64);
  const iv = randomBytes(12);
  const params = { name: 'AES-GCM', iv: bs(iv), ...(aad ? { additionalData: bs(utf8(aad)) } : {}) };
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, ck, bs(utf8(plaintext))));
  return isRing(key) ? `v2:${key.primaryId}:${toBase64(iv)}:${toBase64(ct)}` : `v1:${toBase64(iv)}:${toBase64(ct)}`;
}

/** Id khoa ghi tren token (null neu la v1 khong co kid hoac khong phai token). */
export function fieldTokenKeyId(token: string): string | null {
  const p = token.split(':');
  return p.length === 4 && p[0] === 'v2' ? p[1]! : null;
}
/** Token da dung khoa ghi hien tai chua (de job ma hoa lai bo qua). */
export function fieldTokenIsCurrent(ring: KeyRing, token: string): boolean {
  return fieldTokenKeyId(token) === ring.primaryId;
}

async function tryDecrypt(kb64: string, ivB64: string, ctB64: string, aad?: string): Promise<string> {
  const ck = await importKey(kb64);
  const params = { name: 'AES-GCM', iv: bs(fromBase64(ivB64)), ...(aad ? { additionalData: bs(utf8(aad)) } : {}) };
  const pt = await crypto.subtle.decrypt(params, ck, bs(fromBase64(ctB64)));
  return fromUtf8(new Uint8Array(pt));
}

export async function decryptField(key: FieldKey, token: string, aad?: string): Promise<string> {
  const parts = token.split(':');
  const candidates: string[] = [];
  let iv: string;
  let ct: string;
  if (parts.length === 3 && parts[0] === 'v1') {
    [, iv, ct] = parts as [string, string, string];
    if (isRing(key)) candidates.push(...key.keys.values()); else candidates.push(key);
  } else if (parts.length === 4 && parts[0] === 'v2') {
    if (!isRing(key)) throw new Error('truong v2 can vong khoa (FIELD_ENC_KEYS)');
    [, , iv, ct] = parts as [string, string, string, string];
    const named = key.keys.get(parts[1]!);
    if (!named) throw new Error(`khong co khoa ${parts[1]} de giai ma truong`);
    candidates.push(named);
  } else {
    throw new Error('dinh dang truong ma hoa khong hop le');
  }
  let last: unknown;
  for (const k of candidates) {
    try { return await tryDecrypt(k, iv, ct, aad); } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error('giai ma truong that bai');
}

/** Chi muc mu (blind index) cho truong ma hoa can UNIQUE/tim kiem (vd MST): HMAC-SHA256(key, label|value) hex. */
export async function blindIndex(key: FieldKey, label: string, value: string): Promise<string> {
  const { hmacSha256Hex } = await import('./hmac.js');
  return hmacSha256Hex(fromBase64(isRing(key) ? key.indexKey : key), `${label}|${value.trim().toLowerCase()}`);
}
