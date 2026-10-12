import { defineConfig } from '@playwright/test'

/** E2E against the BUILT Electron app (run `node scripts/build.mjs` first). One worker: specs share the GPU and the AI sidecar. */
export default defineConfig({
  testDir: './e2e/specs',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  outputDir: 'test-results/artifacts',
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
})
