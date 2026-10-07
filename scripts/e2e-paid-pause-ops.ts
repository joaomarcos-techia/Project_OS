/**
 * Operações de aplicação usadas por `e2e/payments-paused-account-real-payment.spec.ts`.
 * O carregador ESM do Playwright não resolve os imports `next/*` do caso de uso;
 * o tsx resolve. Somente DEV + Asaas Sandbox, e somente clínicas da fixture
 * (`e2e-paid-pause-*`): qualquer outro alvo aborta antes de ler ou escrever.
 *
 *   tsx --conditions=react-server scripts/e2e-paid-pause-ops.ts create-deposit --clinic=<id> --appointment=<id>
 *   tsx --conditions=react-server scripts/e2e-paid-pause-ops.ts dispatch --clinic=<id> --replay=1
 *
 * `dispatch` processa somente eventos `pending` da clínica e de uma lista fixa de
 * tipos de Agenda/Financeiro, com as mesmas três etapas do worker (reserva,
 * handler sob tenant, finalização condicionada). Mensageria fica de fora.
 * Saída: uma linha `OPS_RESULT {json}` sem segredo.
 */
// MUST be first: loads `.env.local` before any `@/lib/*` module validates env.
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { createDepositCharge } from '@/contexts/payments/internal/deposit-charge';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { getEventSchema } from '@/lib/outbox/catalog';
import { getHandler } from '@/lib/outbox/registry';

