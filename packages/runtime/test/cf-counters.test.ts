// R1-12 / N4: bo dem nguyen tu tren D1 (CfKv.incr*, D1Counters) + khu trung PoP theo event_id (N8).
// D1 gia lap bang node:sqlite: moi cau lenh nguyen tu; moi lan goi chen mot `await` de cac loi goi dong thoi xen ke nhau (nhu hai isolate).
import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { MANIFEST_EPOCH_KEY } from '@ams/shared';
import { D1Counters } from '../src/cloudflare/counters.js';
import { CfKv } from '../src/cloudflare/kv.js';
import { openSqlite } from '../src/adapters-sqlite.js';
import { kvClaimMany, kvIncrMany } from '../src/counters.js';
import { MemoryKv } from '../src/index.js';

function fakeD1(opts: { withTable?: boolean } = {}) {
  const db = openSqlite();
  if (opts.withTable !== false) db.exec('CREATE TABLE kv_counters (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)');
  let batches = 0;
  const stmt = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    all: async () => {
      await Promise.resolve();
      return { results: db.prepare(sql).all(...(params as never[])) as unknown[], meta: { changes: 0 } };
    },
    run: async () => {
      await Promise.resolve();
      const r = db.prepare(sql).run(...(params as never[]));
      return { results: [], meta: { changes: Number(r.changes) } };
    },
    _exec: () => {
      const st = db.prepare(sql);
      if (st.columns().length > 0) return { results: st.all(...(params as never[])), meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(st.run(...(params as never[])).changes) } };
    },
  });
  const d1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: { _exec(): unknown }[]) => {
      batches++;
      await Promise.resolve();
      db.exec('BEGIN');
      try {
        const out = ss.map((s) => s._exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { d1: d1 as unknown as D1Database, raw: db, batches: () => batches };
}
const kvStub = () => {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k), m } as never;
};

describe('D1Counters / CfKv.incr nguyen tu', () => {
  it('200 loi tang dong thoi khong mat luot nao (KV doc-roi-ghi se mat)', async () => {
    const { d1 } = fakeD1();
    const kv = new CfKv(kvStub(), d1);
    const res = await Promise.all(Array.from({ length: 200 }, () => kv.incr('rl:login:1', 60)));
    expect([...res].sort((a, b) => a - b)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });

  it('doi chung: CfKv khong co D1 (duong cu) mat luot tang khi dong thoi', async () => {
    const kv = new CfKv(kvStub());
    const res = await Promise.all(Array.from({ length: 50 }, () => kv.incr('k', 60)));
    expect(new Set(res).size).toBeLessThan(50); // chung minh vi sao can D1
  });

  it('incrMany: mot vong D1 batch, ket qua theo thu tu, cung khoa lap lai nhan gia tri tang dan', async () => {
    const f = fakeD1();
    const kv = new CfKv(kvStub(), f.d1);
    const out = await kv.incrMany([{ k: 'a', ttlSec: 60 }, { k: 'b', by: 5, ttlSec: 60 }, { k: 'a', ttlSec: 60 }, { k: 'b', by: 0 }]);
    expect(out).toEqual([1, 5, 2, 5]);
    expect(f.batches()).toBe(1);
  });

  it('50 khoa chiem = 1 vong (N4), chiem lai lo cu => khong con 1', async () => {
    const f = fakeD1();
    const kv = new CfKv(kvStub(), f.d1);
    const keys = Array.from({ length: 50 }, (_, i) => `capev:d:${i}`);
    expect((await kvClaimMany(kv, keys, 3700)).every(Boolean)).toBe(true);
    expect(f.batches()).toBe(1);
    expect((await kvClaimMany(kv, keys, 3700)).some(Boolean)).toBe(false);
  });

  it('cua so co dinh: het han thi dem lai tu dau; chua het han giu nguyen exp', async () => {
    const f = fakeD1();
    let now = 1_000;
    const c = new D1Counters(f.d1, () => now);
    expect(await c.incrBy('w', 1, 60)).toBe(1);
    now = 1_030;
    expect(await c.incrBy('w', 1, 60)).toBe(2);
    now = 1_061; // qua exp goc (1060), khong gia han theo lan tang
    expect(await c.incrBy('w', 1, 60)).toBe(1);
    expect(await c.purge()).toBe(0);
    now = 2_000;
    expect(await c.purge()).toBe(1);
  });

  it('manifest:epoch o lai tren KV (gateway doc bang get), del xoa ca bo dem', async () => {
    const kvs = kvStub();
    const kv = new CfKv(kvs, fakeD1().d1);
    await kv.incr(MANIFEST_EPOCH_KEY);
    expect(await kv.get(MANIFEST_EPOCH_KEY)).toBe('1');
    await kv.incr('media:lock:x', 900);
    await kv.del('media:lock:x');
    expect(await kv.incr('media:lock:x', 900)).toBe(1);
  });

  it('chua chay migration 0011: tu tao bang kv_counters roi thu lai', async () => {
    const f = fakeD1({ withTable: false });
    const kv = new CfKv(kvStub(), f.d1);
    expect(await kv.incr('x', 60)).toBe(1);
    expect(await kv.incr('x', 60)).toBe(2);
  });
});

describe('kvIncrMany tren MemoryKv (duong Docker/test khong doi)', () => {
  it('thu tu + by + dong thoi', async () => {
    const kv = new MemoryKv();
    expect(await kvIncrMany(kv, [{ k: 'a' }, { k: 'a', by: 3 }, { k: 'b', ttlSec: 5 }])).toEqual([1, 4, 1]);
    const r = await Promise.all(Array.from({ length: 100 }, () => kv.incr('z')));
    expect(new Set(r).size).toBe(100);
  });
  it('duong lui khi Kv khong co incrMany/incrBy', async () => {
    const m = new MemoryKv();
    const bare = { get: m.get.bind(m), set: m.set.bind(m), del: m.del.bind(m), incr: m.incr.bind(m) };
    expect(await kvIncrMany(bare, [{ k: 'a' }, { k: 'a', by: 2 }, { k: 'a', by: 0 }])).toEqual([1, 3, 3]);
  });
});
