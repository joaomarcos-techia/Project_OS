/**
 * R44 no navegador: uma clínica sintética ZERADA configura o convênio inteiro pela
 * interface, sem SQL nem fixture de cadastro, contra um PREVIEW que usa o DEV.
 *
 *   procedimento (catálogo) → prestador → operadora → plano → procedimento contratado
 *   (TUSS da tabela oficial, valor, coparticipação) → ativar → perfil TISS da médica →
 *   paciente (cadastro) → carteirinha → agendamento como CONVÊNIO → cobertura PRONTA, com
 *   coparticipação de R$ 45,00 sobre R$ 150,00 → reajuste a partir de uma data (o passado
 *   não muda) → permissões, outra clínica, trial e celular.
 *
 * A fixture `hi-dev-e2e-fixture.ts setup-config` só cria a clínica `e2e-hi-config`, as contas,
 * a assinatura paga e a habilitação operacional (decisão do Qoro). Antes de qualquer escrita, a
 * prova assinada confirma que o Preview usa o DEV. Dados 100% sintéticos.
 *
 *   E2E_BASE_URL=<preview> E2E_HI_CFG_ACCOUNTS=<contas-cfg.json> E2E_HI_ACCOUNTS=<contas.json> \
 *   E2E_HI_FIXTURE=<ids.json> [E2E_HI_SHOTS=<dir>] VERCEL_AUTOMATION_BYPASS_SECRET=… MAGIC_TOKEN_SECRET_DEV=… \
 *     npx playwright test e2e/convenios-config-preview.spec.ts
 */
import { mkdirSync, readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const CFG_ACCOUNTS = process.env.E2E_HI_CFG_ACCOUNTS;
const ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const FIXTURE = process.env.E2E_HI_FIXTURE;
const SHOTS = process.env.E2E_HI_SHOTS;

test.skip(!BASE || !CFG_ACCOUNTS || !ACCOUNTS || !FIXTURE, 'requer E2E_BASE_URL (Preview no DEV) e as fixtures e2e-hi');
test.describe.configure({ mode: 'serial' });
// Falha cedo: uma ação que não acha o elemento não deve consumir o tempo do teste inteiro.
test.use({ actionTimeout: 45_000 });

type Account = { email: string; password: string; userId: string; clinic: string; role: string };
const accounts: Record<string, Account> = {
  ...(ACCOUNTS ? (JSON.parse(readFileSync(ACCOUNTS, 'utf8')) as Record<string, Account>) : {}),
  ...(CFG_ACCOUNTS ? (JSON.parse(readFileSync(CFG_ACCOUNTS, 'utf8')) as Record<string, Account>) : {}),
};
const other = FIXTURE ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { insurerId: string; patients: Array<{ id: string }> }) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
/** Marca desta execução: nomes e códigos únicos, sempre sintéticos. */
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const PROC_CODE = `E2E${RUN}`;
const PROC_NAME = `Consulta sintética ${RUN}`;
const INSURER = `Operadora Sintética ${RUN}`;
const PATIENT = `Paciente Sintético Config ${RUN}`;
const CARD = `0099${RUN.replace(/[^0-9]/gu, '7').padEnd(4, '7').slice(0, 4)}55664433`;

const state: { insurerUrl?: string; patientId?: string } = {};

interface Session {
  context: BrowserContext;
  page: Page;
  errors: string[];
}

async function login(browser: Browser, key: string, viewport = DESKTOP): Promise<Session> {
  const account = accounts[key];
  if (!account) throw new Error(`conta ${key} ausente na fixture`);
  const context = await browser.newContext({ viewport, extraHTTPHeaders: vercelBypassHeaders() });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  return { context, page, errors };
}

