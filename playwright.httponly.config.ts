import { readFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const APP_DIR = path.join(process.cwd(), 'dist/security-local/app');
const RUNTIME_ENV = path.join(process.cwd(), 'dist/security-local/runtime-env.json');
const APP_PORT = 3217;
const NEXT_PORT = 3218;
const baseURL = `https://localhost:${APP_PORT}`;

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
  use: { baseURL, ignoreHTTPSErrors: true },
  webServer: {
    command: `node ${path.join(process.cwd(), 'node_modules/next/dist/bin/next')} start -p ${NEXT_PORT} -H 127.0.0.1`,
    cwd: APP_DIR,
    // O spec põe um proxy TLS local na frente do Next. O build em modo produção
    // exige HTTPS para links e confirmação; HTTP localhost seria recusado com 503.
    env: { ...runtimeEnv(), APP_BASE_URL: baseURL },
    url: `http://127.0.0.1:${NEXT_PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
