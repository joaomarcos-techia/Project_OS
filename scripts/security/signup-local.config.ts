import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      process.env.SIGNUP_LOCAL_MAIL === 'true'
        ? 'scripts/security/signup-mail.integration.ts'
        : process.env.SIGNUP_LOCAL_BROWSER === 'true'
          ? 'scripts/security/signup-browser.integration.ts'
          : 'scripts/security/signup-local.integration.ts',
    ],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.resolve('src'),
      'server-only': path.resolve('src/lib/test/server-only-stub.ts'),
    },
  },
});
