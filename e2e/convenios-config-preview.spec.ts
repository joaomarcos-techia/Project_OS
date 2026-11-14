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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

const BASE = process.env.E2E_BASE_URL;
const CFG_ACCOUNTS = process.env.E2E_HI_CFG_ACCOUNTS;
const ACCOUNTS = process.env.E2E_HI_ACCOUNTS;
const FIXTURE = process.env.E2E_HI_FIXTURE;
const SHOTS = process.env.E2E_HI_SHOTS;
/** Retomada: com E2E_RUN e E2E_HI_STATE, a execução reaproveita a marca e o estado salvo (rode as etapas pendentes com -g). */
const STATE_FILE = process.env.E2E_HI_STATE;

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
const RUN = process.env.E2E_RUN ?? Date.now().toString(36).slice(-5).toUpperCase();
const PROC_CODE = `E2E${RUN}`;
const PROC_NAME = `Consulta sintética ${RUN}`;
const INSURER = `Operadora Sintética ${RUN}`;
const PATIENT = `Paciente Sintético Config ${RUN}`;
const CARD = `0099${RUN.replace(/[^0-9]/gu, '7').padEnd(4, '7').slice(0, 4)}55664433`;

/**
 * Data e horário do agendamento, variando por execução e por tentativa: a médica sintética é a
 * mesma pessoa em todas as execuções e a agenda do profissional não aceita sobreposição (só amanhã,
 * com 32 horários, colidia com execuções anteriores). Entre amanhã e o fim do mês, porque o reajuste
 * do teste seguinte vale a partir do dia 1º; das 06:00 às 21:30, de meia em meia hora.
 */
const RUN_N = Number.parseInt(RUN, 36);
function slotFor(attempt: number): { date: string; time: string } {
  const [y, m, d] = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const span = Math.max(1, Math.min(7, lastDay - d));
  const date = new Date(Date.UTC(y, m - 1, d + 1 + ((RUN_N + attempt) % span))).toISOString().slice(0, 10);
  const n = (RUN_N * 7 + attempt * 11) % 32;
  return { date, time: `${String(6 + Math.floor(n / 2)).padStart(2, '0')}:${n % 2 ? '30' : '00'}` };
}

const saved = (STATE_FILE && process.env.E2E_RUN && existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}) as {
  state?: { insurerUrl?: string; patientId?: string };
  journey?: { guideUrl?: string; guideNumber?: string; batchUrl?: string; paymentStage?: number };
};
const state: { insurerUrl?: string; patientId?: string } = { ...saved.state };
const journey: { guideUrl?: string; guideNumber?: string; batchUrl?: string; paymentStage?: number } = { ...saved.journey };
const persist = () => {
  if (STATE_FILE) writeFileSync(STATE_FILE, JSON.stringify({ run: RUN, state, journey }, null, 1));
};
test.afterEach(persist);
console.log(`E2E_RUN=${RUN}`);

interface Session {
  context: BrowserContext;
  page: Page;
  errors: string[];
}

/**
 * Uma sessão por conta na execução: o login real acontece uma vez e o estado é reusado
 * (o login do Qoro limita 10 tentativas por IP e 5 por e-mail em 15 min, janela deslizante: este spec
 * usa 5 logins; não rode outro spec autenticado na mesma janela).
 */
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

async function login(browser: Browser, key: string, viewport = DESKTOP): Promise<Session> {
  const account = accounts[key];
  if (!account) throw new Error(`conta ${key} ausente na fixture`);
  const cached = sessions.get(key);
  const context = await browser.newContext({ viewport, extraHTTPHeaders: vercelBypassHeaders(), ...(cached ? { storageState: cached } : {}) });
  const page = await context.newPage();
  const errors: string[] = [];
  // A rota entra na mensagem: um erro de página precisa dizer em que tela apareceu.
  page.on('pageerror', (e) => errors.push(e.message + ' @ ' + new URL(page.url()).pathname));
  if (cached) return { context, page, errors };
  await page.goto('/login', { waitUntil: 'load' });
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  sessions.set(key, await context.storageState());
  return { context, page, errors };
}

