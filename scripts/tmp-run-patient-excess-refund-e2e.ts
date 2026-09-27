/**
 * Prova externa D50, estritamente opt-in e tenant-scoped na Clinica A.
 *
 * Cenario: o restante nasce por R$ 20; uma baixa manual tardia reduz o saldo
 * para R$ 10; o paciente paga o link antigo de R$ 20. O fluxo real deve alocar
 * R$ 10 e devolver exatamente o excedente de R$ 10 pelo Asaas Sandbox.
 *
 * O manifesto ignorado pelo Git permite retomar/verificar/limpar sem procurar
 * recursos por heuristica. Nunca imprime PAN, CVV, CPF, tokens ou credenciais.
 */
import { assertDevContext } from './_env';

import { randomInt, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { chromium, type Page } from '@playwright/test';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  faturamentoPendencias,
  lancamentos,
  patientCreditAdjustments,
  patientCredits,
  paymentTransactions,
} from '@/contexts/financial/schema';
import { patients } from '@/contexts/patient';
import {
  patientCharges,
  patientCheckoutGenerations,
  patientRefundIntents,
} from '@/contexts/payments/schema';
import { reconcileRefundIntentsForPayment } from '@/contexts/payments/internal/excess-refund';
import { createRemainderCharge } from '@/contexts/payments/internal/remainder-charge';
import { appointments } from '@/contexts/scheduling';
import { encryptForTenant, hashForLookup, normalizeCpf, validateCpf } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { withTenant } from '@/lib/db/tenant';
import { getEventSchema } from '@/lib/outbox/catalog';
import { getHandler } from '@/lib/outbox/registry';
import { getClinicAsaasClient } from '@/lib/payments/account-store';
import type {
  AsaasAccountInfo,
  AsaasClient,
  ProviderPayment,
  ProviderRefund,
} from '@/lib/payments/asaas';
import {
  assertAsaasFixtureAccount,
  fingerprintAsaasAccount,
} from '@/lib/test/asaas-account-provenance';

// Registra schemas e handlers reais do worker.
import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

assertDevContext();

const OPT_IN_RUN = 'RUN_CLINICA_A_D50';
const OPT_IN_RESUME = 'RESUME_CLINICA_A_D50';
const OPT_IN_STATUS = 'STATUS_CLINICA_A_D50';
const OPT_IN_VERIFY = 'VERIFY_CLINICA_A_D50';
const OPT_IN_CLEANUP = 'CLEANUP_CLINICA_A_D50';
const CLINIC_SLUG = 'clinica-a';
const MANIFEST_PATH = resolve('.playwright', 'asaas-patient-excess-refund-fixture.json');
const MANIFEST_TEMP_PATH = `${MANIFEST_PATH}.${process.pid}.tmp`;
const CHARGE_AMOUNT = 20;
const MANUAL_PAYMENT_AMOUNT = 10;
const EXPECTED_EXCESS = CHARGE_AMOUNT - MANUAL_PAYMENT_AMOUNT;
const POLL_INTERVAL_MS = 2_000;
const PAYMENT_POLL_ATTEMPTS = 45;
const WEBHOOK_POLL_ATTEMPTS = 60;
const REFUND_POLL_ATTEMPTS = 45;
const CONFIRMED_REFUND_STATUSES = new Set(['REFUNDED', 'DONE', 'CONFIRMED', 'COMPLETED']);
const SETTLED_PAYMENT_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const FINAL_REFUNDED_PAYMENT_STATUSES = new Set(['REFUNDED']);

const SANDBOX_CARD = {
  number: '4444444444444444',
  holderName: 'Paciente Sandbox D50',
  expiryDate: '12/30',
  ccv: '123',
} as const;

type Mode = 'run' | 'resume' | 'status' | 'verify' | 'cleanup';
type ClinicRow = { id: string; status: string; webhookReady: boolean };
type DoctorRow = { id: string; nome: string };
type ProcedureRow = {
  id: string;
  descricao: string;
  codigo: string | null;
  categoria: string | null;
  duracao: number;
};

