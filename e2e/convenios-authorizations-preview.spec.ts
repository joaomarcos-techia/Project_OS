/**
 * P6.3 — telas das autorizações da operadora no Preview ligado ao DEV, executado no navegador
 * remoto (convenios-preview-e2e.yml) desde 17/11.
 *
 *   - fila: o alerta "Senha vence amanhã" aparece ANTES do vencimento (P6.6, calculado na leitura);
 *   - registro: a gestora registra a resposta da operadora numa autorização de Consulta aguardando;
 *     sem evidência o formulário recusa; com o número da operadora, a autorização passa a
 *     "Autorizada" e a senha nunca volta à tela;
 *   - recepção (`operate:convenios`, matriz I.2 aprovada em 16/11): vê a fila e o detalhe e RECEBE o
 *     formulário na Consulta aguardando (roda ANTES da gestora, que registra a resposta); sem valores
 *     de faturamento na tela. A recusa a quem não opera é provada em `actions.test.ts`;
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
import { createHash, randomUUID } from 'node:crypto';
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

test('recepção (operate:convenios): vê a fila e o detalhe e recebe o formulário na Consulta aguardando', async ({ browser }) => {
  const s = await login(browser, 'recepcao');
  try {
    const r = await s.page.goto('/convenios/autorizacoes');
    expect(r?.status()).toBe(200);
    await expect(s.page.getByText('Sem acesso')).toHaveCount(0);
    await s.page.goto(`/convenios/autorizacoes/${fx!.waiting}`);
    await expect(s.page.getByRole('region', { name: 'Situação da autorização' })).toBeVisible();
    await expect(s.page.getByRole('button', { name: 'Registrar resposta da operadora' })).toHaveCount(1);
    expect(s.errors).toEqual([]);
  } finally {
    await s.context.close();
  }
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
    await form.getByLabel('Senha', { exact: true }).fill(`SENHA-${fx!.run}`);
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

// ── Comprovantes (P6.3): envio em partes até 10 MB, download auditado e integridade ─────────────

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** PDF sintético de `size` bytes (cabeçalho real, conteúdo determinístico pela marca da execução). */
function syntheticPdf(size: number, salt: string): Buffer {
  const b = Buffer.alloc(size);
  const head = Buffer.from(`%PDF-1.4\n% comprovante sintetico ${fx!.run} ${salt}\n`);
  head.copy(b);
  for (let i = head.length; i < size; i++) b[i] = (i * 31 + salt.length * 7) % 251;
  return b;
}
const receiptsRegion = (page: Page) => page.getByRole('region', { name: 'Comprovantes da autorização' });
const receiptLinks = (page: Page) => receiptsRegion(page).getByRole('link', { name: 'Baixar (leitura registrada)' });
const uploadForm = (page: Page) => page.getByRole('form', { name: 'Anexar comprovante da operadora' });

async function attach(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await uploadForm(page).locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
  await uploadForm(page).getByRole('button', { name: 'Anexar comprovante' }).click();
}

/** Baixa todos os comprovantes da tela e devolve o que tem o SHA-256 pedido. */
async function downloadBySha(page: Page, wanted: string) {
  const hrefs = await receiptLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  for (const href of hrefs) {
    const r = await page.context().request.get(href, { failOnStatusCode: false });
    if (r.status() === 200 && r.headers()['x-content-sha256'] === wanted) {
      return { href, status: r.status(), type: r.headers()['content-type'] ?? '', cache: r.headers()['cache-control'] ?? '', body: await r.body() };
    }
  }
  return null;
}

