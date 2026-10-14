import { randomUUID } from 'node:crypto';

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import postgres from 'postgres';

import { assertPreviewRuntimeIsDev, DEV_PROJECT_REF } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';
import { assertDevContext } from '../scripts/_env';

/**
 * Revisão humana do repasse suspenso após estorno (camada 4, decisão de
 * 07/10/2026), no Preview com Auth e banco DEV e papéis reais.
 *
 * ===================================================================
 * SOMENTE Preview + DEV. Nunca produção.
 * ===================================================================
 * Cria duas clínicas isoladas (`e2e-payout-review-*`), cinco usuários Auth
 * sintéticos, um atendimento e o lançamento dele; não toca o Asaas. Exige
 * `E2E_PAYOUT_REVIEW_MUTATION=dev`, Database e Auth no projeto DEV e a prova
 * assinada do próprio Preview antes de qualquer escrita.
 *
 * Pagamento e estornos passam pelo Caixa, pelas mesmas actions do operador, e é
 * o estorno que suspende o repasse, na transação dele. Só o snapshot inicial do
 * repasse nasce por INSERT: o Preview não tem worker para o evento de
 * atendimento concluído. O cleanup apaga só esta fixture e relê o resíduo.
 */

const baseUrl = process.env.E2E_BASE_URL;
const mutationOptIn = process.env.E2E_PAYOUT_REVIEW_MUTATION;
const runId = randomUUID();
const short = runId.slice(0, 8);
const SLUG_PREFIX = 'e2e-payout-review-';
const fixturePrefix = `${SLUG_PREFIX}${short}`;
const password = `Qoro${runId.replaceAll('-', '')}Aa1!`;
const patientName = `Paciente revisão ${short}`;
const APPOINTMENT_VALUE = 150;
const REASONS = {
  v1: 'Acordo com a profissional após estorno parcial',
  v2: 'Correção: valor combinado em reunião',
  v3: 'Nova decisão após o segundo estorno',
} as const;

const ROLES = ['owner', 'financial', 'attendant', 'doctor', 'financialB'] as const;
type FixtureRole = (typeof ROLES)[number];
const PROFILES: Record<FixtureRole, { role: string; clinic: 'a' | 'b'; nome: string }> = {
  owner: { role: 'owner', clinic: 'a', nome: 'Dono E2E' },
  financial: { role: 'financial', clinic: 'a', nome: 'Financeiro E2E' },
  attendant: { role: 'attendant', clinic: 'a', nome: 'Atendente E2E' },
  doctor: { role: 'doctor', clinic: 'a', nome: 'Dra. Repasse E2E' },
  financialB: { role: 'financial', clinic: 'b', nome: 'Financeiro E2E outra clínica' },
};

const fixture = {
  clinicA: '',
  clinicB: '',
  users: {} as Partial<Record<FixtureRole, string>>,
  plans: {} as Partial<Record<'solo' | 'clinica' | 'pro', { planId: string; priceId: string }>>,
  lancamentoId: '',
  payoutId: '',
};
const evidence: Record<string, unknown> = { runId: short };
const sessions = new Map<FixtureRole, BrowserContext>();
let sqlClient: ReturnType<typeof postgres> | null = null;
let capturedAction: { url: string; headers: Record<string, string>; body: string } | null = null;
let validatedOrigin = '';

/** Origem do Preview, só depois das guardas e da prova assinada do `beforeAll`. */
function previewOrigin(): string {
  if (!validatedOrigin) throw new Error('Preview ainda não validado.');
  return validatedOrigin;
}

function db(): ReturnType<typeof postgres> {
  if (!sqlClient) throw new Error('Conexão DEV da fixture ausente.');
  return sqlClient;
}

function devConfig(): { databaseUrl: string; supabaseUrl: string; secretKey: string } {
  const { databaseUrl } = assertDevContext();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) throw new Error('A fixture exige Supabase Auth DEV configurado.');
  const databaseRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  const authRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (databaseRef !== DEV_PROJECT_REF || authRef !== DEV_PROJECT_REF) {
    throw new Error('A fixture exige Database e Auth no projeto DEV fixado.');
  }
  return { databaseUrl, supabaseUrl, secretKey };
}

/** Aborta com erro, não skip: este spec escreve no DEV. */
function assertTargets(): string {
  if (mutationOptIn !== 'dev') {
    throw new Error(
      'Exige E2E_PAYOUT_REVIEW_MUTATION=dev: o spec cria clínicas e usuários no DEV.',
    );
  }
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app')) {
    throw new Error('Este spec escreve no DEV e só roda contra Preview Vercel.');
  }
  devConfig();
  return url.origin;
}