import '@/contexts/scheduling/internal/handlers/patient-charge-created';
import '@/contexts/scheduling/internal/handlers/patient-charge-paid';
import '@/contexts/financial/internal/handlers/patient-credit-granted';
import '@/contexts/financial/internal/handlers/patient-payment-economics-reconciled';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const FIXTURE_SLUG_PREFIX = 'e2e-paid-pause-';
const DISPATCH_ALLOWLIST = [
  'payments.patient_charge.created',
  'payments.patient_charge.paid',
  'payments.patient_credit.granted',
  'payments.patient_payment.economics_reconciled',
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function argValue(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  assert(value && /^[0-9a-f-]{36}$|^[01]$/i.test(value), `argumento inválido: ${name}`);
  return value;
}

function assertTargets(): void {
  const { databaseUrl } = assertDevContext();
  const dbRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  const authUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const asaasBase = process.env.ASAAS_BASE_URL;
  assert(dbRef === DEV_PROJECT_REF, 'Banco não é o projeto DEV autorizado.');
  assert(authUrl && new URL(authUrl).hostname.split('.')[0] === DEV_PROJECT_REF, 'Auth não é DEV.');
  assert(
    asaasBase && new URL(asaasBase).hostname.endsWith('sandbox.asaas.com'),
    'Asaas fora do Sandbox.',
  );
}

async function assertFixtureClinic(clinicId: string): Promise<void> {
  const [clinic] = await dbAdmin.execute<{ slug: string }>(sql`
    SELECT slug FROM clinics WHERE id = ${clinicId}
  `);
  assert(clinic?.slug.startsWith(FIXTURE_SLUG_PREFIX), 'Clínica não pertence à fixture.');
}

async function createDeposit(clinicId: string, appointmentId: string): Promise<unknown> {
  const [appointment] = await dbAdmin.execute<{
    patient_id: string | null;
    valor: string;
    scheduled_at: string;
  }>(sql`
    SELECT patient_id::text AS patient_id, valor::text AS valor, scheduled_at::text AS scheduled_at
      FROM appointments WHERE id = ${appointmentId} AND clinic_id = ${clinicId}
  `);
  assert(appointment, 'Agendamento da fixture ausente.');
  await createDepositCharge({
    clinicId,
    appointment: {
      appointmentId,
      patientId: appointment.patient_id,
      valor: Number(appointment.valor),
      scheduledAt: new Date(appointment.scheduled_at).toISOString(),
      commercialPaymentMethod: null,
      commercialInstallmentCount: null,
    },
  });
  return { op: 'create-deposit', ok: true };
}

async function runHandler(input: {
  clinicId: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  attempt: number;
}): Promise<void> {
  const registered = getHandler(input.eventType);
  assert(registered, `Handler ausente para ${input.eventType}.`);
  if (registered.execution === 'detached') {
    await registered.handler({
      clinicId: input.clinicId,
      payload: input.payload,
      eventId: input.eventId,
      attempt: input.attempt,
    });
    return;
  }
  await withTenant(input.clinicId, (tx) =>
    registered.handler({
      tx,
      clinicId: input.clinicId,
      payload: input.payload,
      eventId: input.eventId,
      attempt: input.attempt,
    }),
  );
}

async function dispatch(clinicId: string, replay: boolean): Promise<unknown> {
  const dispatched: Array<{ id: string; eventType: string; payload: unknown; attempt: number }> =
    [];
  const allowed = sql.join(
    DISPATCH_ALLOWLIST.map((type) => sql`${type}`),
    sql`, `,
  );
  for (;;) {
    // Reserva, como a TX1 do worker, restrita à clínica e aos tipos permitidos.
    const [row] = await dbAdmin.execute<{
      id: string;
      event_type: string;
      payload: unknown;
      attempts: number;
    }>(sql`
      UPDATE outbox
         SET status = 'processing', attempts = attempts + 1, processing_started_at = now()
       WHERE id = (
         SELECT id FROM outbox
          WHERE clinic_id = ${clinicId} AND status = 'pending'
            AND event_type IN (${allowed})
          ORDER BY created_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       ) AND status = 'pending'
      RETURNING id::text AS id, event_type, payload, attempts
    `);
    if (!row) break;
    const schema = getEventSchema(row.event_type);
    assert(schema, `Schema ausente para ${row.event_type}.`);
    const payload: unknown = schema.parse(row.payload);
    try {
      await runHandler({
        clinicId,
        eventType: row.event_type,
        eventId: row.id,
        payload,
        attempt: row.attempts,
      });
    } catch (error) {
      await dbAdmin.execute(sql`
        UPDATE outbox SET status = 'pending', processing_started_at = NULL
         WHERE id = ${row.id} AND status = 'processing'
      `);
      throw new Error(
        `handler ${row.event_type} falhou: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`,
      );
    }
    // Finalização condicionada, como a TX3 do worker.
    const finalized = await dbAdmin.execute<{ id: string }>(sql`
      UPDATE outbox SET status = 'processed', processed_at = now(), processing_started_at = NULL
       WHERE id = ${row.id} AND status = 'processing' AND attempts = ${row.attempts}
      RETURNING id::text AS id
    `);
    assert(finalized.length === 1, `finalização perdeu a corrida em ${row.event_type}`);
    dispatched.push({ id: row.id, eventType: row.event_type, payload, attempt: row.attempts });
  }
  if (replay) {
    // Entrega at-least-once: a mesma mensagem pode voltar ao handler.
    for (const item of dispatched) {
      await runHandler({
        clinicId,
        eventType: item.eventType,
        eventId: item.id,
        payload: item.payload,
        attempt: item.attempt + 1,
      });
    }
  }
  return {
    op: 'dispatch',
    dispatched: dispatched.map((item) => item.eventType),
    replayed: replay ? dispatched.length : 0,
  };
}

async function main(): Promise<void> {
  assertTargets();
  const op = process.argv[2];
  const clinicId = argValue('clinic');
  await assertFixtureClinic(clinicId);
  let result: unknown;
  if (op === 'create-deposit') {
    result = await createDeposit(clinicId, argValue('appointment'));
  } else if (op === 'dispatch') {
    result = await dispatch(clinicId, argValue('replay') === '1');
  } else {
    throw new Error('operação desconhecida');
  }
  process.stdout.write(`OPS_RESULT ${JSON.stringify(result)}\n`, () => process.exit(0));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message.replace(/\b[a-z]+:\/\/\S+/gi, '<url>').slice(0, 240)}\n`);
  process.exit(1);
});
