/**
 * P6.3 — telas das autorizações da operadora no Preview ligado ao DEV (PREPARADO, ainda NÃO
 * executado: o notebook não roda Chromium pesado e não há navegador remoto autorizado; a P6.3 só
 * fecha com esta execução).
 *
 *   - fila: o alerta "Senha vence amanhã" aparece ANTES do vencimento (P6.6, calculado na leitura);
 *   - registro: a gestora registra a resposta da operadora numa autorização de Consulta aguardando;
 *     sem evidência o formulário recusa; com o número da operadora, a autorização passa a
 *     "Autorizada" e a senha nunca volta à tela;
 *   - recepção sem `manage:financial`: vê a fila e o detalhe, mas não recebe o formulário (a recusa
 *     da action chamada direto é provada nos testes da action: `actions.test.ts`);
 *   - acessibilidade: axe-core (A/AA) na fila e no detalhe, sem exceção nova.
 *
 * Antes de executar (P1 do ciclo de 16/11): confirmar o SHA servido pelo Preview, que o runtime é o
 * DEV (`assertPreviewRuntimeIsDev`), Auth e banco DEV, Asaas Sandbox, dados sintéticos e nenhuma
 * credencial live. O spec não dispara cobrança nem pagamento.
 *
 * Fixture (só clínicas e2e-hi-*, dados sintéticos):
 *   npx tsx --conditions=react-server scripts/security/hi-dev-e2e-fixture.ts setup-authorizations \
 *     --expected-ref <ref DEV> --accounts <contas.json> --run <MARCA> --out <autorizacoes.json>
 *
 *   E2E_BASE_URL=<preview> E2E_HI_ACCOUNTS=<contas.json> E2E_HI_AUTHS=<autorizacoes.json> \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=… MAGIC_TOKEN_SECRET=… \
 *     npx playwright test e2e/convenios-authorizations-preview.spec.ts --project=chromium
 *
 * Logins: gestora (1) e recepção (1) da clínica paga. Não rode outro spec autenticado na mesma
 * janela (limite de 10 logins por IP em 15 min, dividido com a frente de UI).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const AUTHS = process.env.E2E_HI_AUTHS;

test.skip(!BASE || !ACCOUNTS || !AUTHS, 'requer E2E_BASE_URL (Preview no DEV), as contas e2e-hi e a fixture setup-authorizations');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 45_000 });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts = ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {};
const fx = AUTHS
  ? (JSON.parse(readFileSync(AUTHS, 'utf8')) as { run: string; waiting: string; expiring: string; tomorrow: string })
  : null;

/** axe-core sem pacote novo (mesma origem do spec de regressões): eslint-config-next → jsx-a11y → axe-core. */
function axeSource(): string {
  const req = createRequire(join(process.cwd(), 'package.json'));
  const a11y = createRequire(req.resolve('eslint-config-next'));
  const axeReq = createRequire(a11y.resolve('eslint-plugin-jsx-a11y'));
  return readFileSync(axeReq.resolve('axe-core/axe.min.js'), 'utf8');
}

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource());
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> };
    };
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
  });
}

async function login(browser: Browser, key: string) {
  const account = accounts[key];
  if (!account) throw new Error(`conta ${key} ausente na fixture`);
  const context = await browser.newContext({ baseURL: BASE!, extraHTTPHeaders: vercelBypassHeaders() });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.message} @ ${new URL(page.url()).pathname}`));
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  return { context, page, errors };
}

test.beforeAll(async () => {
  // Prova assinada do runtime: Preview no DEV e Asaas em Sandbox (pedido do ciclo de 16/11, P1 §10).
  await assertPreviewRuntimeIsDev(BASE!, { requireSandboxAsaas: true });
});

test('gestora: alerta antes do vencimento, registro da resposta com evidência e senha que não volta', async ({ browser }) => {
  const s = await login(browser, 'gestor');
  try {
    await s.page.goto('/convenios/autorizacoes');
    const [y, m, d] = fx!.tomorrow.split('-');
    await expect(s.page.getByRole('region', { name: 'Autorizações vencendo ou acabando' })).toContainText(`Senha vence amanhã (${d}/${m}/${y})`);
    expect(await axeViolations(s.page)).toEqual([]);

    await s.page.goto(`/convenios/autorizacoes/${fx!.waiting}`);
    await s.page.getByRole('button', { name: 'Registrar resposta da operadora' }).click();
    const form = s.page.getByRole('form', { name: 'Resposta da operadora' });
    await form.getByRole('button', { name: 'Confirmar' }).click();
    await expect(form.getByRole('alert')).toContainText('Sem evidência da operadora, não há autorização');
    await form.getByLabel('Número da guia na operadora').fill(`E2EW${fx!.run}`);
    await form.getByLabel('Senha').fill(`SENHA-${fx!.run}`);
    await form.getByRole('button', { name: 'Confirmar' }).click();
    const box = s.page.getByRole('region', { name: 'Situação da autorização' });
    await expect(box).toContainText('Autorizada');
    await expect(box).toContainText('registrada (guardada cifrada)');
    await expect(s.page.locator('body')).not.toContainText(`SENHA-${fx!.run}`);
    expect(await axeViolations(s.page)).toEqual([]);
    expect(s.errors).toEqual([]);
  } finally {
    await s.context.close();
  }
});

test('recepção: vê a fila e o detalhe, sem formulário de resposta', async ({ browser }) => {
  const s = await login(browser, 'recepcao');
  try {
    const r = await s.page.goto('/convenios/autorizacoes');
    expect(r?.status()).toBe(200);
    await s.page.goto(`/convenios/autorizacoes/${fx!.expiring}`);
    await expect(s.page.getByRole('region', { name: 'Situação da autorização' })).toBeVisible();
    await expect(s.page.getByRole('button', { name: 'Registrar resposta da operadora' })).toHaveCount(0);
    expect(s.errors).toEqual([]);
  } finally {
    await s.context.close();
  }
});
