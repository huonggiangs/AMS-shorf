import { migrate } from '@ams/db';
import { ulid } from '@ams/shared';
import { PgliteDb, openPglite } from './adapters-pglite.js';
import { SqliteDb, openSqlite } from './adapters-sqlite.js';
import { DbEventStore } from './events.js';
import { MemoryKv, MemoryMailer, MemoryObjectStore, MemoryQueue, TestClock } from './memory.js';
import type { Db, Runtime } from './types.js';

export interface TestRuntime extends Runtime {
  clock: TestClock;
  kv: MemoryKv;
  queue: MemoryQueue;
  objects: MemoryObjectStore;
  mail: MemoryMailer;
  close(): Promise<void>;
}

export interface TestRuntimeOptions {
  /** 'postgres' (pglite, mac dinh) hoac 'sqlite' (node:sqlite, proxy cho D1) */
  dialect?: 'postgres' | 'sqlite';
  /** chay migration (mac dinh true) */
  migrate?: boolean;
  /** dong ban dong ho tai thoi diem nay; khong dat = gio that */
  now?: Date | string | number;
  env?: Record<string, string | undefined>;
}

/** Khoa truong chi dung cho test (32 byte, base64). Khong phai bi mat that. */
export const TEST_FIELD_ENC_KEY = 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktMTIzNDU=';

export const TEST_ENV: Record<string, string> = {
  RUNTIME: 'test',
  FIELD_ENC_KEY: TEST_FIELD_ENC_KEY,
  SEPAY_MODE: 'mock',
  SEPAY_WEBHOOK_SECRET: 'test-sepay-secret',
  SEPAY_API_KEY: 'test-sepay-apikey',
};

/** pglite (hoac node:sqlite) + memory kv/queue/objects/mail/events. Cach dung: `const rt = await createTestRuntime()`. */
export async function createTestRuntime(opts: TestRuntimeOptions = {}): Promise<TestRuntime> {
  const dialect = opts.dialect ?? 'postgres';
  let db: Db;
  let closeDb: () => Promise<void>;
  if (dialect === 'postgres') {
    const d = new PgliteDb(await openPglite());
    db = d;
    closeDb = () => d.close();
  } else {
    const d = new SqliteDb(openSqlite());
    db = d;
    closeDb = async () => d.close();
  }
  if (opts.migrate !== false) await migrate(db);
  const clock = new TestClock(opts.now);
  const rt: TestRuntime = {
    db,
    kv: new MemoryKv(clock),
    queue: new MemoryQueue(),
    objects: new MemoryObjectStore(clock),
    mail: new MemoryMailer(),
    events: new DbEventStore(db),
    clock,
    config: { runtime: 'test', env: { ...TEST_ENV, ...opts.env } },
    id: () => ulid(clock.now().getTime()),
    close: closeDb,
  };
  return rt;
}
