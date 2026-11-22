import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
// api.test.ts gieo du lieu demo (seed bo qua neu da co tenant) nen phai chay dau tien: sap theo ten tep.
class ByName extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}
// Chay tren workerd that (Miniflare) -> mot Miniflare dung chung cho moi tep test (singleFork) de khoi dong 1 lan.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    globalSetup: ['./src/global-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { sequencer: ByName },
  },
});