function emailFor(role: FixtureRole): string {
  return `${fixturePrefix}-${role.toLowerCase()}@example.invalid`;
}

function saoPauloDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

async function authAdmin(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown) {
  const config = devConfig();
  return fetch(`${config.supabaseUrl}/auth/v1/admin${path}`, {
    method,
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
}

async function createFixture(): Promise<void> {
  const config = devConfig();
  sqlClient = postgres(config.databaseUrl, {
    max: 2,
    ssl: 'require',
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 600,
  });
  const plans = await db()<
    { code: 'solo' | 'clinica' | 'pro'; plan_id: string; price_id: string }[]
  >`
    select distinct on (p.code) p.code, p.id::text plan_id, pr.id::text price_id
      from plans p join prices pr on pr.plan_id = p.id
     where p.code in ('solo', 'clinica', 'pro') and p.ativo = true
       and pr.billing_cycle = 'monthly' and pr.active_until is null
       and pr.campaign_code is null
     order by p.code, pr.active_from desc
  `;
  for (const plan of plans)
    fixture.plans[plan.code] = { planId: plan.plan_id, priceId: plan.price_id };
  const pro = fixture.plans.pro;
  if (!pro || !fixture.plans.solo || !fixture.plans.clinica) {
    throw new Error('Planos Solo, Clínica e Pro mensais vigentes precisam existir no DEV.');
  }

  for (const role of ROLES) {
    const response = await authAdmin('/users', 'POST', {
      email: emailFor(role),
      password,
      email_confirm: true,
    });
    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    if (!response.ok || typeof body?.id !== 'string') {
      throw new Error(`Auth DEV recusou o usuário ${role} (HTTP ${response.status}).`);
    }
    fixture.users[role] = body.id;
  }
  const doctorId = fixture.users.doctor!;

  await db().begin(async (tx) => {
    for (const side of ['a', 'b'] as const) {
      const [clinic] = await tx<{ id: string }[]>`
        insert into clinics (slug, nome, status)
        values (${`${fixturePrefix}-${side}`}, ${`E2E Revisão de repasse ${side.toUpperCase()} ${short}`}, 'active')
        returning id::text
      `;
      if (!clinic) throw new Error('Clínica da fixture não foi criada.');
      if (side === 'a') fixture.clinicA = clinic.id;
      else fixture.clinicB = clinic.id;
      await tx`
        insert into subscriptions
          (clinic_id, plan_id, price_id, billing_status, started_at,
           current_period_start, current_period_end)
        values (${clinic.id}::uuid, ${pro.planId}::uuid, ${pro.priceId}::uuid, 'active', now(),
                now(), now() + interval '1 month')
      `;
    }
    for (const role of ROLES) {
      const profile = PROFILES[role];
      const clinicId = profile.clinic === 'a' ? fixture.clinicA : fixture.clinicB;
      await tx`
        insert into profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
        values (${fixture.users[role]!}::uuid, ${clinicId}::uuid, ${`${profile.nome} ${short}`},
                ${profile.role}::role_enum, true, now())
      `;
    }

    const [procedure] = await tx<{ id: string }[]>`
      insert into procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min)
      values (${fixture.clinicA}::uuid, ${`E2E-RR-${short}`}, 'Consulta E2E repasse',
              ${APPOINTMENT_VALUE}, 30)
      returning id::text
    `;
    await tx`
      insert into clinic_financial_policies (clinic_id, professional_payout_basis)
      values (${fixture.clinicA}::uuid, 'gross')
    `;
    const [version] = await tx<{ id: string }[]>`
      insert into clinic_financial_policy_versions
        (clinic_id, professional_payout_basis, effective_from)
      values (${fixture.clinicA}::uuid, 'gross', now() - interval '1 day')
      returning id::text
    `;
    const [rule] = await tx<{ id: string }[]>`
      insert into professional_payout_rules
        (clinic_id, professional_id, procedure_id, kind, percentage, effective_from)
      values (${fixture.clinicA}::uuid, ${doctorId}::uuid, ${procedure!.id}::uuid,
              'percentage', 50, now() - interval '1 day')
      returning id::text
    `;
    const patientId = randomUUID();
    const appointmentId = randomUUID();
    fixture.lancamentoId = randomUUID();
    await tx`
      insert into patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${patientId}::uuid, ${fixture.clinicA}::uuid, ${patientName},
              'fixture', ${randomUUID().replaceAll('-', '').padEnd(64, '0')})
    `;
    await tx`
      insert into appointments
        (id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
         duration_min, status, valor, snapshot_procedure_name,
         snapshot_procedure_valor, snapshot_procedure_duracao_min,
         snapshot_doctor_nome, created_via)
      values (${appointmentId}::uuid, ${fixture.clinicA}::uuid, ${doctorId}::uuid,
              ${patientId}::uuid, ${procedure!.id}::uuid, now() - interval '2 hours', 30,
              'atendido', ${APPOINTMENT_VALUE}, 'Consulta E2E repasse', ${APPOINTMENT_VALUE},
              30, ${PROFILES.doctor.nome}, 'attendant')
    `;
    await tx`
      insert into lancamentos
        (id, clinic_id, tipo, descricao, valor, valor_pago, status, due_date,
         appointment_id, patient_id, created_via, snapshot_procedure_name, snapshot_doctor_nome)
      values (${fixture.lancamentoId}::uuid, ${fixture.clinicA}::uuid, 'receber',
              'Consulta E2E repasse', ${APPOINTMENT_VALUE}, 0, 'pendente',
              ${saoPauloDate()}::date, ${appointmentId}::uuid, ${patientId}::uuid, 'auto',
              'Consulta E2E repasse', ${PROFILES.doctor.nome})
    `;
    // O snapshot que o handler de atendimento concluído criaria: GROSS 50% de R$ 150.
    const [payout] = await tx<{ id: string }[]>`
      insert into professional_payouts
        (clinic_id, appointment_id, professional_id, procedure_id,
         policy_version_id, rule_id, calculation_basis, rule_kind,
         rule_percentage, gross_amount, basis_amount, payout_amount, status, calculated_at)
      values (${fixture.clinicA}::uuid, ${appointmentId}::uuid, ${doctorId}::uuid,
              ${procedure!.id}::uuid, ${version!.id}::uuid, ${rule!.id}::uuid, 'gross',
              'percentage', 50, ${APPOINTMENT_VALUE}, ${APPOINTMENT_VALUE}, 75, 'calculated', now())
      returning id::text
    `;
    fixture.payoutId = payout!.id;
  });
}

async function cleanupFixture(): Promise<void> {
  const errors: string[] = [];
  const clinicIds = [fixture.clinicA, fixture.clinicB].filter(Boolean);
  if (sqlClient) {
    try {
      await db().begin(async (tx) => {
        for (const clinicId of clinicIds) {
          // Repasses antes da clínica: versão de política e regra são RESTRICT.
          await tx`delete from professional_payouts where clinic_id = ${clinicId}::uuid`;
          await tx`delete from outbox where clinic_id = ${clinicId}::uuid`;
          await tx`delete from audit_events where clinic_id = ${clinicId}::uuid`;
          await tx`delete from clinics where id = ${clinicId}::uuid`;
        }
      });
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message.slice(0, 200) : 'falha ao remover clínicas',
      );
    }
  }
  for (const role of ROLES) {
    const userId = fixture.users[role];
    if (!userId) continue;
    const path = `/users/${encodeURIComponent(userId)}`;
    const removed = await authAdmin(path, 'DELETE');
    const readback = await authAdmin(path, 'GET');
    if ((!removed.ok && removed.status !== 404) || readback.status !== 404) {
      errors.push(
        `Auth cleanup incompleto (${role}: DELETE ${removed.status}, GET ${readback.status})`,
      );
    }
  }
  if (sqlClient) {
    const [named] = await db()<{ clinics: number; users: number }[]>`
      select
        (select count(*)::int from clinics where slug like ${`${fixturePrefix}%`}) clinics,
        (select count(*)::int from auth.users where email like ${`${fixturePrefix}%`}) users
    `;
    const residue = { clinics: named?.clinics ?? -1, users: named?.users ?? -1, rows: 0 };
    for (const clinicId of clinicIds) {
      const [left] = await db()<{ n: number }[]>`
        select (select count(*)::int from professional_payout_reviews where clinic_id = ${clinicId}::uuid)
             + (select count(*)::int from professional_payouts where clinic_id = ${clinicId}::uuid)
             + (select count(*)::int from audit_events where clinic_id = ${clinicId}::uuid)
             + (select count(*)::int from outbox where clinic_id = ${clinicId}::uuid) n
      `;
      residue.rows += left?.n ?? 1;
    }
    evidence.residue = residue;
    if (Object.values(residue).some((count) => count !== 0)) {
      errors.push(`resíduo após cleanup: ${JSON.stringify(residue)}`);
    }
    await db().end({ timeout: 5 });
    sqlClient = null;
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors.map((message) => new Error(message)),
      'Cleanup da revisão de repasse falhou.',
    );
  }
}

