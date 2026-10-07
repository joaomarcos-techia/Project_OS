import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { vercelBypassHeaders } from './vercel-bypass';
import { assertDevContext } from '../scripts/_env';
import { cleanupSandboxFixtureWebhook } from '../src/lib/test/asaas-fixture-webhook-cleanup';

/**
 * Pagamento REAL no Asaas Sandbox chegando a uma conta PAUSADA — runner com
 * humano no circuito. Somente Preview com Auth/banco DEV e a conta Sandbox DA
 * CLÍNICA. Exige opt-in triplo: `E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox`,
 * `E2E_REAL_PAYMENT=human` e `E2E_CHECKOUT_LINK_FILE` (arquivo local onde o
 * link de pagamento é gravado para a pessoa; o link nunca vai ao log).
 *
 * Sequência:
 *  1. Fixture DEV isolada: owner Auth, clínica Pro, política de sinal de 50%,
 *     dois pacientes com CPF sintético válido, dois agendamentos de hoje e um
 *     recebível em aberto para o primeiro. O recebível é da fixture (equivale a
 *     um lançamento manual); concluir o atendimento exigiria prontuário.
 *  2. A UI do Preview conecta a chave Sandbox e registra o webhook real.
 *  3. O caso de uso real `createDepositCharge` cria o Checkout no Sandbox
 *     (via `scripts/e2e-paid-pause-ops.ts`, que o tsx consegue carregar).
 *  4. A UI do Preview pausa a conta; uma nova reserva para o segundo
 *     agendamento não pode criar dívida.
 *  5. HUMANO: abre o link, escolhe Pix e resolve somente o reCAPTCHA. O runner
 *     liquida o Pix pelo endpoint de simulação do Sandbox e espera o webhook
 *     real processado pelo Preview com a conta ainda pausada.
 *  6. Readback: banco DEV × `GET /payments/{id}` × `GET /financialTransactions`.
 *  7. Despachante de outbox restrito à fixture e a eventos de Agenda/Financeiro
 *     (mensageria fica de fora), com replay idempotente.
 *  8. O Caixa do Preview mostra bruto, tarifa e líquido reais da cobrança.
 *  Cleanup: cancela Checkout não pago, remove o webhook da fixture (GET 404),
 *  outbox, auditoria, clínica e usuário Auth (GET 404), com readback zero. A
 *  cobrança paga permanece no Sandbox: não há exclusão de pagamento recebido e
 *  o estorno Pix deste Sandbox termina `REFUSED` (ver spec financeira).
 */

const baseUrl = process.env.E2E_BASE_URL;
const sandboxKey = process.env.ASAAS_CLINIC_SANDBOX_KEY;
const realPayment = process.env.E2E_REAL_PAYMENT === 'human';
const linkFile = process.env.E2E_CHECKOUT_LINK_FILE;
// Parada limpa da espera humana: criar este arquivo encerra o passo 4 e deixa o
// cleanup cancelar o Checkout. Matar o processo pularia o afterAll.
const abortFile = process.env.E2E_PAID_PAUSE_ABORT_FILE ?? null;
const waitMinutes = Number(process.env.E2E_REAL_PAYMENT_WAIT_MIN ?? '45');
const SANDBOX_API = 'https://api-sandbox.asaas.com/v3';
const EXPECTED_DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const APPOINTMENT_VALUE = 20;
const DEPOSIT_VALUE = 10;

// Retomada: a espera humana pode cair por rede. Com o UUID de uma clínica
// `e2e-paid-pause-*` já pausada e com Checkout ativo, os passos 1–3 (comprovados
// na execução original) são pulados e a mesma fixture segue do passo 4.
const resumeClinicId = process.env.E2E_PAID_PAUSE_RESUME_CLINIC ?? null;
const runId = randomUUID();
let clinicSlug = `e2e-paid-pause-${runId.slice(0, 8)}`;
let ownerEmail = `e2e-paid-pause-${runId}@example.invalid`;
let ownerPassword = `Qoro${runId.replaceAll('-', '')}Aa1!`;
let patientAId: string = randomUUID();
const patientBId = randomUUID();
const procedureId = randomUUID();
let appointmentAId: string = randomUUID();
const appointmentBId = randomUUID();
let receivableId: string = randomUUID();
let patientAName = `Paciente pagamento real ${runId.slice(0, 8)}`;

let sql: ReturnType<typeof postgres> | null = null;
let clinicId = '';
let ownerId = '';
let authCookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> | null =
  null;

interface Fixture {
  webhookRef: string;
  apiKeyEncrypted: string;
  webhookTokenEncrypted: string;
  chargeId: string;
  checkoutId: string;
  paymentId: string;
  paymentValue: number;
  paymentNetValue: number | null;
}
const state: Partial<Fixture> = {};
const evidence: Record<string, unknown> = { runId: runId.slice(0, 8) };

interface PaidChargeRow {
  status: string;
  provider_payment_id: string | null;
  provider_gross_amount: string | null;
  provider_fee_amount: string | null;
  provider_net_amount: string | null;
  provider_billing_type: string | null;
  revision: number;
}

type SandboxPayment = {
  id: string;
  status: string;
  value: number;
  netValue?: number | null;
  billingType: string;
  checkoutSession?: string | null;
};

function db(): ReturnType<typeof postgres> {
  if (!sql) throw new Error('Conexão DEV da fixture indisponível.');
  return sql;
}

/** A espera humana deixa a conexão ociosa; reciclar evita socket morto no pooler. */
function openDb(databaseUrl: string): ReturnType<typeof postgres> {
  return postgres(databaseUrl, {
    max: 2,
    ssl: 'require',
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 10 * 60,
    connect_timeout: 30,
  });
}

function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof SandboxHttpError) return error.status === 429 || error.status >= 500;
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'TimeoutError' ||
    error.name === 'AbortError' ||
    /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|Connect Timeout/iu.test(
      `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`,
    )
  );
}

