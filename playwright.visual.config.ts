import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const hasReusableAuth =
  process.env.E2E_AUTH_REUSE === '1' &&
  Boolean(process.env.E2E_BASE_URL && process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);

const viewports = [
  { name: 'mobile-390x844', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'tablet-768x1024', viewport: { width: 768, height: 1024 }, touch: true },
  { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 }, touch: false },
  { name: 'ultrawide-2560x1440', viewport: { width: 2560, height: 1440 }, touch: false },
] as const;

/**
 * Auditoria visual isolada: não multiplica os specs de mutação/produção do
 * playwright.config.ts e nunca grava trace ou vídeo autenticado.
 */
export default defineConfig({
  testDir: './e2e/visual',
  testMatch: 'ui-critical-routes.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // VISUAL_WAVE separa as capturas por wave, para comparar antes/depois sem
  // que a run seguinte sobrescreva a anterior.
  outputDir: process.env.VISUAL_WAVE
    ? `.playwright/visual/${process.env.VISUAL_WAVE}`
    : '.playwright/ui-visual-results',
  ...(hasReusableAuth ? { globalSetup: './e2e/auth-global-setup.ts' } : {}),
  use: {
    baseURL,
    ...(hasReusableAuth ? { storageState: '.playwright/.auth/user.json' } : {}),
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: viewports.map(({ name, viewport, touch }) => ({
    name,
    use: {
      ...devices['Desktop Chrome'],
      viewport,
      hasTouch: touch,
      isMobile: touch,
    },
  })),
});