async function openSession(browser: Browser, role: FixtureRole): Promise<Page> {
  const context = await browser.newContext({
    baseURL: previewOrigin(),
    extraHTTPHeaders: vercelBypassHeaders(),
  });
  sessions.set(role, context);
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('#email').fill(emailFor(role));
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 90_000 });
  return page;
}

function pageOf(role: FixtureRole): Page {
  const page = sessions.get(role)?.pages()[0];
  if (!page) throw new Error(`Sessão ${role} ausente.`);
  return page;
}

function requestOf(role: FixtureRole): APIRequestContext {
  const context = sessions.get(role);
  if (!context) throw new Error(`Sessão ${role} ausente.`);
  return context.request;
}

async function switchPlan(code: 'solo' | 'clinica' | 'pro'): Promise<void> {
  const plan = fixture.plans[code]!;
  const updated = await db()<{ clinic_id: string }[]>`
    update subscriptions set plan_id = ${plan.planId}::uuid, price_id = ${plan.priceId}::uuid
     where clinic_id = ${fixture.clinicA}::uuid
     returning clinic_id::text
  `;
  expect(updated).toHaveLength(1);
}

/** A troca de plano invalida as claims; a rota própria renova o JWT sem novo login. */
async function refreshSession(page: Page): Promise<void> {
  await page.goto('/auth/session-refresh?next=/caixa');
  await expect(page).toHaveURL(/\/caixa(?:\?|$)/u);
  await page.waitForLoadState('networkidle');
}

