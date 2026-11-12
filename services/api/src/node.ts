import { serve } from '@hono/node-server';
import { createDockerRuntime } from '@ams/runtime/docker';
import { createApp } from './app.js';
import { mountFinanceRoutes } from './finance-mount.js';

/** Khoi dong tren Docker/PC: Postgres + Redis + MinIO + SMTP (xem createDockerRuntime). */
export async function startNode(env: Record<string, string | undefined> = process.env): Promise<{ close: () => Promise<void> }> {
  const rt = await createDockerRuntime(env);
  const app = createApp(rt, { mountFinance: mountFinanceRoutes });
  const port = Number(env['PORT'] ?? 8787);
  const server = serve({ fetch: app.fetch, port });
  console.log(`[api] lang nghe cong ${port}`);
  const close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await rt.close?.();
  };
  const stop = () => void close().finally(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return { close };
}
