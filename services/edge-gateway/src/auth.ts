import type { Context } from 'hono';
import type { Runtime } from '@ams/runtime';
import { canonicalRequest, ed25519Verify, sha256Hex } from '@ams/shared';
import type { DeviceDirectory, DeviceRec } from './devices.js';
import { HEADER, MAX_CLOCK_SKEW_S, NONCE_RE, NONCE_TTL_S, B64URL_RE } from './protocol.js';
import { HttpProblem, nowSec } from './util.js';

/** Chong phat lai. Mac dinh dung rt.kv; Cloudflare thay bang Durable Object (KV khong nguyen tu). */
export interface NonceStore {
  /** true = nonce moi (da ghi nhan); false = da thay (phat lai). */
  claim(scope: string, nonce: string, ttlSec: number): Promise<boolean>;
}

export class KvNonceStore implements NonceStore {
  constructor(private kv: Runtime['kv']) {}
  async claim(scope: string, nonce: string, ttlSec: number): Promise<boolean> {
    return (await this.kv.incr(`nonce:${scope}:${nonce}`, ttlSec)) === 1;
  }
}

export interface AuthDeps {
  rt: Runtime;
  devices: DeviceDirectory;
  nonces: NonceStore;
}

export interface Envelope {
  deviceId: string | null;
  timestamp: number;
  nonce: string;
  signature: string;
}

export function readEnvelope(c: Context): Envelope {
  const h = c.req.raw.headers;
  const tsRaw = h.get(HEADER.timestamp);
  const nonce = h.get(HEADER.nonce);
  const sig = h.get(HEADER.signature);
  if (!tsRaw || !nonce || !sig) throw new HttpProblem('invalid_signature', 'Thieu tieu de X-Timestamp, X-Nonce hoac X-Signature.');
  if (!/^\d{9,12}$/.test(tsRaw)) throw new HttpProblem('stale_timestamp', 'X-Timestamp phai la epoch giay (so nguyen).');
  if (!NONCE_RE.test(nonce)) throw new HttpProblem('invalid_signature', 'X-Nonce phai gom 16-64 ky tu [A-Za-z0-9_-].');
  if (!B64URL_RE.test(sig) || sig.length !== 86) throw new HttpProblem('invalid_signature', 'X-Signature khong dung dinh dang (Ed25519 base64url 64 byte).');
  return { deviceId: h.get(HEADER.deviceId), timestamp: Number(tsRaw), nonce, signature: sig };
}

export function signedPath(c: Context): string {
  const u = new URL(c.req.url);
  return u.pathname + u.search;
}

/** Xac minh chu ky voi khoa cong khai da biet, kiem do lech dong ho, chan nonce phat lai. */
export async function verifyEnvelope(c: Context, deps: AuthDeps, env: Envelope, body: Uint8Array, pubkey: string, scope: string): Promise<void> {
  const now = nowSec(deps.rt.clock.now());
  if (Math.abs(now - env.timestamp) > MAX_CLOCK_SKEW_S) {
    throw new HttpProblem('stale_timestamp', `Dong ho lech qua ${MAX_CLOCK_SKEW_S} giay so voi may chu.`, { server_time: now });
  }
  const msg = canonicalRequest(c.req.method, signedPath(c), String(env.timestamp), env.nonce, await sha256Hex(body));
  if (!(await ed25519Verify(pubkey, env.signature, msg))) throw new HttpProblem('invalid_signature', 'Chu ky khong hop le.');
  // chi ghi nonce SAU khi chu ky dung: ke tan cong khong lam o nhiem kho nonce bang chu ky gia
  if (!(await deps.nonces.claim(scope, env.nonce, NONCE_TTL_S))) throw new HttpProblem('replay', 'Nonce da duoc dung (phat lai).');
}

/** Xac thuc thiet bi da dang ky (header X-Device-Id). */
export async function authenticateDevice(c: Context, deps: AuthDeps, body: Uint8Array): Promise<DeviceRec> {
  const env = readEnvelope(c);
  if (!env.deviceId) throw new HttpProblem('unknown_device', 'Thieu tieu de X-Device-Id.');
  const dev = await deps.devices.get(env.deviceId);
  if (!dev) throw new HttpProblem('unknown_device', 'Thiet bi chua dang ky.');
  await verifyEnvelope(c, deps, env, body, dev.pubkey, dev.id);
  if (dev.blocked) throw new HttpProblem('device_blocked', 'Thiet bi bi khoa.');
  return dev;
}
