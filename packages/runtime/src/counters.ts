import type { Kv, KvIncrOp } from './types.js';

/**
 * Tang nhieu khoa trong MOT vong (lo). Adapter co `incrMany` (Memory, Redis pipeline, Cloudflare D1 batch) di thang;
 * con lai tra ve duong tuan tu tren `incr`. Ket qua theo thu tu `ops`. Thu tu ap dung trong lo = thu tu mang, nen cung mot khoa
 * xuat hien nhieu lan nhan lan luot cac gia tri tang dan.
 */
export async function kvIncrMany(kv: Kv, ops: KvIncrOp[]): Promise<number[]> {
  if (ops.length === 0) return [];
  if (kv.incrMany) return kv.incrMany(ops);
  const out: number[] = [];
  for (const o of ops) {
    const by = o.by ?? 1;
    if (by === 0) out.push(Number((await kv.get(o.k)) ?? 0));
    else if (by === 1) out.push(await kv.incr(o.k, o.ttlSec));
    else if (kv.incrBy) out.push(await kv.incrBy(o.k, by, o.ttlSec));
    else {
      let n = 0;
      for (let i = 0; i < by; i++) n = await kv.incr(o.k, o.ttlSec);
      out.push(n);
    }
  }
  return out;
}

/** Tang mot khoa them `by` (mac dinh 1), nguyen tu neu adapter ho tro. */
export async function kvIncrBy(kv: Kv, k: string, by: number, ttlSec?: number): Promise<number> {
  return (await kvIncrMany(kv, [{ k, by, ttlSec }]))[0]!;
}

/** Chiem nhieu khoa (idempotency): tra ve mang bool, true = lan dau (gia tri sau tang = 1). */
export async function kvClaimMany(kv: Kv, keys: string[], ttlSec: number): Promise<boolean[]> {
  const ns = await kvIncrMany(kv, keys.map((k) => ({ k, ttlSec })));
  return ns.map((n) => n === 1);
}