async function openCaixa(page: Page): Promise<void> {
  const response = await page.goto('/caixa');
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');
}

function receivedRow(page: Page): Locator {
  return page
    .locator('section[aria-label="Recebidos hoje"]')
    .getByText(patientName, { exact: true })
    .locator('xpath=../..');
}

async function openComposition(page: Page): Promise<Locator> {
  const composition = receivedRow(page).locator('details');
  await expect(composition).toBeVisible();
  if ((await composition.getAttribute('open')) === null) {
    await composition.locator('summary').click();
  }
  await expect(composition).toHaveAttribute('open', '');
  return composition;
}

function valueOf(composition: Locator, label: string): Locator {
  return composition
    .locator('dt')
    .filter({ hasText: label })
    .locator('xpath=following-sibling::dd[1]');
}

async function refundInCaixa(page: Page, amount: string, reason: string): Promise<void> {
  await openCaixa(page);
  await receivedRow(page).getByRole('button', { name: 'Reembolsar' }).click();
  await page.locator('#refund-value').fill(amount);
  await page.locator('#estorno-motivo').fill(reason);
  await page.getByRole('button', { name: 'Confirmar reembolso' }).click();
}

async function submitReview(
  page: Page,
  input: { version: number; amount: string; reason: string },
): Promise<Locator> {
  const composition = await openComposition(page);
  await composition
    .getByRole('button', {
      name: input.version === 1 ? 'Revisar repasse' : 'Registrar nova revisão',
    })
    .click();
  await composition.getByLabel('Valor devido ao profissional').fill(input.amount);
  await composition.getByLabel('Motivo da decisão').fill(input.reason);
  await composition.getByRole('button', { name: `Registrar versão ${input.version}` }).click();
  await expect(
    composition.getByText(new RegExp(`Repasse revisado na versão ${input.version}:`, 'u')),
  ).toBeVisible({ timeout: 30_000 });
  return composition;
}

interface ReviewRow {
  version: number;
  ceiling: string;
  reference: string | null;
  decided: string;
  reason: string;
  refunded: string;
  loss: boolean;
  decided_by: string;
}

async function reviews(clinicId = fixture.clinicA): Promise<ReviewRow[]> {
  return db()<ReviewRow[]>`
    select version, ceiling_amount::text ceiling, reference_amount::text reference,
           decided_amount::text decided, reason, reversal_refunded_amount::text refunded,
           reversal_loss loss, decided_by::text decided_by
      from professional_payout_reviews
     where clinic_id = ${clinicId}::uuid
     order by version
  `;
}

async function payoutState(): Promise<{
  status: string;
  basis: string | null;
  amount: string | null;
}> {
  const [row] = await db()<{ status: string; basis: string | null; amount: string | null }[]>`
    select status, basis_amount::text basis, payout_amount::text amount
      from professional_payouts where id = ${fixture.payoutId}::uuid
  `;
  if (!row) throw new Error('O repasse da fixture sumiu.');
  return row;
}

async function payoutAudits(
  action: string,
): Promise<{ user_id: string | null; before: unknown; after: unknown }[]> {
  return db()<{ user_id: string | null; before: unknown; after: unknown }[]>`
    select user_id::text, before, after from audit_events
     where clinic_id = ${fixture.clinicA}::uuid and action = ${action}
       and resource_id = ${fixture.payoutId}
     order by created_at
  `;
}

