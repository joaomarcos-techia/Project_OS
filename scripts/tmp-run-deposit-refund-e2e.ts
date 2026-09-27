/**
 * Prova externa temporária P11/D77: PIX pago no Asaas Sandbox e estorno
 * tenant-scoped pelo fluxo real de closeout. Nunca repete o POST de estorno.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { patientCredits } from '@/contexts/financial/schema';
import { patients } from '@/contexts/patient';
import { patientCharges, patientRefundIntents } from '@/contexts/payments/schema';
import { closeChargeForCancellation } from '@/contexts/payments/internal/charge-closeout';
import { reconcileRefundIntentsForPayment } from '@/contexts/payments/internal/excess-refund';
import { appointments } from '@/contexts/scheduling';
import { dbAdmin } from '@/lib/db';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { withTenant } from '@/lib/db/tenant';
import { getEventSchema } from '@/lib/outbox/catalog';
import { getHandler } from '@/lib/outbox/registry';
import { getClinicAsaasClient } from '@/lib/payments/account-store';
import { createAsaasClient, type AsaasClient, type ProviderRefund } from '@/lib/payments/asaas';
import { fingerprintAsaasAccount } from '@/lib/test/asaas-account-provenance';

import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

assertDevContext();

const OPT_IN = 'ALLOW_CLINICA_A_D77_PIX';
const RESUME_OPT_IN = 'ALLOW_CLINICA_A_D77_RESUME';
const OPERATOR_GATE_OPT_IN = 'WAIT_FOR_D77_OPERATOR';
const SUBMIT_COMMAND = 'SUBMIT_D77_REFUND';
const CLINIC_SLUG = 'clinica-a';
const AMOUNT = 10;
const POLL_ATTEMPTS = 300;
const POLL_MS = 2_000;
const MANIFEST_PATH = resolve('.playwright', 'asaas-deposit-refund-d77.json');

type ClinicRow = { id: string; status: string };
type ReferenceRow = {
  doctor_id: string;
  doctor_name: string;
  procedure_id: string;
  procedure_name: string;
  procedure_code: string | null;
  procedure_category: string | null;
  duration: number;
};

type Fixture = {
  purpose: 'asaas-sandbox-deposit-refund-d77';
  createdAt: string;
  accountFingerprint: string;
  clinicId: string;
  patientId: string;
  appointmentId: string;
  chargeId: string;
  sourceEventId: string;
  providerCustomerId: string;
  providerPaymentId: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[d77-e2e] ${message}`);
}

function tomorrowBrt(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 86_400_000));
}

function sandboxConfig(): { baseUrl: URL; apiKey: string } {
  const baseUrl = new URL(process.env.ASAAS_BASE_URL ?? '');
  assert(baseUrl.protocol === 'https:', 'ASAAS_BASE_URL deve usar HTTPS');
  assert(
    baseUrl.hostname === 'sandbox.asaas.com' || baseUrl.hostname === 'api-sandbox.asaas.com',
    'ASAAS_BASE_URL deve apontar ao Sandbox',
  );
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey?.includes('hmlg')) {
    throw new Error('[d77-e2e] ASAAS_API_KEY deve ser uma chave Sandbox');
  }
  return { baseUrl, apiKey };
}

function assertCreateOptIn(): void {
  assert(process.env.PAYMENTS_D77_E2E === OPT_IN, `PAYMENTS_D77_E2E deve ser ${OPT_IN}`);
  assert(
    process.env.PAYMENTS_D77_OPERATOR_GATE === OPERATOR_GATE_OPT_IN,
    `PAYMENTS_D77_OPERATOR_GATE deve ser ${OPERATOR_GATE_OPT_IN}`,
  );
}

async function manifestExists(): Promise<boolean> {
  return stat(MANIFEST_PATH).then(
    () => true,
    () => false,
  );
}

async function loadManifest(): Promise<Fixture> {
  const parsed = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Partial<Fixture>;
  assert(parsed.purpose === 'asaas-sandbox-deposit-refund-d77', 'manifesto com purpose inválido');
  for (const key of [
    'createdAt',
    'accountFingerprint',
    'clinicId',
    'patientId',
    'appointmentId',
    'chargeId',
    'sourceEventId',
    'providerCustomerId',
    'providerPaymentId',
  ] as const) {
    assert(typeof parsed[key] === 'string' && parsed[key]!.length > 0, `manifesto sem ${key}`);
  }
  return parsed as Fixture;
}

async function waitForOperatorSubmission(): Promise<void> {
  console.log(
    JSON.stringify({
      event: 'READY_FOR_REFUND_SUBMISSION',
      action: `type-${SUBMIT_COMMAND}`,
    }),
  );
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  try {
    const command = await prompt.question('');
    assert(command.trim() === SUBMIT_COMMAND, 'comando de submissão recusado');
  } finally {
    prompt.close();
  }
}

async function confirmSandboxPayment(
  baseUrl: URL,
  apiKey: string,
  paymentId: string,
): Promise<void> {
  const response = await fetch(new URL(`sandbox/payment/${paymentId}/confirm`, `${baseUrl}/`), {
    method: 'POST',
    headers: { accept: 'application/json', access_token: apiKey },
  });
  assert(response.ok, `confirmação Sandbox recusada (HTTP ${response.status})`);
}

async function assertRefundBalance(baseUrl: URL, apiKey: string): Promise<void> {
  const response = await fetch(new URL('finance/balance', `${baseUrl}/`), {
    method: 'GET',
    headers: { accept: 'application/json', access_token: apiKey },
  });
  assert(response.ok, `consulta de saldo recusada (HTTP ${response.status})`);
  const body = (await response.json()) as { balance?: unknown };
  const balance = typeof body.balance === 'number' ? body.balance : Number(body.balance);
  assert(Number.isFinite(balance), 'saldo Sandbox inválido');
  // O Asaas não devolve as tarifas da cobrança. Exigir ao menos o valor do
  // refund já disponível antes do novo PIX deixa margem para essas tarifas.
  assert(balance >= AMOUNT, 'saldo Sandbox insuficiente para estorno integral com tarifas');
  console.log(
    JSON.stringify({
      event: 'REFUND_BALANCE_PREFLIGHT',
      sufficient: true,
      minimumBalance: AMOUNT,
    }),
  );
}

async function loadClinic(): Promise<ClinicRow> {
  const rows = await dbAdmin.execute<ClinicRow>(sql`
    SELECT c.id::text AS id, c.status::text AS status
      FROM clinics c
      JOIN clinic_payment_accounts a
        ON a.clinic_id = c.id AND a.provider = 'asaas' AND a.active = true
     WHERE c.slug = ${CLINIC_SLUG}
  `);
  assert(rows.length === 1 && rows[0]?.status === 'active', 'Clínica A ativa não encontrada');
  return rows[0];
}

async function loadReferences(clinicId: string): Promise<ReferenceRow> {
  const rows = await dbAdmin.execute<ReferenceRow>(sql`
    SELECT p.id::text AS doctor_id,
           p.nome AS doctor_name,
           pr.id::text AS procedure_id,
           pr.descricao AS procedure_name,
           pr.codigo AS procedure_code,
           pr.categoria AS procedure_category,
           pr.duracao_padrao_min AS duration
      FROM profiles p
      CROSS JOIN LATERAL (
        SELECT id, descricao, codigo, categoria, duracao_padrao_min
          FROM procedures
         WHERE clinic_id = ${clinicId}::uuid AND ativo = true
         ORDER BY created_at
         LIMIT 1
      ) pr
     WHERE p.clinic_id = ${clinicId}::uuid AND p.role = 'doctor' AND p.ativo = true
     ORDER BY p.created_at
     LIMIT 1
  `);
  assert(rows[0], 'referências clínicas da Clínica A indisponíveis');
  return rows[0];
}

async function persistManifest(fixture: Fixture): Promise<void> {
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(fixture, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function processEvent(clinicId: string, key: string): Promise<void> {
  const rows = await dbAdmin.execute<{
    id: string;
    event_type: string;
    payload: unknown;
    status: string;
    attempts: number;
  }>(sql`
    SELECT id::text AS id, event_type, payload, status, attempts
      FROM outbox
     WHERE clinic_id = ${clinicId}::uuid AND idempotency_key = ${key}
  `);
  assert(rows.length === 1, `evento ${key} não é único`);
  const event = rows[0]!;
  if (event.status === 'processed') return;
  assert(event.status === 'pending', `evento ${key} está ${event.status}`);
  const schema = getEventSchema(event.event_type);
  const registration = getHandler(event.event_type);
  assert(schema && registration, `handler/schema ausente para ${event.event_type}`);
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
  await dbAdmin.execute(sql`
    UPDATE outbox
       SET status = 'processed', attempts = ${event.attempts + 1}, processed_at = now(),
           processing_started_at = NULL, last_error = NULL, error_code = NULL
     WHERE id = ${event.id}::uuid AND clinic_id = ${clinicId}::uuid AND status = 'pending'
  `);
}

async function loadState(
  fixture: Fixture,
  client: AsaasClient,
): Promise<{
  intentStatus: string;
  chargeStatus: string;
  creditStatus: string;
  baselineCount: number | null;
  baselineRejectedCount: number | null;
  refunds: ProviderRefund[];
  paymentStatus: string;
}> {
  const [rows, refunds, payment] = await Promise.all([
    dbAdmin.execute<{
      intent_status: string;
      charge_status: string;
      credit_status: string;
      baseline_count: number | null;
      baseline_rejected_count: number | null;
    }>(sql`
      SELECT i.status::text AS intent_status,
             c.status::text AS charge_status,
             pc.status::text AS credit_status,
             i.baseline_refund_count AS baseline_count,
             i.baseline_rejected_refund_count AS baseline_rejected_count
        FROM patient_refund_intents i
        JOIN patient_charges c ON c.id = i.patient_charge_id
        JOIN patient_credits pc ON pc.patient_charge_id = c.id AND pc.clinic_id = c.clinic_id
       WHERE i.clinic_id = ${fixture.clinicId}::uuid
         AND i.patient_charge_id = ${fixture.chargeId}::uuid
         AND i.purpose = 'deposit_closeout'
    `),
    client.listPaymentRefunds(fixture.providerPaymentId, { attempts: 1 }),
    client.getPayment(fixture.providerPaymentId, { attempts: 1 }),
  ]);
  assert(rows.length === 1, 'estado da intenção não é único');
  return {
    intentStatus: rows[0]!.intent_status,
    chargeStatus: rows[0]!.charge_status,
    creditStatus: rows[0]!.credit_status,
    baselineCount: rows[0]!.baseline_count,
    baselineRejectedCount: rows[0]!.baseline_rejected_count,
    refunds: [...refunds],
    paymentStatus: payment.status,
  };
}

async function cleanup(
  fixture: Fixture,
  client: AsaasClient,
  options: { deleteProviderCustomer?: boolean } = {},
): Promise<void> {
  const events = await dbAdmin.execute<{ id: string; event_type: string }>(sql`
    SELECT id::text AS id, event_type
      FROM outbox
     WHERE clinic_id = ${fixture.clinicId}::uuid
       AND (
         payload->>'chargeId' = ${fixture.chargeId}
         OR payload->>'appointmentId' = ${fixture.appointmentId}
       )
  `);
  const allowed = new Set(['payments.patient_charge.closed', 'payments.patient_credit.released']);
  assert(
    events.every((event) => allowed.has(event.event_type)),
    'cleanup encontrou evento inesperado',
  );
  await dbAdmin.transaction(async (tx) => {
    if (events.length > 0) {
      await tx.delete(outbox).where(
        inArray(
          outbox.id,
          events.map((event) => event.id),
        ),
      );
    }
    await tx
      .delete(patientRefundIntents)
      .where(
        and(
          eq(patientRefundIntents.clinicId, fixture.clinicId),
          eq(patientRefundIntents.patientChargeId, fixture.chargeId),
        ),
      );
    await tx
      .delete(patientCredits)
      .where(
        and(
          eq(patientCredits.clinicId, fixture.clinicId),
          eq(patientCredits.patientChargeId, fixture.chargeId),
        ),
      );
    await tx
      .delete(patientCharges)
      .where(
        and(eq(patientCharges.clinicId, fixture.clinicId), eq(patientCharges.id, fixture.chargeId)),
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
  if (options.deleteProviderCustomer !== false) {
    await client.deleteCustomer(fixture.providerCustomerId).catch(() => undefined);
  }
  await rm(MANIFEST_PATH, { force: true });
}

async function resumeExistingFixture(apiKey: string): Promise<void> {
  assert(
    process.env.PAYMENTS_D77_RESUME === RESUME_OPT_IN,
    `PAYMENTS_D77_RESUME deve ser ${RESUME_OPT_IN}`,
  );
  const fixture = await loadManifest();
  const clinic = await loadClinic();
  assert(fixture.clinicId === clinic.id, 'manifesto pertence a outra clínica');
  const tenantClient = await getClinicAsaasClient(clinic.id);
  assert(tenantClient, 'cliente Asaas tenant-scoped indisponível');
  const environmentClient = createAsaasClient({ apiKey });
  const [tenantAccount, environmentAccount] = await Promise.all([
    tenantClient.getMyAccount({ attempts: 1 }),
    environmentClient.getMyAccount({ attempts: 1 }),
  ]);
  assert(
    fixture.accountFingerprint === fingerprintAsaasAccount(tenantAccount) &&
      fixture.accountFingerprint === fingerprintAsaasAccount(environmentAccount),
    'manifesto pertence a outra conta Sandbox',
  );

  let state = await loadState(fixture, tenantClient);
  await reconcileRefundIntentsForPayment({
    clinicId: clinic.id,
    providerPaymentId: fixture.providerPaymentId,
    loadRefunds: () => tenantClient.listPaymentRefunds(fixture.providerPaymentId, { attempts: 1 }),
    providerPaymentStatus: state.paymentStatus,
  });
  state = await loadState(fixture, tenantClient);

  if (state.intentStatus === 'confirmed') {
    await processEvent(clinic.id, `charge-closed:${fixture.chargeId}`);
    await processEvent(clinic.id, `credit-released:${fixture.chargeId}`);
    state = await loadState(fixture, tenantClient);
    assert(state.chargeStatus === 'refunded', 'refund DONE não fechou a cobrança');
    assert(state.creditStatus === 'refunded', 'refund DONE não fechou o crédito');
  } else if (state.intentStatus === 'failed') {
    assert(state.chargeStatus === 'paid', 'refund recusado fechou a cobrança indevidamente');
    assert(state.creditStatus === 'available', 'refund recusado fechou o crédito indevidamente');
  } else {
    console.log(
      JSON.stringify({
        result: 'PARTIAL',
        branch: 'PENDING',
        refundCount: state.refunds.length,
        chargeStatus: state.chargeStatus,
        creditStatus: state.creditStatus,
        cleanup: 'blocked-until-provider-terminal',
      }),
    );
    process.exitCode = 2;
    return;
  }

  const terminalRefund = state.refunds.at(-1);
  await cleanup(fixture, tenantClient, { deleteProviderCustomer: false });
  console.log(
    JSON.stringify({
      result: 'PASS',
      branch: state.intentStatus === 'confirmed' ? 'DONE' : 'CANCELLED_OR_DENIED',
      providerRefundStatus: terminalRefund?.status ?? null,
      refundCount: state.refunds.length,
      chargeStatus: state.chargeStatus,
      creditStatus: state.creditStatus,
      cleanup: 'local-complete-provider-history-preserved',
    }),
  );
}

async function main(): Promise<void> {
  const { baseUrl, apiKey } = sandboxConfig();
  if (process.env.PAYMENTS_D77_RESUME === RESUME_OPT_IN) {
    await resumeExistingFixture(apiKey);
    return;
  }
  assertCreateOptIn();
  assert(!(await manifestExists()), 'manifesto D77 já existe');
  const clinic = await loadClinic();
  const references = await loadReferences(clinic.id);
  const tenantClient = await getClinicAsaasClient(clinic.id);
  assert(tenantClient, 'cliente Asaas tenant-scoped indisponível');
  const environmentClient = createAsaasClient({ apiKey });
  const [tenantAccount, environmentAccount] = await Promise.all([
    tenantClient.getMyAccount({ attempts: 1 }),
    environmentClient.getMyAccount({ attempts: 1 }),
  ]);
  const accountFingerprint = fingerprintAsaasAccount(tenantAccount);
  assert(
    accountFingerprint === fingerprintAsaasAccount(environmentAccount),
    'chave Sandbox efetiva pertence a outra conta da Clínica A',
  );
  await assertRefundBalance(baseUrl, apiKey);

  const patientId = randomUUID();
  const appointmentId = randomUUID();
  const chargeId = randomUUID();
  const sourceEventId = randomUUID();
  const stamp = Date.now();
  const customer = await tenantClient.createCustomer({
    name: `Paciente sintético D77 ${stamp}`,
    cpfCnpj: '24971563792',
  });
  const payment = await tenantClient.generateInvoice({
    customerId: customer.customerId,
    value: AMOUNT,
    dueDate: tomorrowBrt(),
    description: 'Sinal sintético D77',
    billingType: 'PIX',
    externalReference: `d77:${chargeId}`,
  });
  const fixture: Fixture = {
    purpose: 'asaas-sandbox-deposit-refund-d77',
    createdAt: new Date().toISOString(),
    accountFingerprint,
    clinicId: clinic.id,
    patientId,
    appointmentId,
    chargeId,
    sourceEventId,
    providerCustomerId: customer.customerId,
    providerPaymentId: payment.paymentId,
  };
  let refundMayHaveBeenSubmitted = false;

  try {
    await withTenant(clinic.id, async (tx) => {
      await tx.insert(patients).values({
        id: patientId,
        clinicId: clinic.id,
        nome: 'Paciente sintético D77',
        cpfEncrypted: 'fixture-d77',
        cpfHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      });
      await tx.insert(appointments).values({
        id: appointmentId,
        clinicId: clinic.id,
        doctorId: references.doctor_id,
        patientId,
        procedureId: references.procedure_id,
        scheduledAt: new Date(Date.now() + 7 * 86_400_000),
        durationMin: references.duration,
        status: 'cancelado',
        valor: AMOUNT.toFixed(2),
        valorAjustado: true,
        valorAjusteMotivo: 'Fixture D77 controlada',
        snapshotProcedureName: references.procedure_name,
        snapshotProcedureCodigo: references.procedure_code,
        snapshotProcedureCategoria: references.procedure_category,
        snapshotProcedureValor: AMOUNT.toFixed(2),
        snapshotProcedureDuracaoMin: references.duration,
        snapshotDoctorNome: references.doctor_name,
        createdVia: 'walkin',
      });
      await tx.insert(patientCharges).values({
        id: chargeId,
        clinicId: clinic.id,
        appointmentId,
        patientId,
        kind: 'deposit',
        status: 'pending',
        amount: AMOUNT.toFixed(2),
        provider: 'asaas',
        providerPaymentId: payment.paymentId,
        externalReference: `d77:${chargeId}`,
      });
    });
    await persistManifest(fixture);
    await withTenant(clinic.id, async (tx) => {
      await tx
        .update(patientCharges)
        .set({ status: 'paid', paidAt: new Date(), updatedAt: sql`now()` })
        .where(and(eq(patientCharges.id, chargeId), eq(patientCharges.status, 'pending')));
      await tx.insert(patientCredits).values({
        clinicId: clinic.id,
        patientId,
        appointmentId,
        patientChargeId: chargeId,
        amount: AMOUNT.toFixed(2),
        kind: 'deposit',
        status: 'available',
        paymentMethod: 'pix',
      });
    });
    await confirmSandboxPayment(baseUrl, apiKey, payment.paymentId);
    const settled = await tenantClient.getPayment(payment.paymentId, { attempts: 2 });
    assert(settled.billingType === 'PIX', `método inesperado: ${settled.billingType}`);
    assert(
      ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(settled.status),
      `PIX não liquidou: ${settled.status}`,
    );

    await waitForOperatorSubmission();
    let firstError: unknown = null;
    refundMayHaveBeenSubmitted = true;
    await closeChargeForCancellation({
      clinicId: clinic.id,
      appointmentId,
      cancelReason: 'doctor_absence',
      cancelledAt: new Date(),
      sourceEventId,
    }).catch((error: unknown) => {
      firstError = error;
    });
    const firstRefunds = await tenantClient.listPaymentRefunds(payment.paymentId, { attempts: 1 });
    assert(
      firstRefunds.length === 1,
      `esperava um refund após o primeiro POST; encontrou ${firstRefunds.length}`,
    );
    console.log(
      JSON.stringify({
        event: 'REFUND_SUBMITTED',
        refundStatus: firstRefunds[0]!.status,
        action: 'authorize-critical-action-with-sandbox-code',
      }),
    );

    await closeChargeForCancellation({
      clinicId: clinic.id,
      appointmentId,
      cancelReason: 'doctor_absence',
      cancelledAt: new Date(),
      sourceEventId,
    }).catch(() => undefined);
    const replayRefunds = await tenantClient.listPaymentRefunds(payment.paymentId, { attempts: 1 });
    assert(replayRefunds.length === firstRefunds.length, 'replay disparou segundo POST de estorno');

    let state = await loadState(fixture, tenantClient);
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (state.intentStatus === 'confirmed' || state.intentStatus === 'failed') break;
      await reconcileRefundIntentsForPayment({
        clinicId: clinic.id,
        providerPaymentId: payment.paymentId,
        loadRefunds: () => tenantClient.listPaymentRefunds(payment.paymentId, { attempts: 1 }),
        providerPaymentStatus: state.paymentStatus,
      });
      state = await loadState(fixture, tenantClient);
      if (state.intentStatus !== 'confirmed' && state.intentStatus !== 'failed') {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }

    assert(
      state.baselineCount === 0 && state.baselineRejectedCount === 0,
      'baseline não foi gravado antes do POST',
    );
    if (state.intentStatus === 'confirmed') {
      await processEvent(clinic.id, `charge-closed:${chargeId}`);
      await processEvent(clinic.id, `credit-released:${chargeId}`);
      state = await loadState(fixture, tenantClient);
      assert(state.chargeStatus === 'refunded', 'refund DONE não fechou a cobrança');
      assert(state.creditStatus === 'refunded', 'crédito não foi liberado como refunded');
      await cleanup(fixture, tenantClient);
      console.log(
        JSON.stringify({
          result: 'PASS',
          branch: 'DONE',
          pixSettled: true,
          refundCount: replayRefunds.length,
          replayCreatedSecondRefund: false,
          chargeStatus: state.chargeStatus,
          creditStatus: state.creditStatus,
          cleanup: 'complete',
        }),
      );
      return;
    }

    if (state.intentStatus === 'failed') {
      assert(state.chargeStatus === 'paid', 'refund recusado fechou a cobrança indevidamente');
      assert(state.creditStatus === 'available', 'refund recusado liberou o crédito indevidamente');
      console.log(
        JSON.stringify({
          result: 'PASS',
          branch: 'CANCELLED_OR_DENIED',
          pixSettled: true,
          refundCount: replayRefunds.length,
          replayCreatedSecondRefund: false,
          chargeStatus: state.chargeStatus,
          creditStatus: state.creditStatus,
          cleanup: 'retained-for-provider-resolution',
          closeoutRaisedTerminalError: Boolean(firstError),
        }),
      );
      return;
    }

    assert(state.chargeStatus === 'paid', 'refund não terminal fechou a cobrança indevidamente');
    assert(
      state.creditStatus === 'available',
      'refund não terminal liberou o crédito indevidamente',
    );
    console.log(
      JSON.stringify({
        result: 'PARTIAL',
        branch: 'PENDING',
        pixSettled: true,
        refundCount: replayRefunds.length,
        replayCreatedSecondRefund: false,
        chargeStatus: state.chargeStatus,
        creditStatus: state.creditStatus,
        cleanup: 'blocked-until-provider-terminal',
      }),
    );
    process.exitCode = 2;
  } catch (error) {
    if (!refundMayHaveBeenSubmitted) {
      await tenantClient.cancelPayment(payment.paymentId).catch(() => undefined);
      await cleanup(fixture, tenantClient).catch(() => undefined);
    }
    console.error(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  () => process.exit(1),
);
