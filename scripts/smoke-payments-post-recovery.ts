/**
 * Hardening 1.H — recuperação de POST perdido com banco DEV e provedor local.
 *
 * O servidor HTTP sintético aceita o primeiro POST /payments, persiste a
 * cobrança em memória e derruba o socket antes da resposta. A segunda execução
 * precisa localizar a cobrança por externalReference, gravá-la uma vez no Qoro
 * e não repetir o POST. Não chama Asaas nem Meta.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { sql } from 'drizzle-orm';

assertDevContext();

interface StoredPayment {
  id: string;
  customer: string;
  status: string;
  value: number;
  dueDate: string;
  invoiceUrl: string;
  billingType: string;
  externalReference: string;
  deleted: boolean;
}

const runId = randomUUID();
const stamp = runId.replaceAll('-', '').slice(0, 12);
const clinicId = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const appointmentId = randomUUID();
const webhookRef = randomUUID();
let doctorId: string | null = null;

let payment: StoredPayment | null = null;
let getPaymentsCount = 0;
let postPaymentsCount = 0;
let sawAccessToken = false;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const current = error.stack ?? error.message;
  return error.cause ? `${current}\nCaused by: ${errorDetail(error.cause)}` : current;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    sawAccessToken ||= typeof req.headers.access_token === 'string';

    if (req.method === 'GET' && url.pathname === '/v3/payments') {
      getPaymentsCount++;
      const requestedRef = url.searchParams.get('externalReference');
      json(res, 200, {
        data: payment?.externalReference === requestedRef ? [payment] : [],
        hasMore: false,
        totalCount: payment?.externalReference === requestedRef ? 1 : 0,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v3/payments') {
      postPaymentsCount++;
      const body = await readJson(req);
      const externalReference = String(body.externalReference ?? '');
      assert(
        externalReference === `deposit:${appointmentId}`,
        'externalReference incorreta no POST',
      );
      assert(body.description === 'Sinal do agendamento', 'descrição da cobrança não é genérica');
      assert(
        JSON.stringify(body).includes('Consulta sintética') === false,
        'procedimento vazou no POST',
      );

      payment = {
        id: `pay_post_lost_${stamp}`,
        customer: String(body.customer),
        status: 'PENDING',
        value: Number(body.value),
        dueDate: String(body.dueDate),
        invoiceUrl: `http://127.0.0.1/invoice/pay_post_lost_${stamp}`,
        billingType: String(body.billingType),
        externalReference,
        deleted: false,
      };

      // O provedor criou a cobrança, mas a resposta nunca chegou ao Qoro.
      req.socket.destroy();
      return;
    }

    json(res, 404, { errors: [{ code: 'not_found' }] });
  })().catch((error) => {
    if (!res.headersSent) json(res, 500, { errors: [{ code: 'fixture_error' }] });
    console.error(errorDetail(error));
  });
});

async function listen(): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/v3`;
}

async function closeServer(): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function main(): Promise<void> {
  const baseUrl = await listen();
  process.env.ASAAS_BASE_URL = baseUrl;
  process.env.ASAAS_BASE_URL_DEV = baseUrl;

  // Imports dinâmicos são deliberados: env.ts precisa ler a URL do provedor
  // local antes de construir o client cacheado da clínica.
  const [{ createAdminClient }, { encryptForTenant, hashForLookup }, { dbAdmin }, { withTenant }] =
    await Promise.all([
      import('@/lib/auth/supabase-admin'),
      import('@/lib/crypto'),
      import('@/lib/db'),
      import('@/lib/db/tenant'),
    ]);
  const [{ patients }, { appointments, procedures }, paymentSchema, { createDepositCharge }] =
    await Promise.all([
      import('@/contexts/patient'),
      import('@/contexts/scheduling'),
      import('@/contexts/payments/schema'),
      import('@/contexts/payments/internal/deposit-charge'),
    ]);

  const supabase = createAdminClient();

  async function cleanup(): Promise<void> {
    for (const table of ['outbox', 'idempotency_keys', 'audit_events'] as const) {
      await dbAdmin.execute(sql`DELETE FROM ${sql.raw(table)} WHERE clinic_id = ${clinicId}`);
    }
    await dbAdmin.execute(sql`DELETE FROM patient_webhook_events WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM patient_payment_customers WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM patient_charges WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM clinic_deposit_policy WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM clinic_payment_accounts WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM appointments WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM patients WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM procedures WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM profiles WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${clinicId}`);

    if (doctorId) {
      const removed = await supabase.auth.admin.deleteUser(doctorId);
      if (removed.error) throw removed.error;
    }

    const residue = await dbAdmin.execute<{ total: number }>(sql`
      SELECT (
        (SELECT count(*) FROM clinics WHERE id = ${clinicId}) +
        (SELECT count(*) FROM appointments WHERE clinic_id = ${clinicId}) +
        (SELECT count(*) FROM patient_charges WHERE clinic_id = ${clinicId}) +
        (SELECT count(*) FROM clinic_payment_accounts WHERE clinic_id = ${clinicId}) +
        (SELECT count(*) FROM outbox WHERE clinic_id = ${clinicId})
      )::int AS total
    `);
    assert(residue[0]?.total === 0, `cleanup incompleto: ${residue[0]?.total}`);
  }

  try {
    await dbAdmin.execute(sql`
      INSERT INTO clinics (id, slug, nome, endereco, status, timezone)
      VALUES (
        ${clinicId}, ${`h1-post-recovery-${stamp}`}, '1.H POST Recovery',
        'Fixture sintética', 'active', 'America/Sao_Paulo'
      )
    `);

    const created = await supabase.auth.admin.createUser({
      email: `h1-post-recovery-${stamp}@smoke.local`,
      password: randomUUID(),
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error('não foi possível criar médico sintético');
    }
    doctorId = created.data.user.id;

    await dbAdmin.execute(sql`
      INSERT INTO profiles (id, clinic_id, nome, role, ativo)
      VALUES (${doctorId}, ${clinicId}, 'Dra. POST Recovery', 'doctor'::role_enum, true)
    `);

    const cpf = '39053344705';
    const [cpfEncrypted, cpfHash, apiKeyEncrypted, apiKeyHash, webhookTokenEncrypted] =
      await Promise.all([
        encryptForTenant(clinicId, cpf),
        hashForLookup(cpf),
        encryptForTenant(clinicId, 'fake-provider-api-key'),
        hashForLookup('fake-provider-api-key'),
        encryptForTenant(clinicId, 'fake-provider-webhook-token-32bytes'),
      ]);

    await withTenant(clinicId, async (tx) => {
      await tx.insert(procedures).values({
        id: procedureId,
        clinicId,
        codigo: `POST-${stamp.slice(0, 6)}`,
        descricao: 'Consulta sintética POST recovery',
        valorPadrao: '200.00',
        duracaoPadraoMin: 30,
      });
      await tx.insert(patients).values({
        id: patientId,
        clinicId,
        nome: 'Paciente Sintético POST Recovery',
        cpfEncrypted,
        cpfHash,
      });
      await tx.insert(appointments).values({
        id: appointmentId,
        clinicId,
        doctorId: doctorId!,
        patientId,
        procedureId,
        scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        durationMin: 30,
        status: 'agendado',
        valor: '200.00',
        snapshotProcedureName: 'Consulta sintética POST recovery',
        snapshotProcedureValor: '200.00',
        snapshotProcedureDuracaoMin: 30,
        snapshotDoctorNome: 'Dra. POST Recovery',
      });
      await tx.insert(paymentSchema.clinicDepositPolicy).values({
        clinicId,
        enabled: true,
        percent: 50,
        cancellationWindowHours: 24,
        appliesToFirstVisit: true,
        appliesToReturn: true,
        updatedBy: doctorId,
      });
      await tx.insert(paymentSchema.patientPaymentCustomers).values({
        clinicId,
        patientId,
        provider: 'asaas',
        providerCustomerId: `cus_fake_${stamp}`,
      });
    });

    await dbAdmin.execute(sql`
      INSERT INTO clinic_payment_accounts
        (clinic_id, provider, api_key_encrypted, api_key_hash, key_version,
         account_name, active, webhook_ref, webhook_token_encrypted,
         connected_at, connected_by)
      VALUES
        (${clinicId}, 'asaas', ${apiKeyEncrypted}, ${apiKeyHash}, 1,
         'Provedor local controlado', true, ${webhookRef}, ${webhookTokenEncrypted},
         now(), ${doctorId})
    `);

    const appointment = {
      appointmentId,
      patientId,
      valor: 200,
      scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const firstError = await createDepositCharge({ clinicId, appointment }).catch(
      (error: unknown) => error,
    );
    assert(
      firstError instanceof Error && firstError.name === 'BillingProviderUnreachableError',
      `primeiro POST não ficou indeterminado: ${errorDetail(firstError)}`,
    );

    const afterLostPost = await dbAdmin.execute<{ charges: number }>(sql`
      SELECT count(*)::int AS charges
        FROM patient_charges
       WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}
    `);
    assert(afterLostPost[0]?.charges === 0, 'Qoro gravou cobrança sem receber a resposta do POST');
    assert(postPaymentsCount === 1, `provedor recebeu ${postPaymentsCount} POSTs`);

    await createDepositCharge({ clinicId, appointment });
    await createDepositCharge({ clinicId, appointment });

    const state = await dbAdmin.execute<{
      charges: number;
      providerPaymentId: string | null;
      createdEvents: number;
      linkEvents: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM patient_charges
          WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}) AS charges,
        (SELECT provider_payment_id FROM patient_charges
          WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}) AS "providerPaymentId",
        (SELECT count(*)::int FROM outbox
          WHERE clinic_id = ${clinicId}
            AND event_type = 'payments.patient_charge.created'
            AND payload->>'appointmentId' = ${appointmentId}) AS "createdEvents",
        (SELECT count(*)::int FROM outbox
          WHERE clinic_id = ${clinicId}
            AND event_type = 'payments.patient_charge.link_ready'
            AND payload->>'appointmentId' = ${appointmentId}) AS "linkEvents"
    `);

    assert(sawAccessToken, 'client não enviou a credencial decifrada ao provedor local');
    assert(getPaymentsCount === 2, `esperava 2 GETs de recuperação; vieram ${getPaymentsCount}`);
    assert(postPaymentsCount === 1, `retry duplicou o POST: ${postPaymentsCount}`);
    assert(state[0]?.charges === 1, `foram gravadas ${state[0]?.charges} cobranças locais`);
    assert(state[0]?.providerPaymentId === payment?.id, 'Qoro não vinculou a cobrança recuperada');
    assert(state[0]?.createdEvents === 1, `foram publicados ${state[0]?.createdEvents} created`);
    assert(state[0]?.linkEvents === 1, `foram publicados ${state[0]?.linkEvents} link_ready`);

    console.log(
      '[OK] POST perdido: 1 criação no provedor · 2 GETs · 1 cobrança local · 2 eventos · sem duplicata',
    );
  } finally {
    await cleanup();
    await closeServer();
    console.log('[OK] cleanup: provedor encerrado, fixture e usuário removidos, resíduo zero');
  }
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    await closeServer().catch(() => undefined);
    console.error(errorDetail(error));
    process.exit(1);
  });
