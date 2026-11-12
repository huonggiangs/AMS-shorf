// Tap con toi thieu cua Runtime/Db ma migrate() va seed() can (Runtime that gan duoc vao day theo kieu cau truc,
// tranh vong phu thuoc @ams/runtime <-> @ams/db).
export interface DbLike {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  tx<T>(fn: (t: DbLike) => Promise<T>): Promise<T>;
  dialect: 'postgres' | 'sqlite';
}

export interface SeedRuntime {
  db: DbLike;
  clock: { now(): Date };
  config: { env: Record<string, string | undefined> };
  id(): string;
}
