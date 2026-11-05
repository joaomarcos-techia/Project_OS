import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error('Informe o Preview em E2E_BASE_URL.');
const target = new URL(baseURL);
const host = target.hostname;
if (target.username || target.password) throw new Error('O endereço não pode conter credenciais.');
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(host) &&
  (target.protocol !== 'https:' || !host.endsWith('.vercel.app'))
) {
  throw new Error('A validação autenticada da ajuda aceita somente Preview ou localhost.');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'documentation-usage.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: { baseURL, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
