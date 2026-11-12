import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDockerRuntime, createTestRuntime, type Runtime } from '@ams/runtime';
import { createMediaWorker, optionsFromEnv } from './worker.js';

export async function startMediaWorker(env: Record<string, string | undefined> = process.env) {
  const rt: Runtime = env['RUNTIME'] === 'test' ? await createTestRuntime({ dialect: 'sqlite' }) : await createDockerRuntime(env);
  const opts = optionsFromEnv(env);
  const worker = createMediaWorker(rt, { ...opts, log: (m) => console.log(m) });
  const haveFf = await opts.media!.available();
  console.log(`[media-worker] ffmpeg=${haveFf ? 'co' : 'khong'} clamd=${env['CLAMD_HOST'] ?? 'khong'} transcode=${opts.transcode}`);
  worker.subscribe();
  const timer = setInterval(() => void worker.sweep().catch((e) => console.error('[media-worker] sweep', e)), Number(env['MEDIA_SWEEP_S'] ?? 60) * 1000);
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'media-worker', ffmpeg: haveFf, stats: worker.stats }));
    } else res.writeHead(404).end();
  });
  const port = await new Promise<number>((r) => server.listen(Number(env['PORT'] ?? 8790), '0.0.0.0', () => r((server.address() as AddressInfo).port)));
  console.log(`[media-worker] lang nghe ${port}`);
  return { worker, port, async close() { clearInterval(timer); server.close(); await rt.close?.(); } };
}
