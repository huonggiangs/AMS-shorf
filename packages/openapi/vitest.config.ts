import { defineConfig } from 'vitest/config';
// Tai len mot lan (buildAll duoc memo) va cho worker them heap: may tai nang truoc day bi OOM (Killed 137).
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true, execArgv: ['--max-old-space-size=3072'] } },
  },
});
