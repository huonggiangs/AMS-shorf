import { createCloudflareRuntime } from '@ams/runtime/cloudflare';
import type { CloudflareEnv, CloudflareRuntime } from '@ams/runtime/cloudflare';
import { createApp } from './app.js';
import { mountFinanceRoutes } from './finance-mount.js';
import { pruneOutbox } from '@ams/runtime';
import { sweepOutbox } from './outbox.js';
import type { FinancePort } from './ports.js';

// Kieu toi thieu cua Workers (tranh keo @cloudflare/workers-types vao goi api).
interface ScheduledEvent { cron: string }
interface ExecCtx { waitUntil(p: Promise<unknown>): void }
type WorkerEnv = Record<string, unknown>;

interface Ready {
  rt: CloudflareRuntime;
  app: ReturnType<typeof createApp>;
  finance: () => Promise<FinancePort>;
}
let cached: Ready | null = null;

function build(env: WorkerEnv): Ready {
  // Ten binding trong wrangler.toml -> ten ma runtime mong doi
  const cf = { ...env, DB: env['DB_CORE'], BUCKET: env['MEDIA'], QUEUE: env['JOBS_QUEUE'] } as unknown as CloudflareEnv;
  const rt = createCloudflareRuntime(cf);
  let port: FinancePort | null = null;
  const app = createApp(rt, { mountFinance: (a, r) => (port = mountFinanceRoutes(a, r)) });
  return { rt, app, finance: async () => port as FinancePort };
}
const ready = (env: WorkerEnv): Ready => (cached ??= build(env));

export default {
  async fetch(req: Request, env: WorkerEnv, ctx: ExecCtx): Promise<Response> {
    void ctx;
    const url = new URL(req.url);
    // Worker nhan URL co tien to /api (route ams.anio.vn/api/*): bo di truoc khi vao Hono.
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      url.pathname = url.pathname.slice(4) || '/';
      req = new Request(url, req);
    }
    return ready(env).app.fetch(req, env);
  },
  async scheduled(event: ScheduledEvent, env: WorkerEnv, ctx: ExecCtx): Promise<void> {
    const r = ready(env);
    // outbox: moi lan cron (thu lai viec dang do; duong chinh la xu ly ngay sau commit trong request). Mot Queue consumer co the goi sweepOutbox y het.
    ctx.waitUntil(sweepOutbox(r.rt, r.finance).catch((e) => console.error('[api] outbox loi:', (e as Error).message)));
    if (event.cron === '* * * * *') return; // cron moi phut chi de outbox
    if (!event.cron.startsWith('*/')) ctx.waitUntil(pruneOutbox(r.rt.db, r.rt).then(() => undefined, () => undefined));
    const fin = await r.finance();
    if (fin.scheduled) ctx.waitUntil(fin.scheduled(r.rt, event.cron));
  },
  async queue(batch: unknown, env: WorkerEnv): Promise<void> {
    const r = ready(env);
    await (r.rt.queue as unknown as { handleBatch(b: unknown): Promise<void> }).handleBatch(batch);
  },
};