async function refundedTotal(): Promise<string> {
  const [row] = await db()<{ total: string }[]>`
    select coalesce(sum(amount), 0)::text total from payment_transactions
     where clinic_id = ${fixture.clinicA}::uuid and lancamento_id = ${fixture.lancamentoId}::uuid
       and kind = 'refund'
  `;
  return row?.total ?? '';
}

/**
 * Reenvia a Server Action capturada na revisão legítima, com a sessão de outro
 * papel e, por padrão, chave de idempotência nova. É o caminho de quem chama a
 * action direto, sem a UI que esconde o formulário.
 */
async function replayAction(
  request: APIRequestContext,
  overrides: { amount?: number; reason?: string; sameKey?: boolean },
): Promise<{ status: number; text: string; message: string | null }> {
  if (!capturedAction) throw new Error('A Server Action da revisão não foi capturada.');
  const parsed: unknown = JSON.parse(capturedAction.body);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[1] !== 'string' ||
    typeof parsed[0] !== 'object' ||
    parsed[0] === null
  ) {
    throw new Error('Formato inesperado do corpo da Server Action.');
  }
  const input = { ...(parsed[0] as Record<string, unknown>) };
  if (input.payoutId !== fixture.payoutId) {
    throw new Error('A action capturada não é a do repasse da fixture.');
  }
  if (overrides.amount !== undefined) input.amount = overrides.amount;
  if (overrides.reason !== undefined) input.reason = overrides.reason;
  const response = await request.fetch(capturedAction.url, {
    method: 'POST',
    headers: capturedAction.headers,
    data: JSON.stringify([input, overrides.sameKey ? parsed[1] : randomUUID()]),
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  const text = await response.text();
  const match = /"message":"((?:[^"\\]|\\.)*)"/u.exec(text);
  return {
    status: response.status(),
    text,
    message: match ? (JSON.parse(`"${match[1]}"`) as string) : null,
  };
}

