/**
 * E2E real e controlado: Checkout Asaas da clínica -> outbox -> C14 -> Meta.
 *
 * Cria duas fixtures sintéticas na clínica informada (sinal e restante), envia
 * os dois templates para um destinatário consentido e remove exatamente os
 * dados criados. Os outbounds aceitos ficam como evidência cifrada; nenhuma URL,
 * credencial ou telefone é impressa.
 *
 * Guardas:
 *   PAYMENTS_META_E2E=ALLOW_REAL_META
 *   PAYMENTS_META_E2E_CLINIC_ID=<uuid da clínica DEV/Preview>
 *   META_E2E_RECIPIENT_E164=<destinatário consentido>
 *   APP_BASE_URL=https://<host público>
 */
import { assertDevContext } from './_env';

import { randomInt, randomUUID } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';
import { aiProactiveJobs } from '@/contexts/ai-agent/proactive-jobs/schema';
import { lancamentos } from '@/contexts/financial';
import { outboundMessages } from '@/contexts/messaging';
import { patientConsents, patients } from '@/contexts/patient';
import {
  patientCharges,
  patientCheckoutGenerations,
  patientPaymentCustomers,
} from '@/contexts/payments/schema';
import { createDepositCharge } from '@/contexts/payments/internal/deposit-charge';
import { createRemainderCharge } from '@/contexts/payments/internal/remainder-charge';
import { appointments } from '@/contexts/scheduling';
import {
  encryptForTenant,
  hashForLookup,
  normalizeCpf,
  normalizePhone,
  validateCpf,
} from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { withTenant } from '@/lib/db/tenant';
import { getEventSchema } from '@/lib/outbox/catalog';
import { getHandler } from '@/lib/outbox/registry';
import { getClinicAsaasClient } from '@/lib/payments/account-store';

// Registra os handlers reais consumidos pelo worker.
import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

assertDevContext();

const OPT_IN = 'ALLOW_REAL_META';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9]\d{9,14}$/;
const TERMINAL_OUTBOUND = new Set(['accepted', 'sent', 'delivered', 'read']);

type RequirementRow = {
  timezone: string;
  local_hour: number;
  deposit_enabled: boolean;
  applies_first: boolean;
  payment_active: boolean;
  webhook_ready: boolean;
  whatsapp_active: boolean;
};

type DoctorRow = { id: string; nome: string };
type ProcedureRow = {
  id: string;
  descricao: string;
  codigo: string | null;
  categoria: string | null;
  valor: string;
  duracao: number;
};

const clinicId = process.env.PAYMENTS_META_E2E_CLINIC_ID ?? '';
const recipient = process.env.META_E2E_RECIPIENT_E164 ?? '';
const appointmentIds = [randomUUID(), randomUUID()] as const;
const patientIds = [randomUUID(), randomUUID()] as const;
const lancamentoId = randomUUID();
let chargeIds: string[] = [];
let checkoutIds: string[] = [];
let outboxIds: string[] = [];
let jobIds: string[] = [];
let preservedOutboundCount = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[payments-meta-e2e] ${message}`);
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

async function uniqueCpf(offset: number): Promise<{ cpf: string; hash: string }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cpf = normalizeCpf(createCpf(Date.now() + offset + attempt + randomInt(1, 10_000)));
    if (!validateCpf(cpf)) continue;
    const hash = await hashForLookup(cpf);
    const rows = await dbAdmin.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
        FROM patients
       WHERE clinic_id = ${clinicId}::uuid AND cpf_hash = ${hash}
    `);
    if (Number(rows[0]?.count ?? 0) === 0) return { cpf, hash };
  }
  throw new Error('[payments-meta-e2e] não foi possível gerar CPF sintético único');
}

