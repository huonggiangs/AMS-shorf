import type { KVNamespace } from '@cloudflare/workers-types';
import type { Kv } from '../types.js';

/**
 * Workers KV: TTL toi thieu 60 giay (kep len 60). `incr` KHONG nguyen tu (doc-roi-ghi, nhat quan cuoi cung):
 * chi dung cho gioi han toc do tuong doi; bo dem chinh xac can Durable Object.
 */
export class CfKv implements Kv {
  constructor(private kv: KVNamespace) {}
  async get(k: string) {
    return this.kv.get(k);
  }
  async set(k: string, v: string, ttlSec?: number) {
    await this.kv.put(k, v, ttlSec ? { expirationTtl: Math.max(60, Math.ceil(ttlSec)) } : undefined);
  }
  async del(k: string) {
    await this.kv.delete(k);
  }
  async incr(k: string, ttlSec?: number) {
    const n = Number((await this.kv.get(k)) ?? 0) + 1;
    await this.kv.put(k, String(n), ttlSec ? { expirationTtl: Math.max(60, Math.ceil(ttlSec)) } : undefined);
    return n;
  }
}