async function withNetworkRetry<T>(operation: () => Promise<T>, budgetMs: number): Promise<T> {
  const deadline = Date.now() + budgetMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientNetworkError(error) || Date.now() >= deadline) throw error;
      evidence.transientRetries = Number(evidence.transientRetries ?? 0) + 1;
      await sleep(Math.min(30_000, 2_000 * 2 ** Math.min(attempt, 4)));
    }
  }
}

function sandboxApiKey(): string {
  if (!sandboxKey?.startsWith('$aact_hmlg_')) {
    throw new Error('ASAAS_CLINIC_SANDBOX_KEY ausente ou não é chave Sandbox.');
  }
  return sandboxKey;
}

function fixtureConfig(): { databaseUrl: string; supabaseUrl: string; secretKey: string } {
  const { databaseUrl } = assertDevContext();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) throw new Error('Auth DEV não configurado.');
  const databaseRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  const authRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (databaseRef !== EXPECTED_DEV_PROJECT_REF || authRef !== EXPECTED_DEV_PROJECT_REF) {
    throw new Error('Fixture exige Database e Auth no projeto DEV fixado.');
  }
  return { databaseUrl, supabaseUrl, secretKey };
}

function assertPreconditions(): void {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app')) {
    throw new Error('O pagamento real só roda contra Preview Vercel.');
  }
  if (process.env.E2E_PAYMENT_ACCOUNT_MUTATION !== 'dev-sandbox') {
    throw new Error('Exige E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox.');
  }
  if (!linkFile) throw new Error('Exige E2E_CHECKOUT_LINK_FILE para entregar o link à pessoa.');
  const asaasBase = process.env.ASAAS_BASE_URL;
  if (!asaasBase || !new URL(asaasBase).hostname.endsWith('sandbox.asaas.com')) {
    throw new Error('ASAAS_BASE_URL do processo não aponta para o Sandbox.');
  }
  if (!Number.isFinite(waitMinutes) || waitMinutes < 5 || waitMinutes > 120) {
    throw new Error('E2E_REAL_PAYMENT_WAIT_MIN deve ficar entre 5 e 120.');
  }
  sandboxApiKey();
  fixtureConfig();
}