async function preflight(): Promise<{ doctor: DoctorRow; procedure: ProcedureRow }> {
  assert(process.env.PAYMENTS_META_E2E === OPT_IN, `PAYMENTS_META_E2E deve ser ${OPT_IN}`);
  assert(UUID.test(clinicId), 'PAYMENTS_META_E2E_CLINIC_ID deve ser UUID');
  assert(E164.test(recipient), 'META_E2E_RECIPIENT_E164 deve estar em E.164');
  assert(process.env.APP_BASE_URL?.startsWith('https://'), 'APP_BASE_URL HTTPS é obrigatória');
  assert(process.env.META_TEMPLATE_DEPOSIT_LINK_ID, 'template Meta de sinal não configurado');
  assert(process.env.META_TEMPLATE_REMAINDER_LINK_ID, 'template Meta de restante não configurado');

  const requirements = await dbAdmin.execute<RequirementRow>(sql`
    SELECT c.timezone,
           extract(hour FROM (now() AT TIME ZONE c.timezone))::int AS local_hour,
           coalesce(p.enabled, false) AS deposit_enabled,
           coalesce(p.applies_to_first_visit, false) AS applies_first,
           EXISTS (
             SELECT 1 FROM clinic_payment_accounts a
              WHERE a.clinic_id = c.id AND a.provider = 'asaas' AND a.active = true
           ) AS payment_active,
           EXISTS (
             SELECT 1 FROM clinic_payment_accounts a
              WHERE a.clinic_id = c.id AND a.provider = 'asaas'
                AND a.active = true AND a.webhook_configured_at IS NOT NULL
           ) AS webhook_ready,
           EXISTS (
             SELECT 1 FROM clinic_whatsapp_numbers w
              WHERE w.clinic_id = c.id AND w.provider = 'meta' AND w.active = true
                AND w.verified_at IS NOT NULL AND w.connection_status = 'connected'
           ) AS whatsapp_active
      FROM clinics c
      LEFT JOIN clinic_deposit_policy p ON p.clinic_id = c.id
     WHERE c.id = ${clinicId}::uuid AND c.status = 'active'
     LIMIT 1
  `);
  const requirement = requirements[0];
  assert(requirement, 'clínica ativa não encontrada no banco DEV');
  assert(
    requirement.deposit_enabled && requirement.applies_first,
    'política de sinal incompatível',
  );
  assert(requirement.payment_active && requirement.webhook_ready, 'conta Asaas não está pronta');
  assert(requirement.whatsapp_active, 'conexão Meta da clínica não está ativa/verificada');
  assert(
    requirement.local_hour >= 8 && requirement.local_hour < 20,
    `janela C14 fechada no timezone da clínica (${requirement.timezone})`,
  );

  const queueRows = await dbAdmin.execute<{ jobs_count: number }>(sql`
    SELECT (SELECT count(*)::int FROM ai_proactive_jobs
        WHERE type IN ('deposit_link', 'remainder_link')
          AND status IN ('pending', 'processing')) AS jobs_count
  `);
  assert(Number(queueRows[0]?.jobs_count ?? 0) === 0, 'há jobs de cobrança concorrentes');

  const phoneHash = await hashForLookup(normalizePhone(recipient));
  const phoneRows = await dbAdmin.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM patients
     WHERE clinic_id = ${clinicId}::uuid AND telefone_hash = ${phoneHash}
  `);
  assert(Number(phoneRows[0]?.count ?? 0) === 0, 'destinatário já pertence a paciente da clínica');

  const doctors = await dbAdmin.execute<DoctorRow>(sql`
    SELECT id::text AS id, nome FROM profiles
     WHERE clinic_id = ${clinicId}::uuid AND role = 'doctor' AND ativo = true
     ORDER BY created_at LIMIT 1
  `);
  const procedures = await dbAdmin.execute<ProcedureRow>(sql`
    SELECT id::text AS id, descricao, codigo, categoria,
           valor_padrao::text AS valor, duracao_padrao_min AS duracao
      FROM procedures
     WHERE clinic_id = ${clinicId}::uuid AND ativo = true
     ORDER BY created_at LIMIT 1
  `);
  assert(doctors[0], 'clínica não possui médico ativo para a fixture');
  assert(procedures[0], 'clínica não possui procedimento ativo para a fixture');
  return { doctor: doctors[0], procedure: procedures[0] };
}

async function createFixtures(doctor: DoctorRow, procedure: ProcedureRow): Promise<void> {
  const phone = normalizePhone(recipient);
  const phoneHash = await hashForLookup(phone);
  const phoneEncrypted = await encryptForTenant(clinicId, phone);
  const identities = await Promise.all([uniqueCpf(0), uniqueCpf(100_000)]);
  const cpfEncrypted = await Promise.all(
    identities.map((identity) => encryptForTenant(clinicId, identity.cpf)),
  );
  const now = Date.now();
  const depositAt = new Date(now + 180 * 24 * 60 * 60 * 1000 + randomInt(1, 30_000));
  const remainderAt = new Date(now - 180 * 24 * 60 * 60 * 1000 - randomInt(1, 30_000));

  await withTenant(clinicId, async (tx) => {
    await tx.insert(patients).values(
      patientIds.map((id, index) => ({
        id,
        clinicId,
        nome: index === 0 ? 'Paciente E2E Sinal' : 'Paciente E2E Restante',
        cpfEncrypted: cpfEncrypted[index]!,
        cpfHash: identities[index]!.hash,
        telefoneEncrypted: phoneEncrypted,
        telefoneHash: phoneHash,
      })),
    );
    await tx.insert(patientConsents).values(
      patientIds.map((patientId) => ({
        clinicId,
        patientId,
        cobrancaWhatsapp: true,
        versao: 1,
      })),
    );
    const snapshot = {
      clinicId,
      doctorId: doctor.id,
      procedureId: procedure.id,
      durationMin: procedure.duracao,
      snapshotProcedureName: procedure.descricao,
      snapshotProcedureCodigo: procedure.codigo,
      snapshotProcedureCategoria: procedure.categoria,
      snapshotProcedureValor: procedure.valor,
      snapshotProcedureDuracaoMin: procedure.duracao,
      snapshotDoctorNome: doctor.nome,
      createdVia: 'attendant' as const,
    };
    await tx.insert(appointments).values([
      {
        ...snapshot,
        id: appointmentIds[0],
        patientId: patientIds[0],
        scheduledAt: depositAt,
        status: 'agendado',
        valor: '1000.00',
        valorAjustado: true,
        valorAjusteMotivo: 'Fixture E2E controlada',
      },
      {
        ...snapshot,
        id: appointmentIds[1],
        patientId: patientIds[1],
        scheduledAt: remainderAt,
        status: 'atendido',
        valor: '75.00',
        valorAjustado: true,
        valorAjusteMotivo: 'Fixture E2E controlada',
      },
    ]);
    await tx.insert(lancamentos).values({
      id: lancamentoId,
      clinicId,
      tipo: 'receber',
      descricao: 'Atendimento E2E controlado',
      valor: '75.00',
      valorPago: '0.00',
      status: 'pendente',
      dueDate: new Date().toISOString().slice(0, 10),
      patientId: patientIds[1],
      appointmentId: appointmentIds[1],
      createdVia: 'auto',
      snapshotProcedureName: procedure.descricao,
      snapshotDoctorNome: doctor.nome,
    });
  });
}

async function dispatchOwnEvents(
  events: Array<{ id: string; eventType: string; payload: unknown; status: string }>,
): Promise<void> {
  for (const event of [...events].sort((left, right) =>
    left.eventType.localeCompare(right.eventType),
  )) {
    assert(event.status === 'pending', `evento próprio ${event.eventType} não está pending`);
    const schema = getEventSchema(event.eventType);
    const registration = getHandler(event.eventType);
    assert(schema && registration, `handler não registrado para ${event.eventType}`);
    assert(
      registration.execution === 'transactional',
      `handler inesperadamente detached: ${event.eventType}`,
    );
    const payload = schema.parse(event.payload);
    await withTenant(clinicId, (tx) =>
      registration.handler({ tx, clinicId, payload, eventId: event.id, attempt: 1 }),
    );
    await dbAdmin
      .update(outbox)
      .set({ status: 'processed', attempts: 1, processedAt: new Date() })
      .where(and(eq(outbox.id, event.id), eq(outbox.status, 'pending')));
  }
}

async function executeJourney(): Promise<void> {
  await createDepositCharge({
    clinicId,
    appointment: {
      appointmentId: appointmentIds[0],
      patientId: patientIds[0],
      valor: 1000,
      scheduledAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  await createRemainderCharge({
    clinicId,
    appointment: { appointmentId: appointmentIds[1], patientId: patientIds[1], valor: 75 },
  });

  const charges = await dbAdmin
    .select({
      id: patientCharges.id,
      kind: patientCharges.kind,
      checkoutId: patientCharges.providerCheckoutId,
      invoiceUrl: patientCharges.invoiceUrl,
    })
    .from(patientCharges)
    .where(inArray(patientCharges.appointmentId, [...appointmentIds]));
  assert(charges.length === 2, `esperava 2 cobranças, encontrou ${charges.length}`);
  assert(
    charges.every((charge) => charge.checkoutId && charge.invoiceUrl),
    'Checkout sem id/link',
  );
  chargeIds = charges.map((charge) => charge.id);
  checkoutIds = charges.map((charge) => charge.checkoutId!);

  const customerMaps = await dbAdmin
    .select({ id: patientPaymentCustomers.id })
    .from(patientPaymentCustomers)
    .where(inArray(patientPaymentCustomers.patientId, [...patientIds]));
  assert(customerMaps.length === 0, 'Checkout criou customer Asaas indevido');

  const eventKeys = [...chargeIds, ...chargeIds.map((chargeId) => `charge-link:${chargeId}:g1`)];
  const events = await dbAdmin
    .select({
      id: outbox.id,
      eventType: outbox.eventType,
      payload: outbox.payload,
      status: outbox.status,
      idempotencyKey: outbox.idempotencyKey,
    })
    .from(outbox)
    .where(and(eq(outbox.clinicId, clinicId), inArray(outbox.idempotencyKey, eventKeys)));
  assert(events.length === 3, `esperava 3 eventos outbox, encontrou ${events.length}`);
  outboxIds = events.map((event) => event.id);
  await dispatchOwnEvents(events);

  const finalEvents = await dbAdmin
    .select({ status: outbox.status })
    .from(outbox)
    .where(inArray(outbox.id, outboxIds));
  assert(
    finalEvents.every((event) => event.status === 'processed'),
    'outbox não terminou processado',
  );

  const jobs = await dbAdmin
    .select({ id: aiProactiveJobs.id, type: aiProactiveJobs.type })
    .from(aiProactiveJobs)
    .where(
      and(
        eq(aiProactiveJobs.clinicId, clinicId),
        inArray(
          aiProactiveJobs.dedupKey,
          charges.map((charge) => `${charge.kind}_link:${charge.id}`),
        ),
      ),
    );
  assert(jobs.length === 2, `esperava 2 jobs C14, encontrou ${jobs.length}`);
  jobIds = jobs.map((job) => job.id);

  const deposit = await processProactiveBatch('deposit_link', { batchSize: 1 });
  const remainder = await processProactiveBatch('remainder_link', { batchSize: 1 });
  assert(deposit.sent === 1 && deposit.scanned === 1, 'template de sinal não foi aceito pela Meta');
  assert(
    remainder.sent === 1 && remainder.scanned === 1,
    'template de restante não foi aceito pela Meta',
  );

  const outbounds = await dbAdmin
    .select({
      id: outboundMessages.id,
      status: outboundMessages.status,
      providerMessageId: outboundMessages.providerMessageId,
      templateId: outboundMessages.templateId,
    })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.clinicId, clinicId),
        inArray(outboundMessages.idempotencyKey, jobIds),
      ),
    );
  assert(outbounds.length === 2, `esperava 2 outbounds, encontrou ${outbounds.length}`);
  assert(
    outbounds.every(
      (message) => TERMINAL_OUTBOUND.has(message.status) && message.providerMessageId,
    ),
    'Meta não devolveu aceite/message id para os dois templates',
  );
  assert(
    new Set(outbounds.map((message) => message.templateId)).size === 2,
    'templates não são distintos',
  );

  const [depositReplay, remainderReplay] = await Promise.all([
    processProactiveBatch('deposit_link', { batchSize: 1 }),
    processProactiveBatch('remainder_link', { batchSize: 1 }),
  ]);
  assert(
    depositReplay.scanned === 0 && remainderReplay.scanned === 0,
    'replay encontrou job duplicado',
  );
}

async function discoverCleanupTargets(): Promise<void> {
  const charges = await dbAdmin
    .select({
      id: patientCharges.id,
      kind: patientCharges.kind,
      checkoutId: patientCharges.providerCheckoutId,
    })
    .from(patientCharges)
    .where(inArray(patientCharges.appointmentId, [...appointmentIds]));
  chargeIds = [...new Set([...chargeIds, ...charges.map((charge) => charge.id)])];
  checkoutIds = [
    ...new Set([
      ...checkoutIds,
      ...charges.flatMap((charge) => (charge.checkoutId ? [charge.checkoutId] : [])),
    ]),
  ];

  if (chargeIds.length === 0) return;

  const eventKeys = [...chargeIds, ...chargeIds.map((chargeId) => `charge-link:${chargeId}:g1`)];
  const events = await dbAdmin
    .select({ id: outbox.id })
    .from(outbox)
    .where(and(eq(outbox.clinicId, clinicId), inArray(outbox.idempotencyKey, eventKeys)));
  outboxIds = [...new Set([...outboxIds, ...events.map((event) => event.id)])];

  const dedupKeys = charges.map((charge) => `${charge.kind}_link:${charge.id}`);
  const jobs = await dbAdmin
    .select({ id: aiProactiveJobs.id })
    .from(aiProactiveJobs)
    .where(
      and(eq(aiProactiveJobs.clinicId, clinicId), inArray(aiProactiveJobs.dedupKey, dedupKeys)),
    );
  jobIds = [...new Set([...jobIds, ...jobs.map((job) => job.id)])];
}

async function cleanup(): Promise<void> {
  const failures: string[] = [];
  await discoverCleanupTargets().catch(() => failures.push('cleanup_target_discovery'));

  const client = await getClinicAsaasClient(clinicId).catch(() => null);
  if (client) {
    for (const checkoutId of checkoutIds) {
      await client.cancelCheckout(checkoutId).catch(() => failures.push('cancel_checkout'));
    }
  } else if (checkoutIds.length > 0) {
    failures.push('asaas_client_unavailable');
  }

  try {
    if (jobIds.length > 0) {
      const messages = await dbAdmin
        .select({
          id: outboundMessages.id,
          status: outboundMessages.status,
          providerMessageId: outboundMessages.providerMessageId,
        })
        .from(outboundMessages)
        .where(inArray(outboundMessages.idempotencyKey, jobIds));
      const evidence = messages.filter(
        (message) => TERMINAL_OUTBOUND.has(message.status) || message.providerMessageId,
      );
      preservedOutboundCount = evidence.length;
      const disposableIds = messages
        .filter((message) => !evidence.some((item) => item.id === message.id))
        .map((message) => message.id);
      if (disposableIds.length > 0) {
        await dbAdmin.delete(outboundMessages).where(inArray(outboundMessages.id, disposableIds));
      }
    }
    if (jobIds.length > 0) {
      await dbAdmin.delete(aiProactiveJobs).where(inArray(aiProactiveJobs.id, jobIds));
    }
    if (outboxIds.length > 0) await dbAdmin.delete(outbox).where(inArray(outbox.id, outboxIds));
    await dbAdmin.delete(lancamentos).where(eq(lancamentos.id, lancamentoId));
    await dbAdmin
      .delete(patientCharges)
      .where(inArray(patientCharges.appointmentId, [...appointmentIds]));
    await dbAdmin.delete(appointments).where(inArray(appointments.id, [...appointmentIds]));
    await dbAdmin.delete(patients).where(inArray(patients.id, [...patientIds]));
  } catch {
    failures.push('database_cleanup');
  }

  const [
    patientResidue,
    appointmentResidue,
    chargeResidue,
    generationResidue,
    jobResidue,
    outboxResidue,
  ] = await Promise.all([
    dbAdmin
      .select({ id: patients.id })
      .from(patients)
      .where(inArray(patients.id, [...patientIds])),
    dbAdmin
      .select({ id: appointments.id })
      .from(appointments)
      .where(inArray(appointments.id, [...appointmentIds])),
    dbAdmin
      .select({ id: patientCharges.id })
      .from(patientCharges)
      .where(inArray(patientCharges.appointmentId, [...appointmentIds])),
    chargeIds.length === 0
      ? Promise.resolve([])
      : dbAdmin
          .select({ id: patientCheckoutGenerations.id })
          .from(patientCheckoutGenerations)
          .where(inArray(patientCheckoutGenerations.patientChargeId, chargeIds)),
    jobIds.length === 0
      ? Promise.resolve([])
      : dbAdmin
          .select({ id: aiProactiveJobs.id })
          .from(aiProactiveJobs)
          .where(inArray(aiProactiveJobs.id, jobIds)),
    outboxIds.length === 0
      ? Promise.resolve([])
      : dbAdmin.select({ id: outbox.id }).from(outbox).where(inArray(outbox.id, outboxIds)),
  ]);
  const values = [
    patientResidue.length,
    appointmentResidue.length,
    chargeResidue.length,
    generationResidue.length,
    jobResidue.length,
    outboxResidue.length,
  ];
  if (values.some((value) => value !== 0)) failures.push('database_residue');
  if (failures.length > 0)
    throw new Error(`[payments-meta-e2e] cleanup incompleto: ${failures.join(',')}`);
}

async function main(): Promise<void> {
  const requirements = await preflight();
  console.log('[payments-meta-e2e] preflight PASS; criando fixtures sintéticas.');
  try {
    await createFixtures(requirements.doctor, requirements.procedure);
    await executeJourney();
    console.log('[payments-meta-e2e] PASS: sinal e restante aceitos pela Meta, sem duplicata.');
  } finally {
    await cleanup();
    console.log(
      `[payments-meta-e2e] cleanup PASS; outbounds cifrados preservados: ${preservedOutboundCount}.`,
    );
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
