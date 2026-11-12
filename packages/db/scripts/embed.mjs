// Dong goi migrations/*.sql thanh src/migrations.gen.ts de chay duoc ca tren Workers (khong co fs).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const items = files.map((f) => {
  const m = f.match(/^(\d{4}_[a-z0-9_]+?)(?:\.(postgres|sqlite))?\.sql$/);
  if (!m) throw new Error('ten migration khong hop le: ' + f);
  return { name: m[1], dialect: m[2] ?? 'all', sql: readFileSync(join(dir, f), 'utf8') };
});
const out =
  '// SINH TU DONG boi scripts/embed.mjs - KHONG SUA TAY. Chay: pnpm --filter @ams/db gen\n' +
  "export interface MigrationFile { name: string; dialect: 'all' | 'postgres' | 'sqlite'; sql: string }\n" +
  'export const MIGRATIONS: MigrationFile[] = ' + JSON.stringify(items, null, 2) + ';\n';
writeFileSync(join(root, 'src', 'migrations.gen.ts'), out);
console.log('da dong goi', items.length, 'migration');
