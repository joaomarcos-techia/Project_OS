import { readFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const APP_DIR = path.join(process.cwd(), 'dist/security-local/app');
const RUNTIME_ENV = path.join(process.cwd(), 'dist/security-local/runtime-env.json');
const PORT = 3220;
const baseURL = `http://localhost:${PORT}`;

function runtimeEnv(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(RUNTIME_ENV, 'utf8')) as Record<string, string>;
  } catch {
    throw new Error('Build isolado ausente. Rode `pnpm security:build` primeiro.');
  }
}

export default defineConfig({
  testDir: './security-e2e',
  testMatch: ['http-only-session.spec.ts'],
  workers: 1,
  reporter: 'list',
  use: { baseURL },
  webServer: {
    command: `node ${path.join(process.cwd(), 'node_modules/next/dist/bin/next')} start -p ${PORT} -H localhost`,
    cwd: APP_DIR,
    env: runtimeEnv(),
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
