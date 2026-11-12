import type { PGlite, Transaction } from '@electric-sql/pglite';
import { SqlDb, type ExecResult } from './base-db.js';
import { toPgPlaceholders } from './sql.js';
import type { Db } from './types.js';

type Q = Pick<PGlite, 'query'> | Pick<Transaction, 'query'>;

export async function openPglite(dataDir?: string): Promise<PGlite> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  return new PGlite({
    ...(dataDir ? { dataDir } : {}),
    // int8 (BIGINT, COUNT) va numeric (SUM) -> number: tien VND nam trong khoang so nguyen an toan
    parsers: { [types.INT8]: (v: string) => Number(v), [types.NUMERIC]: (v: string) => Number(v) },
  });
}

class PgliteInner extends SqlDb {
  readonly dialect = 'postgres' as const;
  constructor(protected q: Q) {
    super();
  }
  protected async exec(sql: string, params: unknown[]): Promise<ExecResult> {
    const r = await (this.q as PGlite).query<Record<string, unknown>>(toPgPlaceholders(sql), params as unknown[]);
    return { rows: r.rows, changes: r.affectedRows ?? 0 };
  }
  async tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
    return this.nested(fn);
  }
}

export class PgliteDb extends PgliteInner {
  constructor(private pg: PGlite) {
    super(pg);
  }
  override async tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (t) => fn(new PgliteInner(t)));
  }
  async close(): Promise<void> {
    await this.pg.close();
  }
}