type D50Fixture = {
  purpose: 'asaas-sandbox-patient-excess-refund';
  version: 1 | 2;
  accountFingerprint?: string;
  createdAt: string;
  clinicId: string;
  patientId: string;
  appointmentId: string;
  lancamentoId: string;
  manualPaymentTransactionId: string;
  patientChargeId: string;
  checkoutGenerationId: string;
  providerCheckoutId: string;
  checkoutUrl: string;
  chargeAmount: number;
  manualPaymentAmount: number;
  expectedExcess: number;
  providerPaymentId?: string;
  refundIntentId?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[d50-e2e] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function modeFromEnvironment(): Mode {
  const optIn = process.env.PAYMENTS_D50_E2E;
  if (optIn === OPT_IN_RUN) return 'run';
  if (optIn === OPT_IN_RESUME) return 'resume';
  if (optIn === OPT_IN_STATUS) return 'status';
  if (optIn === OPT_IN_VERIFY) return 'verify';
  if (optIn === OPT_IN_CLEANUP) return 'cleanup';
  throw new Error(
    `[d50-e2e] opt-in deve ser ${OPT_IN_RUN}, ${OPT_IN_RESUME}, ${OPT_IN_STATUS}, ${OPT_IN_VERIFY} ou ${OPT_IN_CLEANUP}`,
  );
}

function assertSandboxConfiguration(): void {
  const apiUrl = new URL(process.env.ASAAS_BASE_URL ?? '');
  assert(apiUrl.protocol === 'https:', 'ASAAS_BASE_URL deve usar HTTPS');
  assert(
    apiUrl.hostname === 'sandbox.asaas.com' || apiUrl.hostname === 'api-sandbox.asaas.com',
    'ASAAS_BASE_URL deve apontar exclusivamente para o Asaas Sandbox',
  );
}

function createCpf(seed: number): string {
  const base = String(seed % 1_000_000_000).padStart(9, '0');
  const digits = base.split('').map(Number);
  if (/^(\d)\1{8}$/.test(base)) digits[8] = (digits[8]! + 1) % 10;
  const check = (length: number): number => {
    const sum = digits.slice(0, length).reduce((acc, digit, index) => {
      return acc + digit * (length + 1 - index);
    }, 0);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  digits.push(check(9));
  digits.push(check(10));
  return digits.join('');
}

async function uniqueIdentity(clinicId: string): Promise<{ encrypted: string; hash: string }> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const cpf = normalizeCpf(createCpf(Date.now() + attempt + randomInt(1, 100_000)));
    if (!validateCpf(cpf)) continue;
    const hash = await hashForLookup(cpf);
    const rows = await dbAdmin.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
        FROM patients
       WHERE clinic_id = ${clinicId}::uuid AND cpf_hash = ${hash}
    `);
    if (Number(rows[0]?.count ?? 0) === 0) {
      return { encrypted: await encryptForTenant(clinicId, cpf), hash };
    }
  }
  throw new Error('[d50-e2e] nao foi possivel gerar identidade sintetica unica');
}

async function loadClinic(): Promise<ClinicRow> {
  const rows = await dbAdmin.execute<ClinicRow>(sql`
    SELECT c.id::text AS id,
           c.status::text AS status,
           (a.webhook_configured_at IS NOT NULL) AS "webhookReady"
      FROM clinics c
      JOIN clinic_payment_accounts a
        ON a.clinic_id = c.id AND a.provider = 'asaas' AND a.active = true
     WHERE c.slug = ${CLINIC_SLUG}
  `);
  assert(rows.length === 1, 'esperava exatamente uma Clinica A com conta Asaas ativa');
  assert(rows[0]!.status === 'active', 'Clinica A nao esta ativa');
  assert(rows[0]!.webhookReady, 'webhook tenant da Clinica A nao esta configurado');
  return rows[0]!;
}

async function loadClinicalReferences(clinicId: string): Promise<{
  doctor: DoctorRow;
  procedure: ProcedureRow;
}> {
  const [doctors, procedures] = await Promise.all([
    dbAdmin.execute<DoctorRow>(sql`
      SELECT id::text AS id, nome
        FROM profiles
       WHERE clinic_id = ${clinicId}::uuid AND role = 'doctor' AND ativo = true
       ORDER BY created_at
       LIMIT 1
    `),
    dbAdmin.execute<ProcedureRow>(sql`
      SELECT id::text AS id, descricao, codigo, categoria,
             duracao_padrao_min AS duracao
        FROM procedures
       WHERE clinic_id = ${clinicId}::uuid AND ativo = true
       ORDER BY created_at
       LIMIT 1
    `),
  ]);
  assert(doctors[0], 'Clinica A nao possui medico ativo para a fixture');
  assert(procedures[0], 'Clinica A nao possui procedimento ativo para a fixture');
  return { doctor: doctors[0], procedure: procedures[0] };
}

async function persistManifest(fixture: D50Fixture): Promise<void> {
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_TEMP_PATH, `${JSON.stringify(fixture, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(MANIFEST_TEMP_PATH, MANIFEST_PATH);
}

async function writeManifest(fixture: D50Fixture): Promise<void> {
  await writeFile(MANIFEST_TEMP_PATH, `${JSON.stringify(fixture, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(MANIFEST_TEMP_PATH, MANIFEST_PATH);
}

async function loadManifest(
  clinicId: string,
  client: AsaasClient,
  account: AsaasAccountInfo,
): Promise<D50Fixture> {
  assert(await pathExists(MANIFEST_PATH), 'manifesto local D50 nao existe');
  const fixture = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as D50Fixture;
  assert(fixture.purpose === 'asaas-sandbox-patient-excess-refund', 'purpose diverge');
  assert(fixture.version === 1 || fixture.version === 2, 'versao de manifesto nao suportada');
  assert(fixture.clinicId === clinicId, 'manifesto pertence a outra clinica');
  assert(fixture.chargeAmount === CHARGE_AMOUNT, 'valor bruto diverge');
  assert(fixture.manualPaymentAmount === MANUAL_PAYMENT_AMOUNT, 'baixa manual diverge');
  assert(fixture.expectedExcess === EXPECTED_EXCESS, 'excedente esperado diverge');
  if (fixture.version === 2) {
    assert(fixture.accountFingerprint, 'manifesto v2 nao possui fingerprint da conta Asaas');
    assertAsaasFixtureAccount(fixture.accountFingerprint, account);
    return fixture;
  }

  const providerPayment = await client.findPaymentByCheckoutSession(fixture.providerCheckoutId, {
    attempts: 1,
  });
  assert(providerPayment?.paymentId, 'conta atual nao possui o pagamento da fixture legada');
  if (fixture.providerPaymentId) {
    assert(
      fixture.providerPaymentId === providerPayment.paymentId,
      'pagamento da conta atual diverge do manifesto legado',
    );
  }
  const upgraded: D50Fixture = {
    ...fixture,
    version: 2,
    accountFingerprint: fingerprintAsaasAccount(account),
    providerPaymentId: providerPayment.paymentId,
  };
  await writeManifest(upgraded);
  return upgraded;
}

async function createFixture(
  clinic: ClinicRow,
  client: AsaasClient,
  accountFingerprint: string,
): Promise<D50Fixture> {
  assert(!(await pathExists(MANIFEST_PATH)), 'ja existe manifesto local D50');
  const existing = await dbAdmin.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
      FROM lancamentos
     WHERE clinic_id = ${clinic.id}::uuid
       AND descricao = 'Fixture D50 excedente Sandbox'
  `);
  assert(Number(existing[0]?.count ?? 0) === 0, 'ja existe fixture D50 no banco DEV');

  const { doctor, procedure } = await loadClinicalReferences(clinic.id);
  const patientId = randomUUID();
  const appointmentId = randomUUID();
  const lancamentoId = randomUUID();
  const manualPaymentTransactionId = randomUUID();
  const identity = await uniqueIdentity(clinic.id);
  const scheduledAt = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000 - randomInt(1, 60_000));
  let chargeId: string | null = null;
  let checkoutId: string | null = null;
  let persisted = false;

  try {
    await withTenant(clinic.id, async (tx) => {
      await tx.insert(patients).values({
        id: patientId,
        clinicId: clinic.id,
        nome: 'Paciente sintetico D50',
        cpfEncrypted: identity.encrypted,
        cpfHash: identity.hash,
      });
      await tx.insert(appointments).values({
        id: appointmentId,
        clinicId: clinic.id,
        doctorId: doctor.id,
        patientId,
        procedureId: procedure.id,
        scheduledAt,
        durationMin: procedure.duracao,
        status: 'atendido',
        valor: CHARGE_AMOUNT.toFixed(2),
        valorAjustado: true,
        valorAjusteMotivo: 'Fixture D50 controlada',
        snapshotProcedureName: procedure.descricao,
        snapshotProcedureCodigo: procedure.codigo,
        snapshotProcedureCategoria: procedure.categoria,
        snapshotProcedureValor: CHARGE_AMOUNT.toFixed(2),
        snapshotProcedureDuracaoMin: procedure.duracao,
        snapshotDoctorNome: doctor.nome,
        createdVia: 'walkin',
      });
      await tx.insert(lancamentos).values({
        id: lancamentoId,
        clinicId: clinic.id,
        tipo: 'receber',
        descricao: 'Fixture D50 excedente Sandbox',
        valor: CHARGE_AMOUNT.toFixed(2),
        valorPago: '0.00',
        status: 'pendente',
        dueDate: new Date().toISOString().slice(0, 10),
        patientId,
        appointmentId,
        createdVia: 'auto',
        snapshotProcedureName: procedure.descricao,
        snapshotDoctorNome: doctor.nome,
      });
    });

    // O link nasce pelo saldo cheio. A baixa manual ocorre DEPOIS, reproduzindo
    // exatamente a corrida economica que motivou D50.
    await createRemainderCharge({
      clinicId: clinic.id,
      appointment: { appointmentId, patientId, valor: CHARGE_AMOUNT },
    });

    const charges = await dbAdmin
      .select({
        id: patientCharges.id,
        status: patientCharges.status,
        amount: patientCharges.amount,
        providerPaymentId: patientCharges.providerPaymentId,
        providerCheckoutId: patientCharges.providerCheckoutId,
        invoiceUrl: patientCharges.invoiceUrl,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.clinicId, clinic.id),
          eq(patientCharges.appointmentId, appointmentId),
          eq(patientCharges.kind, 'remainder'),
        ),
      );
    assert(charges.length === 1, `esperava uma patient_charge; encontrou ${charges.length}`);
    const charge = charges[0]!;
    chargeId = charge.id;
    checkoutId = charge.providerCheckoutId;
    assert(charge.status === 'pending', `patient_charge nasceu ${charge.status}`);
    assert(Number(charge.amount) === CHARGE_AMOUNT, 'patient_charge nasceu com valor incorreto');
    assert(charge.providerPaymentId === null, 'checkout novo ja possui provider payment');
    assert(charge.providerCheckoutId && charge.invoiceUrl, 'checkout nao foi ativado');
    const checkoutUrl = new URL(charge.invoiceUrl);
    assert(checkoutUrl.protocol === 'https:', 'checkout nao usa HTTPS');
    assert(checkoutUrl.hostname === 'sandbox.asaas.com', 'checkout nao pertence ao Sandbox');

    const generations = await dbAdmin
      .select({
        id: patientCheckoutGenerations.id,
        status: patientCheckoutGenerations.status,
        providerCheckoutId: patientCheckoutGenerations.providerCheckoutId,
      })
      .from(patientCheckoutGenerations)
      .where(
        and(
          eq(patientCheckoutGenerations.clinicId, clinic.id),
          eq(patientCheckoutGenerations.patientChargeId, charge.id),
        ),
      );
    assert(generations.length === 1, 'geracao do checkout nao e unica');
    assert(generations[0]!.status === 'active', 'geracao do checkout nao nasceu ativa');
    assert(
      generations[0]!.providerCheckoutId === charge.providerCheckoutId,
      'provider checkout diverge da geracao',
    );
    assert(
      (await client.findPaymentByCheckoutSession(charge.providerCheckoutId, { attempts: 1 })) ===
        null,
      'checkout novo ja possui cobranca',
    );

    await withTenant(clinic.id, async (tx) => {
      await tx.insert(paymentTransactions).values({
        id: manualPaymentTransactionId,
        clinicId: clinic.id,
        lancamentoId,
        kind: 'payment',
        amount: MANUAL_PAYMENT_AMOUNT.toFixed(2),
        paymentMethod: 'pix',
      });
      const updated = await tx
        .update(lancamentos)
        .set({
          valorPago: MANUAL_PAYMENT_AMOUNT.toFixed(2),
          status: 'parcial',
          paymentMethod: 'pix',
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(lancamentos.id, lancamentoId),
            eq(lancamentos.clinicId, clinic.id),
            eq(lancamentos.status, 'pendente'),
            eq(lancamentos.valorPago, '0.00'),
          ),
        )
        .returning({ id: lancamentos.id });
      assert(updated.length === 1, 'baixa manual perdeu a pre-condicao atomica');
    });

    const fixture: D50Fixture = {
      purpose: 'asaas-sandbox-patient-excess-refund',
      version: 2,
      accountFingerprint,
      createdAt: new Date().toISOString(),
      clinicId: clinic.id,
      patientId,
      appointmentId,
      lancamentoId,
      manualPaymentTransactionId,
      patientChargeId: charge.id,
      checkoutGenerationId: generations[0]!.id,
      providerCheckoutId: charge.providerCheckoutId,
      checkoutUrl: charge.invoiceUrl,
      chargeAmount: CHARGE_AMOUNT,
      manualPaymentAmount: MANUAL_PAYMENT_AMOUNT,
      expectedExcess: EXPECTED_EXCESS,
    };
    await persistManifest(fixture);
    persisted = true;
    console.log(
      JSON.stringify({
        result: 'PASS',
        operation: 'd50-fixture-created',
        clinic: CLINIC_SLUG,
        chargeAmount: CHARGE_AMOUNT,
        balanceAfterManualPayment: EXPECTED_EXCESS,
        checkoutActive: true,
        manifest: '.playwright/asaas-patient-excess-refund-fixture.json',
      }),
    );
    return fixture;
  } catch (error) {
    if (!persisted) {
      if (checkoutId) await client.cancelCheckout(checkoutId).catch(() => undefined);
      if (chargeId) {
        await dbAdmin
          .delete(outbox)
          .where(
            and(
              eq(outbox.clinicId, clinic.id),
              inArray(outbox.idempotencyKey, [chargeId, `charge-link:${chargeId}:g1`]),
            ),
          )
          .catch(() => undefined);
      }
      await dbAdmin
        .delete(paymentTransactions)
        .where(eq(paymentTransactions.id, manualPaymentTransactionId))
        .catch(() => undefined);
      if (chargeId) {
        await dbAdmin
          .delete(patientCharges)
          .where(eq(patientCharges.id, chargeId))
          .catch(() => undefined);
      }
      await dbAdmin
        .delete(lancamentos)
        .where(eq(lancamentos.id, lancamentoId))
        .catch(() => undefined);
      await dbAdmin
        .delete(appointments)
        .where(eq(appointments.id, appointmentId))
        .catch(() => undefined);
      await dbAdmin
        .delete(patients)
        .where(eq(patients.id, patientId))
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(MANIFEST_TEMP_PATH, { force: true }).catch(() => undefined);
  }
}

async function prepareCardCheckout(page: Page, checkoutUrl: string): Promise<void> {
  await page.goto(checkoutUrl, { waitUntil: 'networkidle' });
  // O Web Component do Checkout pode manter o `<atlas-panel>` pai como alvo
  // de hit-test mesmo com o botao visivel/estavel. `force` apenas reproduz o
  // clique do operador no controle ja localizado; nao ignora validacao alguma.
  await page.getByRole('button', { name: /Cart[aã]o de Cr[eé]dito/i }).click({ force: true });
  await page.locator('input[name="number"]').fill(SANDBOX_CARD.number);
  await page.locator('input[name="holderName"]').fill(SANDBOX_CARD.holderName);
  await page.locator('input[name="expiryDate"]').fill(SANDBOX_CARD.expiryDate);
  await page.locator('input[name="ccv"]').fill(SANDBOX_CARD.ccv);
}

async function submitCheckoutHeadless(
  page: Page,
  checkoutUrl: string,
): Promise<{
  success: boolean | null;
  recaptchaV2Enabled: boolean | null;
}> {
  await prepareCardCheckout(page, checkoutUrl);
  let resolveResponse!: (value: { status: number; body: unknown }) => void;
  let rejectResponse!: (reason: unknown) => void;
  const responsePromise = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  await page.route('**/checkoutSession/pay', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch();
      const text = await response.text();
      const body = JSON.parse(text) as unknown;
      await route.fulfill({ response, body: text });
      resolveResponse({ status: response.status(), body });
    } catch (error) {
      await route.abort();
      rejectResponse(error);
    }
  });
  await page.getByRole('button', { name: /^Pagar R\$/i }).click({ noWaitAfter: true });
  const response = await responsePromise;
  const body =
    response.body && typeof response.body === 'object' && !Array.isArray(response.body)
      ? (response.body as Record<string, unknown>)
      : {};
  return {
    success:
      response.status >= 200 && response.status < 300 && typeof body.success === 'boolean'
        ? body.success
        : false,
    recaptchaV2Enabled:
      typeof body.recaptchaV2Enabled === 'boolean' ? body.recaptchaV2Enabled : null,
  };
}

