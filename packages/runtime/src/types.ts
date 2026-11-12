// Hop dong Runtime (PLAN §3). Ma nghiep vu chi nhan `deps: Runtime`, khong import truc tiep pg/ioredis/D1.
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Giao dich; long nhau dung SAVEPOINT. Rollback khi fn nem loi. (D1: xem ghi chu o cloudflare/d1.ts) */
  tx<T>(fn: (t: Db) => Promise<T>): Promise<T>;
  /** Mo rong so voi PLAN: chay danh sach cau lenh nguyen tu (D1 dung batch gia tri, Postgres/SQLite dung giao dich). */
  batch(stmts: { sql: string; params?: unknown[] }[]): Promise<{ changes: number }[]>;
  dialect: 'postgres' | 'sqlite';
  /** false tren D1: tx() chay cau lenh ngay, KHONG hoan tac khi loi; dung batch() cho thao tac tien can nguyen tu. Mac dinh (undefined) = true. */
  readonly interactiveTx?: boolean;
}

export interface Kv {
  get(k: string): Promise<string | null>;
  set(k: string, v: string, ttlSec?: number): Promise<void>;
  del(k: string): Promise<void>;
  incr(k: string, ttlSec?: number): Promise<number>;
}

export interface Queue<T = unknown> {
  send(topic: string, msg: T): Promise<void>;
  subscribe(topic: string, handler: (msg: T) => Promise<void>): void;
} // memory/redis/redpanda/CF Queues

export interface ObjectStore {
  putSigned(key: string, contentType: string, ttlSec: number): Promise<{ url: string; headers: Record<string, string> }>;
  getSigned(key: string, ttlSec: number): Promise<string>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
}

export interface Mailer {
  send(m: { to: string; subject: string; html: string; text?: string }): Promise<void>;
}

export type EventTable = 'heartbeat' | 'ad_impression' | 'proof_of_play';

export interface EventStore {
  append(table: EventTable, rows: Record<string, unknown>[]): Promise<void>;
  countImpressions(campaignId: string, sinceIso?: string): Promise<number>;
}

export interface Clock {
  now(): Date;
}

export interface Config {
  runtime: 'docker' | 'cloudflare' | 'k8s' | 'test';
  env: Record<string, string | undefined>;
}

export interface Runtime {
  db: Db;
  kv: Kv;
  queue: Queue;
  objects: ObjectStore;
  mail: Mailer;
  events: EventStore;
  clock: Clock;
  config: Config;
  id(): string; // ULID
  /** Mo rong: giai phong ket noi (pg/redis/sqlite). Khong bat buoc goi tren Workers. */
  close?(): Promise<void>;
}