async function assertPreviewRuntimeIsDev(): Promise<void> {
  const secret = process.env.MAGIC_TOKEN_SECRET_DEV ?? process.env.MAGIC_TOKEN_SECRET;
  if (!baseUrl || !secret) throw new Error('Prova assinada do runtime Preview indisponível.');
  const timestamp = Date.now();
  const nonce = randomBytes(32).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`POST\n/api/signup/runtime-fingerprint\n${timestamp}\n${nonce}`)
    .digest('hex');
  const response = await fetch(new URL('/api/signup/runtime-fingerprint', baseUrl), {
    method: 'POST',
    headers: {
      ...vercelBypassHeaders(),
      'content-type': 'application/json',
      'x-qoro-e2e-signature': signature,
    },
    body: JSON.stringify({ timestamp, nonce }),
    cache: 'no-store',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Preview recusou a prova do projeto DEV (${response.status}).`);
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    !('environment' in result) ||
    !('authProjectRef' in result) ||
    !('databaseProjectRef' in result) ||
    result.environment !== 'preview' ||
    result.authProjectRef !== EXPECTED_DEV_PROJECT_REF ||
    result.databaseProjectRef !== EXPECTED_DEV_PROJECT_REF
  ) {
    throw new Error('Preview não comprovou Auth e banco no projeto DEV esperado.');
  }
}

class SandboxHttpError extends Error {
  constructor(
    readonly status: number,
    method: string,
  ) {
    super(`Asaas Sandbox ${method} respondeu HTTP ${status}.`);
    this.name = 'SandboxHttpError';
  }
}

async function sandbox<T>(path: string, init?: { method?: 'GET' | 'POST' }): Promise<T> {
  const response = await fetch(`${SANDBOX_API}${path}`, {
    method: init?.method ?? 'GET',
    headers: { access_token: sandboxApiKey(), 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new SandboxHttpError(response.status, init?.method ?? 'GET');
  return body as T;
}

/** Leitura idempotente: repetir após falha de rede não altera o provedor. */
function sandboxGet<T>(path: string, budgetMs = 5 * 60_000): Promise<T> {
  return withNetworkRetry(() => sandbox<T>(path), budgetMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function syntheticCpf(): string {
  const checkDigit = (digits: number[]): number => {
    let sum = 0;
    for (let index = 0; index < digits.length; index++) {
      sum += digits[index]! * (digits.length + 1 - index);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  for (;;) {
    const base = Array.from(randomBytes(9), (byte) => byte % 10);
    if (new Set(base).size === 1) continue;
    const first = checkDigit(base);
    const second = checkDigit([...base, first]);
    return [...base, first, second].join('');
  }
}

/** Data civil de hoje na conta Asaas (America/Sao_Paulo), `YYYY-MM-DD`. */
function saoPauloDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

async function createFixture(): Promise<void> {
  const config = fixtureConfig();
  sql = openDb(config.databaseUrl);
  const { encryptForTenant, hashForLookup, validateCpf } = await import('../src/lib/crypto');
  const [catalog] = await db()<{ plan_id: string; price_id: string }[]>`
    select p.id::text plan_id, pr.id::text price_id
      from plans p join prices pr on pr.plan_id = p.id
     where p.code = 'pro' and p.ativo = true and pr.billing_cycle = 'monthly'
       and pr.active_until is null and pr.campaign_code is null
     order by pr.active_from desc limit 1
  `;
  if (!catalog) throw new Error('Plano Pro mensal vigente ausente no DEV.');

  const created = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword, email_confirm: true }),
  });
  const createdBody = (await created.json().catch(() => null)) as { id?: unknown } | null;
  if (!created.ok || typeof createdBody?.id !== 'string') {
    throw new Error(`Auth DEV recusou a fixture (HTTP ${created.status}).`);
  }
  ownerId = createdBody.id;

  const [clinic] = await db()<{ id: string }[]>`
    insert into clinics (slug, nome, status, timezone)
    values (${clinicSlug}, ${`E2E Pagamento Real ${runId.slice(0, 8)}`}, 'active',
            'America/Sao_Paulo')
    returning id::text
  `;
  if (!clinic) throw new Error('Clínica da fixture não foi criada.');
  clinicId = clinic.id;

  const cpfA = syntheticCpf();
  const cpfB = syntheticCpf();
  if (!validateCpf(cpfA) || !validateCpf(cpfB)) throw new Error('CPF sintético inválido.');
  const [encryptedA, encryptedB, hashA, hashB] = await Promise.all([
    encryptForTenant(clinicId, cpfA),
    encryptForTenant(clinicId, cpfB),
    hashForLookup(cpfA),
    hashForLookup(cpfB),
  ]);

  await db().begin(async (tx) => {
    await tx`
      insert into subscriptions
        (clinic_id, plan_id, price_id, billing_status, started_at,
         current_period_start, current_period_end)
      values (${clinicId}::uuid, ${catalog.plan_id}::uuid, ${catalog.price_id}::uuid,
              'active', now(), now(), now() + interval '1 month')
    `;
    await tx`
      insert into profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
      values (${ownerId}::uuid, ${clinicId}::uuid, ${`Owner pagamento real ${runId.slice(0, 8)}`},
              'owner'::role_enum, true, now())
    `;
    await tx`
      insert into procedures (id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min)
      values (${procedureId}::uuid, ${clinicId}::uuid, ${`PAID-${runId.slice(0, 8)}`},
              'Consulta E2E pagamento real', ${APPOINTMENT_VALUE}, 30)
    `;
    await tx`
      insert into patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${patientAId}::uuid, ${clinicId}::uuid, ${patientAName}, ${encryptedA}, ${hashA}),
             (${patientBId}::uuid, ${clinicId}::uuid,
              ${`Paciente sem nova cobrança ${runId.slice(0, 8)}`}, ${encryptedB}, ${hashB})
    `;
    await tx`
      insert into clinic_deposit_policy
        (clinic_id, enabled, percent, cancellation_window_hours,
         applies_to_first_visit, applies_to_return, updated_by)
      values (${clinicId}::uuid, true, 50, 24, true, true, ${ownerId}::uuid)
    `;
    for (const [appointmentId, patientId, hours] of [
      [appointmentAId, patientAId, 3],
      [appointmentBId, patientBId, 4],
    ] as const) {
      await tx`
        insert into appointments
          (id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
           duration_min, status, valor, snapshot_procedure_name,
           snapshot_procedure_valor, snapshot_procedure_duracao_min,
           snapshot_doctor_nome, created_via)
        values (${appointmentId}::uuid, ${clinicId}::uuid, ${ownerId}::uuid,
                ${patientId}::uuid, ${procedureId}::uuid,
                now() + make_interval(hours => ${hours}::int), 30, 'agendado',
                ${APPOINTMENT_VALUE}, 'Consulta E2E pagamento real', ${APPOINTMENT_VALUE}, 30,
                'Profissional E2E', 'attendant')
      `;
    }
    await tx`
      insert into lancamentos
        (id, clinic_id, tipo, descricao, valor, valor_pago, status, due_date,
         appointment_id, patient_id, created_via)
      values (${receivableId}::uuid, ${clinicId}::uuid, 'receber',
              'Consulta E2E pagamento real', ${APPOINTMENT_VALUE}, 0, 'pendente',
              ${saoPauloDate()}::date, ${appointmentAId}::uuid, ${patientAId}::uuid, 'manual')
    `;
  });
}

/** Retoma uma fixture preservada no estado comprovado ao fim do passo 3. */
async function loadFixture(resumeId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/iu.test(resumeId))
    throw new Error('E2E_PAID_PAUSE_RESUME_CLINIC inválido.');
  const config = fixtureConfig();
  sql = openDb(config.databaseUrl);
  const [clinic] = await db()<{ id: string; slug: string }[]>`
    select id::text, slug from clinics where id = ${resumeId}::uuid
  `;
  if (!clinic?.slug.startsWith('e2e-paid-pause-')) {
    throw new Error('A retomada exige uma clínica da fixture e2e-paid-pause.');
  }
  clinicId = clinic.id;
  clinicSlug = clinic.slug;
  evidence.runId = clinicSlug.slice('e2e-paid-pause-'.length);
  evidence.resumed = true;

  const [owner] = await db()<{ id: string; email: string }[]>`
    select p.id::text, u.email from profiles p join auth.users u on u.id = p.id
     where p.clinic_id = ${clinicId}::uuid and p.role = 'owner'
     order by p.created_at limit 1
  `;
  if (!owner || !/^e2e-paid-pause-[0-9a-f-]{36}@example\.invalid$/u.test(owner.email)) {
    throw new Error('Owner sintético da fixture ausente.');
  }
  ownerId = owner.id;
  ownerEmail = owner.email;
  // A senha original vivia só na memória do processo interrompido. A nova,
  // aleatória, vale apenas para este usuário sintético e some com ele no cleanup.
  ownerPassword = `Qoro${randomUUID().replaceAll('-', '')}Aa1!`;
  const reset = await fetch(
    `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(ownerId)}`,
    {
      method: 'PUT',
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password: ownerPassword }),
    },
  );
  if (!reset.ok)
    throw new Error(`Auth DEV recusou a senha nova da fixture (HTTP ${reset.status}).`);

  const [charge] = await db()<
    {
      id: string;
      appointment_id: string;
      patient_id: string;
      status: string;
      provider_checkout_id: string | null;
      generation_status: string | null;
    }[]
  >`
    select c.id::text, c.appointment_id::text, c.patient_id::text, c.status::text,
           c.provider_checkout_id, g.status::text generation_status
      from patient_charges c
      left join patient_checkout_generations g on g.patient_charge_id = c.id
     where c.clinic_id = ${clinicId}::uuid and c.kind = 'deposit'
     order by c.created_at limit 1
  `;
  if (
    !charge?.provider_checkout_id ||
    charge.status !== 'pending' ||
    charge.generation_status !== 'active'
  ) {
    throw new Error('A retomada exige a cobrança do sinal pendente com Checkout ativo.');
  }
  appointmentAId = charge.appointment_id;
  patientAId = charge.patient_id;
  state.chargeId = charge.id;
  state.checkoutId = charge.provider_checkout_id;
  const [patient] = await db()<{ nome: string }[]>`
    select nome from patients where id = ${patientAId}::uuid and clinic_id = ${clinicId}::uuid
  `;
  const [receivable] = await db()<{ id: string }[]>`
    select id::text from lancamentos
     where clinic_id = ${clinicId}::uuid and appointment_id = ${appointmentAId}::uuid
       and tipo = 'receber'
  `;
  if (!patient || !receivable) throw new Error('Paciente ou recebível da fixture ausente.');
  patientAName = patient.nome;
  receivableId = receivable.id;

  const account = await readAccount();
  if (!account.active || account.accept_new_charges) {
    throw new Error('A retomada exige a conta da fixture pausada.');
  }
  if (!account.api_key_encrypted || !account.webhook_token_encrypted) {
    throw new Error('Conta pausada da fixture sem segredos cifrados.');
  }
  state.webhookRef = account.webhook_ref;
  state.apiKeyEncrypted = account.api_key_encrypted;
  state.webhookTokenEncrypted = account.webhook_token_encrypted;
  if (!(await fixtureWebhookEnabled(account.webhook_ref))) {
    throw new Error('Webhook da fixture não está habilitado no Sandbox.');
  }
}

async function cleanupFixture(): Promise<void> {
  const errors: string[] = [];
  const config = fixtureConfig();
  if (sql && clinicId) {
    const [account] = await withNetworkRetry(
      () => db()<{ webhook_ref: string }[]>`
        select webhook_ref::text from clinic_payment_accounts where clinic_id = ${clinicId}::uuid
      `,
      60_000,
    );
    const [charge] = await withNetworkRetry(
      () => db()<{ status: string; provider_checkout_id: string | null }[]>`
        select status::text, provider_checkout_id from patient_charges
         where clinic_id = ${clinicId}::uuid and appointment_id = ${appointmentAId}::uuid
      `,
      60_000,
    );
    // Externo primeiro: Checkout não pago não pode continuar pagável depois da fixture.
    if (charge?.provider_checkout_id && charge.status !== 'paid' && !state.paymentId) {
      try {
        const cancelled = await sandbox<{ id?: string; status?: string }>(
          `/checkouts/${encodeURIComponent(charge.provider_checkout_id)}/cancel`,
          { method: 'POST' },
        );
        if (cancelled.id !== charge.provider_checkout_id || cancelled.status !== 'CANCELED') {
          errors.push('Checkout não pago sem confirmação CANCELED');
        }
      } catch (error) {
        errors.push(`Checkout: ${error instanceof Error ? error.message : 'falha'}`);
      }
    }
    if (account?.webhook_ref && baseUrl) {
      try {
        evidence.cleanupWebhooksRemoved = await cleanupSandboxFixtureWebhook({
          apiKey: sandboxApiKey(),
          webhookRef: account.webhook_ref,
          previewUrl: baseUrl,
        });
      } catch (error) {
        // Preserva a fixture: apagar a clínica deixaria webhook apontando para ref inexistente.
        throw new Error(
          `Webhook da fixture não removido; fixture preservada: ${
            error instanceof Error ? error.message : 'falha'
          }`,
        );
      }
    }
    try {
      await withNetworkRetry(async () => {
        await db()`delete from outbox where clinic_id = ${clinicId}::uuid`;
        await db()`delete from audit_events where clinic_id = ${clinicId}::uuid`;
        await db()`delete from clinics where id = ${clinicId}::uuid`;
      }, 60_000);
    } catch (error) {
      errors.push(`banco: ${error instanceof Error ? error.message.slice(0, 160) : 'falha'}`);
    }
  }
  if (ownerId) {
    const url = `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(ownerId)}`;
    const headers = { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` };
    const removed = await fetch(url, { method: 'DELETE', headers });
    const readback = await fetch(url, { headers });
    if ((!removed.ok && removed.status !== 404) || readback.status !== 404) {
      errors.push(`Auth (DELETE ${removed.status}, GET ${readback.status})`);
    }
  }
  if (sql) {
    const [residue] = await db()<Record<string, number>[]>`
      select
        (select count(*)::int from clinics where slug = ${clinicSlug}) clinics,
        (select count(*)::int from outbox where clinic_id = ${clinicId || null}::uuid) outbox,
        (select count(*)::int from audit_events where clinic_id = ${clinicId || null}::uuid) audit,
        (select count(*)::int from profiles where id = ${ownerId || null}::uuid) profiles
    `;
    const leftovers = Object.entries(residue ?? {}).filter(([, count]) => count !== 0);
    if (!residue || leftovers.length > 0) {
      errors.push(`resíduo ${leftovers.map(([name, count]) => `${name}=${count}`).join(', ')}`);
    }
    await db().end({ timeout: 5 });
    sql = null;
  }
  if (errors.length > 0) throw new Error(`Cleanup incompleto: ${errors.join('; ')}`);
}