async function pollCheckoutPayment(
  client: AsaasClient,
  checkoutId: string,
): Promise<ProviderPayment | null> {
  for (let attempt = 0; attempt < PAYMENT_POLL_ATTEMPTS; attempt += 1) {
    const payment = await client.findPaymentByCheckoutSession(checkoutId, { attempts: 1 });
    if (payment) return payment;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function payFixture(fixture: D50Fixture, client: AsaasClient): Promise<D50Fixture> {
  const existing = await client.findPaymentByCheckoutSession(fixture.providerCheckoutId, {
    attempts: 1,
  });
  let payment = existing;
  if (!payment) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const response = await submitCheckoutHeadless(page, fixture.checkoutUrl);
      console.log(
        JSON.stringify({
          operation: 'd50-checkout-submit',
          success: response.success,
          recaptchaRequired: response.recaptchaV2Enabled,
        }),
      );
      if (response.success !== true) {
        const reason =
          response.recaptchaV2Enabled === true
            ? 'manual_recaptcha_required'
            : 'checkout_not_confirmed';
        throw new Error(`[d50-e2e] ${reason}`);
      }
      payment = await pollCheckoutPayment(client, fixture.providerCheckoutId);
    } finally {
      await browser.close();
    }
  }
  assert(payment, 'checkout pago nao produziu cobranca correlacionada');
  assert(payment.billingType === 'CREDIT_CARD', `metodo inesperado: ${payment.billingType}`);
  assert(Number(payment.value) === CHARGE_AMOUNT, 'valor no provider diverge do checkout');
  assert(SETTLED_PAYMENT_STATUSES.has(payment.status), `pagamento ficou ${payment.status}`);
  const updated = { ...fixture, providerPaymentId: payment.paymentId };
  await writeManifest(updated);
  console.log(
    JSON.stringify({
      result: 'PASS',
      operation: 'd50-checkout-paid',
      providerStatus: payment.status,
      billingType: payment.billingType,
      value: payment.value,
    }),
  );
  return updated;
}

