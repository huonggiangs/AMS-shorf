import { createDockerRuntime, createTestRuntime, type Runtime } from '@ams/runtime';
import { createIngestConsumer, type IngestConsumer } from './consumer.js';
import { getSpendFn } from './spend-registry.js';

/**
 * Chi tieu: DOC chua duoc gan. @ams/payments (a2) phai cung cap SpendFn; khi chua co, consumer van ghi su kien va dem
 * `spendSkippedNoFn` (khong tru tien). Co the gan sau bang `setSpendFn` truoc khi subscribe.
 */
export { setSpendFn } from './spend-registry.js';

export async function createConsumerForEnv(env: Record<string, string | undefined>): Promise<{ consumer: IngestConsumer; rt: Runtime }> {
  const rt = env['RUNTIME'] === 'test' ? await createTestRuntime({ dialect: 'sqlite' }) : await createDockerRuntime(env);
  const injected = getSpendFn();
  const consumer = createIngestConsumer(rt, { ...(injected ? { spend: injected } : {}), log: (m) => console.log(m) });
  if (!injected) console.warn('[ingest-consumer] CANH BAO: chua gan SpendFn (payments) -> khong tru chi tieu chien dich');
  return { consumer, rt };
}
