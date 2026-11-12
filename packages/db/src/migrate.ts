import { MIGRATIONS, type MigrationFile } from './migrations.gen.js';
import { splitSql } from './sql.js';
import type { DbLike } from './types.js';

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export function migrationsFor(dialect: 'postgres' | 'sqlite'): MigrationFile[] {
  return MIGRATIONS.filter((m) => m.dialect === 'all' || m.dialect === dialect);
}

/**
 * Chay cac migration chua ap dung theo thu tu ten. Moi migration chay trong mot giao dich
 * (D1 khong co giao dich tuong tac: runtime Cloudflare tu xu ly tx; migration van idempotent nho bang _migrations).
 */
export async function migrate(db: DbLike): Promise<MigrateResult> {
  await db.run('CREATE TABLE IF NOT EXISTS _migrations (name TEXT NOT NULL PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name));
  const result: MigrateResult = { applied: [], skipped: [] };
  for (const m of migrationsFor(db.dialect)) {
    if (done.has(m.name)) {
      result.skipped.push(m.name);
      continue;
    }
    const stmts = splitSql(m.sql);
    await db.tx(async (t) => {
      for (const s of stmts) await t.run(s);
      await t.run('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)', [m.name, new Date().toISOString()]);
    });
    result.applied.push(m.name);
  }
  return result;
}
