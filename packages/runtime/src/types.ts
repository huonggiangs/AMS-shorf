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
  /** Tang nguyen tu 1; ttl (cua so co dinh) chi dat o lan tao. Tren Cloudflare tang nguyen tu qua D1 (xem cloudflare/kv.ts, docs/DECISIONS-CF-COUNTERS.md). */
  incr(k: string, ttlSec?: number): Promise<number>;
  /** Tuy chon: tang nguyen tu them `by`. Dung `kvIncrBy` (counters.ts) de co duong lui. */
  incrBy?(k: string, by: number, ttlSec?: number): Promise<number>;
  /** Tuy chon: tang nhieu khoa trong MOT vong (D1 batch / Redis pipeline). Dung `kvIncrMany` (counters.ts) de co duong lui. */
  incrMany?(ops: KvIncrOp[]): Promise<number[]>;
}

export interface KvIncrOp {
  k: string;
  /** mac dinh 1; 0 = chi doc gia tri hien tai (tao khoa neu chua co) */
  by?: number;
  ttlSec?: number | undefined;
}

export interface Queue<T = unknown> {
  send(topic: string, msg: T): Promise<void>;
  subscribe(topic: string, handler: (msg: T) => Promise<void>): void;
} // memory/redis/redpanda/CF Queues

export interface ObjectStore {
  /** `opts.maxBytes`: chi adapter fs dung (S3/R2 gioi han kich thuoc o buoc confirm). */
  putSigned(key: string, contentType: string, ttlSec: number, opts?: { maxBytes?: number }): Promise<{ url: string; headers: Record<string, string> }>;
  getSigned(key: string, ttlSec: number): Promise<string>;
  /**
   * false = KHONG ky duoc URL PUT truc tiep len kho (vd Cloudflare R2 thieu khoa S3): API phai nhan tep qua chinh no
   * (`PUT /media/:id/content`, ghi bang `putStream`). undefined/true = `putSigned` dung duoc.
   */
  readonly signedPut?: boolean;
  /** Ghi tep tu luong, KHONG doc ca tep vao bo nho. `size` la so byte da khai (R2 can do dai biet truoc). Ghi de neu da co. */
  putStream?(key: string, body: ReadableStream<Uint8Array>, contentType: string, size: number): Promise<void>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  /** Tuy chon (adapter fs + bo nho): xoa khong loi neu khong co; liet ke theo tien to chuoi. */
  /** Tuy chon: doc mot doan [offset, offset+length) (khong doc ca tep vao bo nho Worker). Tra ve toi da `length` byte; null neu khong co tep. */
  getRange?(key: string, offset: number, length: number): Promise<Uint8Array | null>;
  delete?(key: string): Promise<void>;
  list?(prefix?: string, limit?: number): Promise<{ key: string; size: number }[]>;
  /**
   * Tai len TUNG PHAN (multipart), tuy chon. Dung khi tep lon khong gui duoc trong mot request (Cloudflare Worker: body toi da 100 MB)
   * va khong co khoa S3 de ky URL. Quy tac chung (R2/S3): moi phan (tru phan cuoi) co CUNG kich thuoc va >= 5 MiB; so phan <= 10000.
   * `etag` do kho tra ve; `multipartComplete` phai nhan DUNG cac etag do (sai/thieu phan => nem loi, khong tao tep).
   */
  multipartCreate?(key: string, contentType: string): Promise<{ uploadId: string }>;
  multipartUploadPart?(key: string, uploadId: string, partNumber: number, body: Uint8Array | ReadableStream<Uint8Array>, size: number): Promise<{ etag: string }>;
  multipartComplete?(key: string, uploadId: string, parts: MultipartPart[]): Promise<void>;
  /** Huy va giai phong cac phan da tai; idempotent (khong loi neu uploadId khong con). */
  multipartAbort?(key: string, uploadId: string): Promise<void>;
}

export interface MultipartPart {
  /** so thu tu phan, tu 1 */
  n: number;
  etag: string;
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
