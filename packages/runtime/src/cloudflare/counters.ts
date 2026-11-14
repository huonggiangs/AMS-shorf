import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { KvIncrOp } from '../types.js';

/**
 * Bo dem NGUYEN TU tren D1 (bang `kv_counters`, migration 0011). Thay cho `KV.get + KV.put` (khong nguyen tu: R1-12).
 * Moi lan tang la MOT cau lenh `INSERT .. ON CONFLICT DO UPDATE .. RETURNING n`; D1 xu ly tuan tu tung cau lenh tren mot co so
 * du lieu nen hai loi goi dong thoi (hai isolate / hai colo) luon nhan hai gia tri khac nhau. Lo nhieu khoa chay bang `D1.batch`
 * (mot giao dich ngam, MOT vong mang) va tra ve gia tri sau tang theo thu tu.
 * Cua so co dinh: `exp` dat khi tao; het han (exp <= now) thi dem lai tu `by`. Khong co ttl => khong het han.
 * Chon D1 thay Durable Object: xem docs/DECISIONS-CF-COUNTERS.md.
 */
const FOREVER = 253402300799; // 9999-12-31, giay
export const COUNTERS_DDL = 'CREATE TABLE IF NOT EXISTS kv_counters (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)';
const UPSERT =
  'INSERT INTO kv_counters (k, n, exp) VALUES (?1, ?2, ?3) ON CONFLICT (k) DO UPDATE SET ' +
  'n = CASE WHEN kv_counters.exp <= ?4 THEN excluded.n ELSE kv_counters.n + excluded.n END, ' +
  'exp = CASE WHEN kv_counters.exp <= ?4 THEN excluded.exp ELSE kv_counters.exp END RETURNING n';

export class D1Counters {
  private ensured = false;
  constructor(private d: D1Database, private nowSec: () => number = () => Math.floor(Date.now() / 1000)) {}

  private stmt(o: KvIncrOp, now: number): D1PreparedStatement {
    const exp = o.ttlSec && o.ttlSec > 0 ? now + Math.ceil(o.ttlSec) : FOREVER;
    return this.d.prepare(UPSERT).bind(o.k, o.by ?? 1, exp, now);
  }

  async incrMany(ops: KvIncrOp[]): Promise<number[]> {
    if (ops.length === 0) return [];
    const run = async (): Promise<number[]> => {
      const now = this.nowSec();
      const rs = await this.d.batch<{ n: number }>(ops.map((o) => this.stmt(o, now)));
      return rs.map((r, i) => {
        const n = r.results?.[0]?.n;
        if (n === undefined) throw new Error(`kv_counters: khong co ket qua cho khoa ${ops[i]!.k}`);
        return Number(n);
      });
    };
    try {
      return await run();
    } catch (e) {
      // dich vu chua chay migration 0011: tu tao bang mot lan roi thu lai (idempotent). Loi khac: nem ra (rate limit/tran dong tien "dong" thay vi "mo").
      if (!this.ensured && /no such table/i.test(String((e as Error)?.message))) {
        await this.d.prepare(COUNTERS_DDL).run();
        this.ensured = true;
        return run();
      }
      throw e;
    }
  }

  async incrBy(k: string, by: number, ttlSec?: number): Promise<number> {
    return (await this.incrMany([{ k, by, ttlSec }]))[0]!;
  }

  async delK(k: string): Promise<void> {
    try {
      await this.d.prepare('DELETE FROM kv_counters WHERE k = ?').bind(k).run();
    } catch (e) {
      if (!/no such table/i.test(String((e as Error)?.message))) throw e;
    }
  }

  /** Don cac khoa het han (cron). Tra ve so dong xoa. */
  async purge(limit = 5000): Promise<number> {
    const r = await this.d.prepare('DELETE FROM kv_counters WHERE k IN (SELECT k FROM kv_counters WHERE exp <= ? LIMIT ?)').bind(this.nowSec(), limit).run();
    return Number(r.meta?.changes ?? 0);
  }
}