async function signIn(page: Page): Promise<void> {
  if (authCookies) {
    await page.context().addCookies(authCookies);
    await page.goto('/dashboard');
    if (/\/dashboard(?:\?|$)/u.test(page.url())) return;
  }
  await page.goto('/login');
  await page.locator('#email').fill(ownerEmail);
  await page.locator('input[name="password"]').fill(ownerPassword);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 90_000 });
  authCookies = await page.context().cookies();
}

async function readAccount(): Promise<{
  active: boolean;
  accept_new_charges: boolean;
  webhook_ref: string;
  api_key_encrypted: string | null;
  webhook_token_encrypted: string | null;
  webhook_configured: boolean;
}> {
  const [account] = await db()<
    {
      active: boolean;
      accept_new_charges: boolean;
      webhook_ref: string;
      api_key_encrypted: string | null;
      webhook_token_encrypted: string | null;
      webhook_configured: boolean;
    }[]
  >`
    select active, accept_new_charges, webhook_ref::text, api_key_encrypted,
           webhook_token_encrypted, webhook_configured_at is not null webhook_configured
      from clinic_payment_accounts where clinic_id = ${clinicId}::uuid
  `;
  if (!account) throw new Error('Conta de pagamento da fixture ausente.');
  return account;
}

async function fixtureWebhookEnabled(webhookRef: string): Promise<boolean> {
  const list = await sandboxGet<{ data?: Array<{ url?: string; enabled?: boolean }> }>(
    '/webhooks?offset=0&limit=100',
  );
  const expectedPath = `/api/webhooks/asaas/patient/${webhookRef}`;
  const matches = (list.data ?? []).filter((item) => {
    try {
      return new URL(item.url ?? '').pathname === expectedPath;
    } catch {
      return false;
    }
  });
  expect(matches, 'o webhook da fixture deve existir exatamente uma vez').toHaveLength(1);
  // Só o hostname: a query do webhook carrega o bypass da Vercel e nunca vai ao log.
  try {
    evidence.webhookHost = new URL(matches[0]?.url ?? '').hostname;
    evidence.webhookHostIsTestedPreview =
      Boolean(baseUrl) && evidence.webhookHost === new URL(baseUrl!).hostname;
  } catch {
    evidence.webhookHost = 'unparseable';
  }
  return matches[0]?.enabled === true;
}

