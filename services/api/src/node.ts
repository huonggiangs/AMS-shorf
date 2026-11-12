import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { createDockerRuntime } from '@ams/runtime/docker';
import type { Runtime } from '@ams/runtime';
import { createApp } from './app.js';
import { mountFinanceRoutes } from './finance-mount.js';
import type { FinancePort } from './ports.js';

/**
 * Lap lich nen cho Docker (tren Cloudflare la cron cua Worker): moi 10 phut doi soat bu SePay + chien dich den/het han,
 * moi ngay 02:15 UTC job hang ngay. Khoa bang kv.incr de nhieu ban sao API khong chay trung.
 */
function startScheduler(rt: Runtime, port: () => FinancePort | undefined): () => void {
  const run = async (cron: string, lockKey: string, ttl: number) => {
    try {
      if ((await rt.kv.incr(lockKey, ttl)) !== 1) return;
      await port()?.scheduled?.(rt, cron);
    } catch (e) {
      console.error(`[api] job "${cron}" loi:`, (e as Error).message);
    }
  };
  const tick = () => {
    const now = rt.clock.now();
    void run('*/10 * * * *', `cron:10m:${Math.floor(now.getTime() / 600_000)}`, 900);
    if (now.getUTCHours() === 2 && now.getUTCMinutes() >= 15 && now.getUTCMinutes() < 25) void run('15 2 * * *', `cron:daily:${now.toISOString().slice(0, 10)}`, 86_400);
  };
  const t = setInterval(tick, 60_000);
  t.unref();
  return () => clearInterval(t);
}

/** Khoi dong tren Docker/PC: Postgres + Redis + MinIO + SMTP (xem createDockerRuntime). PORT=0 => cong ngau nhien (tra ve trong `port`). */
export async function startNode(env: Record<string, string | undefined> = process.env): Promise<{ close: () => Promise<void>; port: number; rt: Runtime }> {
  const rt = await createDockerRuntime(env);
  let finance: FinancePort | undefined;
  const app = createApp(rt, {
    mountFinance: (a, r) => {
      finance = mountFinanceRoutes(a, r);
      return finance;
    },
  });
  const wanted = Number(env['PORT'] ?? 8787);
  const { server, port } = await new Promise<{ server: ReturnType<typeof serve>; port: number }>((resolve) => {
    const s = serve({ fetch: app.fetch, port: wanted, hostname: '0.0.0.0' }, (info: AddressInfo) => resolve({ server: s, port: info.port }));
  });
  console.log(`[api] lang nghe cong ${port}`);
  const stopScheduler = env['API_SCHEDULER'] === '0' ? () => undefined : startScheduler(rt, () => finance);
  const close = async () => {
    stopScheduler();
    await new Promise<void>((r) => server.close(() => r()));
    await rt.close?.();
  };
  const stop = () => void close().finally(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return { close, port, rt };
}
