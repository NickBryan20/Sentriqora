import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      LOG_LEVEL: process.env.INTEGRATION_LOG_LEVEL ?? 'silent',
      NODE_ENV: 'test',
    },
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
