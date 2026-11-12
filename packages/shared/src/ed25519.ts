import { bs, fromBase64Url, toBase64Url, utf8 } from './encoding.js';

// Web Crypto Ed25519: Node 22 dung ten "Ed25519"; Workers ho tro "Ed25519" (truoc day "NODE-ED25519").
type Alg = { name: string; namedCurve?: string };
const PRIMARY: Alg = { name: 'Ed25519' };
const LEGACY: Alg = { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' };

async function withAlg<T>(fn: (alg: Alg) => Promise<T>): Promise<T> {
  try {
    return await fn(PRIMARY);
  } catch (e) {
    try {
      return await fn(LEGACY);
    } catch {
      throw e;
    }
  }
}

export interface Ed25519KeyPair {
  /** khoa cong khai 32 byte, base64url */
  publicKey: string;
  /** khoa rieng PKCS8, base64url */
  privateKey: string;
}

export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  return withAlg(async (alg) => {
    const kp = (await crypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as unknown as {
      publicKey: Parameters<typeof crypto.subtle.exportKey>[1];
      privateKey: Parameters<typeof crypto.subtle.exportKey>[1];
    };
    const pub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
    const priv = new Uint8Array((await crypto.subtle.exportKey('pkcs8', kp.privateKey)) as ArrayBuffer);
    return { publicKey: toBase64Url(pub), privateKey: toBase64Url(priv) };
  });
}

export async function ed25519Sign(privateKeyB64: string, message: string | Uint8Array): Promise<string> {
  const msg = typeof message === 'string' ? utf8(message) : message;
  return withAlg(async (alg) => {
    const key = await crypto.subtle.importKey('pkcs8', bs(fromBase64Url(privateKeyB64)), alg, false, ['sign']);
    return toBase64Url(new Uint8Array(await crypto.subtle.sign(alg.name, key, bs(msg))));
  });
}

export async function ed25519Verify(publicKeyB64: string, signatureB64: string, message: string | Uint8Array): Promise<boolean> {
  const msg = typeof message === 'string' ? utf8(message) : message;
  try {
    return await withAlg(async (alg) => {
      const key = await crypto.subtle.importKey('raw', bs(fromBase64Url(publicKeyB64)), alg, false, ['verify']);
      return crypto.subtle.verify(alg.name, key, bs(fromBase64Url(signatureB64)), bs(msg));
    });
  } catch {
    return false;
  }
}

/**
 * Chuoi can ky cua gateway (PLAN §4): "<METHOD>\n<path>\n<timestamp>\n<nonce>\n<sha256hex(body)>".
 * Dung chung giua thiet bi/gia lap va gateway de hai ben khong lech.
 */
export function canonicalRequest(method: string, path: string, timestamp: string, nonce: string, bodySha256Hex: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodySha256Hex}`;
}