async function waitForPatientWebhook(fixture: D50Fixture): Promise<void> {
  for (let attempt = 0; attempt < WEBHOOK_POLL_ATTEMPTS; attempt += 1) {
    const rows = await dbAdmin
      .select({
        status: patientCharges.status,
        providerPaymentId: patientCharges.providerPaymentId,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.id, fixture.patientChargeId),
          eq(patientCharges.clinicId, fixture.clinicId),
        ),
      );
    if (rows[0]?.status === 'paid' && rows[0]?.providerPaymentId === fixture.providerPaymentId) {
      console.log(
        JSON.stringify({ result: 'PASS', operation: 'd50-real-patient-webhook-observed' }),
      );
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('[d50-e2e] webhook real do pagamento nao foi observado no prazo');
}

async function processTargetedEvent(
  clinicId: string,
  idempotencyKey: string,
): Promise<'processed' | 'already_processed'> {
  const rows = await dbAdmin
    .select({
      id: outbox.id,
      eventType: outbox.eventType,
      payload: outbox.payload,
      status: outbox.status,
      attempts: outbox.attempts,
    })
    .from(outbox)
    .where(and(eq(outbox.clinicId, clinicId), eq(outbox.idempotencyKey, idempotencyKey)));
  assert(rows.length === 1, `evento ${idempotencyKey} nao e unico`);
  const event = rows[0]!;
  if (event.status === 'processed') return 'already_processed';
  assert(event.status === 'pending', `evento ${idempotencyKey} esta ${event.status}`);
  const schema = getEventSchema(event.eventType);
  const registration = getHandler(event.eventType);
  assert(schema, `schema ausente para ${event.eventType}`);
  assert(registration, `handler ausente para ${event.eventType}`);
  const payload = schema.parse(event.payload);
  if (registration.execution === 'detached') {
    await registration.handler({
      clinicId,
      payload,
      eventId: event.id,
      attempt: event.attempts + 1,
    });
  } else {
    await withTenant(clinicId, (tx) =>
      registration.handler({
        tx,
        clinicId,
        payload,
        eventId: event.id,
        attempt: event.attempts + 1,
      }),
    );
  }
  const updated = await dbAdmin
    .update(outbox)
    .set({
      status: 'processed',
      attempts: event.attempts + 1,
      processedAt: new Date(),
      processingStartedAt: null,
      lastError: null,
      errorCode: null,
    })
    .where(
      and(
        eq(outbox.id, event.id),
        eq(outbox.clinicId, clinicId),
        eq(outbox.status, 'pending'),
        eq(outbox.attempts, event.attempts),
      ),
    )
    .returning({ id: outbox.id });
  assert(updated.length === 1, `evento ${event.eventType} perdeu a transicao terminal`);
  return 'processed';
}

async function processD50Pipeline(fixture: D50Fixture, client: AsaasClient): Promise<D50Fixture> {
  const firstKeys = [
    `charge-paid:${fixture.patientChargeId}`,
    `credit-granted:${fixture.patientChargeId}`,
  ];
  const firstPass = [] as Array<{ key: string; outcome: string }>;
  for (const key of firstKeys) {
    firstPass.push({ key, outcome: await processTargetedEvent(fixture.clinicId, key) });
  }

  const requestedKey = `excess-refund-requested:${fixture.patientChargeId}`;
  const requestOutcome = await processTargetedEvent(fixture.clinicId, requestedKey);
  const loadIntents = () =>
    dbAdmin
      .select({
        id: patientRefundIntents.id,
        amount: patientRefundIntents.amount,
        status: patientRefundIntents.status,
        providerPaymentId: patientRefundIntents.providerPaymentId,
        baselineRefundedAmount: patientRefundIntents.baselineRefundedAmount,
        providerRefundId: patientRefundIntents.providerRefundId,
        failureCode: patientRefundIntents.failureCode,
      })
      .from(patientRefundIntents)
      .where(
        and(
          eq(patientRefundIntents.clinicId, fixture.clinicId),
          eq(patientRefundIntents.patientChargeId, fixture.patientChargeId),
          eq(patientRefundIntents.purpose, 'excess'),
        ),
      );
  let intents = await loadIntents();
  assert(intents.length === 1, `esperava uma intencao D50; encontrou ${intents.length}`);
  let intent = intents[0]!;
  if (intent.status === 'submitting' || intent.status === 'confirmation_pending') {
    for (let attempt = 0; attempt < REFUND_POLL_ATTEMPTS; attempt += 1) {
      await reconcileRefundIntentsForPayment({
        clinicId: fixture.clinicId,
        providerPaymentId: intent.providerPaymentId,
        loadRefunds: () =>
          client.listPaymentRefunds(intent.providerPaymentId, {
            attempts: 1,
          }),
      });
      intents = await loadIntents();
      assert(intents.length === 1, 'intencao D50 desapareceu durante o readback');
      intent = intents[0]!;
      if (intent.status === 'confirmed' || intent.status === 'failed') break;
      await sleep(POLL_INTERVAL_MS);
    }
  }
  assert(Number(intent.amount) === EXPECTED_EXCESS, 'POST D50 nao usou o excedente exato');
  assert(
    intent.providerPaymentId === fixture.providerPaymentId,
    'intencao aponta para outro pagamento',
  );
  assert(
    intent.status === 'confirmed',
    `intencao D50 terminou ${intent.status}: ${intent.failureCode ?? 'sem codigo'}`,
  );
  assert(Number(intent.baselineRefundedAmount ?? 0) === 0, 'baseline D50 nao nasceu zerada');
  assert(intent.providerRefundId, 'intencao confirmada nao possui provider refund id');

  const confirmedKey = `excess-refund-confirmed:${intent.id}`;
  const confirmedOutcome = await processTargetedEvent(fixture.clinicId, confirmedKey);
  const updatedFixture = { ...fixture, refundIntentId: intent.id };
  await writeManifest(updatedFixture);
  console.log(
    JSON.stringify({
      result: 'PASS',
      operation: 'd50-targeted-real-handlers',
      paymentEvents: firstPass,
      refundRequested: requestOutcome,
      refundConfirmed: confirmedOutcome,
      unrelatedEventsTouched: 0,
    }),
  );
  return updatedFixture;
}

function confirmedRefundTotal(refunds: readonly ProviderRefund[]): number {
  return Number(
    refunds
      .filter((refund) => CONFIRMED_REFUND_STATUSES.has(refund.status))
      .reduce((total, refund) => total + refund.value, 0)
      .toFixed(2),
  );
}

async function reportFixtureStatus(fixture: D50Fixture, client: AsaasClient): Promise<void> {
  const [providerPayment, rows] = await Promise.all([
    client.findPaymentByCheckoutSession(fixture.providerCheckoutId, { attempts: 1 }),
    dbAdmin.execute<{
      charge_status: string;
      provider_payment_id: string | null;
      receivable_status: string;
      receivable_value: string;
      receivable_paid: string;
      payment_transaction_count: number;
      payment_transaction_total: string;
      refund_intent_count: number;
      refund_intent_status: string | null;
      refund_intent_amount: string | null;
      refund_baseline_amount: string | null;
      refund_provider_id_present: boolean;
    }>(sql`
      SELECT pc.status::text AS charge_status,
             pc.provider_payment_id::text AS provider_payment_id,
             l.status::text AS receivable_status,
             l.valor::text AS receivable_value,
             l.valor_pago::text AS receivable_paid,
             (SELECT count(*)::int FROM payment_transactions t
               WHERE t.clinic_id = ${fixture.clinicId}::uuid
                 AND t.lancamento_id = ${fixture.lancamentoId}::uuid
                 AND t.kind = 'payment') AS payment_transaction_count,
             (SELECT coalesce(sum(t.amount), 0)::text FROM payment_transactions t
               WHERE t.clinic_id = ${fixture.clinicId}::uuid
                 AND t.lancamento_id = ${fixture.lancamentoId}::uuid
                 AND t.kind = 'payment') AS payment_transaction_total,
             (SELECT count(*)::int FROM patient_refund_intents i
               WHERE i.clinic_id = ${fixture.clinicId}::uuid
                 AND i.patient_charge_id = ${fixture.patientChargeId}::uuid) AS refund_intent_count,
             (SELECT i.status::text FROM patient_refund_intents i
               WHERE i.clinic_id = ${fixture.clinicId}::uuid
                 AND i.patient_charge_id = ${fixture.patientChargeId}::uuid) AS refund_intent_status,
             (SELECT i.amount::text FROM patient_refund_intents i
               WHERE i.clinic_id = ${fixture.clinicId}::uuid
                 AND i.patient_charge_id = ${fixture.patientChargeId}::uuid) AS refund_intent_amount,
             (SELECT i.baseline_refunded_amount::text FROM patient_refund_intents i
               WHERE i.clinic_id = ${fixture.clinicId}::uuid
                 AND i.patient_charge_id = ${fixture.patientChargeId}::uuid) AS refund_baseline_amount,
             coalesce((SELECT i.provider_refund_id IS NOT NULL FROM patient_refund_intents i
               WHERE i.clinic_id = ${fixture.clinicId}::uuid
                 AND i.patient_charge_id = ${fixture.patientChargeId}::uuid), false)
               AS refund_provider_id_present
        FROM patient_charges pc
        JOIN lancamentos l
          ON l.id = ${fixture.lancamentoId}::uuid
         AND l.clinic_id = ${fixture.clinicId}::uuid
       WHERE pc.id = ${fixture.patientChargeId}::uuid
         AND pc.clinic_id = ${fixture.clinicId}::uuid
    `),
  ]);
  assert(rows.length === 1, 'fixture local nao foi encontrada integralmente');
  const row = rows[0]!;
  assert(Number(row.receivable_value) === CHARGE_AMOUNT, 'valor local da fixture diverge');
  const paymentTransactionTotal = Number(row.payment_transaction_total);
  assert(
    paymentTransactionTotal === MANUAL_PAYMENT_AMOUNT || paymentTransactionTotal === CHARGE_AMOUNT,
    'total de baixas da fixture diverge',
  );
  const providerRefunds = providerPayment
    ? await client.listPaymentRefunds(providerPayment.paymentId, { attempts: 1 })
    : [];

  console.log(
    JSON.stringify({
      result: 'PASS',
      operation: 'd50-read-only-status',
      providerPaymentCreated: providerPayment !== null,
      providerPaymentStatus: providerPayment?.status ?? null,
      providerPaymentMatchesLocal:
        providerPayment !== null && row.provider_payment_id !== null
          ? providerPayment.paymentId === row.provider_payment_id
          : providerPayment === null && row.provider_payment_id === null,
      localChargeStatus: row.charge_status,
      receivableStatus: row.receivable_status,
      receivableValue: Number(row.receivable_value),
      receivablePaid: Number(row.receivable_paid),
      paymentTransactionCount: row.payment_transaction_count,
      paymentTransactionTotal,
      refundIntentCount: row.refund_intent_count,
      refundIntentStatus: row.refund_intent_status,
      refundIntentAmount:
        row.refund_intent_amount === null ? null : Number(row.refund_intent_amount),
      refundBaselineAmount:
        row.refund_baseline_amount === null ? null : Number(row.refund_baseline_amount),
      refundProviderIdPresent: row.refund_provider_id_present,
      providerRefunds: providerRefunds.map((refund) => ({
        status: refund.status,
        value: refund.value,
      })),
    }),
  );
}

async function verifyFixture(fixture: D50Fixture, client: AsaasClient): Promise<void> {
  assert(fixture.providerPaymentId, 'manifesto ainda nao possui provider payment');
  const [payment, refunds, rows] = await Promise.all([
    client.getPayment(fixture.providerPaymentId, { attempts: 1 }),
    client.listPaymentRefunds(fixture.providerPaymentId, { attempts: 1 }),
    dbAdmin.execute<{
      charge_status: string;
      charge_amount: string;
      receivable_status: string;
      receivable_value: string;
      receivable_paid: string;
      credit_count: number;
      credit_amount: string | null;
      allocated_amount: string | null;
      reversed_amount: string | null;
      intent_count: number;
      intent_status: string | null;
      intent_amount: string | null;
      adjustment_count: number;
      adjustment_amount: string | null;
      pending_status: string | null;
      payment_transaction_count: number;
      payment_transaction_total: string;
    }>(sql`
      SELECT pc.status::text AS charge_status,
             pc.amount::text AS charge_amount,
             l.status::text AS receivable_status,
             l.valor::text AS receivable_value,
             l.valor_pago::text AS receivable_paid,
             (SELECT count(*)::int FROM patient_credits c
               WHERE c.clinic_id = ${fixture.clinicId}::uuid
                 AND c.patient_charge_id = ${fixture.patientChargeId}::uuid) AS credit_count,
             (SELECT c.amount::text FROM patient_credits c
               WHERE c.clinic_id = ${fixture.clinicId}::uuid
                 AND c.patient_charge_id = ${fixture.patientChargeId}::uuid) AS credit_amount,
             (SELECT c.allocated_amount::text FROM patient_credits c
               WHERE c.clinic_id = ${fixture.clinicId}::uuid
                 AND c.patient_charge_id = ${fixture.patientChargeId}::uuid) AS allocated_amount,
             (SELECT c.unallocated_reversed_amount::text FROM patient_credits c
               WHERE c.clinic_id = ${fixture.clinicId}::uuid
                 AND c.patient_charge_id = ${fixture.patientChargeId}::uuid) AS reversed_amount,
             (SELECT count(*)::int FROM patient_refund_intents i
               WHERE i.clinic_id = ${fixture.clinicId}::uuid
                 AND i.patient_charge_id = ${fixture.patientChargeId}::uuid) AS intent_count,
             (SELECT i.status::text FROM patient_refund_intents i
               WHERE i.clinic_id = ${fixture.clinicId}::uuid
                 AND i.patient_charge_id = ${fixture.patientChargeId}::uuid) AS intent_status,
             (SELECT i.amount::text FROM patient_refund_intents i
               WHERE i.clinic_id = ${fixture.clinicId}::uuid
                 AND i.patient_charge_id = ${fixture.patientChargeId}::uuid) AS intent_amount,
             (SELECT count(*)::int FROM patient_credit_adjustments a
               WHERE a.clinic_id = ${fixture.clinicId}::uuid
                 AND a.patient_charge_id = ${fixture.patientChargeId}::uuid
                 AND a.kind = 'excess_refund') AS adjustment_count,
             (SELECT a.amount::text FROM patient_credit_adjustments a
               WHERE a.clinic_id = ${fixture.clinicId}::uuid
                 AND a.patient_charge_id = ${fixture.patientChargeId}::uuid
                 AND a.kind = 'excess_refund') AS adjustment_amount,
             (SELECT p.status::text FROM faturamento_pendencias p
               WHERE p.clinic_id = ${fixture.clinicId}::uuid
                 AND p.appointment_id = ${fixture.appointmentId}::uuid) AS pending_status,
             (SELECT count(*)::int FROM payment_transactions t
               WHERE t.clinic_id = ${fixture.clinicId}::uuid
                 AND t.lancamento_id = ${fixture.lancamentoId}::uuid
                 AND t.kind = 'payment') AS payment_transaction_count,
             (SELECT coalesce(sum(t.amount), 0)::text FROM payment_transactions t
               WHERE t.clinic_id = ${fixture.clinicId}::uuid
                 AND t.lancamento_id = ${fixture.lancamentoId}::uuid
                 AND t.kind = 'payment') AS payment_transaction_total
        FROM patient_charges pc
        JOIN lancamentos l ON l.id = ${fixture.lancamentoId}::uuid
       WHERE pc.id = ${fixture.patientChargeId}::uuid
         AND pc.clinic_id = ${fixture.clinicId}::uuid
         AND l.clinic_id = ${fixture.clinicId}::uuid
    `),
  ]);
  assert(rows.length === 1, 'fixture local nao foi encontrada integralmente');
  const row = rows[0]!;
  assert(payment.paymentId === fixture.providerPaymentId, 'readback encontrou outro pagamento');
  assert(Number(payment.value) === CHARGE_AMOUNT, 'valor do provider diverge');
  assert(
    confirmedRefundTotal(refunds) === EXPECTED_EXCESS,
    'provider nao confirmou exatamente R$ 10',
  );
  assert(
    row.charge_status === 'paid' && Number(row.charge_amount) === CHARGE_AMOUNT,
    'charge local diverge',
  );
  assert(row.receivable_status === 'pago', 'recebivel nao terminou pago');
  assert(Number(row.receivable_value) === CHARGE_AMOUNT, 'valor do recebivel diverge');
  assert(Number(row.receivable_paid) === CHARGE_AMOUNT, 'recebivel nao foi quitado sem inflar');
  assert(row.credit_count === 1, 'credito duplicou');
  assert(Number(row.credit_amount) === CHARGE_AMOUNT, 'credito nao preservou valor recebido');
  assert(Number(row.allocated_amount) === EXPECTED_EXCESS, 'alocacao nao respeitou saldo atual');
  assert(Number(row.reversed_amount) === EXPECTED_EXCESS, 'excedente nao foi compensado no ledger');
  assert(
    row.intent_count === 1 && row.intent_status === 'confirmed',
    'intencao nao e unica/confirmada',
  );
  assert(Number(row.intent_amount) === EXPECTED_EXCESS, 'intencao tem valor incorreto');
  assert(row.adjustment_count === 1, 'ajuste append-only duplicou');
  assert(
    Number(row.adjustment_amount) === EXPECTED_EXCESS,
    'ajuste append-only tem valor incorreto',
  );
  assert(row.pending_status === 'resolvida', 'pendencia humana nao foi resolvida');
  assert(row.payment_transaction_count === 2, 'ledger deve ter baixa manual + alocacao do credito');
  assert(
    Number(row.payment_transaction_total) === CHARGE_AMOUNT,
    'ledger de pagamentos nao fecha em R$ 20',
  );

  console.log(
    JSON.stringify({
      result: 'PASS',
      operation: 'd50-authoritative-readback',
      providerPaymentStatus: payment.status,
      providerChargeAmount: CHARGE_AMOUNT,
      providerConfirmedRefund: confirmedRefundTotal(refunds),
      receivableValue: Number(row.receivable_value),
      receivablePaid: Number(row.receivable_paid),
      creditCount: row.credit_count,
      creditAllocated: Number(row.allocated_amount),
      creditUnallocatedReversed: Number(row.reversed_amount),
      intentCount: row.intent_count,
      adjustmentCount: row.adjustment_count,
      pendingStatus: row.pending_status,
    }),
  );
}

async function verifyReplay(fixture: D50Fixture): Promise<void> {
  assert(fixture.refundIntentId, 'manifesto ainda nao possui refund intent');
  const keys = [
    `charge-paid:${fixture.patientChargeId}`,
    `credit-granted:${fixture.patientChargeId}`,
    `excess-refund-requested:${fixture.patientChargeId}`,
    `excess-refund-confirmed:${fixture.refundIntentId}`,
  ];
  const outcomes = [] as Array<{ key: string; outcome: string }>;
  for (const key of keys) {
    outcomes.push({ key, outcome: await processTargetedEvent(fixture.clinicId, key) });
  }
  assert(
    outcomes.every((item) => item.outcome === 'already_processed'),
    'replay reprocessou evento',
  );
  const counts = await dbAdmin.execute<{
    intents: number;
    credits: number;
    adjustments: number;
    allocated_payments: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM patient_refund_intents
        WHERE clinic_id = ${fixture.clinicId}::uuid
          AND patient_charge_id = ${fixture.patientChargeId}::uuid) AS intents,
      (SELECT count(*)::int FROM patient_credits
        WHERE clinic_id = ${fixture.clinicId}::uuid
          AND patient_charge_id = ${fixture.patientChargeId}::uuid) AS credits,
      (SELECT count(*)::int FROM patient_credit_adjustments
        WHERE clinic_id = ${fixture.clinicId}::uuid
          AND patient_charge_id = ${fixture.patientChargeId}::uuid) AS adjustments,
      (SELECT count(*)::int FROM payment_transactions
        WHERE clinic_id = ${fixture.clinicId}::uuid
          AND lancamento_id = ${fixture.lancamentoId}::uuid
          AND kind = 'payment'
          AND id <> ${fixture.manualPaymentTransactionId}::uuid) AS allocated_payments
  `);
  assert(
    counts[0]?.intents === 1 &&
      counts[0]?.credits === 1 &&
      counts[0]?.adjustments === 1 &&
      counts[0]?.allocated_payments === 1,
    'replay alterou cardinalidade financeira',
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      operation: 'd50-replay',
      processedNow: 0,
      alreadyProcessed: outcomes.length,
      intents: counts[0]!.intents,
      credits: counts[0]!.credits,
      adjustments: counts[0]!.adjustments,
      allocatedPayments: counts[0]!.allocated_payments,
    }),
  );
}

async function waitForConfirmedRefundTotal(
  client: AsaasClient,
  paymentId: string,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < REFUND_POLL_ATTEMPTS; attempt += 1) {
    const [payment, refunds] = await Promise.all([
      client.getPayment(paymentId, { attempts: 1 }),
      client.listPaymentRefunds(paymentId, { attempts: 1 }),
    ]);
    if (
      confirmedRefundTotal(refunds) >= expected ||
      (expected === CHARGE_AMOUNT && FINAL_REFUNDED_PAYMENT_STATUSES.has(payment.status))
    ) {
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`[d50-e2e] provider nao confirmou estorno total de R$ ${expected.toFixed(2)}`);
}

async function cleanupFixture(fixture: D50Fixture, client: AsaasClient): Promise<void> {
  assert(fixture.providerPaymentId, 'cleanup exige provider payment no manifesto');
  const refunds = await client.listPaymentRefunds(fixture.providerPaymentId, { attempts: 1 });
  const alreadyRefunded = confirmedRefundTotal(refunds);
  const remaining = Number((CHARGE_AMOUNT - alreadyRefunded).toFixed(2));
  if (remaining > 0) {
    await client.refundPayment(fixture.providerPaymentId, {
      value: remaining,
      description: 'Cleanup controlado da fixture D50 Sandbox',
    });
    await waitForConfirmedRefundTotal(client, fixture.providerPaymentId, CHARGE_AMOUNT);
  }

  const eventRows = await dbAdmin.execute<{
    id: string;
    event_type: string;
    idempotency_key: string;
  }>(sql`
    SELECT id::text AS id, event_type, idempotency_key
      FROM outbox
     WHERE clinic_id = ${fixture.clinicId}::uuid
       AND (
         payload->>'appointmentId' = ${fixture.appointmentId}
         OR payload->>'chargeId' = ${fixture.patientChargeId}
         OR idempotency_key = ${fixture.patientChargeId}
         OR idempotency_key = ${`charge-link:${fixture.patientChargeId}:g1`}
       )
  `);
  const allowedEventTypes = new Set([
    'payments.patient_charge.link_ready',
    'payments.patient_charge.paid',
    'payments.patient_credit.granted',
    'financial.patient_refund.requested',
    'payments.patient_refund.confirmed',
  ]);
  assert(
    eventRows.every((row) => allowedEventTypes.has(row.event_type)),
    'cleanup encontrou evento inesperado e recusou ampliar o alvo',
  );

  await dbAdmin.transaction(async (tx) => {
    if (eventRows.length > 0) {
      await tx.delete(outbox).where(
        inArray(
          outbox.id,
          eventRows.map((row) => row.id),
        ),
      );
    }
    await tx
      .delete(patientCreditAdjustments)
      .where(
        and(
          eq(patientCreditAdjustments.clinicId, fixture.clinicId),
          eq(patientCreditAdjustments.patientChargeId, fixture.patientChargeId),
        ),
      );
    await tx
      .delete(patientRefundIntents)
      .where(
        and(
          eq(patientRefundIntents.clinicId, fixture.clinicId),
          eq(patientRefundIntents.patientChargeId, fixture.patientChargeId),
        ),
      );
    await tx
      .delete(faturamentoPendencias)
      .where(
        and(
          eq(faturamentoPendencias.clinicId, fixture.clinicId),
          eq(faturamentoPendencias.appointmentId, fixture.appointmentId),
        ),
      );
    await tx
      .delete(patientCredits)
      .where(
        and(
          eq(patientCredits.clinicId, fixture.clinicId),
          eq(patientCredits.patientChargeId, fixture.patientChargeId),
        ),
      );
    await tx
      .delete(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.clinicId, fixture.clinicId),
          eq(paymentTransactions.lancamentoId, fixture.lancamentoId),
        ),
      );
    await tx
      .delete(patientCharges)
      .where(
        and(
          eq(patientCharges.clinicId, fixture.clinicId),
          eq(patientCharges.id, fixture.patientChargeId),
        ),
      );
    await tx
      .delete(lancamentos)
      .where(
        and(eq(lancamentos.clinicId, fixture.clinicId), eq(lancamentos.id, fixture.lancamentoId)),
      );
    await tx
      .delete(appointments)
      .where(
        and(
          eq(appointments.clinicId, fixture.clinicId),
          eq(appointments.id, fixture.appointmentId),
        ),
      );
    await tx
      .delete(patients)
      .where(and(eq(patients.clinicId, fixture.clinicId), eq(patients.id, fixture.patientId)));
  });

  const residue = await dbAdmin.execute<{
    patients: number;
    appointments: number;
    receivables: number;
    charges: number;
    intents: number;
    credits: number;
    adjustments: number;
    transactions: number;
    pendings: number;
    outbox_events: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM patients WHERE id = ${fixture.patientId}::uuid) AS patients,
      (SELECT count(*)::int FROM appointments WHERE id = ${fixture.appointmentId}::uuid) AS appointments,
      (SELECT count(*)::int FROM lancamentos WHERE id = ${fixture.lancamentoId}::uuid) AS receivables,
      (SELECT count(*)::int FROM patient_charges WHERE id = ${fixture.patientChargeId}::uuid) AS charges,
      (SELECT count(*)::int FROM patient_refund_intents
        WHERE patient_charge_id = ${fixture.patientChargeId}::uuid) AS intents,
      (SELECT count(*)::int FROM patient_credits
        WHERE patient_charge_id = ${fixture.patientChargeId}::uuid) AS credits,
      (SELECT count(*)::int FROM patient_credit_adjustments
        WHERE patient_charge_id = ${fixture.patientChargeId}::uuid) AS adjustments,
      (SELECT count(*)::int FROM payment_transactions
        WHERE lancamento_id = ${fixture.lancamentoId}::uuid) AS transactions,
      (SELECT count(*)::int FROM faturamento_pendencias
        WHERE appointment_id = ${fixture.appointmentId}::uuid) AS pendings,
      (SELECT count(*)::int FROM outbox
        WHERE clinic_id = ${fixture.clinicId}::uuid
          AND (payload->>'appointmentId' = ${fixture.appointmentId}
               OR payload->>'chargeId' = ${fixture.patientChargeId})) AS outbox_events
  `);
  assert(
    residue[0] && Object.values(residue[0]).every((value) => Number(value) === 0),
    'cleanup local deixou residuos da fixture',
  );
  await rm(MANIFEST_PATH, { force: true });
  console.log(
    JSON.stringify({
      result: 'PASS',
      operation: 'd50-cleanup',
      providerRefundedTotal: CHARGE_AMOUNT,
      localResidue: residue[0],
      retainedChargebackFixtureTouched: false,
    }),
  );
}

async function main(): Promise<void> {
  assertSandboxConfiguration();
  const mode = modeFromEnvironment();
  const clinic = await loadClinic();
  const client = await getClinicAsaasClient(clinic.id);
  assert(client, 'client Asaas tenant-scoped indisponivel');
  const account = await client.getMyAccount({ attempts: 1 });

  if (mode === 'cleanup') {
    await cleanupFixture(await loadManifest(clinic.id, client, account), client);
    return;
  }
  if (mode === 'status') {
    await reportFixtureStatus(await loadManifest(clinic.id, client, account), client);
    return;
  }
  if (mode === 'verify') {
    const fixture = await loadManifest(clinic.id, client, account);
    await verifyFixture(fixture, client);
    await verifyReplay(fixture);
    return;
  }

  let fixture =
    mode === 'run'
      ? await createFixture(clinic, client, fingerprintAsaasAccount(account))
      : await loadManifest(clinic.id, client, account);
  fixture = await payFixture(fixture, client);
  await waitForPatientWebhook(fixture);
  fixture = await processD50Pipeline(fixture, client);
  await verifyFixture(fixture, client);
  await verifyReplay(fixture);
  await cleanupFixture(fixture, client);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