/**
 * Nenhum erro de página, sem exceção. O React #418 (R51) foi corrigido na causa (hora sem fuso
 * e `Date.now()` na renderização) e tem regressão própria (`hydration-r51-preview.spec.ts`);
 * qualquer ocorrência volta a reprovar, com a rota na mensagem.
 */
function expectNoPageErrors(s: Session): void {
  expect(s.errors).toEqual([]);
}

async function visit(s: Session, path: string, shot?: string): Promise<number> {
  const res = await s.page.goto(path, { waitUntil: 'load' });
  await s.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path} transborda na horizontal`).toBeLessThanOrEqual(1);
  if (SHOTS && shot) await s.page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  return res?.status() ?? 0;
}

/** Espera o aviso de sucesso; registra todo aviso que aparecer no caminho (o de erro some em 6 s) para a falha dizer o motivo. */
const toast = async (page: Page, text: string | RegExp) => {
  const seen = new Set<string>();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await page.getByText(text).first().isVisible().catch(() => false)) return;
    for (const t of await page.getByRole('status').allInnerTexts().catch(() => [] as string[])) if (t.trim()) seen.add(t.trim());
    await page.waitForTimeout(400);
  }
  throw new Error(`aviso esperado não apareceu (${String(text)}); avisos vistos: ${JSON.stringify([...seen])}`);
};
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
  await expect(s.page.getByText(PROC_NAME).first()).toBeVisible({ timeout: 90_000 });
  expectNoPageErrors(s);
  await s.context.close();
});

test('gestora: configura do zero — prestador, operadora, plano, contrato TUSS, ativação e perfil TISS', async ({ browser }) => {
  test.setTimeout(420_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, '/convenios/configuracao', 'cfg-01-zerada')).toBe(200);
  // Clínica zerada: só a habilitação (Qoro) e a terminologia estão prontas.
  for (const key of ['identity', 'insurers', 'contracts', 'credentials', 'professionals']) await expect(readiness(s.page, key)).toHaveAttribute('data-ok', 'false');
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

  // Credenciamento (P2.2): operadora ativa e contratada, mas sem credenciamento a prontidão acusa.
  await visit(s, '/convenios/configuracao');
  await expect(readiness(s.page, 'contracts')).toHaveAttribute('data-ok', 'true');
  await expect(readiness(s.page, 'credentials')).toHaveAttribute('data-ok', 'false');
  await visit(s, state.insurerUrl);
  await s.page.getByRole('button', { name: 'Registrar credenciamento' }).click();
  // Sem plano escolhido a tela não presume "todos os planos".
  await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await toast(s.page, 'Escolha o plano credenciado (ou, de propósito, todos os planos).');
  await s.page.getByRole('combobox', { name: /^Plano/u }).selectOption({ label: 'Plano Sintético Ambulatorial' });
  await s.page.getByLabel('Código na operadora (opcional)').fill(`CR${RUN}`);
  await s.page.getByLabel('Vale a partir de').fill('2026-01-01');
  await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await toast(s.page, 'Credenciamento registrado.');
  // A médica habilitada no mesmo plano (clínica PJ: a operadora exige).
  await s.page.getByRole('button', { name: 'Registrar credenciamento' }).click();
  await s.page.getByRole('combobox', { name: /^Quem é credenciado/u }).selectOption({ label: 'Profissional: Dra. Sintética Configuração' });
  await s.page.getByRole('combobox', { name: /^Plano/u }).selectOption({ label: 'Plano Sintético Ambulatorial' });
  await s.page.getByLabel('Vale a partir de').fill('2026-01-01');
  await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await toast(s.page, 'Credenciamento registrado.');
  await expect(s.page.getByTestId('credential')).toHaveCount(2, { timeout: 30_000 });
  await expect(s.page.locator('[data-testid="credential"][data-in-force="yes"]')).toHaveCount(2);
  await expect(s.page.getByTestId('insurer-history')).toContainText('Credenciamento registrado');

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
  for (const key of ['identity', 'insurers', 'contracts', 'credentials', 'professionals', 'terminology', 'enabled']) {
    await expect(readiness(s.page, key)).toHaveAttribute('data-ok', 'true');
  }
  expectNoPageErrors(s);
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
  await s.page.getByRole('link', { name: PATIENT, exact: true }).first().click();
  await s.page.waitForURL(/paciente=/u);
  await s.page.getByRole('button', { name: 'Nova carteirinha' }).click();
  await s.page.getByLabel('Operadora').selectOption({ label: INSURER });
  // O plano da carteirinha é o do credenciamento (P2.2): a agenda usa o plano da preferencial.
  await s.page.getByRole('combobox', { name: /^Plano/u }).selectOption({ label: 'Plano Sintético Ambulatorial' });
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
  expectNoPageErrors(s);
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
  const first = slotFor(0);
  await s.page.locator('#appointment-date').fill(first.date);
  await s.page.locator('#appointment-time').fill(first.time);
  await s.page.getByRole('radio', { name: 'Convênio' }).click();
  await s.page.locator('#appointment-insurer').selectOption({ label: INSURER });
  const card = `final ${CARD.slice(-4)} · válida até 31/12/2027 · preferencial`;
  await expect(s.page.locator('#appointment-card option', { hasText: `final ${CARD.slice(-4)}` })).toHaveCount(1, { timeout: 30_000 });
  await s.page.locator('#appointment-card').selectOption({ label: card });
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-05-agendamento-convenio.png`, fullPage: true });
  // Horário ocupado por uma execução anterior (mesma médica) → o produto recusa, com razão; tenta o próximo.
  const done = s.page.getByText('Atendimento agendado').first();
  const clash = s.page.getByText('Já existe um atendimento nesse horário para este profissional.').first();
  for (let attempt = 0; ; attempt += 1) {
    if (attempt > 0) {
      const next = slotFor(attempt);
      await s.page.locator('#appointment-date').fill(next.date);
      await s.page.locator('#appointment-time').fill(next.time);
      await expect(s.page.locator('#appointment-card option', { hasText: `final ${CARD.slice(-4)}` })).toHaveCount(1, { timeout: 30_000 });
      await s.page.locator('#appointment-card').selectOption({ label: card });
    }
    const answered = s.page.waitForResponse((r) => r.request().method() === 'POST' && r.request().headers()['next-action'] !== undefined, { timeout: 60_000 });
    await s.page.getByRole('button', { name: 'Agendar', exact: true }).click();
    await answered;
    await expect(done.or(clash).first()).toBeVisible({ timeout: 30_000 });
    if (await done.isVisible().catch(() => false)) break;
    // O aviso de conflito da tentativa anterior pode continuar na tela: espera o desta resposta.
    await s.page.waitForTimeout(1_500);
    if (await done.isVisible().catch(() => false)) break;
    expect(attempt, 'nenhum horário livre em 6 tentativas').toBeLessThan(5);
    console.log('horário já ocupado por execução anterior (tentativa ' + (attempt + 1) + '); tentando o próximo');
  }

  expect(await visit(s, '/convenios/atendimentos', 'cfg-06-atendimento-pronto')).toBe(200);
  const row = s.page.getByTestId('insurance-appointment').filter({ hasText: PATIENT });
  await expect(row).toHaveAttribute('data-coverage', 'ready');
  await expect(row).toContainText(`final ${CARD.slice(-4)}`);
  await expect(row).toContainText('Nada');
  expectNoPageErrors(s);
  await s.context.close();
});

