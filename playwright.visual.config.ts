import { config as loadDotenv } from 'dotenv';

// Playwright roda fora do Next, entao nao herda o .env.local automaticamente.
// Precisa ser o primeiro efeito colateral: as constantes abaixo leem process.env
// na avaliacao do modulo. Valores ja presentes no shell tem precedencia.
loadDotenv({ path: '.env.local' });

import { defineConfig, devices } from '@playwright/test';

import { vercelBypassHeaders } from './e2e/vercel-bypass';

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
    extraHTTPHeaders: vercelBypassHeaders(),
    ...(hasReusableAuth ? { storageState: '.playwright/.auth/user.json' } : {}),
    // 9 rotas por teste, cada uma podendo ser a primeira compilação de um
    // `next dev` ou um cold start serverless. O teto padrão de 30 s reprova por
    // lentidão de ambiente, não por regressão visual — que é o que se audita.
    navigationTimeout: 90_000,
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