async function crossTenantSnapshot(): Promise<Record<string, number>> {
  const [row] = await db()<Record<string, number>[]>`
    select
      (select count(*)::int from patient_charges where clinic_id <> ${clinicId}::uuid) charges,
      (select count(*)::int from patient_credits where clinic_id <> ${clinicId}::uuid) credits,
      (select count(*)::int from patient_webhook_events where clinic_id <> ${clinicId}::uuid) events
  `;
  return row ?? {};
}

/**
 * Caso de uso e despachante rodam em `scripts/e2e-paid-pause-ops.ts` via tsx:
 * o carregador ESM do Playwright não resolve os imports `next/*` dessa cadeia.
 * O processo herda o ambiente DEV/Sandbox deste runner.
 */
function runOps(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/e2e-paid-pause-ops.ts', ...args],
      { env: { ...process.env, NODE_OPTIONS: '--conditions=react-server' }, stdio: 'pipe' },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const timer = setTimeout(() => child.kill(), 180_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('OPS_RESULT '));
      if (code !== 0 || !line) {
        reject(new Error(`ops ${args[0]} saiu com ${code}: ${stderr.trim().slice(0, 240)}`));
        return;
      }
      resolve(JSON.parse(line.slice('OPS_RESULT '.length)) as Record<string, unknown>);
    });
  });
}