test('recepção: muda um atendimento PARTICULAR para CONVÊNIO pela agenda e volta para particular (P4.3)', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await login(browser, 'cfg-recepcao');
  expect(await visit(s, '/agenda')).toBe(200);
  await s.page.getByRole('button', { name: 'Novo atendimento' }).click();
  await s.page.locator('#appointment-patient').fill(PATIENT.slice(0, 12));
  await s.page.getByRole('option', { name: PATIENT }).first().click();
  await s.page.locator('#appointment-procedure').selectOption({ label: PROC_NAME });
  await s.page.locator('#appointment-doctor').selectOption({ label: 'Dra. Sintética Configuração' });
  const done = s.page.getByText('Atendimento agendado').first();
  const clash = s.page.getByText('Já existe um atendimento nesse horário para este profissional.').first();
  // Regra do produto: um atendimento ativo por paciente e profissional no dia. O de convênio do
  // passo anterior está em slotFor(0); este vai para OUTRO dia.
  const sameDay = s.page.getByText('já tem um atendimento ativo com este profissional neste dia').first();
  const taken = new Set([slotFor(0).date]);
  const candidates = Array.from({ length: 40 }, (_, i) => slotFor(13 + i)).filter((c) => !taken.has(c.date));
  let when = candidates[0]!;
  for (let attempt = 0; ; attempt += 1) {
    when = candidates[attempt]!;
    await s.page.locator('#appointment-date').fill(when.date);
    await s.page.locator('#appointment-time').fill(when.time);
    const answered = s.page.waitForResponse((r) => r.request().method() === 'POST' && r.request().headers()['next-action'] !== undefined, { timeout: 60_000 });
    await s.page.getByRole('button', { name: 'Agendar', exact: true }).click();
    await answered;
    await expect(done.or(clash).or(sameDay).first()).toBeVisible({ timeout: 30_000 });
    if (await done.isVisible().catch(() => false)) break;
    await s.page.waitForTimeout(1_500);
    if (await done.isVisible().catch(() => false)) break;
    expect(attempt, 'nenhum horário livre em 6 tentativas').toBeLessThan(5);
  }
  // O dia do atendimento particular, na agenda.
  expect(await visit(s, `/agenda?view=day&date=${when.date}`)).toBe(200);
  const row = s.page.locator('tr[data-appointment-id]').filter({ hasText: PATIENT }).filter({ hasText: when.time }).first();
  await expect(row).toHaveAttribute('data-billing-mode', 'particular', { timeout: 30_000 });
  await row.getByTestId('billing-mode-open').click();
  const dialog = s.page.getByTestId('billing-mode-dialog');
  await dialog.locator('#appointment-insurer').selectOption({ label: INSURER });
  await expect(dialog.locator('#appointment-card option', { hasText: `final ${CARD.slice(-4)}` })).toHaveCount(1, { timeout: 30_000 });
  await dialog.locator('#appointment-card').selectOption({ index: 1 });
  await dialog.getByRole('textbox', { name: /Motivo da troca/u }).fill('Paciente apresentou a carteirinha na recepção.');
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-05b-troca-para-convenio.png`, fullPage: true });
  await s.page.getByTestId('billing-mode-submit').click();
  await toast(s.page, 'Forma de atendimento alterada');
  await expect(row).toHaveAttribute('data-billing-mode', 'convenio', { timeout: 30_000 });
  await expect(row.getByTestId('agenda-convenio-badge')).toContainText(INSURER);
  // Em Convênios › Atendimentos ele aparece com a cobertura registrada pela troca.
  expect(await visit(s, '/convenios/atendimentos')).toBe(200);
  await expect(s.page.getByTestId('insurance-appointment').filter({ hasText: PATIENT }).first()).toBeVisible();
  // Volta para particular: a cobertura é encerrada (sem ser apagada) e nada é cobrado.
  expect(await visit(s, `/agenda?view=day&date=${when.date}`)).toBe(200);
  await row.getByTestId('billing-mode-open').click();
  await s.page.getByTestId('billing-mode-dialog').getByRole('textbox', { name: /Motivo da troca/u }).fill('Paciente decidiu pagar particular.');
  await s.page.getByTestId('billing-mode-submit').click();
  await toast(s.page, 'Forma de atendimento alterada');
  await expect(row).toHaveAttribute('data-billing-mode', 'particular', { timeout: 30_000 });
  await expect(row.getByTestId('agenda-convenio-badge')).toHaveCount(0);
  expectNoPageErrors(s);
  await s.context.close();
});

test('gestora: importa a tabela por planilha — prévia por linha, erro bloqueia, aplicação atômica, reenvio não duplica (P2.7)', async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, state.insurerUrl!)).toBe(200);
  const panel = s.page.getByTestId('contract-import');
  await expect(panel).toBeVisible();
  const header = 'tabela;codigo;descricao;tipo_guia;valor;vigencia_inicio;vigencia_fim;plano;exige_autorizacao;coparticipacao_tipo;coparticipacao_valor;retorno_dias;retorno_faturavel;procedimento_clinica';
  const file = (name: string, rows: string[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(`${header}\r\n${rows.join('\r\n')}\r\n`, 'utf8') });
  // 1) Uma linha com erro (procedimento fora do catálogo): prévia mostra o motivo e NÃO deixa aplicar.
  await panel.getByTestId('contract-import-file').setInputFiles(
    file(`com-erro-${RUN}.csv`, [`22;10101012;;sp_sadt;99,00;01/01/2026;;;não;;;;;${PROC_CODE}`, '22;10101012;;sp_sadt;99,00;01/02/2026;;;não;;;;;NAO-EXISTE']),
  );
  await panel.getByTestId('contract-import-validate').click();
  await expect(panel.getByTestId('contract-import-preview')).toHaveAttribute('data-status', 'rejected', { timeout: 60_000 });
  await expect(panel.getByTestId('contract-import-row').filter({ hasText: 'não está no catálogo' })).toHaveCount(1);
  await expect(panel.getByTestId('contract-import-apply')).toBeDisabled();
  // 2) A planilha certa: prévia validada, aplicar, o item aparece no contrato.
  const good = file(`tabela-${RUN}.csv`, [`22;10101012;;sp_sadt;99,00;01/01/2026;;;não;;;;;${PROC_CODE}`]);
  await panel.getByTestId('contract-import-file').setInputFiles(good);
  await panel.getByTestId('contract-import-validate').click();
  await expect(panel.getByTestId('contract-import-preview')).toHaveAttribute('data-status', 'validated', { timeout: 60_000 });
  await expect(panel.getByTestId('contract-import-row')).toHaveAttribute('data-action', 'create');
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-03b-importacao-previa.png`, fullPage: true });
  await panel.getByTestId('contract-import-apply').click();
  await toast(s.page, 'Tabela importada');
  expect(await visit(s, state.insurerUrl!)).toBe(200);
  await expect(s.page.getByRole('region', { name: 'Contrato' }).getByText('SP/SADT').first()).toBeVisible();
  // 3) Reenviar a mesma planilha: "sem mudança" e já aplicada — nada é duplicado.
  await s.page.getByTestId('contract-import-file').setInputFiles(good);
  await s.page.getByTestId('contract-import-validate').click();
  await expect(s.page.getByTestId('contract-import-row')).toHaveAttribute('data-action', 'unchanged', { timeout: 60_000 });
  await expect(s.page.getByTestId('contract-import-apply')).toBeDisabled();
  await expect(s.page.getByTestId('contract-import-history')).toContainText(`tabela-${RUN}.csv`);
  expectNoPageErrors(s);
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
  expectNoPageErrors(s);
  await s.context.close();
});

