import { createDockerRuntime, createTestRuntime, type Runtime } from '@ams/runtime';
import { createIngestConsumer, type IngestConsumer } from './consumer.js';
import { spendFnFor } from './spend-registry.js';

/**
 * Chi tieu: mac dinh dung SpendFn that cua @ams/payments (createSpendFn); co the thay bang `setSpendFn` truoc khi subscribe.
 */
export { setSpendFn } from './spend-registry.js';

export async function createConsumerForEnv(env: Record<string, string | undefined>): Promise<{ consumer: IngestConsumer; rt: Runtime }> {
  const rt = env['RUNTIME'] === 'test' ? await createTestRuntime({ dialect: 'sqlite' }) : await createDockerRuntime(env);
  const consumer = createIngestConsumer(rt, { spend: spendFnFor(rt), log: (m) => console.log(m) });
  return { consumer, rt };
}
