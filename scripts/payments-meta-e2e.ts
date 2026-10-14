/**
 * E2E real e controlado: Checkout Asaas da clínica -> outbox -> C14 -> Meta.
 *
 * Modo padrão: duas fixtures sintéticas (sinal e restante), dois templates e
 * limpeza dos dados criados. Modo de pagamento humano: só sinal; mantém o
 * Checkout Sandbox ativo para o destinatário consentido pagar depois.
 * Nenhuma URL, credencial ou telefone é impressa.
 *
 * Guardas:
 *   PAYMENTS_META_E2E=ALLOW_REAL_META
 *   ou PAYMENTS_META_E2E=ALLOW_SANDBOX_HUMAN_PAYMENT
 *   PAYMENTS_META_E2E_CLINIC_ID=<uuid da clínica DEV/Preview>
 *   META_E2E_RECIPIENT_E164=<destinatário consentido>
 *   APP_BASE_URL=https://<host público>
 */
import { assertDevContext } from './_env';

import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';
import { aiProactiveJobs } from '@/contexts/ai-agent/proactive-jobs/schema';
import { lancamentos } from '@/contexts/financial';
import { outboundMessages } from '@/contexts/messaging';
import { patientConsentDecisions, patientConsents, patients } from '@/contexts/patient';
import {
  clinicPaymentAccounts,
  patientCharges,
  patientCheckoutGenerations,
  patientPaymentCustomers,
} from '@/contexts/payments/schema';
import { createDepositCharge } from '@/contexts/payments/internal/deposit-charge';
import { createRemainderCharge } from '@/contexts/payments/internal/remainder-charge';
import { appointments } from '@/contexts/scheduling';
import {
  decryptForTenant,
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
import { assertPreviewRuntimeIsDev, DEV_PROJECT_REF } from '../e2e/preview-dev-runtime';

// Registra os handlers reais consumidos pelo worker.
import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

const { databaseUrl } = assertDevContext();

const OPT_IN = 'ALLOW_REAL_META';
const HUMAN_PAYMENT_OPT_IN = 'ALLOW_SANDBOX_HUMAN_PAYMENT';
const MOVE_WEBHOOK_OPT_IN = 'ALLOW_SANDBOX_PREVIEW_WEBHOOK_MOVE';
const humanPayment = process.env.PAYMENTS_META_E2E === HUMAN_PAYMENT_OPT_IN;
const checkoutMethod = process.env.PAYMENTS_META_E2E_METHOD;
const humanPaymentMethod: 'credit_card' | null =
  checkoutMethod === 'CREDIT_CARD' ? 'credit_card' : null;
const fixtureCount = humanPayment ? 1 : 2;
const handoffFile = join('.tmp', 'payments-meta-deposit-handoff.json');
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
let metaSendAttempted = false;

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

async function assertSandboxWebhookTargetsPreview(previewOrigin: string, asaasBase: string) {
  const [account] = await dbAdmin
    .select({
      apiKeyEncrypted: clinicPaymentAccounts.apiKeyEncrypted,
      webhookRef: clinicPaymentAccounts.webhookRef,
    })
    .from(clinicPaymentAccounts)
    .where(
      and(
        eq(clinicPaymentAccounts.clinicId, clinicId),
        eq(clinicPaymentAccounts.provider, 'asaas'),
      ),
    )
    .limit(1);
  assert(account?.apiKeyEncrypted && account.webhookRef, 'conta Sandbox incompleta');
  const apiKey = await decryptForTenant(clinicId, account.apiKeyEncrypted);
  const response = await fetch(`${asaasBase.replace(/\/$/, '')}/webhooks?offset=0&limit=100`, {
    headers: { access_token: apiKey, 'User-Agent': 'Qoro E2E preflight' },
    signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `Asaas Sandbox recusou leitura de webhooks (HTTP ${response.status})`);
  const body: unknown = await response.json();
  assert(body && typeof body === 'object' && 'data' in body, 'lista de webhooks inválida');
  const entries = body.data;
  assert(Array.isArray(entries), 'lista de webhooks inválida');
  const matching = entries.filter((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('url' in entry)) return false;
    if (typeof entry.url !== 'string') return false;
    try {
      return new URL(entry.url).pathname === `/api/webhooks/asaas/patient/${account.webhookRef}`;
    } catch {
      return false;
    }
  });
  assert(matching.length === 1, 'webhook da clínica ausente ou duplicado no Sandbox');
  const webhook: unknown = matching[0];
  assert(
    webhook &&
      typeof webhook === 'object' &&
      'id' in webhook &&
      typeof webhook.id === 'string' &&
      'url' in webhook &&
      typeof webhook.url === 'string',
    'webhook da clínica inválido no Sandbox',
  );
  const url = new URL(webhook.url);
  assert(
    'enabled' in webhook &&
      webhook.enabled === true &&
      'interrupted' in webhook &&
      webhook.interrupted !== true,
    'webhook Sandbox inativo',
  );
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  assert(bypass, 'bypass do Preview ausente');
  const expected = new URL(`/api/webhooks/asaas/patient/${account.webhookRef}`, previewOrigin);
  expected.searchParams.set('x-vercel-protection-bypass', bypass);
  if (url.toString() !== expected.toString()) {
    assert(
      process.env.PAYMENTS_META_E2E_MOVE_WEBHOOK === MOVE_WEBHOOK_OPT_IN,
      'webhook Sandbox aponta para outro Preview',
    );
    assert(url.hostname.endsWith('.vercel.app'), 'webhook atual não é Preview Vercel');
    const routeResponse = await fetch(expected, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    assert(routeResponse.status === 405, 'rota de webhook não respondeu 405 no novo Preview');
    const changed = await fetch(
      `${asaasBase.replace(/\/$/, '')}/webhooks/${encodeURIComponent(webhook.id)}`,
      {
        method: 'PUT',
        headers: {
          access_token: apiKey,
          'User-Agent': 'Qoro E2E preflight',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: expected.toString() }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert(changed.ok, `Asaas Sandbox recusou troca do callback (HTTP ${changed.status})`);
  }
  const readback = await fetch(
    `${asaasBase.replace(/\/$/, '')}/webhooks/${encodeURIComponent(webhook.id)}`,
    {
      headers: { access_token: apiKey, 'User-Agent': 'Qoro E2E preflight' },
      signal: AbortSignal.timeout(15_000),
    },
  );
  assert(readback.ok, `Asaas Sandbox recusou readback do webhook (HTTP ${readback.status})`);
  const configured: unknown = await readback.json();
  assert(
    configured &&
      typeof configured === 'object' &&
      'url' in configured &&
      configured.url === expected.toString() &&
      'enabled' in configured &&
      configured.enabled === true &&
      'interrupted' in configured &&
      configured.interrupted !== true,
    'readback do webhook Sandbox não confirmou Preview ativo',
  );
}

async function preflight(): Promise<{ doctor: DoctorRow; procedure: ProcedureRow }> {
  assert(
    [OPT_IN, HUMAN_PAYMENT_OPT_IN].includes(process.env.PAYMENTS_META_E2E ?? ''),
    `PAYMENTS_META_E2E deve ser ${OPT_IN} ou ${HUMAN_PAYMENT_OPT_IN}`,
  );
  assert(UUID.test(clinicId), 'PAYMENTS_META_E2E_CLINIC_ID deve ser UUID');
  assert(E164.test(recipient), 'META_E2E_RECIPIENT_E164 deve estar em E.164');
  assert(
    !checkoutMethod || (humanPayment && checkoutMethod === 'CREDIT_CARD'),
    'PAYMENTS_META_E2E_METHOD deve ser CREDIT_CARD no modo de pagamento humano',
  );
  assert(process.env.APP_BASE_URL?.startsWith('https://'), 'APP_BASE_URL HTTPS é obrigatória');
  assert(process.env.META_TEMPLATE_DEPOSIT_LINK_ID, 'template Meta de sinal não configurado');
  if (!humanPayment) {
    assert(
      process.env.META_TEMPLATE_REMAINDER_LINK_ID,
      'template Meta de restante não configurado',
    );
  }
  if (humanPayment) {
    const dbRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
    assert(dbRef === DEV_PROJECT_REF, 'banco local não é o projeto DEV esperado');
    assert(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0] === DEV_PROJECT_REF,
      'Auth local não é o projeto DEV esperado',
    );
    assert(!existsSync(handoffFile), 'handoff anterior ainda existe; não criar outra cobrança');
    const appBase = new URL(process.env.APP_BASE_URL!);
    assert(appBase.hostname.endsWith('.vercel.app'), 'handoff exige Preview Vercel isolado');
    assert(process.env.ASAAS_BASE_URL, 'ASAAS_BASE_URL explícita é obrigatória');
    const asaasBase = new URL(process.env.ASAAS_BASE_URL);
    assert(
      asaasBase.protocol === 'https:' &&
        ((asaasBase.hostname === 'api-sandbox.asaas.com' && asaasBase.pathname === '/v3') ||
          (asaasBase.hostname === 'sandbox.asaas.com' && asaasBase.pathname === '/api/v3')),
      'handoff exige somente Asaas Sandbox',
    );
    await assertPreviewRuntimeIsDev(appBase.origin);
  }

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
        WHERE (type = 'deposit_link' OR (${!humanPayment} AND type = 'remainder_link'))
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
  if (humanPayment) {
    await assertSandboxWebhookTargetsPreview(
      new URL(process.env.APP_BASE_URL!).origin,
      process.env.ASAAS_BASE_URL!,
    );
  }
  return { doctor: doctors[0], procedure: procedures[0] };
}

async function createFixtures(doctor: DoctorRow, procedure: ProcedureRow): Promise<void> {
  const phone = normalizePhone(recipient);
  const phoneHash = await hashForLookup(phone);
  const phoneEncrypted = await encryptForTenant(clinicId, phone);
  const identities = await Promise.all(
    [0, 100_000].slice(0, fixtureCount).map((offset) => uniqueCpf(offset)),
  );
  const cpfEncrypted = await Promise.all(
    identities.map((identity) => encryptForTenant(clinicId, identity.cpf)),
  );
  const now = Date.now();
  const depositAt = new Date(now + 180 * 24 * 60 * 60 * 1000 + randomInt(1, 30_000));
  const remainderAt = new Date(now - 180 * 24 * 60 * 60 * 1000 - randomInt(1, 30_000));

  await withTenant(clinicId, async (tx) => {
    await tx.insert(patients).values(
      patientIds.slice(0, fixtureCount).map((id, index) => ({
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
      patientIds.slice(0, fixtureCount).map((patientId) => ({
        clinicId,
        patientId,
        cobrancaWhatsapp: true,
        versao: 1,
      })),
    );
    await tx.insert(patientConsentDecisions).values(
      patientIds.slice(0, fixtureCount).map((patientId) => ({
        clinicId,
        patientId,
        purpose: 'agendamento_whatsapp' as const,
        channel: 'whatsapp' as const,
        granted: true,
        version: 1,
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
    await tx.insert(appointments).values(
      [
        {
          ...snapshot,
          id: appointmentIds[0],
          patientId: patientIds[0],
          scheduledAt: depositAt,
          status: 'agendado' as const,
          valor: humanPayment ? '20.00' : '1000.00',
          valorAjustado: true,
          valorAjusteMotivo: 'Fixture E2E controlada',
        },
        {
          ...snapshot,
          id: appointmentIds[1],
          patientId: patientIds[1],
          scheduledAt: remainderAt,
          status: 'atendido' as const,
          valor: '75.00',
          valorAjustado: true,
          valorAjusteMotivo: 'Fixture E2E controlada',
        },
      ].slice(0, fixtureCount),
    );
    if (!humanPayment) {
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
    }
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
      valor: humanPayment ? 20 : 1000,
      scheduledAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      ...(humanPaymentMethod
        ? { commercialPaymentMethod: humanPaymentMethod, commercialInstallmentCount: 1 }
        : {}),
    },
  });
  if (!humanPayment) {
    await createRemainderCharge({
      clinicId,
      appointment: { appointmentId: appointmentIds[1], patientId: patientIds[1], valor: 75 },
    });
  }

  const charges = await dbAdmin
    .select({
      id: patientCharges.id,
      kind: patientCharges.kind,
      checkoutId: patientCharges.providerCheckoutId,
      invoiceUrl: patientCharges.invoiceUrl,
    })
    .from(patientCharges)
    .where(inArray(patientCharges.appointmentId, [...appointmentIds]));
  assert(
    charges.length === fixtureCount,
    `esperava ${fixtureCount} cobranças, encontrou ${charges.length}`,
  );
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
  assert(
    events.length === (humanPayment ? 2 : 3),
    `quantidade inesperada de eventos outbox: ${events.length}`,
  );
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
  assert(
    jobs.length === fixtureCount,
    `esperava ${fixtureCount} jobs C14, encontrou ${jobs.length}`,
  );
  jobIds = jobs.map((job) => job.id);

  if (humanPayment) metaSendAttempted = true;
  const deposit = await processProactiveBatch('deposit_link', { batchSize: 1 });
  assert(deposit.sent === 1 && deposit.scanned === 1, 'template de sinal não foi aceito pela Meta');
  if (!humanPayment) {
    const remainder = await processProactiveBatch('remainder_link', { batchSize: 1 });
    assert(
      remainder.sent === 1 && remainder.scanned === 1,
      'template de restante não foi aceito pela Meta',
    );
  }

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
  assert(
    outbounds.length === fixtureCount,
    `esperava ${fixtureCount} outbounds, encontrou ${outbounds.length}`,
  );
  assert(
    outbounds.every(
      (message) => TERMINAL_OUTBOUND.has(message.status) && message.providerMessageId,
    ),
    'Meta não devolveu aceite/message id para os templates esperados',
  );
  assert(
    new Set(outbounds.map((message) => message.templateId)).size === fixtureCount,
    'templates não são distintos',
  );

  const depositReplay = await processProactiveBatch('deposit_link', { batchSize: 1 });
  assert(depositReplay.scanned === 0, 'replay encontrou job de sinal duplicado');
  if (!humanPayment) {
    const remainderReplay = await processProactiveBatch('remainder_link', { batchSize: 1 });
    assert(remainderReplay.scanned === 0, 'replay encontrou job de restante duplicado');
  }
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

async function saveHumanPaymentHandoff(): Promise<void> {
  const [charge] = await dbAdmin
    .select({
      id: patientCharges.id,
      amount: patientCharges.amount,
      checkoutId: patientCharges.providerCheckoutId,
      status: patientCharges.status,
    })
    .from(patientCharges)
    .where(eq(patientCharges.appointmentId, appointmentIds[0]))
    .limit(1);
  assert(
    charge?.checkoutId && charge.status === 'pending',
    'sinal não está pendente com Checkout ativo para o handoff',
  );
  const [outbound] = await dbAdmin
    .select({
      id: outboundMessages.id,
      status: outboundMessages.status,
      providerMessageId: outboundMessages.providerMessageId,
    })
    .from(outboundMessages)
    .where(eq(outboundMessages.idempotencyKey, jobIds[0]!))
    .limit(1);
  assert(
    outbound?.providerMessageId && TERMINAL_OUTBOUND.has(outbound.status),
    'template do sinal ainda não foi aceito pela Meta',
  );
  const state = {
    status: 'awaiting_sandbox_payment',
    createdAt: new Date().toISOString(),
    clinicId,
    patientId: patientIds[0],
    appointmentId: appointmentIds[0],
    chargeId: charge.id,
    checkoutId: charge.checkoutId,
    amount: charge.amount,
    outboundId: outbound.id,
    providerMessageId: outbound.providerMessageId,
  };
  const nextFile = `${handoffFile}.next`;
  await writeFile(nextFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(nextFile, handoffFile);
}

async function main(): Promise<void> {
  const requirements = await preflight();
  if (humanPayment) {
    await mkdir('.tmp', { recursive: true });
    await writeFile(
      handoffFile,
      JSON.stringify({
        status: 'preparing',
        createdAt: new Date().toISOString(),
        clinicId,
        patientId: patientIds[0],
        appointmentId: appointmentIds[0],
      }),
      { flag: 'wx', mode: 0o600 },
    );
  }
  console.log('[payments-meta-e2e] preflight PASS; criando fixtures sintéticas.');
  let handedOff = false;
  try {
    await createFixtures(requirements.doctor, requirements.procedure);
    await executeJourney();
    if (humanPayment) {
      await saveHumanPaymentHandoff();
      handedOff = true;
      console.log(
        '[payments-meta-e2e] SINAL PRONTO: Meta aceitou um template; Checkout Sandbox mantido ativo para o pagamento humano. Confirme o recebimento no aparelho antes de pagar.',
      );
    } else {
      console.log('[payments-meta-e2e] PASS: sinal e restante aceitos pela Meta, sem duplicata.');
    }
  } finally {
    if (humanPayment && metaSendAttempted && !handedOff) {
      await writeFile(
        handoffFile,
        JSON.stringify({
          status: 'manual_review_required',
          createdAt: new Date().toISOString(),
          clinicId,
          patientId: patientIds[0],
          appointmentId: appointmentIds[0],
        }),
        { mode: 0o600 },
      );
      console.error(
        '[payments-meta-e2e] envio Meta foi tentado; cobrança preservada para inspeção antes de qualquer cleanup.',
      );
    } else if (!handedOff) {
      await cleanup();
      if (humanPayment) await unlink(handoffFile);
      console.log(
        `[payments-meta-e2e] cleanup PASS; outbounds cifrados preservados: ${preservedOutboundCount}.`,
      );
    }
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