test('médica: sem ver o financeiro, não entra na configuração nem nas carteirinhas', async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await login(browser, 'cfg-medica');
  for (const path of ['/convenios/configuracao', '/convenios/carteirinhas', '/convenios/atendimentos']) {
    await visit(s, path);
    await expect(s.page.getByText('Seu perfil não tem permissão para o faturamento de convênios.')).toBeVisible();
  }
  expectNoPageErrors(s);
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

test('trial: configuração e carteirinhas aparecem como recurso contratável (a recusa da carteirinha no trial é provada no harness)', async ({ browser }) => {
  test.setTimeout(150_000);
  const s = await login(browser, 'gestor-trial');
  expect(await visit(s, '/convenios/configuracao', 'cfg-07-trial')).toBe(200);
  await expect(s.page.getByTestId('convenios-commercial-notice')).toHaveAttribute('data-denial', 'trial');
  expect(await visit(s, '/convenios/carteirinhas')).toBe(200);
  await expect(s.page.getByTestId('convenios-commercial-notice')).toBeVisible();
  expectNoPageErrors(s);
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
  expectNoPageErrors(s);
  await s.context.close();
});

// ── Da consulta ao repasse, na mesma clínica configurada pela interface ──────────────


test('gestora: regra de repasse da médica (40%) em Configurações › Pagamentos', async ({ browser }) => {
  test.setTimeout(150_000);
  const s = await login(browser, 'cfg-gestor');
  expect(await visit(s, '/configuracoes/pagamentos')).toBe(200);
  await s.page.locator('#payout-professional').selectOption({ label: 'Dra. Sintética Configuração' });
  await s.page.locator('#payout-kind').selectOption('percentage');
  await s.page.locator('#payout-value').fill('40');
  await s.page.getByRole('button', { name: 'Salvar regra' }).click();
  await toast(s.page, 'Regra de repasse salva.');
  expectNoPageErrors(s);
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
  expectNoPageErrors(s);
  await s.context.close();
});

test('médica: chama e encerra a consulta; a guia de convênio nasce sozinha do atendimento', async ({ browser }) => {
  test.setTimeout(300_000);
  const m = await login(browser, 'cfg-medica');
  expect(await visit(m, '/consultorio')).toBe(200);
  await expect(m.page.getByText(PATIENT).first()).toBeVisible({ timeout: 30_000 });
  await m.page.getByRole('button', { name: 'Chamar' }).first().click();
  // Regra clínica: só encerra com o prontuário assinado, e o banco recusa prontuário vazio. A nota
  // diz só que é um registro de teste: nenhum dado clínico é inventado.
  await m.page.getByPlaceholder('Anotações complementares.').fill('Registro sintético de teste automatizado (E2E). Nenhum dado clínico.');
  await m.page.getByRole('button', { name: 'Salvar agora' }).click();
  await expect(m.page.getByText(/^Salvo/u).first()).toBeVisible({ timeout: 45_000 });
  await m.page.getByRole('button', { name: 'Assinar consulta' }).first().click();
  const sign = m.page.getByRole('dialog', { name: 'Assinar prontuário' });
  await expect(sign).toBeVisible({ timeout: 30_000 });
  await sign.getByRole('button', { name: 'Assinar consulta' }).click();
  await expect(sign).toHaveCount(0, { timeout: 45_000 });
  await m.page.getByRole('button', { name: 'Encerrar consulta' }).click();
  await expect(m.page.getByRole('button', { name: 'Encerrar consulta' })).toHaveCount(0, { timeout: 45_000 });
  expectNoPageErrors(m);
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
  expectNoPageErrors(s);
  await s.context.close();
});

test('gestora: lote → XML validado no XSD → enviado → protocolo → em análise', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await login(browser, 'cfg-gestor');
  const has = async (name: string) => (await s.page.getByRole('button', { name, exact: true }).count()) > 0;
  if (!journey.batchUrl) {
    expect(await visit(s, '/convenios/lotes')).toBe(200);
    await s.page.getByLabel('Operadora').first().selectOption({ label: `${INSURER} (1 aprovadas)` });
    await s.page.getByText('Todas (até 100)').click();
    await s.page.getByRole('button', { name: 'Montar lote' }).click();
    await s.page.waitForURL(/\/convenios\/lotes\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
    journey.batchUrl = new URL(s.page.url()).pathname;
  } else {
    // Retomada: o lote já existe; segue da etapa em que ele está.
    expect(await visit(s, journey.batchUrl)).toBe(200);
  }
  if (await has('Gerar e validar XML')) {
    await s.page.getByRole('button', { name: 'Gerar e validar XML' }).click();
    await toast(s.page, 'XML gerado e validado');
    await visit(s, journey.batchUrl!);
  }
  if (await has('Marcar como enviado')) {
    await s.page.getByRole('button', { name: 'Marcar como enviado' }).click();
    await s.page.getByLabel('Como o lote foi enviado').fill('Enviado pelo portal da operadora sintética, comprovante de teste');
    await s.page.getByRole('button', { name: 'Confirmar' }).click();
    await toast(s.page, 'Envio registrado');
    await visit(s, journey.batchUrl!);
  }
  if (await has('Registrar protocolo')) {
    await s.page.getByRole('button', { name: 'Registrar protocolo' }).click();
    // Protocolo TISS do lote: numérico, até 12 dígitos (o recurso de glosa o referencia como st_numerico12).
    await s.page.getByLabel('Protocolo da operadora').fill(String(Date.now()).slice(-12));
    // O recibo é obrigatório: PDF sintético mínimo, sem dado nenhum (o Qoro guarda só o SHA-256).
    await s.page.getByLabel('Recibo emitido pela operadora').setInputFiles({
      name: 'recibo-sintetico.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.4\n% recibo sintetico de teste ${RUN}\n%%EOF\n`),
    });
    await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await toast(s.page, 'Protocolo registrado');
    await visit(s, journey.batchUrl!);
  }
  await s.page.getByRole('button', { name: 'Operadora iniciou a análise' }).click();
  await toast(s.page, 'Lote em análise');
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-09-lote-em-analise.png`, fullPage: true });
  expectNoPageErrors(s);
  await s.context.close();
});

test('gestora: glosa parcial → análise → contestação → recurso com XML no XSD → envio → resposta', async ({ browser }) => {
  test.setTimeout(420_000);
  const s = await login(browser, 'cfg-gestor');
  const has = async (name: string) => (await s.page.getByRole('button', { name, exact: true }).count()) > 0;
  /** Cada decisão muda a versão da glosa: recarrega antes da próxima (senão o botão leva a versão antiga e o servidor recusa). */
  const act = async (name: string, done: string | RegExp) => {
    if (!(await has(name))) return;
    await s.page.getByRole('button', { name, exact: true }).first().click();
    await toast(s.page, done);
    await visit(s, journey.guideUrl!);
  };
  expect(await visit(s, journey.guideUrl!)).toBe(200);
  if ((await s.page.getByText('Código 1705').count()) === 0) {
    expect(await visit(s, journey.batchUrl!)).toBe(200);
    await s.page.getByRole('button', { name: 'Registrar glosa' }).click();
    await s.page.getByLabel('Código da glosa (tabela 38)').fill('1705');
    await s.page.getByLabel('Valor glosado (R$)').fill('30,00');
    await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await toast(s.page, 'Glosa registrada');
    expect(await visit(s, journey.guideUrl!)).toBe(200);
  }
  await act('Analisar', 'Glosa em análise');
  await act('Contestar', 'Glosa contestada');
  if (await has('Preparar recurso')) {
    await s.page.getByRole('button', { name: 'Preparar recurso' }).click();
    await s.page.getByRole('checkbox').first().check();
    await s.page.getByLabel('Justificativa').fill('Atendimento realizado conforme o contrato vigente na data; segue o registro sintético do atendimento.');
    await s.page.getByRole('button', { name: 'Salvar recurso' }).click();
    await toast(s.page, 'Recurso preparado');
    await visit(s, journey.guideUrl!);
  }
  await act('Gerar XML do recurso (TISS)', 'XML do recurso gerado e validado no XSD');
  if (await has('Registrar envio do recurso')) {
    await s.page.getByRole('button', { name: 'Registrar envio do recurso' }).click();
    await s.page.getByLabel('Protocolo da operadora').fill(`REC${RUN}`);
    await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await toast(s.page, 'Envio do recurso registrado');
    await visit(s, journey.guideUrl!);
  }
  await s.page.getByRole('button', { name: 'Registrar resposta' }).first().click();
  await s.page.getByLabel(/Aceito pela operadora/u).first().fill('20,00');
  await s.page.getByRole('button', { name: 'Registrar resposta' }).last().click();
  await toast(s.page, 'Resposta registrada');
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-10-recurso-respondido.png`, fullPage: true });
  expectNoPageErrors(s);
  await s.context.close();
});

