// Cong cu kiem thu: mo phong tien trinh chet GIUA CAC CAU LENH. Dem moi lan GHI (db.run, db.batch = mot lan, truy van UPDATE/INSERT/DELETE, kv.set/incr/del)
// va nem SimulatedCrash TRUOC lan ghi thu `armAt` (nghia la moi ranh gioi giua hai lan ghi deu duoc thu). Chi dung trong test.
import type { Db, Kv, Runtime } from './types.js';

export class SimulatedCrash extends Error {
  constructor(public at: number) {
    super(`mat dien gia lap truoc lan ghi thu ${at}`);
    this.name = 'SimulatedCrash';
  }
}

export interface CrashController {
  /** so lan ghi da dem tu luc reset */
  writes: number;
  /** nem SimulatedCrash truoc lan ghi thu n (1-based); null = tat */
  armAt(n: number | null): void;
  reset(): void;
}

const isWrite = (sql: string): boolean => /^\s*(insert|update|delete)\b/i.test(sql);

/**
 * Boc Runtime de chen loi. `nonAtomic: true` mo phong D1: tx() chay thang tung cau lenh va KHONG hoan tac khi fn nem loi
 * (tx that cua pg/sqlite hoan tac, nen mat dien giua giao dich khong de lai trang thai do).
 */
export function crashable<R extends Runtime>(rt: R, opts: { nonAtomic?: boolean } = {}): { rt: R; ctl: CrashController } {
  let writes = 0;
  let at: number | null = null;
  const tick = (): void => {
    writes++;
    if (at !== null && writes === at) throw new SimulatedCrash(writes);
  };
  const wrapDb = (inner: Db): Db => {
    const d: Db = {
      dialect: inner.dialect,
      ...(opts.nonAtomic ? { interactiveTx: false as const } : inner.interactiveTx === false ? { interactiveTx: false as const } : {}),
      query: (sql, params) => {
        if (isWrite(sql)) tick();
        return inner.query(sql, params);
      },
      run: (sql, params) => {
        tick();
        return inner.run(sql, params);
      },
      batch: (stmts) => {
        tick();
        return inner.batch(stmts);
      },
      tx: (fn) => (opts.nonAtomic ? fn(d) : inner.tx((t) => fn(wrapDb(t)))),
    } as Db;
    return d;
  };
  const kv: Kv = {
    get: (k) => rt.kv.get(k),
    set: (k, v, ttl) => (tick(), rt.kv.set(k, v, ttl)),
    del: (k) => (tick(), rt.kv.del(k)),
    incr: (k, ttl) => (tick(), rt.kv.incr(k, ttl)),
  };
  const ctl: CrashController = {
    get writes() {
      return writes;
    },
    armAt: (n) => {
      at = n;
    },
    reset: () => {
      writes = 0;
      at = null;
    },
  };
  return { rt: { ...rt, db: wrapDb(rt.db), kv }, ctl };
}
