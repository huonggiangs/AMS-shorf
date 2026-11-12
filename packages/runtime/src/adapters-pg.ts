import type { Pool, PoolClient, PoolConfig } from 'pg';
import { SqlDb, type ExecResult } from './base-db.js';
import { toPgPlaceholders } from './sql.js';
import type { Db } from './types.js';

/** Tao Pool pg: int8/numeric -> number (tien VND la so nguyen an toan). */
export async function createPgPool(connectionString: string, extra: PoolConfig = {}): Promise<Pool> {
  const pg = (await import('pg')).default;
  const base = pg.types;
  return new pg.Pool({
    connectionString,
    max: 10,
    ...extra,
    types: {
      getTypeParser: ((oid: number, format?: string) =>
        oid === 20 || oid === 1700 ? (v: string) => Number(v) : base.getTypeParser(oid, format as 'text')) as never,
    },
  });
}

class PgClientDb extends SqlDb {
  readonly dialect = 'postgres' as const;
  constructor(protected c: Pool | PoolClient) {
    super();
  }
  protected async exec(sql: string, params: unknown[]): Promise<ExecResult> {
    const r = await this.c.query(toPgPlaceholders(sql), params as unknown[]);
    return { rows: r.rows as Record<string, unknown>[], changes: r.rowCount ?? 0 };
  }
  async tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
    return this.nested(fn);
  }
}

export class PgDb extends PgClientDb {
  constructor(private pool: Pool) {
    super(pool);
  }
  override async tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(new PgClientDb(client));
      await client.query('COMMIT');
      return r;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ket noi hong: bo qua, loi goc quan trong hon */
      }
      throw e;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
