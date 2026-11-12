import { startNode } from './node.js';

export { createApp } from './app.js';
export type { AppOptions } from './app.js';
export type { FinancePort, MountFinance } from './ports.js';

// Chay truc tiep (tsx/node): `pnpm --filter @ams/api dev`. Import tu module khac thi khong tu khoi dong.
const entry = process.argv[1] ?? '';
// Docker: image chay `node index.mjs` (tep da bundle), nen khop them index.mjs; Dockerfile con dat AMS_API_START=1.
if (/[\\/]services[\\/]api[\\/](src[\\/]index\.ts|dist[\\/]index\.js)$/.test(entry) || /(^|[\\/])index\.mjs$/.test(entry) || process.env['AMS_API_START'] === '1') {
  startNode().catch((e) => {
    console.error('[api] khoi dong that bai:', (e as Error).message);
    process.exit(1);
  });
}
