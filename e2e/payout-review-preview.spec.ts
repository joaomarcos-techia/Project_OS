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
const cardPatientName = `Paciente cartão ${short}`;
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
    // O browser pode levar minutos entre readbacks. Manter a conexão da fixture
    // evita nova resolução DNS do pooler a cada intervalo ocioso; afterAll a fecha.
    idle_timeout: 600,
    max_lifetime: 1800,
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
      insert into patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${randomUUID()}::uuid, ${fixture.clinicA}::uuid, ${cardPatientName},
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
      insert into appointment_state_log
        (clinic_id, appointment_id, from_status, to_status, transitioned_at, actor_type)
      values (${fixture.clinicA}::uuid, ${appointmentId}::uuid,
              'em_atendimento', 'atendido', now(), 'user')
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

/** Aguarda o componente cliente, não apenas o HTML de streaming do servidor. */
async function waitForCaixaHydration(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Caixa', exact: true })).toBeVisible();
  const queue = page.getByRole('region', { name: 'A receber' });
  await expect(queue).toBeVisible();
  // O HTML do servidor já mostra botões e <details> antes de o React anexar
  // seus handlers. Clicar nesse intervalo perde a ação ou fecha o <details>
  // quando a hidratação substitui o nó. A fila é renderizada por CaixaView.
  await expect
    .poll(() =>
      queue.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith('__reactFiber$')),
      ),
    )
    .toBe(true);
}

/** A troca de plano invalida as claims; a rota própria renova o JWT sem novo login. */
async function refreshSession(page: Page, caixaAccess = true): Promise<void> {
  await page.goto('/auth/session-refresh?next=/caixa');
  await expect(page).toHaveURL(/\/caixa(?:\?|$)/u);
  if (caixaAccess) {
    await waitForCaixaHydration(page);
  } else {
    await expect(page.getByText('Seu perfil não tem permissão para o caixa.')).toBeVisible();
  }
}

