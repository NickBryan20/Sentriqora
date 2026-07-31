import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    },
    environment: 'node',
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
});
