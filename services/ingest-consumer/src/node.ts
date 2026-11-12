// Diem vao Node cho ingest-consumer (Docker): dang ky hang doi, mo /health tren cong PORT (8789).
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createConsumerForEnv } from './boot.js';
import type { IngestConsumer } from './consumer.js';

export async function startConsumer(env: Record<string, string | undefined> = process.env): Promise<{ consumer: IngestConsumer; port: number; close(): Promise<void> }> {
  const { consumer, rt } = await createConsumerForEnv(env);
  consumer.subscribe();
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'ingest-consumer', stats: consumer.stats }));
    } else {
      res.writeHead(404).end();
    }
  });
  const port = await new Promise<number>((resolve) => server.listen(Number(env['PORT'] ?? 8789), '0.0.0.0', () => resolve((server.address() as AddressInfo).port)));
  console.log(`[ingest-consumer] lang nghe ${port}`);
  return {
    consumer,
    port,
    async close() {
      server.close();
      await rt.close?.();
    },
  };
}
