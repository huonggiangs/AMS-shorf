// pnpm --filter @ams/api migrate : ap dung migration len Postgres (DATABASE_URL). Idempotent, thoat 0 khi xong.
import { migrate } from '@ams/db';
import { PgDb, createPgPool } from '@ams/runtime/pg';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('thieu DATABASE_URL');
  process.exit(1);
}
const db = new PgDb(await createPgPool(url));
try {
  const r = await migrate(db);
  console.log(`[migrate] da ap dung: ${r.applied.join(', ') || '(khong co)'}; bo qua: ${r.skipped.length}`);
} finally {
  await db.close();
}
