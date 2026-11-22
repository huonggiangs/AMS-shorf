import { safeErr } from '@ams/shared';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { createDockerRuntime } from '@ams/runtime/docker';
import type { Runtime } from '@ams/runtime';
import { createApp } from './app.js';
import { sweepAutoApprove } from './lib/auto-approve.js';
import { createMediaImporter } from './lib/media-import.js';
import { sweepMultipart, sweepStaleUploads } from './lib/transfers.js';
import { pruneOutboxAll, sweepOutbox } from './outbox.js';
import { mountFinanceRoutes } from './finance-mount.js';
import type { FinancePort } from './ports.js';
import { opsTick } from './ops/index.js';
import { streamRecheckTick } from './lib/video-link.js';
import { billingDailyTick, billingFrequentTick } from './billing/jobs.js';

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
      console.error(`[api] job "${cron}" loi:`, safeErr(e));
    }
  };
  const lockedOps = async (prune: boolean) => {
    try {
      if ((await rt.kv.incr(`cron:ops:${Math.floor(rt.clock.now().getTime() / 240_000)}`, 600)) !== 1) return;
      await opsTick(rt, { prune });
    } catch (e) {
      console.error('[api] job ops loi:', safeErr(e));
    }
  };
  // p4: thu lai hoa don dien tu moi 10 phut; nhac no/luu giu du lieu hang ngay (khoa kv chong chay trung giua cac ban sao)
  const lockedBilling = async (daily: boolean, lockKey: string, ttl: number) => {
    try {
      if ((await rt.kv.incr(lockKey, ttl)) !== 1) return;
      if (daily) await billingDailyTick(rt);
      else await billingFrequentTick(rt);
    } catch (e) {
      console.error('[api] job billing loi:', safeErr(e));
    }
  };
  // video dan link (v-link): kiem tra lai moi 10 phut (moi creative toi da 1 lan/gio); khoa kv chong chay trung
  const lockedStreams = async (lockKey: string) => {
    try {
      if ((await rt.kv.incr(lockKey, 900)) !== 1) return;
      await streamRecheckTick(rt);
    } catch (e) {
      console.error('[api] job stream loi:', (e as Error).message);
    }
  };
  const tick = () => {
    const now = rt.clock.now();
    if (now.getUTCMinutes() % 10 === 7) void lockedStreams(`cron:streams:${Math.floor(now.getTime() / 600_000)}`);
    if (now.getUTCMinutes() % 10 === 3) void lockedBilling(false, `cron:billing10:${Math.floor(now.getTime() / 600_000)}`, 900);
    if (now.getUTCHours() === 2 && now.getUTCMinutes() >= 20 && now.getUTCMinutes() < 30) void lockedBilling(true, `cron:billing-daily:${now.toISOString().slice(0, 10)}`, 86_400);
    // p3-ops: kiem tra canh bao moi 5 phut (khoa kv chong chay trung giua cac ban sao API); don dep hang ngay luc 03:30 UTC
    if (now.getUTCMinutes() % 5 === 0 && (now.getUTCHours() !== 3 || now.getUTCMinutes() !== 30)) void lockedOps(false);
    if (now.getUTCHours() === 3 && now.getUTCMinutes() === 30) void lockedOps(true);
    void run('*/10 * * * *', `cron:10m:${Math.floor(now.getTime() / 600_000)}`, 900);
    if (now.getUTCHours() === 2 && now.getUTCMinutes() >= 15 && now.getUTCMinutes() < 25) void run('15 2 * * *', `cron:daily:${now.toISOString().slice(0, 10)}`, 86_400);
  };
  const t = setInterval(tick, 60_000);
  t.unref();
  return () => clearInterval(t);
}

/**
 * Worker outbox (duyet -> giu tien -> manifest): thu lai viec dang do; an toan chay nhieu ban sao (chiem bang UPDATE co dieu kien).
 * Doc lap voi API_SCHEDULER (job tai chinh theo cron). Tat bang OUTBOX_WORKER=0; chu ky OUTBOX_INTERVAL_MS (mac dinh 5000).
 */
function startOutboxWorker(rt: Runtime, port: () => FinancePort | undefined, env: Record<string, string | undefined>): () => void {
  const every = Math.max(200, Number(env['OUTBOX_INTERVAL_MS'] ?? 5_000));
  const fin = async () => {
    const p = port();
    if (!p) throw new Error('finance chua san sang');
    return p;
  };
  let busy = false;
  let lastMedia = 0;
  const importer = createMediaImporter(rt, { finance: fin });
  importer.subscribe(); // chu de 'media.import' (nhap tu Drive/Dropbox)
  const o = setInterval(() => {
    if (busy) return;
    busy = true;
    sweepOutbox(rt, fin)
      .then(() => sweepAutoApprove(rt)) // media-worker VPS ghi scan_state sau confirm: tep noi bo co quyen duyet -> tu duyet
      .then(async () => {
        if (Date.now() - lastMedia < 60_000) return;
        lastMedia = Date.now();
        await importer.sweep(); // nhap tu lien ket bi ket -> dat lai viec
        await sweepMultipart(rt); // phien tai tung phan het han -> huy
        await sweepStaleUploads(rt); // tep ket 'uploading' qua 1 gio
      })
      .catch((e) => console.error('[api] outbox loi:', safeErr(e)))
      .finally(() => (busy = false));
  }, every);
  o.unref();
  const day = setInterval(() => void pruneOutboxAll(rt).catch(() => undefined), 3600_000);
  day.unref();
  return () => {
    clearInterval(o);
    clearInterval(day);
  };
}

/** Khoi dong tren Docker/PC: Postgres + Redis + kho tep (fs/S3) + SMTP (xem createDockerRuntime). PORT=0 => cong ngau nhien (tra ve trong `port`). */
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
  const stopOutbox = env['OUTBOX_WORKER'] === '0' ? () => undefined : startOutboxWorker(rt, () => finance, env);
  const close = async () => {
    stopScheduler();
    stopOutbox();
    await new Promise<void>((r) => server.close(() => r()));
    await rt.close?.();
  };
  const stop = () => void close().finally(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return { close, port, rt };
}
