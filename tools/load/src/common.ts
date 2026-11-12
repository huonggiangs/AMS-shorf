// Tien ich dung chung cho generator (gen.ts) va orchestrator (run.ts). Chi dung node:*, khong phu thuoc gateway.
import { createHash, createPrivateKey, randomBytes, sign as edSign, type KeyObject } from 'node:crypto';

export interface DeviceCred {
  id: string;
  region: string;
  /** PKCS8 DER base64 */
  priv: string;
}
export interface Fixture {
  /** moi vung -> danh sach {campaign_id, creative_id, slot_id} hop le cho su kien */
  items: { campaign_id: string; creative_id: string; slot_id: string }[];
}

export const b64u = (b: Buffer): string => b.toString('base64url');
export const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');
const EMPTY_SHA = sha256hex('');

export function loadKey(b64: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
}

/** Ky theo docs/DEVICE-PROTOCOL.md muc 3 (cung dinh dang voi @ams/edge-gateway/testing signRequest). */
export function signed(key: KeyObject, deviceId: string | null, method: 'GET' | 'POST', path: string, body: string | undefined, tsSec: number): Record<string, string> {
  const nonce = b64u(randomBytes(16));
  const ts = String(tsSec);
  const msg = `${method}\n${path}\n${ts}\n${nonce}\n${body === undefined ? EMPTY_SHA : sha256hex(body)}`;
  const sig = b64u(edSign(null, Buffer.from(msg), key));
  const h: Record<string, string> = { 'x-timestamp': ts, 'x-nonce': nonce, 'x-signature': sig };
  if (deviceId) h['x-device-id'] = deviceId;
  if (body !== undefined) {
    h['content-type'] = 'application/json';
    h['content-length'] = String(Buffer.byteLength(body));
  }
  return h;
}

export function uuidv7(ms: number): string {
  const r = randomBytes(10);
  const t = ms.toString(16).padStart(12, '0');
  const rb = r.toString('hex');
  const v = '7' + rb.slice(0, 3);
  const variant = ((parseInt(rb.slice(3, 4), 16) & 0x3) | 0x8).toString(16) + rb.slice(4, 7);
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-${v}-${variant}-${rb.slice(7, 19)}`;
}

export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1]!;
}

export interface TypeStats {
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  statuses: Record<string, number>;
}
export class Rec {
  lat = new Map<string, number[]>();
  st = new Map<string, Record<string, number>>();
  add(type: string, ms: number, status: number): void {
    (this.lat.get(type) ?? this.lat.set(type, []).get(type)!).push(ms);
    const s = this.st.get(type) ?? this.st.set(type, {}).get(type)!;
    s[String(status)] = (s[String(status)] ?? 0) + 1;
  }
  summary(): Record<string, TypeStats> {
    const out: Record<string, TypeStats> = {};
    const allLat: number[] = [];
    const allSt: Record<string, number> = {};
    for (const [k, v] of this.lat) {
      const s = Float64Array.from(v).sort();
      const st = this.st.get(k)!;
      out[k] = { count: s.length, errors: errCount(st), p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s[s.length - 1] ?? 0, statuses: st };
      for (const x of v) allLat.push(x);
      for (const [c, n] of Object.entries(st)) allSt[c] = (allSt[c] ?? 0) + n;
    }
    const a = Float64Array.from(allLat).sort();
    out['ALL'] = { count: a.length, errors: errCount(allSt), p50: percentile(a, 50), p95: percentile(a, 95), p99: percentile(a, 99), max: a[a.length - 1] ?? 0, statuses: allSt };
    return out;
  }
}
function errCount(st: Record<string, number>): number {
  let e = 0;
  for (const [c, n] of Object.entries(st)) if (!(c === '200' || c === '201' || c === '202' || c === '304')) e += n;
  return e;
}
