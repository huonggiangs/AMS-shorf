// Cloudflare Worker: fetch (Hono), queue (consumer ams-ingest-<env>), scheduled (cron moi phut), Durable Object PresenceShard.
// CHUA chay that tren Cloudflare (khong co wrangler/tai khoan o day) — chi kiem tsc voi tsconfig.workers.json.
import { DurableObject } from 'cloudflare:workers';
import type {
  AnalyticsEngineDataset,
  D1Database,
  DurableObjectNamespace,
  ExecutionContext,
  KVNamespace,
  MessageBatch,
  Queue as CfQueueBinding,
  R2Bucket,
  ScheduledController,
} from '@cloudflare/workers-types';
import { createCloudflareRuntime, type CloudflareRuntime } from '@ams/runtime/cloudflare';
import { createIngestConsumer } from '@ams/ingest-consumer';
import { spendFnFor } from '@ams/ingest-consumer/spend';
import { shardOf } from '@ams/shared';
import type { NonceStore } from './auth.js';
import { createGateway, type Gateway } from './gateway.js';
import type { Presence, PresenceRec } from './presence.js';
import { PRESENCE_TTL_S } from './protocol.js';

export interface Env {
  DB_CORE: D1Database;
  KV: KVNamespace;
  MEDIA: R2Bucket;
  INGEST_QUEUE: CfQueueBinding<{ topic: string; msg: unknown }>;
  PRESENCE: DurableObjectNamespace<PresenceShard>;
  EVENTS_AE?: AnalyticsEngineDataset;
  [k: string]: unknown;
}

const SHARDS = (env: Env) => Math.max(1, Number(env['PRESENCE_SHARDS'] ?? 16));

/**
 * Presence + nonce chong phat lai, theo shard. Mot DO ~ 1/N thiet bi; SQLite noi bo nen ghi dong re va nguyen tu
 * (KV khong nguyen tu: khong dung de chong phat lai o production). Gioi han mem 1.000 req/s/DO: tang PRESENCE_SHARDS khi can.
 */
export class PresenceShard extends DurableObject<Env> {
  private ops = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS presence (device_id TEXT PRIMARY KEY, ts INTEGER NOT NULL, state INTEGER, region TEXT)');
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS nonces (k TEXT PRIMARY KEY, exp INTEGER NOT NULL)');
    });
  }

  /** Ghi heartbeat; tra ts truoc do (null neu chua thay hoac da het han 6 phut). */
  touch(deviceId: string, ts: number, state: number, region: string | null): number | null {
    const sql = this.ctx.storage.sql;
    const prev = sql.exec<{ ts: number }>('SELECT ts FROM presence WHERE device_id = ?', deviceId).toArray()[0];
    sql.exec('INSERT INTO presence (device_id, ts, state, region) VALUES (?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET ts = excluded.ts, state = excluded.state, region = excluded.region', deviceId, ts, state, region);
    this.gc(ts);
    return prev && ts - prev.ts <= PRESENCE_TTL_S ? prev.ts : null;
  }

  /** true = nonce moi. */
  claimNonce(key: string, nowS: number, ttlSec: number): boolean {
    const sql = this.ctx.storage.sql;
    const row = sql.exec<{ exp: number }>('SELECT exp FROM nonces WHERE k = ?', key).toArray()[0];
    if (row && row.exp > nowS) return false;
    sql.exec('INSERT INTO nonces (k, exp) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET exp = excluded.exp', key, nowS + ttlSec);
    this.gc(nowS);
    return true;
  }

  stats(nowS: number, onlineWithinS: number): { online: number; total: number } {
    const sql = this.ctx.storage.sql;
    const online = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM presence WHERE ts >= ?', nowS - onlineWithinS).one().n;
    const total = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM presence').one().n;
    return { online, total };
  }

  private gc(nowS: number): void {
    if (++this.ops % 500 !== 0) return;
    this.ctx.storage.sql.exec('DELETE FROM nonces WHERE exp < ?', nowS);
    this.ctx.storage.sql.exec('DELETE FROM presence WHERE ts < ?', nowS - 24 * 3600);
  }
}

class DoPresence implements Presence {
  constructor(private env: Env) {}
  async touch(deviceId: string, rec: PresenceRec): Promise<{ prevTs: number | null }> {
    const stub = this.env.PRESENCE.get(this.env.PRESENCE.idFromName(`shard-${shardOf(deviceId) % SHARDS(this.env)}`));
    return { prevTs: await stub.touch(deviceId, rec.ts, rec.state, rec.region) };
  }
}
class DoNonces implements NonceStore {
  constructor(private env: Env) {}
  async claim(scope: string, nonce: string, ttlSec: number): Promise<boolean> {
    const key = `${scope}:${nonce}`;
    const stub = this.env.PRESENCE.get(this.env.PRESENCE.idFromName(`shard-${shardOf(scope) % SHARDS(this.env)}`));
    return stub.claimNonce(key, Math.floor(Date.now() / 1000), ttlSec);
  }
}

interface Booted {
  rt: CloudflareRuntime;
  gw: Gateway;
  lastFlush: number;
}
let booted: Booted | undefined;
function boot(env: Env): Booted {
  if (booted) return booted;
  // anh xa ten binding cua wrangler (DB_CORE/INGEST_QUEUE/MEDIA) sang ten ma createCloudflareRuntime mong doi
  const rt = createCloudflareRuntime({ ...env, DB: env.DB_CORE, QUEUE: env.INGEST_QUEUE, BUCKET: env.MEDIA } as never);
  const gw = createGateway(rt, { presence: new DoPresence(env), nonces: new DoNonces(env) });
  // consumer chay trong chinh Worker nay (handler queue); chi tieu that cua payments (idempotent).
  createIngestConsumer(rt, { spend: spendFnFor(rt) }).subscribe();
  booted = { rt, gw, lastFlush: Date.now() };
  return booted;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const b = boot(env);
    const res = await b.gw.app.fetch(request, env, ctx);
    // isolate Workers ngan han: xa bo dem telemetry moi >=5 giay (cung co nguong kich thuoc trong gateway)
    if (Date.now() - b.lastFlush > 5000) {
      b.lastFlush = Date.now();
      ctx.waitUntil(b.gw.flush().catch(() => undefined));
    }
    return res;
  },

  async queue(batch: MessageBatch<{ topic: string; msg: unknown }>, env: Env): Promise<void> {
    await boot(env).rt.queue.handleBatch(batch);
  },

  /** Cron moi phut: tong hop presence tu cac shard vao Analytics Engine (bieu do online), va xa bo dem cua isolate nay. */
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const b = boot(env);
    ctx.waitUntil(b.gw.flush().catch(() => undefined));
    ctx.waitUntil(b.gw.sweep().then(() => undefined, () => undefined)); // het han lenh thiet bi
    ctx.waitUntil(b.rt.kv.purgeExpiredCounters().then(() => undefined, () => undefined)); // don bo dem D1 het han (kv_counters)
    if (!env.EVENTS_AE) return;
    const now = Math.floor(Date.now() / 1000);
    const n = SHARDS(env);
    const window = Math.round(Number(env['HB_PLAYING_S'] ?? 300) * 2.5);
    const stats = await Promise.all(
      Array.from({ length: n }, (_, i) => env.PRESENCE.get(env.PRESENCE.idFromName(`shard-${i}`)).stats(now, window)),
    );
    stats.forEach((s, i) => env.EVENTS_AE!.writeDataPoint({ indexes: [`shard-${i}`], blobs: ['presence'], doubles: [s.online, s.total] }));
  },
};