async function openCaixa(page: Page): Promise<void> {
  const response = await page.goto('/caixa');
  expect(response?.status()).toBe(200);
  await waitForCaixaHydration(page);
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
  const row = receivedRow(page);
  await expect(row).toBeVisible();
  const refundButton = row.getByRole('button', { name: 'Reembolsar' });
  await refundButton.click();
  await expect(refundButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#refund-value')).toBeVisible();
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

  test('6. owner Pro agenda pelo preço único; médico não configura políticas', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const owner = sessions.has('owner') ? pageOf('owner') : await openSession(browser, 'owner');
    await refreshSession(owner);
    await owner.goto('/configuracoes/pagamentos');
    await expect(owner.getByText('Política financeira', { exact: true })).toBeVisible();
    await expect(owner.locator('#price-procedure')).toHaveCount(0);
    await expect(owner.locator('input[name="pricing-policy"]')).toHaveCount(0);
    const doctor = sessions.has('doctor') ? pageOf('doctor') : await openSession(browser, 'doctor');
    await refreshSession(doctor, false);
    await doctor.goto('/configuracoes/pagamentos');
    await expect(
      doctor.getByText('Seu perfil não tem permissão para configurar o recebimento da clínica.'),
    ).toBeVisible();
    await expect(doctor.getByRole('button', { name: 'Salvar base de repasse' })).toHaveCount(0);

    const appointmentDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    const schedulingDurationsMs: number[] = [];
    const scheduleAtStandardPrice = async (name: string, time: string) => {
      await owner.goto('/agenda');
      await owner.getByRole('button', { name: 'Novo atendimento' }).click();
      const drawer = owner.getByRole('dialog', { name: 'Novo atendimento' });
      await drawer.getByPlaceholder('Buscar por nome (mín. 2 letras)').fill(name);
      await drawer.getByRole('option', { name }).click();
      await drawer
        .getByLabel('Procedimento', { exact: true })
        .selectOption({ label: 'Consulta E2E repasse' });
      await drawer
        .getByLabel('Profissional', { exact: true })
        .selectOption({ label: `Dra. Repasse E2E ${short}` });
      await drawer.getByLabel('Data', { exact: true }).fill(appointmentDate);
      await drawer.getByLabel('Hora', { exact: true }).fill(time);
      await expect(drawer.getByLabel('Forma de pagamento e preço')).toHaveCount(0);
      const startedAt = Date.now();
      await drawer.getByRole('button', { name: 'Agendar', exact: true }).click();
      await expect(owner.getByText('Atendimento agendado', { exact: true })).toBeVisible({
        timeout: 60_000,
      });
      schedulingDurationsMs.push(Date.now() - startedAt);
      await expect(drawer).toBeHidden();
    };
    await scheduleAtStandardPrice(patientName, '10:00');
    await scheduleAtStandardPrice(cardPatientName, '11:00');
    evidence.schedulingDurationsMs = schedulingDurationsMs;
    const appointments = await db()<
      { patient_name: string; amount: string; method: string | null }[]
    >`
      select pt.nome patient_name, a.valor::text amount, a.commercial_payment_method method
        from appointments a join patients pt on pt.id = a.patient_id
       where a.clinic_id = ${fixture.clinicA}::uuid and a.created_by = ${fixture.users.owner!}::uuid
       order by pt.nome
    `;
    expect(appointments).toHaveLength(2);
    expect(appointments.map(({ amount, method }) => ({ amount, method }))).toEqual([
      { amount: '150.00', method: null },
      { amount: '150.00', method: null },
    ]);
    evidence.standardPrice = { appointments: appointments.length, gross: '150.00' };
  });

  test('7. cadastro manual não autoriza WhatsApp; consentimentos separados preservam revogação', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const owner = sessions.has('owner') ? pageOf('owner') : await openSession(browser, 'owner');
    const name = `Paciente consentimento ${short}`;
    await owner.goto('/pacientes?novo=1');
    const drawer = owner.getByRole('dialog', { name: 'Novo paciente' });
    await expect(drawer).toBeVisible();
    await drawer.locator('input[name="nome"]').fill(name);
    await drawer.locator('input[name="cpf"]').fill('52998224725');
    await drawer.locator('input[name="email"]').fill(`consent-${short}@example.invalid`);
    await drawer.locator('input[name="telefone"]').fill('11999990000');
    await drawer.getByRole('button', { name: 'Criar paciente' }).click();
    await expect(owner).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
    const patientId = new URL(owner.url()).pathname.split('/').at(-1);
    if (!patientId) throw new Error('Paciente de consentimento não foi criado.');

    const decisions = () => db()<{ purpose: string; granted: boolean; version: number }[]>`
      select distinct on (purpose) purpose::text, granted, version
        from patient_consent_decisions
       where clinic_id = ${fixture.clinicA}::uuid and patient_id = ${patientId}::uuid
         and purpose in ('agendamento_whatsapp', 'cobranca_whatsapp')
       order by purpose, version desc
    `;
    expect(await decisions()).toEqual([]);
    const [outbound] = await db()<{ count: number }[]>`
      select count(*)::int as count
        from outbound_messages o
        join patients p on p.telefone_hash = o.to_number_hash and p.clinic_id = o.clinic_id
       where p.clinic_id = ${fixture.clinicA}::uuid and p.id = ${patientId}::uuid
    `;
    expect(outbound?.count).toBe(0);
    const scheduling = owner.locator('li').filter({ hasText: 'Agendamento por WhatsApp' });
    const billing = owner.locator('li').filter({ hasText: 'Cobrança por WhatsApp' });
    await expect(scheduling.getByText('Não concedido')).toBeVisible();
    await expect(billing.getByText('Não concedido')).toBeVisible();

    // Remover o atributo HTML simula um cliente que ignora a validação visual:
    // a Server Action ainda precisa recusar a concessão sem atestação.
    await scheduling.locator('input[name="optInConfirmed"]').evaluate((checkbox) => {
      checkbox.removeAttribute('required');
      (checkbox as HTMLInputElement).form?.requestSubmit();
    });
    await expect(
      owner.getByText('Confirme que o paciente autorizou mensagens por WhatsApp.'),
    ).toBeVisible();
    expect(await decisions()).toEqual([]);

    await scheduling.getByRole('checkbox').check();
    await scheduling.getByRole('button', { name: 'Registrar consentimento' }).click();
    await expect(scheduling.getByText('Concedido', { exact: true })).toBeVisible();
    expect(await decisions()).toEqual([
      { purpose: 'agendamento_whatsapp', granted: true, version: 1 },
    ]);

    // A segunda aba reteve o estado anterior. Conceder cobrança nela não pode
    // ressuscitar a permissão de agendamento revogada pela primeira aba.
    const stale = await owner.context().newPage();
    await stale.goto(`/pacientes/${patientId}`);
    const staleBilling = stale.locator('li').filter({ hasText: 'Cobrança por WhatsApp' });
    await expect(
      staleBilling.getByRole('button', { name: 'Registrar consentimento' }),
    ).toBeVisible();
    await scheduling.getByRole('button', { name: 'Registrar revogação' }).click();
    await expect(scheduling.getByText('Não concedido')).toBeVisible();
    await staleBilling.getByRole('checkbox').check();
    await staleBilling.getByRole('button', { name: 'Registrar consentimento' }).click();
    await expect(staleBilling.getByText('Concedido', { exact: true })).toBeVisible();
    expect(await decisions()).toEqual([
      { purpose: 'agendamento_whatsapp', granted: false, version: 2 },
      { purpose: 'cobranca_whatsapp', granted: true, version: 1 },
    ]);
    await stale.close();
    evidence.consent = {
      manuallyCreated: true,
      independentPurposes: true,
      staleTabRevocationPreserved: true,
    };
  });

  test('8. regras do mesmo profissional persistem sem travar após retirar preços por meio', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const owner = sessions.has('owner') ? pageOf('owner') : await openSession(browser, 'owner');
    await refreshSession(owner);
    await owner.goto('/configuracoes/pagamentos');
    await expect(owner.locator('a[href="#precos-por-meio"]')).toHaveCount(0);
    await expect(owner.locator('#precos-por-meio')).toHaveCount(0);

    const rules = owner.locator('#regras-de-repasse');
    await expect(rules.getByText('50% da base')).toBeVisible();
    const [eligibleProfile] = await db()<
      { clinic_id: string; role: string; ativo: boolean; deleted_at: string | null }[]
    >`
      select clinic_id::text, role::text, ativo, deleted_at::text
        from profiles where id = ${fixture.users.doctor!}::uuid
    `;
    expect(eligibleProfile).toEqual({
      clinic_id: fixture.clinicA,
      role: 'doctor',
      ativo: true,
      deleted_at: null,
    });
    const scopedEligible = await db().begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('app.current_clinic', ${fixture.clinicA}, true)`;
      await tx`select set_config('app.current_user', ${fixture.users.owner!}, true)`;
      return tx<{ ok: number }[]>`
        select 1 as ok from profiles
         where id = ${fixture.users.doctor!}::uuid
           and clinic_id = ${fixture.clinicA}::uuid
           and deleted_at is null and ativo = true and role <> 'owner'
           and (role = 'doctor' or (crm is not null and btrim(crm) <> ''))
         limit 1
      `;
    });
    expect(scopedEligible).toHaveLength(1);
    await rules.locator('#payout-procedure').selectOption('');
    await rules.locator('#payout-kind').selectOption('fixed');
    await rules.locator('#payout-value').fill('25');
    await rules.getByRole('button', { name: 'Salvar regra' }).click();
    await expect(rules.getByText('R$ 25,00 fixos')).toBeVisible();

    const [procedure] = await db()<{ id: string }[]>`
      select id::text from procedures where clinic_id = ${fixture.clinicA}::uuid
      order by descricao limit 1
    `;
    expect(procedure).toBeTruthy();
    await rules.locator('#payout-procedure').selectOption(procedure!.id);
    await rules.locator('#payout-kind').selectOption('percentage');
    await rules.locator('#payout-value').fill('60');
    await rules.getByRole('button', { name: 'Salvar regra' }).click();
    await expect(rules.getByText('60% da base')).toBeVisible();
    await owner.reload();
    await expect(owner.locator('#regras-de-repasse').getByText('R$ 25,00 fixos')).toBeVisible();
    await expect(owner.locator('#regras-de-repasse').getByText('60% da base')).toBeVisible();

    const active = await db()<
      {
        procedure_id: string | null;
        kind: string;
        percentage: string | null;
        fixed_amount: string | null;
      }[]
    >`
      select procedure_id::text, kind, percentage::text, fixed_amount::text
        from professional_payout_rules
       where clinic_id = ${fixture.clinicA}::uuid
         and professional_id = ${fixture.users.doctor!}::uuid
         and effective_to is null
       order by procedure_id nulls first
    `;
    expect(active).toEqual([
      { procedure_id: null, kind: 'fixed', percentage: null, fixed_amount: '25.00' },
      {
        procedure_id: procedure!.id,
        kind: 'percentage',
        percentage: '60.0000',
        fixed_amount: null,
      },
    ]);
    evidence.multipleRules = { active: active.length, oldPricingAnchorRemoved: true };
  });

  test('9. permissões individuais de dois tipos são salvas juntas ou descartadas', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const owner = sessions.has('owner') ? pageOf('owner') : await openSession(browser, 'owner');
    await refreshSession(owner);
    await owner.goto('/equipe');
    const memberName = `Dra. Repasse E2E ${short}`;
    await owner.getByRole('button', { name: `Ações de ${memberName}` }).click();
    await owner.getByRole('menuitem', { name: 'Permissões individuais' }).click();
    const dialog = owner.getByRole('dialog', { name: `Permissões de ${memberName}` });
    const viewFinancial = dialog.locator(`select[id$="view:financial"]`);
    const operateCaixa = dialog.locator(`select[id$="operate:caixa"]`);
    await viewFinancial.selectOption('grant');
    await operateCaixa.selectOption('deny');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    const readOverrides = () => db()<{ permission_code: string; granted: boolean }[]>`
      select permission_code, granted from user_permission_overrides
       where user_id = ${fixture.users.doctor!}::uuid
         and clinic_id = ${fixture.clinicA}::uuid
         and permission_code in ('view:financial', 'operate:caixa')
       order by permission_code
    `;
    expect(await readOverrides()).toEqual([]);

    await owner.getByRole('button', { name: `Ações de ${memberName}` }).click();
    await owner.getByRole('menuitem', { name: 'Permissões individuais' }).click();
    await viewFinancial.selectOption('grant');
    await operateCaixa.selectOption('deny');
    await dialog.getByRole('button', { name: 'Salvar permissões (2)' }).click();
    await expect(dialog).toBeHidden();
    expect(await readOverrides()).toEqual([
      { permission_code: 'operate:caixa', granted: false },
      { permission_code: 'view:financial', granted: true },
    ]);
    await owner.reload();
    await owner.getByRole('button', { name: `Ações de ${memberName}` }).click();
    await owner.getByRole('menuitem', { name: 'Permissões individuais' }).click();
    await expect(viewFinancial).toHaveValue('grant');
    await expect(operateCaixa).toHaveValue('deny');
    await viewFinancial.selectOption('default');
    await operateCaixa.selectOption('default');
    await dialog.getByRole('button', { name: 'Salvar permissões (2)' }).click();
    await expect(dialog).toBeHidden();
    expect(await readOverrides()).toEqual([]);
    evidence.bulkPermissions = {
      changes: 2,
      cancelledWithoutWrites: true,
      persisted: true,
      revoked: true,
    };
  });

  test('10. proposta de preços em Preview não altera o checkout vigente', async ({ browser }) => {
    const owner = sessions.has('owner') ? pageOf('owner') : await openSession(browser, 'owner');
    await refreshSession(owner);
    await owner.goto('/oferta-preview');
    await expect(
      owner.getByRole('heading', { name: 'Proposta de planos em validação' }),
    ).toBeVisible();
    const count = owner.getByLabel('Médicos que atendem em agenda clínica');
    for (const [professionals, monthly] of [
      ['1', '197'],
      ['2', '397'],
      ['3', '544'],
      ['5', '838'],
    ] as const) {
      await count.fill(professionals);
      await expect(owner.getByText(new RegExp(`R\\$\\s*${monthly},00/mês`, 'u'))).toBeVisible();
    }
    await count.fill('2');
    const staff = owner.getByLabel('Logins de equipe: recepção, gestão e financeiro');
    await staff.fill('2');
    await expect(owner.getByText(/R\$\s*397,00\/mês/u)).toBeVisible();
    await staff.fill('3');
    await expect(owner.getByText(/R\$\s*397,00\/mês/u)).toBeVisible();
    await staff.fill('4');
    await expect(owner.locator('main').getByRole('alert')).toContainText('até 3 logins de equipe');
    await count.fill('1');
    await expect(owner.locator('main').getByRole('alert')).toContainText(
      'Consultório e Clínica incluem até 3',
    );
    await staff.fill('1');
    await count.fill('6');
    await expect(owner.locator('main').getByRole('alert')).toContainText(
      'Informe de 1 a 5 médicos',
    );
    await expect(owner.locator('a[href*="/cadastro"]')).toHaveCount(0);
    evidence.pricingPreview = {
      values: 4,
      consultorioStaffLimitAndClinicaIncluded: true,
      aboveLimitBlocked: true,
      checkoutUntouched: true,
    };
  });

  test('11. relatório mensal mostra revisão ao médico e gestor, isolando perfil e tenant', async ({
    browser,
  }) => {
    const month = saoPauloDate().slice(0, 7);
    const owner = sessions.has('owner') ? pageOf('owner') : await openSession(browser, 'owner');
    await owner.goto(`/relatorios/repasses?mes=${month}`);
    await expect(owner.getByRole('heading', { name: 'Repasses por mês' })).toBeVisible();
    await expect(owner.getByText(PROFILES.doctor.nome)).toBeVisible();
    await expect(owner.getByText(/Revisado · versão 3/u)).toBeVisible();
    await expect(owner.getByText(/Repasse calculado\/revisado: R\$\s?40,00/u)).toBeVisible();

    const doctor = sessions.has('doctor') ? pageOf('doctor') : await openSession(browser, 'doctor');
    await refreshSession(doctor, false);
    await doctor.goto('/relatorios');
    await expect(doctor.getByRole('link', { name: 'Ver repasses por mês' })).toBeVisible();
    await doctor.goto(`/relatorios/repasses?mes=${month}`);
    await expect(doctor.getByText(/Seus atendimentos concluídos/u)).toBeVisible();
    await expect(doctor.getByText(/Repasse calculado\/revisado: R\$\s?40,00/u)).toBeVisible();
    await expect(doctor.getByRole('columnheader', { name: 'Profissional' })).toHaveCount(0);

    const attendant = sessions.has('attendant')
      ? pageOf('attendant')
      : await openSession(browser, 'attendant');
    await refreshSession(attendant);
    await attendant.goto('/relatorios');
    await expect(attendant.getByRole('link', { name: 'Ver repasses por mês' })).toHaveCount(0);
    await attendant.goto(`/relatorios/repasses?mes=${month}`);
    await expect(attendant.getByText('Seu perfil não tem acesso a este relatório.')).toBeVisible();

    const otherTenant = sessions.has('financialB')
      ? pageOf('financialB')
      : await openSession(browser, 'financialB');
    await refreshSession(otherTenant);
    await otherTenant.goto(`/relatorios/repasses?mes=${month}`);
    await expect(
      otherTenant.getByText('Nenhum repasse com consulta concluída neste mês.'),
    ).toBeVisible();
    evidence.monthlyPayout = { scoped: true, reviewedVersion: 3, amount: '40.00' };
  });

  test('12. assinatura da nova oferta mostra cotas e valores de 2 a 5 médicos', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const legacy = fixture.plans.pro;
    if (!legacy) throw new Error('Plano legado da fixture ausente.');
    const [entry] = await db()<
      { plan_id: string; price_id: string; amount: string; doctors: number; staff: number }[]
    >`
      select p.id::text plan_id, pr.id::text price_id, pr.amount::text amount,
             s.doctors, s.staff
        from plans p
        join prices pr on pr.plan_id = p.id
        join plan_seat_limits s on s.plan_id = p.id
       where p.code = 'clinica_2026_2' and p.ativo = true
         and pr.billing_cycle = 'monthly' and pr.active_until is null
         and pr.campaign_code is null
    `;
    if (!entry) throw new Error('Plano Clínica 2026 de entrada ausente no DEV.');
    expect(entry).toMatchObject({ amount: '397.00', doctors: 2, staff: 3 });
    const changed = await db()<{ clinic_id: string }[]>`
      update subscriptions
         set plan_id = ${entry.plan_id}::uuid, price_id = ${entry.price_id}::uuid
       where clinic_id = ${fixture.clinicA}::uuid
         and plan_id = ${legacy.planId}::uuid and price_id = ${legacy.priceId}::uuid
         and billing_status = 'active' and asaas_subscription_id is null
      returning clinic_id::text
    `;
    expect(changed).toHaveLength(1);
    try {
      const owner = sessions.has('owner') ? pageOf('owner') : await openSession(browser, 'owner');
      await refreshSession(owner);
      const response = await owner.goto('/configuracoes/assinatura');
      expect(response?.status()).toBe(200);
      await expect(owner.getByRole('heading', { name: 'Assinatura', exact: true })).toBeVisible();
      for (const [doctors, price] of [
        [2, '397'],
        [3, '544'],
        [4, '691'],
        [5, '838'],
      ] as const) {
        const card = owner
          .locator('main [data-slot="card"]')
          .filter({
            has: owner.getByRole('heading', { name: `Clínica · ${doctors} médicos`, exact: true }),
          })
          .filter({ has: owner.locator('input[name="targetPlanId"]') });
        await expect(card).toHaveCount(1);
        await expect(card).toContainText(new RegExp(`R\\$\\s?${price},00\\s+por mês`, 'u'));
        await expect(card).toContainText(`${doctors} médicos e até 3 pessoas de equipe`);
      }
      await expect(owner.getByRole('button', { name: 'Contratar +1 médico' })).toBeVisible();
      const period = new Date().toISOString().slice(0, 7);
      const usageText = owner.getByText(/de 1000 conversas de referência usadas/u);
      await expect(usageText).toContainText('0 de 1000');
      for (const [count, warning] of [
        [799, null],
        [800, 'Uso da IA próximo da referência mensal'],
        [1000, 'Referência mensal de IA alcançada'],
      ] as const) {
        await db()`
          insert into usage_metrics (clinic_id, period_yyyymm, conversas_ia_count)
          values (${fixture.clinicA}::uuid, ${period}, ${count})
          on conflict (clinic_id, period_yyyymm)
          do update set conversas_ia_count = excluded.conversas_ia_count
        `;
        await owner.reload();
        await expect(usageText).toContainText(`${count} de 1000`);
        if (warning) {
          await expect(owner.getByText(warning, { exact: true })).toBeVisible();
          await expect(
            owner.getByText('A IA continua atendendo. Não há cobrança automática de excedente.'),
          ).toBeVisible();
        } else {
          await expect(owner.getByText('Uso da IA próximo da referência mensal')).toHaveCount(0);
        }
      }
      evidence.extraDoctorsUi = {
        plans: [2, 3, 4, 5],
        aiUsageAt: [799, 800, 1000],
        purchaseNotStarted: true,
      };
    } finally {
      await db()`delete from usage_metrics where clinic_id = ${fixture.clinicA}::uuid`;
      const restored = await db()<{ clinic_id: string }[]>`
        update subscriptions
           set plan_id = ${legacy.planId}::uuid, price_id = ${legacy.priceId}::uuid
         where clinic_id = ${fixture.clinicA}::uuid
           and plan_id = ${entry.plan_id}::uuid and price_id = ${entry.price_id}::uuid
           and asaas_subscription_id is null
        returning clinic_id::text
      `;
      expect(restored).toHaveLength(1);
    }
  });
  test('13. nova Clínica libera os três recursos; Consultório bloqueia UI, PDF e action direta', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const owner = sessions.has('owner') ? pageOf('owner') : await openSession(browser, 'owner');
    const memberName = `Dra. Repasse E2E ${short}`;
    let permissionAction: { url: string; body: string; headers: Record<string, string> } | null =
      null;
    const matrix = [
      ['clinica_2026_2', true],
      ['consultorio_2026', false],
      ['clinica_2026_5', true],
      ['pro', true],
    ] as const;
    for (const [code, allowed] of matrix) {
      const [plan] = await db()<{ plan_id: string; price_id: string }[]>`
        select p.id::text plan_id, pr.id::text price_id from plans p
        join prices pr on pr.plan_id=p.id
        where p.code=${code} and pr.billing_cycle='monthly' and pr.active_until is null
          and pr.campaign_code is null
        order by pr.active_from desc limit 1
      `;
      if (!plan) throw new Error(`Plano da matriz ausente: ${code}`);
      const changed = await db()<{ clinic_id: string }[]>`
        update subscriptions set plan_id=${plan.plan_id}::uuid, price_id=${plan.price_id}::uuid
        where clinic_id=${fixture.clinicA}::uuid and asaas_subscription_id is null
        returning clinic_id::text
      `;
      expect(changed).toHaveLength(1);
      if (code === 'consultorio_2026') {
        if (!permissionAction)
          throw new Error('Action anterior não capturada para a sessão antiga.');
        // Ainda são os cookies da Clínica: antes de qualquer refresh, o epoch
        // precisa rejeitar o POST antigo, sem permitir a mutação.
        const [before] = await db()<{ total: number }[]>`
          select count(*)::int total from audit_events where clinic_id=${fixture.clinicA}::uuid
        `;
        const stale = await owner.request.post(permissionAction.url, {
          headers: permissionAction.headers,
          data: permissionAction.body,
          maxRedirects: 0,
        });
        expect(await stale.text()).toContain('Sua sessão expirou. Entre novamente para continuar.');
        const [after] = await db()<{ total: number }[]>`
          select count(*)::int total from audit_events where clinic_id=${fixture.clinicA}::uuid
        `;
        expect(after).toEqual(before);
      }
      await refreshSession(owner);
      if (code === 'consultorio_2026') {
        await owner.goto('/configuracoes/assinatura');
        await expect(owner.getByRole('button', { name: 'Mudar para Clínica' })).toHaveCount(4);
        await expect(owner.getByRole('button', { name: /Contratar \+/u })).toHaveCount(0);
        await expect(
          owner.getByText(/O Consultório não vende vagas médicas avulsas/u),
        ).toBeVisible();
      }
      await owner.goto('/configuracoes/pagamentos');
      await expect(owner.locator('#regras-de-repasse')).toHaveCount(allowed ? 1 : 0);
      await expect(owner.getByRole('button', { name: 'Salvar base de repasse' })).toHaveCount(
        allowed ? 1 : 0,
      );
      await owner.goto('/relatorios');
      await expect(owner.getByRole('link', { name: 'Exportar PDF' })).toBeVisible();
      await expect(owner.getByRole('link', { name: 'Ver repasses por mês' })).toHaveCount(
        allowed ? 1 : 0,
      );
      const response = await owner.request.get('/relatorios/pdf?periodo=30d');
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/pdf');
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({
        data: new Uint8Array(await response.body()),
        useSystemFonts: true,
      });
      try {
        const pdf = await task.promise;
        const parts: string[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
          const content = await (await pdf.getPage(index)).getTextContent();
          parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        }
        expect(parts.join(' ')).toContain('Ocupação');
        expect(parts.join(' ').includes('Consolidado por profissional')).toBe(allowed);
      } finally {
        await task.destroy();
      }
      await owner.goto('/relatorios/repasses');
      if (allowed) {
        await expect(owner.getByRole('navigation', { name: 'Mês de competência' })).toBeVisible();
      } else {
        await expect(owner.getByText('Disponível no plano Clínica', { exact: true })).toBeVisible();
        await expect(owner.getByRole('navigation', { name: 'Mês de competência' })).toHaveCount(0);
      }
      await owner.goto('/equipe');
      await owner.getByRole('button', { name: `Ações de ${memberName}` }).click();
      await expect(owner.getByRole('menuitem', { name: 'Permissões individuais' })).toHaveCount(
        allowed ? 1 : 0,
      );
      if (code === 'clinica_2026_2') {
        await owner.getByRole('menuitem', { name: 'Permissões individuais' }).click();
        const dialog = owner.getByRole('dialog', { name: `Permissões de ${memberName}` });
        await dialog.locator('select[id$="view:financial"]').selectOption('grant');
        const sent = owner.waitForRequest(
          (request) => request.method() === 'POST' && Boolean(request.headers()['next-action']),
        );
        await dialog.getByRole('button', { name: 'Salvar permissões (1)' }).click();
        const request = await sent;
        const body = request.postData();
        if (!body) throw new Error('Action de permissões sem corpo.');
        const headers = request.headers();
        permissionAction = {
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
        await expect(dialog).toBeHidden();
        const [permission] = await db()<{ granted: boolean; effective: boolean }[]>`
          select o.granted, 'view:financial'=any(v.permissions) effective
          from user_permission_overrides o join effective_permissions_v v on v.user_id=o.user_id
          where o.user_id=${fixture.users.doctor!}::uuid and o.permission_code='view:financial'
        `;
        expect(permission).toEqual({ granted: true, effective: true });
      } else {
        await owner.keyboard.press('Escape');
      }
      if (code === 'consultorio_2026') {
        if (!permissionAction) throw new Error('Action legítima anterior não capturada.');
        const [before] = await db()<{ total: number }[]>`
          select count(*)::int total from audit_events where clinic_id=${fixture.clinicA}::uuid
        `;
        const denied = await owner.request.post(permissionAction.url, {
          headers: permissionAction.headers,
          data: permissionAction.body,
        });
        expect(await denied.text()).toContain('Permissões granulares estão disponíveis');
        const [after] = await db()<{ total: number }[]>`
          select count(*)::int total from audit_events where clinic_id=${fixture.clinicA}::uuid
        `;
        expect(after).toEqual(before);
        const [effective] = await db()<{ granted: boolean }[]>`
          select 'view:financial'=any(permissions) granted from effective_permissions_v
          where user_id=${fixture.users.doctor!}::uuid
        `;
        expect(effective?.granted).toBe(false);
      }
    }
    evidence.featureEntitlements = {
      plans: matrix.map(([code]) => code),
      serverActionDeniedWithoutWrite: true,
      oldSessionRejectedBeforeRefresh: true,
      consultorioRequiresClinicPlanChange: true,
      permissionsEffectiveInDatabase: true,
      pdfAndMonthlyReportGated: true,
      legacyProPreserved: true,
    };
  });
});
