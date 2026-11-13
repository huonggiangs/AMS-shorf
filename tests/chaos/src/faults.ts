// Chen loi ngau nhien co hat giong (seed) quanh Runtime: Db/Kv/Queue nem loi (truoc HOAC SAU khi thuc thi: "sau" mo phong mat phan hoi sau commit),
// tre ngau nhien (doi thu tu cac tac vu dong thoi), hang doi gui trung/giu-xao-tron. Va giao van HTTP mat goi/mat phan hoi/gui trung.
// Chi dung API cong khai (Db/Kv/Queue/Runtime). Hoan toan tat dinh theo seed: in seed khi that bai de tai hien.
import type { Db, Kv, Queue, Runtime, TestRuntime } from '@ams/runtime';
import type { Transport } from './world.js';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class InjectedFault extends Error {
  constructor(public where: string) {
    super('loi chen: ' + where);
    this.name = 'InjectedFault';
  }
}

export interface FaultConfig {
  /** xac suat moi cau lenh Db that bai */
  db?: number;
  /** xac suat moi thao tac Kv that bai */
  kv?: number;
  /** xac suat moi lan queue.send that bai (truoc khi nhan) */
  queueSend?: number;
  /** xac suat gui trung (giao 2 lan) */
  queueDup?: number;
  /** xac suat giu tin lai de giao sau, sai thu tu (xa bang flushQueue) */
  queueHold?: number;
  /** xac suat tre ngau nhien (<=3ms) truoc moi thao tac */
  delay?: number;
  /** 'before' = loi truoc khi thuc thi; 'after' = thuc thi roi moi bao loi (commit mat phan hoi); 'mixed' = ngau nhien */
  when?: 'before' | 'after' | 'mixed';
  /** khong chen loi cho khoa kv.get bat dau bang cac tien to nay (tranh loi DA BIET: xem requests muc 1) */
  kvSkipGet?: string[];
}

export interface Flaky {
  rt: Runtime;
  /** bat/tat chen loi (tat khi khoi tao du lieu va khi doi soat) */
  armed: boolean;
  injected: { db: number; kv: number; queue: number };
  /** giao het cac tin dang giu theo thu tu xao tron */
  flushQueue(): Promise<void>;
}

export function flaky(base: TestRuntime, cfg: FaultConfig, rand: () => number): Flaky {
  const f: Flaky = { rt: undefined as unknown as Runtime, armed: false, injected: { db: 0, kv: 0, queue: 0 }, flushQueue: async () => undefined };
  const when = (): 'before' | 'after' => (cfg.when === 'mixed' || cfg.when === undefined ? (rand() < 0.5 ? 'before' : 'after') : cfg.when);
  const maybeDelay = async () => {
    if (f.armed && cfg.delay && rand() < cfg.delay) await sleep(rand() * 3);
  };

  async function guard<T>(kind: 'db' | 'kv', p: number | undefined, label: string, exec: () => Promise<T>, canAfter: boolean): Promise<T> {
    await maybeDelay();
    if (!f.armed || !p || rand() >= p) return exec();
    f.injected[kind]++;
    if (canAfter && when() === 'after') {
      await exec();
      throw new InjectedFault(label + ' (sau khi thuc thi)');
    }
    throw new InjectedFault(label);
  }
  const isWrite = (sql: string) => /^\s*(insert|update|delete)\b/i.test(sql);

  const wrapDb = (inner: Db): Db =>
    ({
      dialect: inner.dialect,
      ...(inner.interactiveTx === false ? { interactiveTx: false as const } : {}),
      query: (sql: string, params?: unknown[]) => guard('db', cfg.db, 'db.query ' + sql.slice(0, 40), () => inner.query(sql, params), isWrite(sql)),
      run: (sql: string, params?: unknown[]) => guard('db', cfg.db, 'db.run ' + sql.slice(0, 40), () => inner.run(sql, params), true),
      batch: (stmts: { sql: string; params?: unknown[] }[]) => guard('db', cfg.db, 'db.batch', () => inner.batch(stmts as never), true),
      tx: (fn: (t: Db) => Promise<unknown>) => inner.tx((t) => fn(wrapDb(t))),
    }) as unknown as Db;

  const kv: Kv = {
    get: (k) => guard('kv', cfg.kvSkipGet?.some((p) => k.startsWith(p)) ? 0 : cfg.kv, 'kv.get', () => base.kv.get(k), false),
    set: (k, v, ttl) => guard('kv', cfg.kvSkipGet?.some((p) => k.startsWith(p)) ? 0 : cfg.kv, 'kv.set', () => base.kv.set(k, v, ttl), true),
    del: (k) => guard('kv', cfg.kv, 'kv.del', () => base.kv.del(k), true),
    incr: (k, ttl) => guard('kv', cfg.kv, 'kv.incr', () => base.kv.incr(k, ttl), true),
  };

  const held: { topic: string; msg: unknown }[] = [];
  const queue: Queue = {
    send: async (topic, msg) => {
      await maybeDelay();
      if (f.armed) {
        if (cfg.queueSend && rand() < cfg.queueSend) {
          f.injected.queue++;
          throw new InjectedFault('queue.send');
        }
        if (cfg.queueHold && rand() < cfg.queueHold) {
          f.injected.queue++;
          held.push({ topic, msg: structuredClone(msg) });
          return;
        }
        if (cfg.queueDup && rand() < cfg.queueDup) {
          f.injected.queue++;
          await base.queue.send(topic, structuredClone(msg));
        }
      }
      return base.queue.send(topic, msg);
    },
    subscribe: (topic, h) => base.queue.subscribe(topic, h),
  };
  f.flushQueue = async () => {
    while (held.length) {
      const i = Math.floor(rand() * held.length);
      const [m] = held.splice(i, 1);
      await base.queue.send(m!.topic, m!.msg);
    }
  };
  f.rt = { ...base, db: wrapDb(base.db), kv, queue } as Runtime;
  return f;
}

export interface NetConfig {
  /** yeu cau khong toi may chu (that bai mang) */
  dropReq?: number;
  /** may chu xu ly xong nhung phan hoi bi mat (thiet bi khong biet da toi) */
  dropResp?: number;
  /** goi yeu cau da ky hai lan dong thoi (mang gui trung): lan thu hai la phat lai nonce */
  dup?: number;
}
/** Giao van HTTP khong dang tin: boc mot Transport. Tra loi mang bang cach nem Error. */
export function lossy(inner: Transport, cfg: NetConfig, rand: () => number, stats = { dropReq: 0, dropResp: 0, dup: 0 }): Transport & { stats: typeof stats; clean: boolean } {
  const t = (async (path, init) => {
    if (!t.clean) {
      if (cfg.dropReq && rand() < cfg.dropReq) {
        stats.dropReq++;
        throw new Error('mang: mat yeu cau');
      }
      if (cfg.dup && rand() < cfg.dup) {
        stats.dup++;
        const [a] = await Promise.all([inner(path, init), inner(path, init).catch(() => undefined)]);
        return a;
      }
      const res = await inner(path, init);
      if (cfg.dropResp && rand() < cfg.dropResp) {
        stats.dropResp++;
        await res.arrayBuffer().catch(() => undefined);
        throw new Error('mang: mat phan hoi');
      }
      return res;
    }
    return inner(path, init);
  }) as Transport & { stats: typeof stats; clean: boolean };
  t.stats = stats;
  t.clean = false;
  return t;
}
