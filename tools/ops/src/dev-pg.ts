// PostgreSQL 16 nhung (khong Docker) cho dien tap/thu nghiem tren may dev. Khong dung cho production.
import { createServer } from 'node:net';
import { rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface DevPg {
  url: (db?: string) => string;
  stop: () => Promise<void>;
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}
export async function startDevPg(): Promise<DevPg> {
  const EmbeddedPostgres = (await import('embedded-postgres')).default;
  const port = await freePort();
  // tu chay duoi root thi embedded-postgres chown thu muc cho nguoi dung `postgres`: KHONG tao thu muc cha 0700 truoc
  const dir = join(tmpdir(), `ams-ops-pg-${randomBytes(4).toString('hex')}`);
  const epg = new EmbeddedPostgres({ databaseDir: dir, user: 'ams', password: 'ams', port, persistent: false, onLog: () => undefined, onError: () => undefined });
  await epg.initialise();
  await epg.start();
  await epg.createDatabase('ams');
  return {
    url: (db = 'ams') => `postgres://ams:ams@127.0.0.1:${port}/${db}`,
    stop: async () => {
      await epg.stop().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
