/**
 * Hardening 1.H — contenção de POST indeterminado com banco DEV e provedor local.
 *
 * O servidor HTTP sintético aceita o primeiro POST /checkouts e derruba o socket
 * antes da resposta. O Qoro precisa manter a dívida e a geração como
 * `creation_unknown`, não publicar link e não repetir o POST. Não chama Asaas
 * nem Meta.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { sql } from 'drizzle-orm';

assertDevContext();

const runId = randomUUID();
const stamp = runId.replaceAll('-', '').slice(0, 12);
const clinicId = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const appointmentId = randomUUID();
const webhookRef = randomUUID();
let doctorId: string | null = null;

let acceptedCheckout = false;
let postCheckoutsCount = 0;
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

    if (req.method === 'POST' && url.pathname === '/v3/checkouts') {
      postCheckoutsCount++;
      const body = await readJson(req);
      const externalReference = String(body.externalReference ?? '');
      assert(
        externalReference === `deposit:${appointmentId}:g1`,
        'externalReference incorreta no POST',
      );
      assert(
        JSON.stringify(body.billingTypes) === JSON.stringify(['PIX', 'CREDIT_CARD']),
        'Checkout não ficou restrito a PIX/cartão',
      );
      assert(
        JSON.stringify(body.chargeTypes) === JSON.stringify(['DETACHED']),
        'Checkout não ficou avulso',
      );
      const items = Array.isArray(body.items) ? body.items : [];
      const item = items[0] as Record<string, unknown> | undefined;
      assert(items.length === 1, 'Checkout não recebeu exatamente um item');
      assert(item?.name === 'Sinal do agendamento', 'descrição da cobrança não é genérica');
      assert(item?.description === 'Sinal do agendamento', 'descrição do item não é genérica');
      assert(item?.quantity === 1, 'quantidade do item não é unitária');
      assert(item?.value === 100, `valor incorreto no Checkout: ${String(item?.value)}`);
      assert(
        JSON.stringify(body).includes('Consulta sintética') === false,
        'procedimento vazou no POST',
      );
      assert(typeof body.callback === 'object', 'callbacks do Checkout ausentes');

      // O provedor aceitou a criação, mas a resposta nunca chegou ao Qoro.
      acceptedCheckout = true;
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
  // O Checkout exige callbacks válidos. O smoke nunca os navega; usar a
  // origem do servidor efêmero mantém toda URL e todo tráfego em localhost.
  process.env.APP_BASE_URL = new URL(baseUrl).origin;

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
        ${clinicId}, ${`h1-post-unknown-${stamp}`}, '1.H POST Unknown',
        'Fixture sintética', 'active', 'America/Sao_Paulo'
      )
    `);

    const created = await supabase.auth.admin.createUser({
      email: `h1-post-unknown-${stamp}@smoke.local`,
      password: randomUUID(),
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error('não foi possível criar médico sintético');
    }
    doctorId = created.data.user.id;

    await dbAdmin.execute(sql`
      INSERT INTO profiles (id, clinic_id, nome, role, ativo)
      VALUES (${doctorId}, ${clinicId}, 'Dra. POST Unknown', 'doctor'::role_enum, true)
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
        descricao: 'Consulta sintética POST unknown',
        valorPadrao: '200.00',
        duracaoPadraoMin: 30,
      });
      await tx.insert(patients).values({
        id: patientId,
        clinicId,
        nome: 'Paciente Sintético POST Unknown',
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
        snapshotProcedureName: 'Consulta sintética POST unknown',
        snapshotProcedureValor: '200.00',
        snapshotProcedureDuracaoMin: 30,
        snapshotDoctorNome: 'Dra. POST Unknown',
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

    const afterLostPost = await dbAdmin.execute<{
      charges: number;
      chargeStatus: string | null;
      chargeFailureCode: string | null;
      providerCheckoutId: string | null;
      invoiceUrl: string | null;
      generations: number;
      generationStatus: string | null;
      generationFailureCode: string | null;
      createdEvents: number;
      linkEvents: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM patient_charges
          WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}) AS charges,
        (SELECT status::text FROM patient_charges
          WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}) AS "chargeStatus",
        (SELECT failure_code FROM patient_charges
          WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}) AS "chargeFailureCode",
        (SELECT provider_checkout_id FROM patient_charges
          WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}) AS "providerCheckoutId",
        (SELECT invoice_url FROM patient_charges
          WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}) AS "invoiceUrl",
        (SELECT count(*)::int FROM patient_checkout_generations g
          JOIN patient_charges c ON c.id = g.patient_charge_id
          WHERE c.clinic_id = ${clinicId} AND c.appointment_id = ${appointmentId}) AS generations,
        (SELECT g.status::text FROM patient_checkout_generations g
          JOIN patient_charges c ON c.id = g.patient_charge_id
          WHERE c.clinic_id = ${clinicId} AND c.appointment_id = ${appointmentId}) AS "generationStatus",
        (SELECT g.failure_code FROM patient_checkout_generations g
          JOIN patient_charges c ON c.id = g.patient_charge_id
          WHERE c.clinic_id = ${clinicId} AND c.appointment_id = ${appointmentId}) AS "generationFailureCode",
        (SELECT count(*)::int FROM outbox
          WHERE clinic_id = ${clinicId}
            AND event_type = 'payments.patient_charge.created'
            AND payload->>'appointmentId' = ${appointmentId}) AS "createdEvents",
        (SELECT count(*)::int FROM outbox
          WHERE clinic_id = ${clinicId}
            AND event_type = 'payments.patient_charge.link_ready'
            AND payload->>'appointmentId' = ${appointmentId}) AS "linkEvents"
    `);
    assert(acceptedCheckout, 'provedor local não aceitou a criação do Checkout');
    assert(
      afterLostPost[0]?.charges === 1,
      'dívida local não foi preservada após POST indeterminado',
    );
    assert(afterLostPost[0]?.chargeStatus === 'pending', 'dívida local não permaneceu pendente');
    assert(
      afterLostPost[0]?.chargeFailureCode === 'checkout_creation_unknown',
      `falha da dívida: ${afterLostPost[0]?.chargeFailureCode}`,
    );
    assert(afterLostPost[0]?.providerCheckoutId === null, 'Qoro inventou provider_checkout_id');
    assert(afterLostPost[0]?.invoiceUrl === null, 'Qoro persistiu link sem receber resposta');
    assert(afterLostPost[0]?.generations === 1, 'geração única não foi preservada');
    assert(
      afterLostPost[0]?.generationStatus === 'creation_unknown',
      `estado da geração: ${afterLostPost[0]?.generationStatus}`,
    );
    assert(
      afterLostPost[0]?.generationFailureCode === 'checkout_creation_unknown',
      `falha da geração: ${afterLostPost[0]?.generationFailureCode}`,
    );
    assert(
      afterLostPost[0]?.createdEvents === 0,
      'evento created publicado sem Checkout confirmado',
    );
    assert(afterLostPost[0]?.linkEvents === 0, 'evento link_ready publicado sem link confirmado');
    assert(postCheckoutsCount === 1, `provedor recebeu ${postCheckoutsCount} POSTs`);

    await createDepositCharge({ clinicId, appointment });
    await createDepositCharge({ clinicId, appointment });

    const state = await dbAdmin.execute<{
      charges: number;
      generations: number;
      events: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM patient_charges
          WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}) AS charges,
        (SELECT count(*)::int FROM patient_checkout_generations g
          JOIN patient_charges c ON c.id = g.patient_charge_id
          WHERE c.clinic_id = ${clinicId} AND c.appointment_id = ${appointmentId}) AS generations,
        (SELECT count(*)::int FROM outbox
          WHERE clinic_id = ${clinicId}
            AND payload->>'appointmentId' = ${appointmentId}) AS events
    `);

    assert(sawAccessToken, 'client não enviou a credencial decifrada ao provedor local');
    assert(postCheckoutsCount === 1, `retry duplicou o POST: ${postCheckoutsCount}`);
    assert(state[0]?.charges === 1, `foram gravadas ${state[0]?.charges} dívidas locais`);
    assert(state[0]?.generations === 1, `foram gravadas ${state[0]?.generations} gerações`);
    assert(state[0]?.events === 0, `foram publicados ${state[0]?.events} eventos indevidos`);

    console.log(
      '[OK] POST indeterminado: 1 Checkout aceito · 1 dívida/generação unknown · 0 links/eventos · 0 duplicata',
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
