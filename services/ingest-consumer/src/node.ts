// Diem vao Node cho ingest-consumer (Docker): dang ky hang doi, mo /health tren cong PORT (8789).
import { createServer } from 'node:http';
import { createConsumerForEnv } from './boot.js';

const port = Number(process.env['PORT'] ?? 8789);
const { consumer, rt } = await createConsumerForEnv(process.env);
consumer.subscribe();
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'ingest-consumer', stats: consumer.stats }));
  } else {
    res.writeHead(404).end();
  }
});
server.listen(port, '0.0.0.0', () => console.log(`[ingest-consumer] lang nghe ${port}`));
const stop = async () => {
  server.close();
  await rt.close?.();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
