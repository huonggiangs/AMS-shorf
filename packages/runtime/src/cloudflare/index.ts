import type { D1Database, KVNamespace, Queue as CfQueueBinding, R2Bucket } from '@cloudflare/workers-types';
import { ulid } from '@ams/shared';
import type { Config, Runtime } from '../types.js';
import { D1Db } from './d1.js';
import { CfEventStore } from './events.js';
import { CfKv } from './kv.js';
import { HttpMailer } from './mail.js';
import { mailConfigFromEnv } from '../mail-http.js';
import { CfQueue } from './queue.js';
import { R2ObjectStore } from './r2.js';

export { D1Counters } from './counters.js';
export { D1Db, CfKv, CfQueue, R2ObjectStore, HttpMailer, CfEventStore };

/** Binding + bien cua Worker (wrangler.toml). Cac khoa khac la bien chuoi/secret. */
export interface CloudflareEnv {
  DB: D1Database;
  KV: KVNamespace;
  QUEUE: CfQueueBinding<{ topic: string; msg: unknown }>;
  BUCKET: R2Bucket;
  [k: string]: unknown;
}

export interface CloudflareRuntime extends Runtime {
  queue: CfQueue;
  kv: CfKv;
}

function str(env: CloudflareEnv): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') o[k] = v;
  return o;
}

/**
 * D1 + KV + Queues + R2. Bien can: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME (ky URL),
 * MAIL_HTTP_URL, MAIL_HTTP_KEY, MAIL_FROM, MAIL_PROVIDER? (resend|postmark|generic), MAIL_REPLY_TO? (gui thu; xem ../mail-http.ts). Phai goi `rt.queue.handleBatch(batch)` trong handler `queue()`.
 */
export function createCloudflareRuntime(env: CloudflareEnv): CloudflareRuntime {
  const vars = str(env);
  const db = new D1Db(env.DB);
  const queue = new CfQueue(env.QUEUE);
  const clock = { now: () => new Date() };
  const config: Config = { runtime: 'cloudflare', env: vars };
  return {
    db,
    kv: new CfKv(env.KV, env.DB),
    queue,
    objects: new R2ObjectStore(
      env.BUCKET,
      {
        accountId: vars['R2_ACCOUNT_ID'] ?? '',
        accessKeyId: vars['R2_ACCESS_KEY_ID'] ?? '',
        secretAccessKey: vars['R2_SECRET_ACCESS_KEY'] ?? '',
        bucketName: vars['R2_BUCKET_NAME'] ?? '',
      },
      clock,
    ),
    mail: new HttpMailer(mailConfigFromEnv(vars, 'AMS <no-reply@ams.vn>')),
    events: new CfEventStore(queue, db),
    clock,
    config,
    id: () => ulid(),
  };
}