async function visit(s: Session, path: string, shot?: string): Promise<number> {
  const res = await s.page.goto(path, { waitUntil: 'load' });
  await s.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path} transborda na horizontal`).toBeLessThanOrEqual(1);
  if (SHOTS && shot) await s.page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  return res?.status() ?? 0;
}

const toast = (page: Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible({ timeout: 45_000 });
const readiness = (page: Page, key: string) => page.locator(`[data-readiness="${key}"]`);

/** CPF sintético de formato válido (dígitos verificadores calculados), diferente a cada execução. */
function syntheticCpf(): string {
  const base = Array.from({ length: 9 }, (_, i) => (Number(Date.now().toString().slice(-9)[i]) + i) % 10);
  if (new Set(base).size === 1) base[0] = (base[0]! + 1) % 10;
  const dv = (digits: number[]) => {
    const sum = digits.reduce((acc, d, i) => acc + d * (digits.length + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

/** Amanhã no fuso de São Paulo (a agenda interpreta a hora como hora da clínica). */
const tomorrowSp = () => new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
/** Dia 1º do mês seguinte (para o reajuste a partir de uma data). */
function firstOfNextMonth(): string {
  const [y, m] = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

test('o Preview usa o projeto DEV (prova assinada antes de qualquer escrita)', async () => {
  test.setTimeout(90_000);
  await assertPreviewRuntimeIsDev(BASE!);
});

test('gestora: procedimento no catálogo da clínica (Configurações › Procedimentos)', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, '/configuracoes/procedimentos')).toBe(200);
  await s.page.getByRole('button', { name: 'Novo procedimento' }).first().click();
  await s.page.fill('#proc-codigo', PROC_CODE);
  await s.page.fill('#proc-descricao', PROC_NAME);
  await s.page.fill('#proc-valor', '150,00');
  await s.page.fill('#proc-duracao', '30');
  await s.page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(s.page.getByText(PROC_NAME).first()).toBeVisible({ timeout: 45_000 });
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('gestora: configura do zero — prestador, operadora, plano, contrato TUSS, ativação e perfil TISS', async ({ browser }) => {
  test.setTimeout(420_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, '/convenios/configuracao', 'cfg-01-zerada')).toBe(200);
  // Clínica zerada: só a habilitação (Qoro) e a terminologia estão prontas.
  for (const key of ['identity', 'insurers', 'contracts', 'professionals']) await expect(readiness(s.page, key)).toHaveAttribute('data-ok', 'false');
  await expect(readiness(s.page, 'enabled')).toHaveAttribute('data-ok', 'true');

  // Prestador.
  await s.page.getByLabel('Fatura como').selectOption('PJ');
  await s.page.getByLabel('Nome do contratado').fill('Clínica Sintética E2E Configuração Ltda');
  await s.page.getByRole('combobox', { name: 'CNES', exact: true }).selectOption('none_declared');
  await s.page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
  await toast(s.page, 'Identificação do prestador salva.');
  await expect(readiness(s.page, 'identity')).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });

  // Operadora (rascunho) → detalhe.
  await s.page.getByRole('button', { name: 'Nova operadora' }).click();
  await s.page.getByLabel('Nome da operadora').fill(INSURER);
  await s.page.getByLabel('Registro ANS').fill('999902');
  await s.page.getByLabel('Código do prestador').fill(`PREST${RUN}`);
  await s.page.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await s.page.waitForURL(/\/convenios\/configuracao\/operadoras\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  state.insurerUrl = new URL(s.page.url()).pathname;
  await expect(s.page.getByTestId('insurer-status')).toHaveAttribute('data-status', 'draft');

  // Plano.
  await s.page.getByRole('button', { name: 'Novo plano' }).click();
  await s.page.getByLabel('Nome do plano').fill('Plano Sintético Ambulatorial');
  await s.page.getByRole('button', { name: 'Cadastrar plano' }).click();
  await toast(s.page, 'Plano cadastrado.');

  // Procedimento contratado: TUSS escolhido na tabela oficial, R$ 150,00, coparticipação fixa R$ 45,00.
  await s.page.getByRole('button', { name: 'Novo procedimento contratado' }).click();
  await s.page.getByLabel('Procedimento do catálogo').selectOption({ label: PROC_NAME });
  await s.page.getByLabel('Código TUSS (tabela 22)').fill('10101012');
  await s.page.getByRole('option', { name: /10101012/u }).first().click();
  await s.page.getByLabel('Valor contratado (R$)').fill('150,00');
  await s.page.getByRole('combobox', { name: 'Coparticipação', exact: true }).selectOption('fixed');
  await s.page.getByLabel('Coparticipação (R$)').fill('45,00');
  await s.page.getByRole('button', { name: 'Cadastrar procedimento' }).click();
  await toast(s.page, 'Procedimento contratado cadastrado.');
  await expect(s.page.locator('[data-testid="contract-line"][data-code="10101012"]')).toHaveCount(1, { timeout: 30_000 });

  // Código inexistente não aparece para escolher (nada fora da tabela oficial).
  await s.page.getByRole('button', { name: 'Novo procedimento contratado' }).click();
  await s.page.getByLabel('Código TUSS (tabela 22)').fill('99999999');
  await expect(s.page.getByText('Nada encontrado na tabela 22 carregada.')).toBeVisible({ timeout: 20_000 });
  await s.page.getByRole('button', { name: 'Cancelar' }).last().click();

  // Ativar.
  await s.page.getByRole('button', { name: 'Ativar operadora' }).click();
  await toast(s.page, 'Situação da operadora atualizada.');
  await expect(s.page.getByTestId('insurer-status')).toHaveAttribute('data-status', 'active', { timeout: 30_000 });
  await visit(s, state.insurerUrl, 'cfg-02-operadora-ativa');

  // Perfil TISS da médica.
  await visit(s, '/convenios/configuracao');
  const row = s.page.getByTestId('professional-row').filter({ hasText: 'Dra. Sintética Configuração' });
  await row.getByRole('button', { name: 'Cadastrar perfil TISS' }).click();
  await row.getByLabel('Conselho profissional').selectOption('06');
  await row.getByLabel('Número no conselho').fill('123456');
  await row.getByLabel('UF do conselho').selectOption('35');
  await row.getByLabel('CBO (tabela 24)').fill('225125');
  await row.getByRole('option', { name: /225125/u }).first().click();
  await row.getByRole('button', { name: 'Salvar', exact: true }).click();
  await toast(s.page, 'Perfil TISS de Dra. Sintética Configuração salvo.');

  await visit(s, '/convenios/configuracao', 'cfg-03-pronta');
  for (const key of ['identity', 'insurers', 'contracts', 'professionals', 'terminology', 'enabled']) {
    await expect(readiness(s.page, key)).toHaveAttribute('data-ok', 'true');
  }
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('recepção: cadastra o paciente e a carteirinha (número cifrado; completo só auditado)', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await login(browser, 'cfg-recepcao');
  await s.page.goto('/pacientes?novo=1');
  const drawer = s.page.getByRole('dialog', { name: 'Novo paciente' });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await drawer.getByLabel('Nome', { exact: true }).first().fill(PATIENT);
  await drawer.getByLabel('CPF', { exact: true }).first().fill(syntheticCpf());
  await drawer.getByLabel('E-mail', { exact: true }).fill(`e2e-hi-paciente-${RUN.toLowerCase()}@example.com`);
  await drawer.getByRole('button', { name: 'Criar paciente' }).click();
  await expect(s.page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
  state.patientId = new URL(s.page.url()).pathname.split('/').at(-1)!;

  await visit(s, `/convenios/carteirinhas?q=${encodeURIComponent(PATIENT)}`);
  await s.page.getByTestId('cards-patient-hits').getByRole('link', { name: PATIENT }).click();
  await s.page.waitForURL(/paciente=/u);
  await s.page.getByRole('button', { name: 'Nova carteirinha' }).click();
  await s.page.getByLabel('Operadora').selectOption({ label: INSURER });
  await s.page.getByLabel('Número da carteirinha').fill(CARD);
  await s.page.getByLabel('Validade (opcional)').fill('2027-12-31');
  await s.page.getByRole('button', { name: 'Cadastrar carteirinha' }).click();
  await toast(s.page, 'Carteirinha cadastrada.');
  const card = s.page.getByTestId('patient-card').first();
  await expect(card).toHaveAttribute('data-last4', CARD.slice(-4), { timeout: 30_000 });
  await expect(s.page.getByText(CARD)).toHaveCount(0);
  await card.getByRole('button', { name: 'Ver número' }).click();
  await expect(s.page.getByTestId('card-number-revealed')).toHaveText(CARD, { timeout: 30_000 });
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-04-carteirinha.png`, fullPage: true });

  // A recepção vê a configuração, mas não cadastra operadora nem contrato.
  expect(await visit(s, '/convenios/configuracao')).toBe(200);
  await expect(s.page.getByRole('button', { name: 'Nova operadora' })).toHaveCount(0);
  await expect(s.page.getByRole('button', { name: /perfil TISS/u })).toHaveCount(0);
  expect(await visit(s, state.insurerUrl!)).toBe(200);
  await expect(s.page.getByRole('button', { name: 'Novo procedimento contratado' })).toHaveCount(0);
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('recepção: agenda como CONVÊNIO e a cobertura nasce pronta, com coparticipação estimada', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await login(browser, 'cfg-recepcao');
  expect(await visit(s, '/agenda')).toBe(200);
  await s.page.getByRole('button', { name: 'Novo atendimento' }).click();
  await s.page.locator('#appointment-patient').fill(PATIENT.slice(0, 12));
  await s.page.getByRole('option', { name: PATIENT }).first().click();
  await s.page.locator('#appointment-procedure').selectOption({ label: PROC_NAME });
  await s.page.locator('#appointment-doctor').selectOption({ label: 'Dra. Sintética Configuração' });
  await s.page.locator('#appointment-date').fill(tomorrowSp());
  await s.page.locator('#appointment-time').fill('10:00');
  await s.page.getByRole('radio', { name: 'Convênio' }).click();
  await s.page.locator('#appointment-insurer').selectOption({ label: INSURER });
  await expect(s.page.locator('#appointment-card option', { hasText: `final ${CARD.slice(-4)}` })).toHaveCount(1, { timeout: 30_000 });
  await s.page.locator('#appointment-card').selectOption({ label: `final ${CARD.slice(-4)} · válida até 31/12/2027 · preferencial` });
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-05-agendamento-convenio.png`, fullPage: true });
  await s.page.getByRole('button', { name: 'Agendar', exact: true }).click();
  await toast(s.page, 'Atendimento agendado');

  expect(await visit(s, '/convenios/atendimentos', 'cfg-06-atendimento-pronto')).toBe(200);
  const row = s.page.getByTestId('insurance-appointment').filter({ hasText: PATIENT });
  await expect(row).toHaveAttribute('data-coverage', 'ready');
  await expect(row).toContainText(`final ${CARD.slice(-4)}`);
  await expect(row).toContainText('Nada');
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('gestora: reajuste a partir de uma data cria versão; o passado não muda; histórico registrado', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, state.insurerUrl!)).toBe(200);
  const line = s.page.locator('[data-testid="contract-line"][data-code="10101012"]').first();
  await line.getByRole('button', { name: 'Alterar' }).click();
  await line.getByLabel('Vale a partir de').fill(firstOfNextMonth());
  await line.getByLabel('Valor contratado (R$)').fill('180,00');
  await line.getByLabel('Motivo').fill('Reajuste anual sintético do contrato da operadora');
  await line.getByRole('button', { name: 'Salvar nova versão' }).click();
  await toast(s.page, 'Contrato atualizado');
  // Duas linhas vivas (a antiga encerrada na véspera e a nova vigência) e uma versão anterior.
  await expect(s.page.locator('[data-testid="contract-line"][data-code="10101012"]')).toHaveCount(2, { timeout: 30_000 });
  await expect(s.page.getByText('Versões anteriores (1)')).toBeVisible();
  await expect(s.page.getByTestId('insurer-history')).toContainText('Reajuste a partir de uma data');
  // O atendimento de amanhã continua coberto pelo preço vigente na data dele.
  expect(await visit(s, '/convenios/atendimentos')).toBe(200);
  await expect(s.page.getByTestId('insurance-appointment').filter({ hasText: PATIENT })).toHaveAttribute('data-coverage', 'ready');
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('médica: sem ver o financeiro, não entra na configuração nem nas carteirinhas', async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await login(browser, 'cfg-medica');
  for (const path of ['/convenios/configuracao', '/convenios/carteirinhas', '/convenios/atendimentos']) {
    await visit(s, path);
    await expect(s.page.getByText('Seu perfil não tem permissão para o faturamento de convênios.')).toBeVisible();
  }
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('outra clínica: operadora e paciente de outro tenant não aparecem (404 / não encontrado)', async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await login(browser, 'cfg-recepcao');
  expect(await visit(s, `/convenios/configuracao/operadoras/${other!.insurerId}`)).toBe(404);
  await visit(s, `/convenios/carteirinhas?paciente=${other!.patients[0]!.id}`);
  await expect(s.page.getByText('Paciente não encontrado nesta clínica.')).toBeVisible();
  // E a clínica sintética "paga" não vê a operadora desta.
  const p = await login(browser, 'gestor');
  expect(await visit(p, state.insurerUrl!)).toBe(404);
  await s.context.close();
  await p.context.close();
});

test('trial: a configuração aparece como recurso contratável e a carteirinha é recusada', async ({ browser }) => {
  test.setTimeout(150_000);
  const s = await login(browser, 'gestor-trial');
  expect(await visit(s, '/convenios/configuracao', 'cfg-07-trial')).toBe(200);
  await expect(s.page.getByTestId('convenios-commercial-notice')).toHaveAttribute('data-denial', 'trial');
  expect(await visit(s, '/convenios/carteirinhas')).toBe(200);
  await expect(s.page.getByTestId('convenios-commercial-notice')).toBeVisible();
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('celular: configuração, operadora, carteirinhas e atendimentos sem rolagem lateral', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await login(browser, 'cfg-gestor', MOBILE);
  for (const [path, shot] of [
    ['/convenios/configuracao', 'cfg-m-configuracao'],
    [state.insurerUrl!, 'cfg-m-operadora'],
    [`/convenios/carteirinhas?paciente=${state.patientId}`, 'cfg-m-carteirinhas'],
    ['/convenios/atendimentos', 'cfg-m-atendimentos'],
  ] as const) {
    expect(await visit(s, path, shot)).toBe(200);
  }
  expect(s.errors).toEqual([]);
  await s.context.close();
});

// ── Da consulta ao repasse, na mesma clínica configurada pela interface ──────────────

const journey: { guideUrl?: string; guideNumber?: string; batchUrl?: string } = {};

test('gestora: regra de repasse da médica (40%) em Configurações › Pagamentos', async ({ browser }) => {
  test.setTimeout(150_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, '/configuracoes/pagamentos')).toBe(200);
  await s.page.locator('#payout-professional').selectOption({ label: 'Dra. Sintética Configuração' });
  await s.page.locator('#payout-kind').selectOption('percentage');
  await s.page.locator('#payout-value').fill('40');
  await s.page.getByRole('button', { name: 'Salvar regra' }).click();
  await toast(s.page, 'Regra de repasse salva.');
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('recepção: encaixe de convênio (o paciente chegou agora)', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await login(browser, 'cfg-recepcao');
  expect(await visit(s, '/agenda')).toBe(200);
  await s.page.getByRole('button', { name: 'Novo atendimento' }).click();
  await s.page.getByRole('radio', { name: 'Encaixe (agora)' }).click();
  await s.page.locator('#appointment-patient').fill(PATIENT.slice(0, 12));
  await s.page.getByRole('option', { name: PATIENT }).first().click();
  await s.page.locator('#appointment-procedure').selectOption({ label: PROC_NAME });
  await s.page.locator('#appointment-doctor').selectOption({ label: 'Dra. Sintética Configuração' });
  await s.page.getByRole('radio', { name: 'Convênio' }).click();
  await s.page.locator('#appointment-insurer').selectOption({ label: INSURER });
  await expect(s.page.locator('#appointment-card option', { hasText: `final ${CARD.slice(-4)}` })).toHaveCount(1, { timeout: 30_000 });
  await s.page.locator('#appointment-card').selectOption({ label: `final ${CARD.slice(-4)} · válida até 31/12/2027 · preferencial` });
  await s.page.getByRole('button', { name: 'Criar encaixe' }).click();
  await toast(s.page, 'Encaixe criado');
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('médica: chama e encerra a consulta; a guia de convênio nasce sozinha do atendimento', async ({ browser }) => {
  test.setTimeout(300_000);
  const m = await login(browser, 'cfg-medica');
  expect(await visit(m, '/consultorio')).toBe(200);
  await expect(m.page.getByText(PATIENT).first()).toBeVisible({ timeout: 30_000 });
  await m.page.getByRole('button', { name: 'Chamar' }).first().click();
  await m.page.getByRole('button', { name: 'Encerrar consulta' }).click();
  await expect(m.page.getByRole('button', { name: 'Encerrar consulta' })).toHaveCount(0, { timeout: 45_000 });
  expect(m.errors).toEqual([]);
  await m.context.close();

  // A guia vem do evento da conclusão (processado logo depois da resposta; o cron é a reserva).
  const s = await login(browser, 'cfg-gestor');
  let found = false;
  for (let i = 0; i < 12 && !found; i += 1) {
    await visit(s, '/convenios/guias');
    const link = s.page.getByRole('row').filter({ hasText: PATIENT }).getByRole('link').first();
    if ((await link.count()) > 0) {
      journey.guideNumber = (await link.innerText()).trim();
      await link.click();
      await s.page.waitForURL(/\/convenios\/guias\/[0-9a-f-]{36}$/u);
      journey.guideUrl = new URL(s.page.url()).pathname;
      found = true;
    } else {
      await s.page.waitForTimeout(5_000);
    }
  }
  expect(found, 'a guia da consulta encerrada não apareceu em 1 minuto').toBe(true);
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-08-guia-gerada.png`, fullPage: true });
  await s.context.close();
});

