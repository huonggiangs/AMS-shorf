import type { Db } from './types.js';
import { normalizeParams } from './sql.js';

export interface ExecResult {
  rows: Record<string, unknown>[];
  changes: number;
}

/**
 * Khung chung cho adapter: lop con chi can cai `exec` (da tu doi placeholder) va `begin/commit/rollback`.
 * Long nhau: SAVEPOINT.
 */
export abstract class SqlDb implements Db {
  abstract readonly dialect: 'postgres' | 'sqlite';
  protected depth = 0;
  protected abstract exec(sql: string, params: unknown[]): Promise<ExecResult>;
  abstract tx<T>(fn: (t: Db) => Promise<T>): Promise<T>;

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const r = await this.exec(sql, normalizeParams(params));
    return r.rows as T[];
  }
  async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
    const r = await this.exec(sql, normalizeParams(params));
    return { changes: r.changes };
  }
  async batch(stmts: { sql: string; params?: unknown[] }[]): Promise<{ changes: number }[]> {
    return this.tx(async (t) => {
      const out: { changes: number }[] = [];
      for (const s of stmts) out.push(await t.run(s.sql, s.params));
      return out;
    });
  }

  /** Giao dich long ben trong mot giao dich dang mo: dung SAVEPOINT. */
  protected async nested<T>(fn: (t: Db) => Promise<T>): Promise<T> {
    const name = `sp_${++this.depth}`;
    await this.exec(`SAVEPOINT ${name}`, []);
    try {
      const r = await fn(this);
      await this.exec(`RELEASE SAVEPOINT ${name}`, []);
      return r;
    } catch (e) {
      await this.exec(`ROLLBACK TO SAVEPOINT ${name}`, []);
      await this.exec(`RELEASE SAVEPOINT ${name}`, []);
      throw e;
    } finally {
      this.depth--;
    }
  }
}

/** Khoa tuan tu (mutex) cho ket noi don (SQLite, PGlite). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => undefined);
    return p;
  }
}
