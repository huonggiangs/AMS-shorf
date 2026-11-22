// Cau hinh wrangler (moi truong production, ID gia): ten binding, consumer hang doi, cron, route gw-ams.anio.vn, co tuong thich.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';
import { ROOT } from '../src/global-setup.js';

const load = (w: string) => unstable_getMiniflareWorkerOptions(join(ROOT, `infra/cloudflare/${w}/wrangler.generated.toml`), 'production').workerOptions as any;
const raw = (w: string) => readFileSync(join(ROOT, `infra/cloudflare/${w}/wrangler.generated.toml`), 'utf8');

describe('wrangler production', () => {
  it('edge-gateway: binding, consumer ams-ingest, DO PresenceShard, domain gw-ams.anio.vn (moi duong /v1/*), cron', () => {
    const o = load('edge-gateway');
    expect(o.compatibilityFlags).toContain('nodejs_compat');
    expect(o.compatibilityDate >= '2025-09-01').toBe(true);
    expect(Object.keys(o.d1Databases)).toEqual(expect.arrayContaining(['DB_CORE']));
    expect(Object.keys(o.kvNamespaces)).toEqual(['KV']);
    expect(Object.keys(o.r2Buckets)).toEqual(['MEDIA']);
    expect(o.queueProducers.INGEST_QUEUE.queueName).toBe('ams-ingest-production');
    expect(o.queueConsumers['ams-ingest-production']).toMatchObject({ maxBatchSize: 100, maxRetries: 5, deadLetterQueue: 'ams-ingest-dlq-production' });
    expect(o.durableObjects.PRESENCE).toMatchObject({ className: 'PresenceShard', useSQLite: true });
    expect(o.zone).toBe('gw-ams.anio.vn');
    const t = raw('edge-gateway');
    expect(t).toMatch(/pattern = "gw-ams\.anio\.vn"[^\n]*custom_domain = true/); // ca ten mien => gom /v1/viewer/*, /v1/wallet, /v1/withdraw...
    expect(t).toMatch(/crons = \["\* \* \* \* \*"\]/);
    expect(o.bindings.ENVIRONMENT).toBe('production');
  });
  it('api: binding DB_CORE/KV/MEDIA/JOBS_QUEUE, consumer ams-jobs, route ams.anio.vn/api/*, 3 cron', () => {
    const o = load('api');
    for (const k of ['DB_CORE', 'DB_FINANCE', 'DB_AUDIT']) expect(o.d1Databases).toHaveProperty(k);
    expect(Object.keys(o.r2Buckets).sort()).toEqual(['AUDIT_ARCHIVE', 'MEDIA', 'REPORTS']);
    expect(o.queueProducers.JOBS_QUEUE.queueName).toBe('ams-jobs-production');
    expect(o.queueConsumers['ams-jobs-production']).toMatchObject({ deadLetterQueue: 'ams-jobs-dlq-production' });
    expect(o.bindings.R2_BUCKET_NAME).toBe('ams-media-production');
    expect(o.durableObjects.PRESENCE).toMatchObject({ className: 'PresenceShard', scriptName: 'ams-edge-gateway-production' });
    const t = raw('api');
    expect(t).toContain('ams.anio.vn/api/*');
    expect(t).toMatch(/crons = \["\* \* \* \* \*", "\*\/10 \* \* \* \*", "15 2 \* \* \*"\]/);
  });
});