test.describe.serial('revisão humana do repasse (Preview + DEV, papéis reais)', () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const origin = assertTargets();
    await assertPreviewRuntimeIsDev(origin);
    validatedOrigin = origin;
    await createFixture();
  });

  test.afterAll(async () => {
    test.setTimeout(180_000);
    for (const context of sessions.values()) await context.close().catch(() => undefined);
    try {
      await cleanupFixture();
      evidence.cleanup = 'ok';
    } finally {
      console.log(`[payout-review] evidência ${JSON.stringify(evidence)}`);
    }
  });

  test('1. dono recebe R$ 150 e reembolsa R$ 50 no Caixa; o estorno suspende o repasse', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const page = await openSession(browser, 'owner');
    await openCaixa(page);
    const card = page
      .locator('section[aria-label="A receber"]')
      .locator('div[data-status]')
      .filter({ hasText: patientName });
    await card.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await card.getByRole('button', { name: /^Receber R\$\s?150,00$/u }).click();
    await expect(receivedRow(page)).toBeVisible({ timeout: 30_000 });
    const [receivable] = await db()<{ status: string; paid: string }[]>`
      select status, valor_pago::text paid from lancamentos where id = ${fixture.lancamentoId}::uuid
    `;
    expect(receivable).toEqual({ status: 'pago', paid: '150.00' });
    expect(await payoutState()).toEqual({ status: 'calculated', basis: '150.00', amount: '75.00' });

    await refundInCaixa(page, '50', 'E2E: estorno parcial de R$ 50');
    await expect.poll(refundedTotal, { timeout: 30_000 }).toBe('50.00');
    expect(await payoutState()).toEqual({ status: 'cancelled', basis: null, amount: null });
    const suspensions = await payoutAudits('financial.professional_payout.suspended');
    expect(suspensions).toHaveLength(1);
    expect(suspensions[0]?.before).toMatchObject({ status: 'calculated', payoutAmount: '75.00' });
    expect(suspensions[0]?.after).toEqual({ status: 'cancelled', reason: 'payment_reversed' });

    await openCaixa(page);
    const composition = await openComposition(page);
    await expect(valueOf(composition, 'Repasse profissional')).toHaveText('Suspenso');
    await expect(
      composition.getByText('Revise o valor devido antes de pagar o profissional.'),
    ).toBeVisible();
    await expect(composition.getByRole('button', { name: 'Revisar repasse' })).toBeVisible();
    evidence.suspension = { refunded: '50.00', payout: 'cancelled', audits: suspensions.length };
  });

  test('2. financeiro revisa com teto R$ 75 e referência R$ 50; versão 1 auditada sem o motivo', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const page = await openSession(browser, 'financial');
    await openCaixa(page);
    const composition = await openComposition(page);
    await composition.getByRole('button', { name: 'Revisar repasse' }).click();
    await expect(composition.getByText(/Teto: R\$\s?75,00, o cálculo original\./u)).toBeVisible();
    await expect(
      composition.getByText(
        /Referência proporcional ao valor que ficou com a clínica: R\$\s?50,00 \(não é aplicada sozinha\)\./u,
      ),
    ).toBeVisible();
    const amount = composition.getByLabel('Valor devido ao profissional');
    await amount.fill('80');
    await composition.getByLabel('Motivo da decisão').fill(REASONS.v1);
    await expect(composition.getByText('Valor fora do limite permitido.')).toBeVisible();
    await expect(composition.getByRole('button', { name: 'Registrar versão 1' })).toBeDisabled();

    await amount.fill('60');
    const sent = page.waitForRequest(
      (request) => request.method() === 'POST' && Boolean(request.headers()['next-action']),
    );
    await composition.getByRole('button', { name: 'Registrar versão 1' }).click();
    const request = await sent;
    const body = request.postData();
    if (!body) throw new Error('Server Action da revisão sem corpo capturável.');
    const headers = request.headers();
    capturedAction = {
      url: request.url(),
      body,
      headers: Object.fromEntries(
        [
          'accept',
          'content-type',
          'next-action',
          'next-router-state-tree',
          'next-url',
          'origin',
          'referer',
        ].flatMap((name) => (headers[name] ? [[name, headers[name]]] : [])),
      ),
    };
    await expect(
      composition.getByText(/Repasse revisado na versão 1:\s*R\$\s?60,00\./u),
    ).toBeVisible({ timeout: 30_000 });
    await expect(valueOf(composition, 'Repasse profissional')).toHaveText(/R\$\s?60,00/u);
    await expect(valueOf(composition, 'Valor da base')).toHaveText(/R\$\s?150,00/u);

    expect(await reviews()).toEqual([
      {
        version: 1,
        ceiling: '75.00',
        reference: '50.00',
        decided: '60.00',
        reason: REASONS.v1,
        refunded: '50.00',
        loss: false,
        decided_by: fixture.users.financial,
      },
    ]);
    expect(await payoutState()).toEqual({ status: 'reviewed', basis: '150.00', amount: '60.00' });
    const reviewed = await payoutAudits('financial.professional_payout.reviewed');
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]?.user_id).toBe(fixture.users.financial);
    expect(reviewed[0]?.after).toMatchObject({
      payoutId: fixture.payoutId,
      version: 1,
      decidedAmount: 60,
      ceilingAmount: 75,
      referenceAmount: 50,
    });
    expect(JSON.stringify(reviewed[0])).not.toContain(REASONS.v1);
    const [leak] = await db()<{ n: number }[]>`
      select count(*)::int n from idempotency_keys
       where clinic_id = ${fixture.clinicA}::uuid and response::text like ${`%${REASONS.v1}%`}
    `;
    expect(leak?.n).toBe(0);
    evidence.v1 = { ceiling: '75.00', reference: '50.00', decided: '60.00', audits: 1 };
  });

  test('3. atendente, médico, servidor, outra clínica e mesma chave não gravam versão', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const attendant = await openSession(browser, 'attendant');
    await openCaixa(attendant);
    const composition = await openComposition(attendant);
    await expect(composition.getByText(/Repasse revisado na versão 1:/u)).toBeVisible();
    await expect(
      composition.getByRole('button', { name: /Revisar repasse|Registrar nova revisão/u }),
    ).toHaveCount(0);
    const byAttendant = await replayAction(requestOf('attendant'), { amount: 10 });
    expect(byAttendant.message).toBe('Você não tem permissão para esta ação.');

    const doctor = await openSession(browser, 'doctor');
    await doctor.goto('/caixa');
    await expect(doctor.getByText('Seu perfil não tem permissão para o caixa.')).toBeVisible();
    const byDoctor = await replayAction(requestOf('doctor'), { amount: 10 });
    expect(byDoctor.message).toBe('Você não tem permissão para esta ação.');

    const aboveCeiling = await replayAction(requestOf('financial'), { amount: 80 });
    expect(aboveCeiling.message).toMatch(
      /^O valor revisado não pode passar de R\$\s?75,00, o cálculo original\.$/u,
    );
    const shortReason = await replayAction(requestOf('financial'), { amount: 10, reason: 'ab' });
    expect(shortReason.text).toContain('"ok":false');

    await openSession(browser, 'financialB');
    const crossTenant = await replayAction(requestOf('financialB'), { amount: 10 });
    expect(crossTenant.message).toBe('Repasse não encontrado nesta clínica.');
    const sameKey = await replayAction(requestOf('financialB'), { sameKey: true });
    expect(sameKey.text).toContain('"ok":false');
    expect(sameKey.text).not.toContain('"decidedAmount"');

    expect(await reviews()).toHaveLength(1);
    expect(await reviews(fixture.clinicB)).toHaveLength(0);
    expect(await payoutAudits('financial.professional_payout.reviewed')).toHaveLength(1);
    evidence.negatives = {
      attendant: byAttendant.message,
      doctor: byDoctor.message,
      aboveCeiling: aboveCeiling.message,
      shortReason: shortReason.message,
      crossTenant: crossTenant.message,
      sameKeyOtherClinic: sameKey.message,
    };
  });

  test('4. correção vira versão 2; novo estorno suspende de novo; Clínica revisa e Solo bloqueia', async () => {
    test.setTimeout(300_000);
    const owner = pageOf('owner');
    await openCaixa(owner);
    const ownerComposition = await submitReview(owner, {
      version: 2,
      amount: '55',
      reason: REASONS.v2,
    });
    await expect(
      ownerComposition.getByText(/Repasse revisado na versão 2:\s*R\$\s?55,00\./u),
    ).toBeVisible();
    const afterV2 = await reviews();
    expect(afterV2.map((row) => [row.version, row.decided, row.decided_by])).toEqual([
      [1, '60.00', fixture.users.financial],
      [2, '55.00', fixture.users.owner],
    ]);
    expect(afterV2[0]?.reason).toBe(REASONS.v1);

    // A versão gravada não aceita UPDATE nem pelo papel administrativo.
    await expect(
      db()`
        update professional_payout_reviews set decided_amount = 1
         where payout_id = ${fixture.payoutId}::uuid and version = 1
      `,
    ).rejects.toThrow();
    expect((await reviews())[0]?.decided).toBe('60.00');

    await refundInCaixa(owner, '20', 'E2E: segundo estorno');
    await expect.poll(refundedTotal, { timeout: 30_000 }).toBe('70.00');
    expect(await payoutState()).toEqual({ status: 'cancelled', basis: null, amount: null });
    const suspensions = await payoutAudits('financial.professional_payout.suspended');
    expect(suspensions).toHaveLength(2);
    expect(suspensions[1]?.before).toMatchObject({
      status: 'reviewed',
      payoutAmount: '55.00',
      reviewVersion: 2,
    });
    expect(suspensions[1]?.after).toEqual({
      status: 'cancelled',
      reason: 'payment_reversed_after_review',
    });
    await openCaixa(owner);
    const suspended = await openComposition(owner);
    await expect(valueOf(suspended, 'Repasse profissional')).toHaveText('Suspenso');
    await expect(suspended.getByRole('button', { name: 'Registrar nova revisão' })).toBeVisible();

    // Plano Clínica: o financeiro registra a versão 3; a referência acompanha os R$ 70 estornados.
    await switchPlan('clinica');
    const financial = pageOf('financial');
    await refreshSession(financial);
    const clinicComposition = await openComposition(financial);
    await clinicComposition.getByRole('button', { name: 'Registrar nova revisão' }).click();
    await expect(
      clinicComposition.getByText(
        /Referência proporcional ao valor que ficou com a clínica: R\$\s?40,00/u,
      ),
    ).toBeVisible();
    await clinicComposition.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await submitReview(financial, { version: 3, amount: '40', reason: REASONS.v3 });
    const afterV3 = await reviews();
    expect(afterV3[2]).toEqual({
      version: 3,
      ceiling: '75.00',
      reference: '40.00',
      decided: '40.00',
      reason: REASONS.v3,
      refunded: '70.00',
      loss: false,
      decided_by: fixture.users.financial,
    });
    expect(await payoutState()).toEqual({ status: 'reviewed', basis: '150.00', amount: '40.00' });

    // Plano Solo: sem detalhe avançado nem formulário, e a action recusa.
    await switchPlan('solo');
    await refreshSession(financial);
    const soloComposition = await openComposition(financial);
    await expect(
      soloComposition.locator('dt').filter({ hasText: 'Repasse profissional' }),
    ).toHaveCount(0);
    await expect(
      soloComposition.getByRole('button', { name: /Revisar repasse|Registrar nova revisão/u }),
    ).toHaveCount(0);
    const bySolo = await replayAction(requestOf('financial'), { amount: 10 });
    expect(bySolo.message).toBe('Políticas de repasse estão disponíveis nos planos Clínica e Pro.');
    expect(await reviews()).toHaveLength(3);
    evidence.versions = afterV3.map((row) => ({
      version: row.version,
      decided: row.decided,
      reference: row.reference,
      refunded: row.refunded,
    }));
    evidence.resuspension = suspensions[1]?.after;
    evidence.solo = bySolo.message;
  });

  test('5. sessão encerrada pelo Sair não registra versão', async () => {
    test.setTimeout(180_000);
    await switchPlan('pro');
    const financial = pageOf('financial');
    await refreshSession(financial);
    // Com a sessão viva a action chega ao domínio (o teto recusa, sem gravar).
    const live = await replayAction(requestOf('financial'), { amount: 80 });
    expect(live.message).toMatch(/^O valor revisado não pode passar de R\$\s?75,00/u);

    const saved = await sessions.get('financial')!.storageState();
    await financial
      .locator('form[action="/logout"]')
      .first()
      .evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await expect(financial).toHaveURL(/\/login(?:\?|$)/u, { timeout: 30_000 });

    const stale = await playwrightRequest.newContext({
      baseURL: previewOrigin(),
      extraHTTPHeaders: vercelBypassHeaders(),
      storageState: saved,
    });
    try {
      const revoked = await replayAction(stale, { amount: 10 });
      expect(revoked.message).toBe('Sua sessão expirou. Entre novamente.');
      evidence.revoked = revoked.message;
    } finally {
      await stale.dispose();
    }
    expect(await reviews()).toHaveLength(3);
  });

  test('6. owner Pro salva preços PIX/cartão, ativa a política e desfaz pela UI', async () => {
    test.setTimeout(180_000);
    const owner = pageOf('owner');
    await refreshSession(owner);
    await owner.goto('/configuracoes/pagamentos');
    await expect(owner.getByText('Política financeira', { exact: true })).toBeVisible();
    await expect(owner.locator('#price-procedure option')).toHaveCount(1);

    const savePrice = async (method: 'pix' | 'credit_card', amount: string) => {
      await owner.locator('#price-method').selectOption(method);
      await owner.locator('#price-gross').fill(amount);
      await owner.getByRole('button', { name: 'Salvar preço' }).click();
      await expect(owner.getByText('Preço por método salvo.', { exact: true })).toBeVisible();
      await expect(owner.getByText(`R$ ${amount},00`, { exact: true })).toBeVisible();
    };

    await savePrice('pix', '140');
    await savePrice('credit_card', '160');
    await owner.reload();
    await expect(owner.getByText('R$ 140,00', { exact: true })).toBeVisible();
    await expect(owner.getByText('R$ 160,00', { exact: true })).toBeVisible();
    const configured = await db()<
      { payment_method: string; gross_amount: string; installment_count: number | null }[]
    >`
      select payment_method, gross_amount::text, installment_count
        from procedure_payment_prices
       where clinic_id = ${fixture.clinicA}::uuid and active = true
       order by payment_method
    `;
    expect(configured).toEqual([
      { payment_method: 'credit_card', gross_amount: '160.00', installment_count: 1 },
      { payment_method: 'pix', gross_amount: '140.00', installment_count: null },
    ]);

    await owner.getByText('Preço por meio de pagamento', { exact: true }).click();
    await owner.getByRole('button', { name: 'Salvar política de preço' }).click();
    await expect(owner.getByText('Política de preço salva.', { exact: true })).toBeVisible();
    await owner.reload();
    await expect(
      owner.locator('input[name="pricing-policy"][value="payment_method_pricing"]'),
    ).toBeChecked();

    await owner.getByText('Absorver taxas', { exact: true }).click();
    await owner.getByRole('button', { name: 'Salvar política de preço' }).click();
    await expect(owner.getByText('Política de preço salva.', { exact: true })).toBeVisible();
    await owner.reload();
    await expect(owner.locator('input[name="pricing-policy"][value="absorb_fees"]')).toBeChecked();
    for (let count = 2; count > 0; count--) {
      await expect(owner.getByRole('button', { name: 'Remover', exact: true })).toHaveCount(count);
      await owner.getByRole('button', { name: 'Remover', exact: true }).first().click();
      await expect(owner.getByText('Preço removido.', { exact: true })).toBeVisible();
    }
    await owner.reload();
    await expect(owner.getByRole('button', { name: 'Remover', exact: true })).toHaveCount(0);
    const [state] = await db()<{ mode: string; active_prices: number }[]>`
      select p.mode,
             (select count(*)::int from procedure_payment_prices
               where clinic_id = ${fixture.clinicA}::uuid and active = true) active_prices
        from clinic_payment_pricing_policies p
       where p.clinic_id = ${fixture.clinicA}::uuid
    `;
    expect(state).toEqual({ mode: 'absorb_fees', active_prices: 0 });
    evidence.pricing = { methods: ['pix', 'credit_card'], activated: true, restored: state };
  });
});
