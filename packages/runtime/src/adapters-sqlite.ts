import type { DatabaseSync } from 'node:sqlite';
import { Mutex, SqlDb, type ExecResult } from './base-db.js';
import type { Db } from './types.js';

/** Mo node:sqlite (Node >= 22.5). Dung de test va lam proxy cho D1. */
export function openSqlite(path = ':memory:'): DatabaseSync {
  const mod = (process as unknown as { getBuiltinModule(n: string): typeof import('node:sqlite') }).getBuiltinModule('node:sqlite');
  const db = new mod.DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

class SqliteInner extends SqlDb {
  readonly dialect = 'sqlite' as const;
  constructor(protected d: DatabaseSync) {
    super();
  }
  protected async exec(sql: string, params: unknown[]): Promise<ExecResult> {
    const st = this.d.prepare(sql);
    // statement tra ve cot -> doc; con lai -> run
    if (st.columns().length > 0) {
      const rows = (st.all(...(params as never[])) as Record<string, unknown>[]).map((r) => ({ ...r }));
      return { rows, changes: 0 };
    }
    const r = st.run(...(params as never[]));
    return { rows: [], changes: Number(r.changes) };
  }
  async tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
    return this.nested(fn);
  }
}

export class SqliteDb extends SqliteInner {
  private mu = new Mutex();
  protected override async exec(sql: string, params: unknown[]): Promise<ExecResult> {
    return this.mu.run(() => super.exec(sql, params));
  }
  override async tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
    return this.mu.run(async () => {
      this.d.exec('BEGIN IMMEDIATE');
      const inner = new SqliteInner(this.d);
      try {
        const r = await fn(inner);
        this.d.exec('COMMIT');
        return r;
      } catch (e) {
        this.d.exec('ROLLBACK');
        throw e;
      }
    });
  }
  close(): void {
    this.d.close();
  }
}
