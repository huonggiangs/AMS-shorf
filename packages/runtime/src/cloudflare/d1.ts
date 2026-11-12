import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { normalizeParams } from '../sql.js';
import type { Db } from '../types.js';

/**
 * D1 (SQLite). GIOI HAN QUAN TRONG: D1 khong co giao dich tuong tac.
 *  - `tx(fn)` chay tung cau lenh NGAY va KHONG hoan tac khi fn nem loi (interactiveTx = false).
 *  - Thao tac tien phai nguyen tu bang MOT cau lenh co dieu kien (UPDATE ... WHERE available >= ?) hoac `batch()`
 *    (D1 batch chay trong mot giao dich ngam; loi o bat ky cau nao se hoan tac ca lo).
 */
export class D1Db implements Db {
  readonly dialect = 'sqlite' as const;
  readonly interactiveTx = false;
  constructor(private d: D1Database) {}

  private prep(sql: string, params?: unknown[]): D1PreparedStatement {
    const st = this.d.prepare(sql);
    const p = normalizeParams(params);
    return p.length ? st.bind(...p) : st;
  }
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const r = await this.prep(sql, params).all<T>();
    return r.results ?? [];
  }
  async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
    const r = await this.prep(sql, params).run();
    return { changes: Number(r.meta?.changes ?? 0) };
  }
  async batch(stmts: { sql: string; params?: unknown[] }[]): Promise<{ changes: number }[]> {
    if (stmts.length === 0) return [];
    const rs = await this.d.batch(stmts.map((s) => this.prep(s.sql, s.params)));
    return rs.map((r) => ({ changes: Number(r.meta?.changes ?? 0) }));
  }
  async tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
