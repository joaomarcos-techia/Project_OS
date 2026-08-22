import { defineConfig, devices } from '@playwright/test';

import { vercelBypassHeaders } from './e2e/vercel-bypass';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const mutationE2E = process.env.E2E_MUTATION === '1';
const retainAllArtifacts = process.env.E2E_ARTIFACTS === '1';
const reuseAuthenticatedState = process.env.E2E_AUTH_REUSE === '1';

if (mutationE2E) {
  const hostname = new URL(baseURL).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error('E2E_MUTATION=1 só pode executar contra localhost.');
  }
  if (!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD) {
    throw new Error('E2E_MUTATION=1 exige E2E_USER_EMAIL e E2E_USER_PASSWORD.');
  }
}

if (reuseAuthenticatedState) {
  if (!process.env.E2E_BASE_URL) {
    throw new Error('E2E_AUTH_REUSE=1 requires E2E_BASE_URL.');
  }
  if (!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD) {
    throw new Error('E2E_AUTH_REUSE=1 requires E2E_USER_EMAIL and E2E_USER_PASSWORD.');
  }
}

/**
 * E2E de navegação e ações de UI.
 *
 * - Sem `E2E_BASE_URL`, sobe a aplicação local para desenvolvimento.
 * - Com `E2E_BASE_URL`, testa um Preview dedicado, sem iniciar outro servidor.
 * - Os cenários autenticados exigem um usuário descartável nas variáveis
 *   `E2E_USER_EMAIL` e `E2E_USER_PASSWORD`; nunca use uma conta real.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Os cenários autenticados compartilham uma conta de desenvolvimento; em
  // paralelo eles acionam o rate-limit de login e tornam a suíte flakey.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  ...(mutationE2E
    ? { globalSetup: './e2e/mutation-global-setup.ts' }
    : reuseAuthenticatedState
      ? { globalSetup: './e2e/auth-global-setup.ts' }
      : {}),
  use: {
    baseURL,
    extraHTTPHeaders: vercelBypassHeaders(),
    ...(reuseAuthenticatedState ? { storageState: '.playwright/.auth/user.json' } : {}),
    trace: retainAllArtifacts ? 'on' : 'retain-on-failure',
    screenshot: retainAllArtifacts ? 'on' : 'only-on-failure',
    video: retainAllArtifacts ? 'on' : 'retain-on-failure',
  },
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'node node_modules/next/dist/bin/next dev',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