test('gestora: anexa comprovante pequeno e de 10 MB (em partes), baixa e confere a integridade; excesso e tipo falso são recusados', async ({ browser }) => {
  test.setTimeout(600_000);
  const s = await login(browser, 'gestor');
  try {
    await s.page.goto(`/convenios/autorizacoes/${fx!.expiring}`);
    await expect(uploadForm(s.page)).toBeVisible();
    const before = await receiptLinks(s.page).count();

    // 1) Arquivo pequeno (uma parte).
    const small = syntheticPdf(4_096, 'pequeno');
    await attach(s.page, 'comprovante-pequeno.pdf', 'application/pdf', small);
    await expect(uploadForm(s.page).getByText('Comprovante anexado e conferido.')).toBeVisible({ timeout: 90_000 });
    await expect(receiptLinks(s.page)).toHaveCount(before + 1, { timeout: 30_000 });
    const gotSmall = await downloadBySha(s.page, sha256(small));
    expect(gotSmall, 'comprovante pequeno baixado com o mesmo SHA-256').not.toBeNull();
    expect(gotSmall!.type).toBe('application/pdf');
    expect(gotSmall!.cache).toContain('no-store');
    expect(sha256(gotSmall!.body)).toBe(sha256(small));

    // 2) Exatamente 10 MB (4 partes de 3 MiB): chega inteiro e idêntico.
    const big = syntheticPdf(10 * 1024 * 1024, 'limite');
    await attach(s.page, 'comprovante-10mb.pdf', 'application/pdf', big);
    await expect(uploadForm(s.page).getByText('Comprovante anexado e conferido.')).toBeVisible({ timeout: 300_000 });
    await expect(receiptLinks(s.page)).toHaveCount(before + 2, { timeout: 30_000 });
    const gotBig = await downloadBySha(s.page, sha256(big));
    expect(gotBig, 'comprovante de 10 MB baixado com o mesmo SHA-256').not.toBeNull();
    expect(gotBig!.body.length).toBe(big.length);
    expect(sha256(gotBig!.body)).toBe(sha256(big));

    // 3) O mesmo arquivo de novo (já registrado): o servidor confirma pelo SHA-256 e não cria outro.
    //    Página recarregada antes de cada passo: a mensagem do passo anterior não conta como resposta
    //    (depois do envio o formulário limpa o arquivo e o botão fica desabilitado por desenho).
    await s.page.reload();
    await attach(s.page, 'comprovante-pequeno.pdf', 'application/pdf', small);
    await expect(uploadForm(s.page).getByText('Comprovante anexado e conferido.')).toBeVisible({ timeout: 90_000 });
    await s.page.reload();
    await expect(receiptLinks(s.page)).toHaveCount(before + 2);

    // 4) Acima do limite: recusado antes de enviar, com a mensagem do limite.
    await s.page.reload();
    await attach(s.page, 'comprovante-grande.pdf', 'application/pdf', syntheticPdf(10 * 1024 * 1024 + 1, 'excesso'));
    await expect(uploadForm(s.page).getByRole('alert')).toContainText('passa de 10 MB');

    // 5) Tipo falso (declarado PDF, conteúdo executável): o servidor confere pelo conteúdo e recusa.
    const fake = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), syntheticPdf(2_048, 'falso').subarray(64)]);
    await s.page.reload();
    await attach(s.page, 'comprovante-falso.pdf', 'application/pdf', fake);
    await expect(uploadForm(s.page).getByRole('alert')).toBeVisible({ timeout: 90_000 });
    await s.page.reload();
    await expect(receiptLinks(s.page)).toHaveCount(before + 2);
    expect(await downloadBySha(s.page, sha256(fake))).toBeNull();
    expect(await axeViolations(s.page)).toEqual([]);
    expect(s.errors).toEqual([]);
  } finally {
    await s.context.close();
  }
});

test('comprovante: a recepção baixa (leitura registrada); médica, outra clínica e sem sessão não recebem o arquivo', async ({ browser }) => {
  test.setTimeout(240_000);
  const rec = await login(browser, 'recepcao');
  let href = '';
  try {
    await rec.page.goto(`/convenios/autorizacoes/${fx!.expiring}`);
    href = (await receiptLinks(rec.page).first().getAttribute('href')) ?? '';
    expect(href).toMatch(/^\/financeiro\/convenios\/comprovantes\/[0-9a-f-]{36}$/u);
    const ok = await rec.context.request.get(href, { failOnStatusCode: false });
    expect([ok.status(), ok.headers()['content-type']]).toEqual([200, 'application/pdf']);
    expect(ok.headers()['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/u);
    // Id adulterado: o mesmo 404, sem corpo.
    const forged = await rec.context.request.get(`/financeiro/convenios/comprovantes/${randomUUID()}`, { failOnStatusCode: false });
    expect([forged.status(), await forged.text()]).toEqual([404, '']);
    expect(rec.errors).toEqual([]);
  } finally {
    await rec.context.close();
  }
  for (const key of ['medica', 'gestor-suspensa']) {
    const s = await login(browser, key);
    try {
      const r = await s.context.request.get(href, { failOnStatusCode: false });
      expect(r.status(), key).toBe(404);
      expect(await r.text(), key).toBe('');
    } finally {
      await s.context.close();
    }
  }
  const anon = await browser.newContext({ baseURL: BASE!, extraHTTPHeaders: vercelBypassHeaders() });
  try {
    const r = await anon.request.get(href, { maxRedirects: 0, failOnStatusCode: false });
    expect(r.status()).not.toBe(200);
    expect(r.headers()['content-type'] ?? '').not.toContain('application/pdf');
  } finally {
    await anon.close();
  }
});
