import type { Q } from './fingerprint.js';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';

/** Ket noi Postgres (pg Client) -> Q. Dong ket noi bang close(). */
export async function openPg(url: string): Promise<{ q: Q; client: import('pg').Client; close: () => Promise<void> }> {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return {
    client,
    q: { kind: 'postgres', all: async (sql) => (await client.query(sql)).rows as Record<string, unknown>[] },
    close: () => client.end(),
  };
}

export async function openSqliteQ(path: string): Promise<{ q: Q; db: import('node:sqlite').DatabaseSync; close: () => void }> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  return { db, q: { kind: 'sqlite', all: async (sql) => db.prepare(sql).all() as Record<string, unknown>[] }, close: () => db.close() };
}

/** Chay lenh va ghi stdout nhi phan thang vao tep (pg_dump qua `docker exec`). */
export function runToFile(cmd: string, args: string[], outPath: string, env: Record<string, string> = {}): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(outPath, { mode: 0o600 });
    let stderr = '';
    p.stdout.pipe(out);
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => reject(new Error(`khong chay duoc "${cmd}": ${e.message}`)));
    p.on('close', (code) => out.end(() => resolve({ code: code ?? 1, stderr })));
  });
}