test('gestora: confere, aprova e emite a guia; o PDF oficial sai do documento congelado', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, journey.guideUrl!)).toBe(200);
  await s.page.getByRole('button', { name: 'Marcar como conferida' }).click();
  await toast(s.page, 'Guia conferida');
  await s.page.getByRole('button', { name: 'Aprovar e emitir' }).click();
  await toast(s.page, 'Guia aprovada e emitida');
  const guideId = journey.guideUrl!.split('/').pop()!;
  const pdf = await s.context.request.get(`/financeiro/convenios/guias/${guideId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('gestora: lote → XML validado no XSD → enviado → protocolo → em análise', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, '/convenios/lotes')).toBe(200);
  await s.page.getByLabel('Operadora').first().selectOption({ label: INSURER });
  await s.page.getByText('Todas (até 100)').click();
  await s.page.getByRole('button', { name: 'Montar lote' }).click();
  await s.page.waitForURL(/\/convenios\/lotes\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  journey.batchUrl = new URL(s.page.url()).pathname;
  await s.page.getByRole('button', { name: 'Gerar e validar XML' }).click();
  await toast(s.page, 'XML gerado e validado');
  await s.page.getByRole('button', { name: 'Marcar como enviado' }).click();
  await s.page.getByLabel('Como o lote foi enviado').fill('Enviado pelo portal da operadora sintética, comprovante de teste');
  await s.page.getByRole('button', { name: 'Confirmar' }).click();
  await toast(s.page, /enviado/iu);
  await s.page.getByRole('button', { name: 'Registrar protocolo' }).click();
  await s.page.getByLabel('Protocolo da operadora').fill(`PROT${RUN}`);
  await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await toast(s.page, 'Protocolo registrado');
  await s.page.getByRole('button', { name: 'Operadora iniciou a análise' }).click();
  await toast(s.page, 'Lote em análise');
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-09-lote-em-analise.png`, fullPage: true });
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('gestora: glosa parcial → análise → contestação → recurso com XML no XSD → envio → resposta', async ({ browser }) => {
  test.setTimeout(360_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, journey.batchUrl!)).toBe(200);
  await s.page.getByRole('button', { name: 'Registrar glosa' }).click();
  await s.page.getByLabel('Código da glosa (tabela 38)').fill('1705');
  await s.page.getByLabel('Valor glosado (R$)').fill('30,00');
  await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await toast(s.page, /glosa/iu);

  expect(await visit(s, journey.guideUrl!)).toBe(200);
  await s.page.getByRole('button', { name: 'Analisar' }).click();
  await toast(s.page, 'Glosa em análise');
  await s.page.getByRole('button', { name: 'Contestar' }).click();
  await toast(s.page, 'Glosa contestada');
  await s.page.getByRole('button', { name: 'Preparar recurso' }).click();
  await s.page.getByRole('checkbox').first().check();
  await s.page.getByLabel('Justificativa').fill('Atendimento realizado conforme o contrato vigente na data; segue o registro sintético do atendimento.');
  await s.page.getByRole('button', { name: 'Salvar recurso' }).click();
  await toast(s.page, 'Recurso preparado');
  await s.page.getByRole('button', { name: 'Gerar XML do recurso (TISS)' }).click();
  await toast(s.page, 'XML do recurso gerado e validado no XSD');
  await s.page.getByRole('button', { name: 'Registrar envio do recurso' }).click();
  await s.page.getByLabel('Protocolo da operadora').fill(`REC${RUN}`);
  await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await toast(s.page, 'Envio do recurso registrado');
  await s.page.getByRole('button', { name: 'Registrar resposta' }).click();
  await s.page.getByLabel(/Aceito pela operadora/u).first().fill('20,00');
  await s.page.getByRole('button', { name: 'Registrar resposta' }).last().click();
  await toast(s.page, 'Resposta registrada');
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-10-recurso-respondido.png`, fullPage: true });
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('gestora: pagamento parcial → alocação → estorno → nova alocação; demonstrativo repetido recusado', async ({ browser }) => {
  test.setTimeout(360_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, journey.batchUrl!)).toBe(200);
  await s.page.getByRole('button', { name: 'Registrar pagamento' }).click();
  await s.page.getByLabel('Valor pago (R$)').fill('100,00');
  await s.page.getByLabel('Referência do demonstrativo').fill(`DEMO${RUN}`);
  await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await toast(s.page, 'Pagamento registrado');
  // O mesmo demonstrativo não entra duas vezes.
  await s.page.getByRole('button', { name: 'Registrar pagamento' }).click();
  await s.page.getByLabel('Valor pago (R$)').fill('100,00');
  await s.page.getByLabel('Referência do demonstrativo').fill(`DEMO${RUN}`);
  await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(s.page.getByText(/já existe|já foi registrad|duas vezes/iu).first()).toBeVisible({ timeout: 45_000 });

  expect(await visit(s, '/convenios/conciliacao')).toBe(200);
  await s.page.getByRole('button', { name: 'Alocar às guias' }).first().click();
  await s.page.getByLabel(`Alocar à guia ${journey.guideNumber}`).fill('100,00');
  await s.page.getByRole('button', { name: 'Alocar', exact: true }).click();
  await toast(s.page, 'Pagamento alocado');

  expect(await visit(s, journey.guideUrl!)).toBe(200);
  await s.page.getByRole('button', { name: 'Estornar' }).first().click();
  await s.page.getByRole('textbox').last().fill('Estorno sintético: alocação feita na guia errada no teste');
  await s.page.getByRole('button', { name: 'Confirmar' }).click();
  await toast(s.page, 'Pagamento estornado');

  expect(await visit(s, '/convenios/conciliacao')).toBe(200);
  await s.page.getByRole('button', { name: 'Alocar às guias' }).first().click();
  await s.page.getByLabel(`Alocar à guia ${journey.guideNumber}`).fill('100,00');
  await s.page.getByRole('button', { name: 'Alocar', exact: true }).click();
  await toast(s.page, 'Pagamento alocado');
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-11-conciliacao.png`, fullPage: true });
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('gestora: repasse de 40% sobre o recebido → autorizar → registrar o repasse', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, '/convenios/repasses')).toBe(200);
  await s.page.getByRole('button', { name: 'Criar repasses que faltam' }).click();
  await toast(s.page, 'Repasses atualizados');
  await visit(s, '/convenios/repasses', 'cfg-12-repasse');
  const row = s.page.getByRole('row').filter({ hasText: PATIENT });
  await row.getByRole('button', { name: 'Autorizar' }).click();
  await s.page.getByRole('button', { name: 'Confirmar' }).click();
  await toast(s.page, 'Repasse autorizado');
  await visit(s, '/convenios/repasses');
  await s.page.getByRole('row').filter({ hasText: PATIENT }).getByRole('button', { name: 'Registrar repasse' }).click();
  await s.page.getByRole('button', { name: 'Confirmar' }).click();
  await toast(s.page, 'Repasse registrado');
  expect(s.errors).toEqual([]);
  await s.context.close();
});