test.describe.serial('pagamento real em conta pausada (Preview + Sandbox, humano)', () => {
  test.skip(!realPayment, 'Runner com humano no circuito: exige E2E_REAL_PAYMENT=human.');

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    assertPreconditions();
    await assertPreviewRuntimeIsDev();
    if (resumeClinicId) await loadFixture(resumeClinicId);
    else await createFixture();
  });

  test.afterAll(async () => {
    test.setTimeout(240_000);
    try {
      await cleanupFixture();
    } finally {
      console.log(`[paid-pause] evidência ${JSON.stringify(evidence)}`);
    }
  });

  test('1. conecta a conta Sandbox pela UI e a chave cifrada pelo Preview é legível aqui', async ({
    page,
  }) => {
    test.skip(Boolean(resumeClinicId), 'Comprovado na execução original desta fixture.');
    test.setTimeout(240_000);
    await signIn(page);
    await page.goto('/configuracoes/pagamentos');
    await expect(page.getByText(/Nenhuma conta conectada/)).toBeVisible();
    await page.locator('#asaas-api-key').fill(sandboxApiKey());
    await page.getByRole('button', { name: 'Conectar conta' }).click();
    await expect(page.getByText('Conectada', { exact: true })).toBeVisible({ timeout: 90_000 });
    expect(await page.content(), 'a chave apareceu no HTML').not.toContain(sandboxApiKey());

    const account = await readAccount();
    expect(account).toMatchObject({
      active: true,
      accept_new_charges: true,
      webhook_configured: true,
    });
    if (!account.api_key_encrypted || !account.webhook_token_encrypted) {
      throw new Error('Conta conectada sem segredos cifrados.');
    }
    state.webhookRef = account.webhook_ref;
    state.apiKeyEncrypted = account.api_key_encrypted;
    state.webhookTokenEncrypted = account.webhook_token_encrypted;
    expect(await fixtureWebhookEnabled(account.webhook_ref)).toBe(true);

    // O Checkout nasce neste processo (o Preview não roda cron nem worker por
    // clínica). Sem a mesma chave mestra, ele não leria a credencial do Preview.
    const { decryptForTenant } = await import('../src/lib/crypto');
    const sameKey = (await decryptForTenant(clinicId, account.api_key_encrypted)) === sandboxKey;
    if (!sameKey) {
      throw new Error(
        'BLOCKED: a chave mestra local não decifra a credencial gravada pelo Preview.',
      );
    }
    evidence.connect = { webhookEnabled: true, localDecryptMatchesPreview: true };
  });

  test('2. caso de uso real cria o Checkout do sinal no Sandbox enquanto a conta aceita cobranças', async () => {
    test.skip(Boolean(resumeClinicId), 'Comprovado na execução original desta fixture.');
    test.setTimeout(240_000);
    await runOps(['create-deposit', `--clinic=${clinicId}`, `--appointment=${appointmentAId}`]);
    const [charge] = await db()<
      {
        id: string;
        status: string;
        amount: string;
        provider_checkout_id: string | null;
        checkout_url: string | null;
        generation_status: string | null;
      }[]
    >`
      select c.id::text, c.status::text, c.amount::text, c.provider_checkout_id,
             c.invoice_url checkout_url, g.status::text generation_status
        from patient_charges c
        left join patient_checkout_generations g on g.patient_charge_id = c.id
       where c.clinic_id = ${clinicId}::uuid and c.appointment_id = ${appointmentAId}::uuid
    `;
    expect(charge, 'o caso de uso não criou a cobrança do sinal').toBeTruthy();
    expect(charge).toMatchObject({ status: 'pending', generation_status: 'active' });
    expect(Number(charge!.amount)).toBe(DEPOSIT_VALUE);
    if (!charge!.provider_checkout_id || !charge!.checkout_url) {
      throw new Error('Checkout sem ID ou link persistido.');
    }
    state.chargeId = charge!.id;
    state.checkoutId = charge!.provider_checkout_id;
    evidence.checkout = { amount: DEPOSIT_VALUE, generation: 'active' };
  });

  test('3. pausa pela UI: credencial e webhook ficam, nova reserva não cria dívida', async ({
    page,
  }) => {
    test.skip(Boolean(resumeClinicId), 'Comprovado na execução original desta fixture.');
    test.setTimeout(240_000);
    await signIn(page);
    await page.goto('/configuracoes/pagamentos');
    await page.getByRole('button', { name: 'Pausar ou desconectar' }).click();
    await expect(page.getByText('Pausada', { exact: true })).toBeVisible({ timeout: 60_000 });
    const account = await readAccount();
    expect(account).toMatchObject({ active: true, accept_new_charges: false });
    expect(account.api_key_encrypted === state.apiKeyEncrypted).toBe(true);
    expect(account.webhook_token_encrypted === state.webhookTokenEncrypted).toBe(true);
    expect(await fixtureWebhookEnabled(state.webhookRef!)).toBe(true);

    await runOps(['create-deposit', `--clinic=${clinicId}`, `--appointment=${appointmentBId}`]);
    const [blocked] = await db()<{ charges: number }[]>`
      select count(*)::int charges from patient_charges
       where clinic_id = ${clinicId}::uuid and appointment_id = ${appointmentBId}::uuid
    `;
    expect(blocked?.charges, 'conta pausada criou cobrança nova').toBe(0);
    evidence.pause = { newChargeAfterPause: 0, credentialPreserved: true, webhookEnabled: true };
  });

  test('4. pessoa paga o Checkout antigo; webhook real chega com a conta pausada', async () => {
    test.setTimeout((waitMinutes + 15) * 60_000);
    const [charge] = await db()<{ invoice_url: string | null }[]>`
      select invoice_url from patient_charges where id = ${state.chargeId!}::uuid
    `;
    if (!charge?.invoice_url) throw new Error('Link do Checkout ausente.');
    await writeFile(linkFile!, `${charge.invoice_url}\n`, 'utf8');
    const before = await crossTenantSnapshot();
    console.log(
      '[paid-pause] AÇÃO HUMANA: abra o link gravado em E2E_CHECKOUT_LINK_FILE, escolha Pix, ' +
        'clique em "Pagar com pix" e conclua somente o reCAPTCHA.',
    );

    const deadline = Date.now() + waitMinutes * 60_000;
    let payment: SandboxPayment | null = null;
    while (!payment && Date.now() < deadline) {
      if (abortFile && existsSync(abortFile)) {
        throw new Error('BLOCKED: espera humana encerrada pelo operador.');
      }
      const query = new URLSearchParams({
        checkoutSession: state.checkoutId!,
        limit: '10',
        offset: '0',
      });
      const list = await sandboxGet<{ data?: SandboxPayment[] }>(
        `/payments?${query.toString()}`,
        Math.max(60_000, deadline - Date.now()),
      );
      payment = list.data?.find((item) => item.checkoutSession === state.checkoutId) ?? null;
      if (!payment) await sleep(10_000);
    }
    if (!payment) throw new Error('BLOCKED: nenhum pagamento humano dentro da janela.');
    expect((await readAccount()).accept_new_charges, 'a conta deixou de estar pausada').toBe(false);

    const paymentPath = `/payments/${encodeURIComponent(payment.id)}`;
    const isSettled = (status: string) => ['RECEIVED', 'CONFIRMED'].includes(status);
    if (payment.billingType === 'PIX' && payment.status === 'PENDING') {
      // POST não é repetido às cegas: após falha de rede, a releitura decide.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await sandbox(`/sandbox/payment/${encodeURIComponent(payment.id)}/confirm`, {
            method: 'POST',
          });
          break;
        } catch (error) {
          if (!isTransientNetworkError(error)) throw error;
          const current = await sandboxGet<SandboxPayment>(paymentPath);
          if (isSettled(current.status)) break;
          await sleep(5_000);
        }
      }
    }
    let settled: SandboxPayment | null = null;
    for (let attempt = 0; attempt < 30 && !settled; attempt++) {
      const current = await sandboxGet<SandboxPayment>(paymentPath);
      if (isSettled(current.status)) settled = current;
      else await sleep(5_000);
    }
    if (!settled) throw new Error('O Sandbox não liquidou o pagamento humano.');
    state.paymentId = settled.id;
    state.paymentValue = settled.value;
    state.paymentNetValue = settled.netValue ?? null;
    expect(settled.checkoutSession).toBe(state.checkoutId);
    expect(settled.value).toBe(DEPOSIT_VALUE);

    let paid: PaidChargeRow | null = null;
    const processedBy = Date.now() + 10 * 60_000;
    while (Date.now() < processedBy) {
      const [row] = await db()<PaidChargeRow[]>`
        select status::text, provider_payment_id, provider_gross_amount::text,
               provider_fee_amount::text, provider_net_amount::text, provider_billing_type,
               provider_economics_revision revision
          from patient_charges where id = ${state.chargeId!}::uuid
      `;
      if (row?.status === 'paid') {
        paid = row;
        break;
      }
      await sleep(5_000);
    }
    if (!paid) throw new Error('O webhook real não marcou a cobrança como paga no DEV.');
    // Forense antes das asserções: o cleanup apaga a fixture mesmo se algo falhar.
    evidence.paidRow = paid;
    evidence.webhookEventsAtPaid = (
      await db()<{ event_type: string; processed_at: string }[]>`
        select event_type, processed_at::text from patient_webhook_events
         where clinic_id = ${clinicId}::uuid order by processed_at
      `
    ).map((row) => `${row.event_type}@${row.processed_at}`);
    evidence.outboxAtPaid = await db()<
      { event_type: string; status: string; has_gross: boolean; gross: string | null }[]
    >`
      select event_type, status, payload ? 'providerGrossAmount' has_gross,
             payload->>'providerGrossAmount' gross
        from outbox where clinic_id = ${clinicId}::uuid order by created_at
    `;
    const account = await readAccount();
    expect(account, 'a conta mudou durante a conciliação').toMatchObject({
      active: true,
      accept_new_charges: false,
    });
    expect(paid.provider_payment_id).toBe(settled.id);
    expect(Number(paid.provider_gross_amount)).toBe(settled.value);
    expect(paid.provider_billing_type).toBe(settled.billingType);
    if (settled.netValue != null) {
      expect(Number(paid.provider_net_amount)).toBe(settled.netValue);
      expect(Number(paid.provider_fee_amount)).toBe(
        Math.round((settled.value - settled.netValue) * 100) / 100,
      );
      expect(paid.revision).toBe(1);
    }

    const events = await db()<{ event_type: string }[]>`
      select event_type from patient_webhook_events
       where clinic_id = ${clinicId}::uuid order by processed_at
    `;
    const outbox = await db()<{ event_type: string; total: number }[]>`
      select event_type, count(*)::int total from outbox
       where clinic_id = ${clinicId}::uuid group by event_type order by event_type
    `;
    const counts = Object.fromEntries(outbox.map((row) => [row.event_type, row.total]));
    expect(counts['payments.patient_charge.paid']).toBe(1);
    expect(counts['payments.patient_credit.granted']).toBe(1);
    const [foreign] = await db()<{ total: number }[]>`
      select (select count(*)::int from patient_charges
               where provider_payment_id = ${settled.id} and clinic_id <> ${clinicId}::uuid)
           + (select count(*)::int from patient_credits pc
               join patient_charges c on c.id = pc.patient_charge_id
              where c.provider_payment_id = ${settled.id} and pc.clinic_id <> ${clinicId}::uuid) total
    `;
    expect(foreign?.total, 'outro tenant registrou o pagamento da fixture').toBe(0);
    evidence.webhook = {
      paymentId: settled.id,
      billingType: settled.billingType,
      status: settled.status,
      gross: settled.value,
      net: settled.netValue ?? null,
      dbFee: paid.provider_fee_amount,
      revision: paid.revision,
      webhookEvents: events.map((row) => row.event_type),
      outbox: counts,
      accountPausedThroughout: true,
      crossTenantBefore: before,
      crossTenantAfter: await crossTenantSnapshot(),
    };
  });

  test('5. extrato do Asaas confere bruto, tarifa e líquido com o banco', async () => {
    test.setTimeout(240_000);
    if (!state.paymentId) throw new Error('Pagamento ausente.');
    const day = saoPauloDate();
    let received: number | null = null;
    let fee: number | null = null;
    let entries: Array<{ type: string; value: number }> = [];
    for (let attempt = 0; attempt < 24; attempt++) {
      entries = [];
      for (let offset = 0; ; offset += 100) {
        const page = await sandboxGet<{
          data?: Array<{ type?: string; value?: number; paymentId?: string | null }>;
          hasMore?: boolean;
        }>(`/financialTransactions?startDate=${day}&finishDate=${day}&offset=${offset}&limit=100`);
        for (const item of page.data ?? []) {
          if (item.paymentId === state.paymentId && item.type && typeof item.value === 'number') {
            entries.push({ type: item.type, value: item.value });
          }
        }
        if (!page.hasMore) break;
      }
      const receivedEntries = entries.filter((entry) => entry.type === 'PAYMENT_RECEIVED');
      const feeEntries = entries.filter((entry) => entry.type === 'PAYMENT_FEE');
      if (receivedEntries.length > 0 && feeEntries.length > 0) {
        received = receivedEntries.reduce((sum, entry) => sum + entry.value, 0);
        fee = -feeEntries.reduce((sum, entry) => sum + entry.value, 0);
        break;
      }
      await sleep(5_000);
    }
    evidence.statement = entries;
    if (received === null || fee === null) {
      throw new Error('Extrato sem PAYMENT_RECEIVED e PAYMENT_FEE para o pagamento.');
    }
    const [charge] = await db()<{ gross: string; fee: string | null; net: string | null }[]>`
      select provider_gross_amount::text gross, provider_fee_amount::text fee,
             provider_net_amount::text net
        from patient_charges where id = ${state.chargeId!}::uuid
    `;
    const roundedFee = Math.round(fee * 100) / 100;
    expect(received).toBe(state.paymentValue);
    expect(Number(charge!.gross)).toBe(received);
    expect(Number(charge!.fee)).toBe(roundedFee);
    expect(Number(charge!.net)).toBe(Math.round((received - roundedFee) * 100) / 100);
    expect(state.paymentNetValue).toBe(Number(charge!.net));
  });

  test('6. despachante da fixture projeta crédito, tarifa e baixa; replay é idempotente', async () => {
    test.setTimeout(240_000);
    const result = await runOps(['dispatch', `--clinic=${clinicId}`, '--replay=1']);
    const types = Array.isArray(result.dispatched) ? (result.dispatched as string[]) : [];
    expect(types).toContain('payments.patient_charge.paid');
    expect(types).toContain('payments.patient_credit.granted');
    expect(result.replayed).toBe(types.length);
    const [pendingMessaging] = await db()<{ link_ready: number }[]>`
      select count(*)::int link_ready from outbox
       where clinic_id = ${clinicId}::uuid and event_type = 'payments.patient_charge.link_ready'
         and status = 'pending'
    `;
    expect(pendingMessaging?.link_ready, 'o link não pode ter sido despachado à mensageria').toBe(
      1,
    );

    const [projection] = await db()<
      {
        credits: number;
        credit_amount: string | null;
        credit_allocated: string | null;
        credit_gross: string | null;
        credit_fee: string | null;
        credit_net: string | null;
        fee_expenses: number;
        fee_expense_value: string | null;
        receivable_status: string | null;
        receivable_paid: string | null;
        receivable_payments: number;
        deposit_status: string | null;
        appointment_status: string | null;
        charge_fee: string | null;
        charge_net: string | null;
      }[]
    >`
      select
        (select count(*)::int from patient_credits where patient_charge_id = ${state.chargeId!}::uuid) credits,
        (select amount::text from patient_credits where patient_charge_id = ${state.chargeId!}::uuid) credit_amount,
        (select allocated_amount::text from patient_credits where patient_charge_id = ${state.chargeId!}::uuid) credit_allocated,
        (select provider_gross_amount::text from patient_credits where patient_charge_id = ${state.chargeId!}::uuid) credit_gross,
        (select provider_fee_amount::text from patient_credits where patient_charge_id = ${state.chargeId!}::uuid) credit_fee,
        (select provider_net_amount::text from patient_credits where patient_charge_id = ${state.chargeId!}::uuid) credit_net,
        (select count(*)::int from lancamentos where clinic_id = ${clinicId}::uuid
            and source_patient_charge_id = ${state.chargeId!}::uuid
            and financial_expense_kind = 'payment_processing_fee') fee_expenses,
        (select valor::text from lancamentos where clinic_id = ${clinicId}::uuid
            and source_patient_charge_id = ${state.chargeId!}::uuid
            and financial_expense_kind = 'payment_processing_fee') fee_expense_value,
        (select status::text from lancamentos where id = ${receivableId}::uuid) receivable_status,
        (select valor_pago::text from lancamentos where id = ${receivableId}::uuid) receivable_paid,
        (select count(*)::int from payment_transactions where lancamento_id = ${receivableId}::uuid
            and kind = 'payment') receivable_payments,
        (select deposit_status::text from appointments where id = ${appointmentAId}::uuid) deposit_status,
        (select status::text from appointments where id = ${appointmentAId}::uuid) appointment_status,
        (select provider_fee_amount::text from patient_charges where id = ${state.chargeId!}::uuid) charge_fee,
        (select provider_net_amount::text from patient_charges where id = ${state.chargeId!}::uuid) charge_net
    `;
    expect(projection).toBeTruthy();
    expect(projection!.credits).toBe(1);
    expect(Number(projection!.credit_amount)).toBe(DEPOSIT_VALUE);
    expect(Number(projection!.credit_allocated)).toBe(DEPOSIT_VALUE);
    expect(Number(projection!.credit_gross)).toBe(DEPOSIT_VALUE);
    expect(projection!.credit_fee).toBe(projection!.charge_fee);
    expect(projection!.credit_net).toBe(projection!.charge_net);
    expect(projection!.fee_expenses).toBe(1);
    expect(projection!.fee_expense_value).toBe(projection!.charge_fee);
    expect(projection!).toMatchObject({
      receivable_status: 'parcial',
      receivable_payments: 1,
      deposit_status: 'paid',
      appointment_status: 'confirmado',
    });
    expect(Number(projection!.receivable_paid)).toBe(DEPOSIT_VALUE);
    evidence.projection = { dispatched: types, replayed: result.replayed, ...projection };
  });

  test('7. Caixa do Preview mostra os fatos reais da cobrança', async ({ page }) => {
    test.setTimeout(240_000);
    const { formatBRL } = await import('../src/lib/format');
    const [charge] = await db()<{ fee: string; net: string; gross: string }[]>`
      select provider_fee_amount::text fee, provider_net_amount::text net,
             provider_gross_amount::text gross
        from patient_charges where id = ${state.chargeId!}::uuid
    `;
    await signIn(page);
    await page.goto('/auth/session-refresh?next=/caixa');
    await expect(page).toHaveURL(/\/caixa(?:\?|$)/u);
    // A fixture tem um único recebível; o detalhe precisa ser exatamente um.
    const receivable = page.locator('section[aria-label="A receber"]');
    await expect(receivable.getByText(patientAName)).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    const composition = receivable
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: 'Composição do atendimento' }) });
    await expect(composition).toHaveCount(1);
    await composition.locator('summary').click();
    await expect(composition).toHaveAttribute('open', '');
    await expect(composition.getByText('Cada cobrança Asaas')).toBeVisible();
    const chargeBlock = composition.locator('div.rounded-md').filter({ hasText: 'Sinal' });
    await expect(chargeBlock.locator('dd')).toHaveText([
      formatBRL(DEPOSIT_VALUE),
      formatBRL(Number(charge!.gross)),
      `− ${formatBRL(Number(charge!.fee))}`,
      formatBRL(Number(charge!.net)),
    ]);
    evidence.caixa = {
      requested: formatBRL(DEPOSIT_VALUE),
      gross: formatBRL(Number(charge!.gross)),
      fee: `− ${formatBRL(Number(charge!.fee))}`,
      net: formatBRL(Number(charge!.net)),
    };
  });
});
