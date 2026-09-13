import { readFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * E2E que roda em CI, sem segredo nenhum.
 *
 * ===================================================================
 * O buraco que esta config fecha
 * ===================================================================
 * A suíte principal tem 51 specs e ~20.000 linhas, e **nenhuma delas roda
 * automaticamente**: 40 exigem variável de autorização própria, credenciais de
 * clínica sintética e conexão ao Postgres de PRODUÇÃO. São uma ferramenta de
 * auditoria operada por gente — boa no que faz, e incapaz de impedir uma
 * regressão antes do merge.
 *
 * Esta config roda a fatia que não precisa de conta: fronteira sem sessão,
 * cabeçalhos de segurança e integridade estrutural do formulário de login. É
 * pouco perto do resto, e é o pouco que roda a cada PR.
 *
 * ===================================================================
 * Contra QUAL aplicação
 * ===================================================================
 * Contra o build isolado que `pnpm security:build` já produz em
 * `dist/security-local/app`, com o `runtime-env.json` de fixtures públicas que
 * ele mesmo escreve. Reusar esse build é deliberado: é o artefato mais próximo
 * do que vai para produção que o CI tem, e evita um segundo `next build` de
 * dez minutos.
 *
 * Nenhuma rota exercitada aqui toca o banco — o `DATABASE_URL` das fixtures não
 * aponta para lugar nenhum, e isso não é um problema porque `/login` é client
 * component e o middleware não faz rede.
 */

const APP_DIR = path.join(process.cwd(), 'dist/security-local/app');
const RUNTIME_ENV = path.join(process.cwd(), 'dist/security-local/runtime-env.json');
const PORT = 3218;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Ambiente do build isolado. Falhar aqui com mensagem clara é melhor que o
 * Playwright subir um servidor com `process.env` do CI e testar outra coisa
 * sem ninguém perceber.
 */
function runtimeEnv(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(RUNTIME_ENV, 'utf8')) as Record<string, string>;
  } catch {
    throw new Error(
      `Ambiente do build isolado ausente em ${RUNTIME_ENV}. Rode \`pnpm security:build\` antes.`,
    );
  }
}

export default defineConfig({
  testDir: './e2e',
  // Só o que dispensa credencial. Acrescentar um spec aqui é uma decisão
  // explícita: ele passa a poder quebrar o merge de todo mundo.
  testMatch: ['public-surface.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: `node ${path.join(process.cwd(), 'node_modules/next/dist/bin/next')} start -p ${PORT} -H 127.0.0.1`,
    cwd: APP_DIR,
    env: runtimeEnv(),
    url: `${baseURL}/login`,
    // `false` sempre: reaproveitar um servidor pendurado de outra execução
    // testaria um build velho e daria verde por engano.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