test('coparticipação: recepção confere R$ 45,00, gestora confirma; só esse valor vira cobrança do paciente', async ({ browser }) => {
  test.setTimeout(300_000);
  const r = await login(browser, 'cfg-recepcao');
  expect(await visit(r, '/convenios/conciliacao')).toBe(200);
  const review = r.page.getByTestId('copay-review').first();
  await expect(review).toHaveAttribute('data-status', 'calculated');
  await expect(r.page.getByLabel('Valor conferido (R$)').first()).toHaveValue('45,00');
  await r.page.getByRole('button', { name: 'Conferir' }).first().click();
  await toast(r.page, 'Coparticipação conferida.');
  // A recepção não confirma (é de quem gerencia o financeiro).
  await r.page.reload();
  await expect(r.page.getByRole('button', { name: 'Confirmar coparticipação' })).toHaveCount(0);
  await r.context.close();

  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, '/convenios/conciliacao')).toBe(200);
  await s.page.getByLabel('A cobrar do paciente (R$)').first().fill('45,00');
  await s.page.getByRole('button', { name: 'Confirmar coparticipação' }).first().click();
  await toast(s.page, 'Coparticipação confirmada; o valor a cobrar do paciente foi lançado.');
  // O recebível nasce do evento logo depois; a lista mostra a cobrança de R$ 45,00 (nunca R$ 150,00).
  let charge = false;
  for (let i = 0; i < 10 && !charge; i += 1) {
    await visit(s, '/convenios/conciliacao');
    charge = (await s.page.getByRole('button', { name: 'Gerar link de cobrança' }).count()) > 0;
    if (!charge) await s.page.waitForTimeout(4_000);
  }
  expect(charge, 'a coparticipação confirmada não apareceu para cobrança').toBe(true);
  await expect(s.page.getByText('R$ 45,00').first()).toBeVisible();
  await s.page.getByRole('button', { name: 'Gerar link de cobrança' }).first().click();
  // Sem conta Asaas ativa nesta clínica sintética: nada é cobrado, receba no Caixa.
  await toast(s.page, /conta Asaas|Pedido registrado/u);
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-13-coparticipacao.png`, fullPage: true });
  expect(s.errors).toEqual([]);
  await s.context.close();
});
