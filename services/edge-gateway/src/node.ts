// Diem vao Node (Docker/PC): cong PORT (mac dinh 8788). RUNTIME=test chay bo nho (pglite/sqlite) — de thu, khong ben vung.
import { serve } from '@hono/node-server';
import { createDockerRuntime, createTestRuntime, type Runtime } from '@ams/runtime';
import { createIngestConsumer } from '@ams/ingest-consumer';
import { spendFnFor } from '@ams/ingest-consumer/spend';
import { createGateway } from './gateway.js';
import { seedAdFixture } from './testing.js';

export async function startNode(env: Record<string, string | undefined> = process.env): Promise<{ close(): Promise<void>; port: number }> {
  const test = env['RUNTIME'] === 'test';
  const rt: Runtime = test ? await createTestRuntime({ dialect: 'sqlite', env: { GATEWAY_DEV_ENDPOINTS: '1', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000', HB_MIN_GAP_S: '0', ...env } }) : await createDockerRuntime(env);
  // RUNTIME=test: nap 3 chien dich mau de thu luong manifest/events (KHONG bao gio chay o docker/cloudflare)
  if (test && env['GATEWAY_DEMO_FIXTURE'] !== '0') await seedAdFixture(rt, { campaigns: 3, creativesPerCampaign: 2 });
  const gw = createGateway(rt);
  // Che do mot tien trinh: consumer chay cung (test, hoac INGEST_INLINE=1). Docker compose chay consumer rieng.
  if (test || env['INGEST_INLINE'] === '1') createIngestConsumer(rt, { spend: spendFnFor(rt) }).subscribe();
  const timer = setInterval(() => void gw.flush().catch((e) => console.error('[gateway] flush loi', e)), Number(env['TELEMETRY_FLUSH_MS'] ?? 10_000));
  timer.unref();
  const port = Number(env['PORT'] ?? 8788);
  const server = serve({ fetch: gw.app.fetch, port, hostname: '0.0.0.0' });
  console.log(`[edge-gateway] lang nghe ${port} (runtime=${rt.config.runtime})`);
  return {
    port,
    async close() {
      clearInterval(timer);
      server.close();
      await gw.flush().catch(() => undefined);
      await rt.close?.();
    },
  };
}
