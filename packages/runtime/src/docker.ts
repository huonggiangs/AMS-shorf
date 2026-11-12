import { ulid } from '@ams/shared';
import { SystemClock } from './memory.js';
import { DbEventStore } from './events.js';
import { PgDb, createPgPool } from './adapters-pg.js';
import { RedisKv, RedisQueue } from './redis.js';
import { S3ObjectStore } from './s3.js';
import { SmtpMailer } from './smtp.js';
import { ClickHouseEventStore } from './clickhouse.js';
import type { Config, EventStore, Mailer, Runtime } from './types.js';

export type DockerEnv = Record<string, string | undefined>;

export interface DockerRuntime extends Runtime {
  db: PgDb;
  kv: RedisKv;
  queue: RedisQueue;
  objects: S3ObjectStore;
  close(): Promise<void>;
}

function need(env: DockerEnv, k: string): string {
  const v = env[k];
  if (!v) throw new Error(`thieu bien moi truong ${k}`);
  return v;
}

/**
 * Docker/PC: Postgres (pg Pool), Redis (ioredis), MinIO (S3 presign), SMTP (Mailpit), EventStore -> ev_* hoac ClickHouse (CLICKHOUSE_URL).
 * Bien: DATABASE_URL, REDIS_URL, S3_ENDPOINT, S3_PUBLIC_ENDPOINT?, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION?,
 *       SMTP_HOST, SMTP_PORT, SMTP_USER?, SMTP_PASS?, MAIL_FROM?, CLICKHOUSE_URL?
 */
export async function createDockerRuntime(
  env: DockerEnv,
  overrides: { mail?: Mailer; events?: EventStore } = {},
): Promise<DockerRuntime> {
  const pool = await createPgPool(need(env, 'DATABASE_URL'));
  const db = new PgDb(pool);
  const kv = await RedisKv.connect(need(env, 'REDIS_URL'));
  const queue = new RedisQueue(kv.client, env['QUEUE_PREFIX'] ?? 'ams:q:');
  const objects = new S3ObjectStore({
    endpoint: need(env, 'S3_ENDPOINT'),
    publicEndpoint: env['S3_PUBLIC_ENDPOINT'],
    region: env['S3_REGION'] ?? 'us-east-1',
    bucket: need(env, 'S3_BUCKET'),
    accessKeyId: need(env, 'S3_ACCESS_KEY'),
    secretAccessKey: need(env, 'S3_SECRET_KEY'),
  });
  const mail =
    overrides.mail ??
    new SmtpMailer({
      host: need(env, 'SMTP_HOST'),
      port: Number(env['SMTP_PORT'] ?? 1025),
      user: env['SMTP_USER'],
      pass: env['SMTP_PASS'],
      from: env['MAIL_FROM'] ?? 'AMS <no-reply@ams.localhost>',
    });
  const events = overrides.events ?? (env['CLICKHOUSE_URL'] ? new ClickHouseEventStore(env['CLICKHOUSE_URL'], env['CLICKHOUSE_DB'] ?? 'default') : new DbEventStore(db));
  const clock = new SystemClock();
  const config: Config = { runtime: 'docker', env };
  return {
    db,
    kv,
    queue,
    objects,
    mail,
    events,
    clock,
    config,
    id: () => ulid(clock.now().getTime()),
    async close() {
      await queue.close();
      await kv.close();
      await db.close();
    },
  };
}
