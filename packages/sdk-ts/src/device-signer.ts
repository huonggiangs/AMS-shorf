// Ky request thiet bi theo giao thuc gateway (docs/openapi/ams-device-gateway.json, mo ta `info.description`):
//   chuoi ky = METHOD \n PATH?QUERY \n TIMESTAMP \n NONCE \n SHA256_HEX(body)   -> Ed25519 -> base64url
const b64url = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string): Uint8Array => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export interface DeviceSignerOptions {
  /** x-device-id; bo trong khi goi /v1/register (chua co) */
  deviceId?: string;
  /** khoa rieng Ed25519 PKCS8, base64url (cung dinh dang generateEd25519KeyPair cua @ams/shared) */
  privateKey: string;
  now?: () => number; // ms
  nonce?: () => string;
}

export function createDeviceSigner(o: DeviceSignerOptions): (method: string, pathWithQuery: string, body: Uint8Array) => Promise<Record<string, string>> {
  let key: Promise<CryptoKey> | undefined;
  return async (method, pathWithQuery, body) => {
    key ??= crypto.subtle.importKey('pkcs8', fromB64url(o.privateKey) as unknown as BufferSource, { name: 'Ed25519' }, false, ['sign']);
    const ts = String(Math.floor((o.now?.() ?? Date.now()) / 1000));
    const nonce = o.nonce?.() ?? b64url(crypto.getRandomValues(new Uint8Array(16)));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body as unknown as BufferSource));
    const msg = new TextEncoder().encode(`${method.toUpperCase()}\n${pathWithQuery}\n${ts}\n${nonce}\n${hex(digest)}`);
    const sig = b64url(new Uint8Array(await crypto.subtle.sign('Ed25519', await key, msg)));
    return { ...(o.deviceId ? { 'x-device-id': o.deviceId } : {}), 'x-timestamp': ts, 'x-nonce': nonce, 'x-signature': sig };
  };
}
