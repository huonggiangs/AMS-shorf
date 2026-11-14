import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { MANIFEST_EPOCH_KEY } from '@ams/shared';
import type { Kv, KvIncrOp } from '../types.js';
import { D1Counters } from './counters.js';

/**
 * Workers KV (get/set/del; TTL toi thieu 60 giay, kep len 60) + bo dem NGUYEN TU tren D1 cho `incr`/`incrBy`/`incrMany`
 * (R1-12: KV doc-roi-ghi lam mat luot tang). Cac khoa dem (rate limit, khoa chiem, khu trung, tran gio) KHONG duoc doc bang `get`.
 * Ngoai le: `manifest:epoch` chi can DOI GIA TRI sau moi lan bump (mat mot luot tang dong thoi khong sao) va gateway doc no bang `get`
 * => giu tren KV. Khong truyen D1 (test don le) => tat ca `incr` roi ve KV khong nguyen tu nhu truoc.
 */
const KV_ONLY_INCR = new Set<string>([MANIFEST_EPOCH_KEY]);

export class CfKv implements Kv {
  private counters: D1Counters | null;
  constructor(private kv: KVNamespace, d1?: D1Database | D1Counters) {
    this.counters = d1 ? (d1 instanceof D1Counters ? d1 : new D1Counters(d1)) : null;
  }
  async get(k: string) {
    return this.kv.get(k);
  }
  async set(k: string, v: string, ttlSec?: number) {
    await this.kv.put(k, v, ttlSec ? { expirationTtl: Math.max(60, Math.ceil(ttlSec)) } : undefined);
  }
  async del(k: string) {
    await this.kv.delete(k);
    await this.counters?.delK(k); // xoa khoa chiem/khoa mem dem (vd media:lock:*)
  }
  private async kvIncr(k: string, by: number, ttlSec?: number) {
    const n = Number((await this.kv.get(k)) ?? 0) + by;
    await this.kv.put(k, String(n), ttlSec ? { expirationTtl: Math.max(60, Math.ceil(ttlSec)) } : undefined);
    return n;
  }
  async incr(k: string, ttlSec?: number) {
    return this.incrBy(k, 1, ttlSec);
  }
  async incrBy(k: string, by: number, ttlSec?: number) {
    return (await this.incrMany([{ k, by, ttlSec }]))[0]!;
  }
  /** Don dong dem het han trong D1 (goi tu cron). */
  async purgeExpiredCounters(limit = 5000): Promise<number> {
    return this.counters ? this.counters.purge(limit) : 0;
  }
  async incrMany(ops: KvIncrOp[]): Promise<number[]> {
    if (!this.counters) {
      const out: number[] = [];
      for (const o of ops) out.push(await this.kvIncr(o.k, o.by ?? 1, o.ttlSec));
      return out;
    }
    const atomicIdx: number[] = [];
    const out = new Array<number>(ops.length);
    for (let i = 0; i < ops.length; i++) {
      if (KV_ONLY_INCR.has(ops[i]!.k)) out[i] = await this.kvIncr(ops[i]!.k, ops[i]!.by ?? 1, ops[i]!.ttlSec);
      else atomicIdx.push(i);
    }
    if (atomicIdx.length > 0) {
      const ns = await this.counters.incrMany(atomicIdx.map((i) => ops[i]!));
      atomicIdx.forEach((i, j) => (out[i] = ns[j]!));
    }
    return out;
  }
}
