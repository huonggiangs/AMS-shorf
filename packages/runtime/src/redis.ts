import type { Redis } from 'ioredis';
import type { Kv, Queue } from './types.js';

const INCR_LUA = `local v = redis.call('INCR', KEYS[1])
if v == 1 and tonumber(ARGV[1]) > 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`;

export class RedisKv implements Kv {
  private constructor(readonly client: Redis) {}
  static async connect(url: string): Promise<RedisKv> {
    const { Redis } = await import('ioredis');
    const c = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
    await c.connect();
    return new RedisKv(c);
  }
  static fromClient(c: Redis): RedisKv {
    return new RedisKv(c);
  }
  async get(k: string) {
    return this.client.get(k);
  }
  async set(k: string, v: string, ttlSec?: number) {
    if (ttlSec && ttlSec > 0) await this.client.set(k, v, 'EX', Math.ceil(ttlSec));
    else await this.client.set(k, v);
  }
  async del(k: string) {
    await this.client.del(k);
  }
  /** Tang nguyen tu; ttl chi dat o lan dau (cua so co dinh, dung cho rate limit). */
  async incr(k: string, ttlSec?: number) {
    return Number(await this.client.eval(INCR_LUA, 1, k, String(ttlSec ?? 0)));
  }
  async close() {
    this.client.disconnect();
  }
}

type Handler = (m: unknown) => Promise<void>;
const MAX_ATTEMPTS = 3;

/**
 * Hang doi tren Redis list: LPUSH + BRPOP (moi topic mot ket noi chan rieng).
 * Tin hong/that bai qua 3 lan vao `<prefix><topic>:dead`. Khong co "exactly once": handler phai idempotent.
 */
export class RedisQueue implements Queue {
  private loops: { conn: Redis; stop: boolean }[] = [];
  private active = new Set<Promise<void>>();
  constructor(private client: Redis, private prefix = 'ams:q:') {}

  async send(topic: string, msg: unknown): Promise<void> {
    await this.client.lpush(this.prefix + topic, JSON.stringify({ n: 0, m: msg }));
  }

  subscribe(topic: string, handler: Handler): void {
    const conn = this.client.duplicate();
    const loop = { conn, stop: false };
    this.loops.push(loop);
    const key = this.prefix + topic;
    const p = (async () => {
      while (!loop.stop) {
        let item: [string, string] | null = null;
        try {
          item = await conn.brpop(key, 1);
        } catch {
          if (loop.stop) return;
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (!item) continue;
        const env = JSON.parse(item[1]) as { n: number; m: unknown };
        try {
          await handler(env.m);
        } catch {
          if (env.n + 1 >= MAX_ATTEMPTS) await this.client.lpush(key + ':dead', JSON.stringify(env));
          else await this.client.lpush(key, JSON.stringify({ n: env.n + 1, m: env.m }));
        }
      }
    })();
    this.active.add(p);
    void p.finally(() => this.active.delete(p));
  }

  async deadCount(topic: string): Promise<number> {
    return this.client.llen(this.prefix + topic + ':dead');
  }

  async close(): Promise<void> {
    for (const l of this.loops) {
      l.stop = true;
      l.conn.disconnect();
    }
    await Promise.allSettled([...this.active]);
  }
}
