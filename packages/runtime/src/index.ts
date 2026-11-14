// Diem vao nhe (khong keo pg/ioredis/aws vao Workers): cac factory nap bang import() dong.
// Cloudflare: import tu '@ams/runtime/cloudflare'.
export * from './types.js';
export * from './memory.js';
export * from './counters.js';
export * from './events.js';
export * from './sql.js';
export { SqlDb, Mutex } from './base-db.js';
export type { TestRuntime, TestRuntimeOptions } from './test.js';
export { TEST_ENV, TEST_FIELD_ENC_KEY } from './test.js';
import type { TestRuntime, TestRuntimeOptions } from './test.js';
import type { Runtime } from './types.js';

export async function createTestRuntime(opts?: TestRuntimeOptions): Promise<TestRuntime> {
  return (await import('./test.js')).createTestRuntime(opts);
}

export async function createDockerRuntime(env: Record<string, string | undefined>): Promise<Runtime> {
  return (await import('./docker.js')).createDockerRuntime(env);
}
export * from './outbox.js';
export * from './faults.js';
export * from './ops.js';
export { HttpMailer, createMailer, mailConfigFromEnv } from './mail-http.js';
export type { HttpMailConfig, MailProvider } from './mail-http.js';