test('gestora: pagamento parcial → alocação → estorno → nova alocação; demonstrativo repetido recusado', async ({ browser }) => {
  test.setTimeout(420_000);
  const s = await login(browser, 'cfg-gestor');
  /** Etapas persistidas na hora (retomada não registra o pagamento duas vezes). */
  const reached = (n: number) => {
    journey.paymentStage = n;
    persist();
  };
  /** Campo de alocação: rótulo "Alocar à guia <número>" (só o número da guia). */
  const allocate = async () => {
    expect(await visit(s, '/convenios/conciliacao')).toBe(200);
    await s.page.getByRole('button', { name: 'Alocar às guias' }).first().click();
    await s.page.getByLabel(/^Alocar à guia /u).first().fill('100,00');
    await s.page.getByRole('button', { name: 'Alocar', exact: true }).click();
    await toast(s.page, 'Pagamento alocado');
  };
  if ((journey.paymentStage ?? 0) < 1) {
    expect(await visit(s, journey.batchUrl!)).toBe(200);
    await s.page.getByRole('button', { name: 'Registrar pagamento' }).click();
    await s.page.getByLabel('Valor pago (R$)').fill('100,00');
    await s.page.getByLabel('Referência do demonstrativo').fill(`DEMO${RUN}`);
    await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await toast(s.page, 'Pagamento registrado');
    reached(1);
    // O mesmo demonstrativo não entra duas vezes.
    await visit(s, journey.batchUrl!);
    await s.page.getByRole('button', { name: 'Registrar pagamento' }).click();
    await s.page.getByLabel('Valor pago (R$)').fill('100,00');
    await s.page.getByLabel('Referência do demonstrativo').fill(`DEMO${RUN}`);
    await s.page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(s.page.getByText(/já existe|já foi registrad|duas vezes/iu).first()).toBeVisible({ timeout: 45_000 });
  }
  if ((journey.paymentStage ?? 0) < 2) {
    await allocate();
    reached(2);
  }
  if ((journey.paymentStage ?? 0) < 3) {
    expect(await visit(s, journey.guideUrl!)).toBe(200);
    await s.page.getByRole('button', { name: 'Estornar' }).first().click();
    await s.page.getByRole('textbox').last().fill('Estorno sintético: alocação feita na guia errada no teste');
    await s.page.getByRole('button', { name: 'Confirmar' }).click();
    await toast(s.page, 'Pagamento estornado');
    reached(3);
  }
  if ((journey.paymentStage ?? 0) < 4) {
    await allocate();
    reached(4);
  }
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-11-conciliacao.png`, fullPage: true });
  expectNoPageErrors(s);
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
  expectNoPageErrors(s);
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
  await toast(s.page, 'A clínica não tem conta Asaas ativa; receba no Caixa.');
  if (SHOTS) await s.page.screenshot({ path: `${SHOTS}/cfg-13-coparticipacao.png`, fullPage: true });
  expectNoPageErrors(s);
  await s.context.close();
});
