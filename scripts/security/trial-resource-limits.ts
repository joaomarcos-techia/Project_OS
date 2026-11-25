/** Actual migrations and enforcement on loopback PostgreSQL. Synthetic data only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PgDialect } from 'drizzle-orm/pg-core';

import { releaseTrialAfterVerifiedPaymentTx, type TrialSql } from '../../src/lib/trial-access';
import { TRIAL_RESOURCE_LIMITS, trialAccessErrorFrom } from '../../src/lib/trial-access/policy';
import { startScratchSchema, type ScratchCluster } from './scratch-schema';

type Sql = ScratchCluster['sql'];
type Fixture = { clinicId: string; ownerId: string; subscriptionId: string };
const PORT = 55491;
let checks = 0;
async function fixture(sql: Sql, planCode = 'clinica_2026_2'): Promise<Fixture> {
  const clinicId = randomUUID(),
    ownerId = randomUUID();
  const [catalog] = await sql<{ plan_id: string; price_id: string }[]>`
    SELECT p.id AS plan_id,pr.id AS price_id FROM plans p JOIN prices pr ON pr.plan_id=p.id
    WHERE p.code=${planCode} AND pr.billing_cycle='monthly' AND pr.active_until IS NULL
      AND pr.campaign_code IS NULL LIMIT 1`;
  assert.ok(catalog);
  await sql`INSERT INTO auth.users(id,email) VALUES(${ownerId}::uuid,${`${ownerId}@example.invalid`})`;
  await sql`INSERT INTO clinics(id,slug,nome,status) VALUES(${clinicId}::uuid,${`trial-${clinicId.slice(0, 8)}`},'Synthetic evaluation','trial')`;
  await sql`INSERT INTO profiles(id,clinic_id,nome,role,ativo,invite_accepted_at,crm,crm_uf)
    VALUES(${ownerId}::uuid,${clinicId}::uuid,'Synthetic owner','owner',true,now(),${clinicId.slice(0, 8)},'CE')`;
  const [subscription] = await sql<{ id: string }[]>`INSERT INTO subscriptions
    (clinic_id,plan_id,price_id,billing_status,enforce_trial_deadline,trial_ends_at)
    VALUES(${clinicId}::uuid,${catalog.plan_id}::uuid,${catalog.price_id}::uuid,'trial',true,now()+interval '14 days') RETURNING id`;
  assert.ok(subscription);
  return { clinicId, ownerId, subscriptionId: subscription.id };
}
async function patient(sql: Sql, f: Fixture) {
  const [row] = await sql<
    { id: string }[]
  >`INSERT INTO patients(clinic_id,nome,cpf_encrypted,cpf_hash)
    VALUES(${f.clinicId}::uuid,'Synthetic patient','synthetic-cipher',${randomUUID()}) RETURNING id`;
  assert.ok(row);
  return row.id;
}
async function usage(sql: Sql, f: Fixture, metric: string) {
  const [row] = await sql<
    { consumed: number }[]
  >`SELECT consumed FROM trial_resource_usage WHERE clinic_id=${f.clinicId}::uuid AND metric=${metric}`;
  return row?.consumed ?? 0;
}
async function denied(operation: () => PromiseLike<unknown>, restriction: string) {
  await assert.rejects(
    async () => {
      await operation();
    },
    (error: unknown) => {
      assert.equal(trialAccessErrorFrom(error)?.restriction, restriction);
      return true;
    },
  );
  checks++;
}
function connection(sql: Sql): TrialSql {
  const dialect = new PgDialect();
  return {
    async execute(statement) {
      const query = dialect.sqlToQuery(statement);
      // Values in this harness are exclusively the UUIDs used by the release seam.
      assert.ok(query.params.every((v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v)));
      let text = query.sql;
      query.params.forEach((v, index) => {
        text = text.replace(`$${index + 1}`, `'${v}'`);
      });
      return sql.unsafe(text);
    },
  };
}
async function invoice(sql: Sql, f: Fixture, status: 'open' | 'paid', amount = 397) {
  const [row] = await sql<{ id: string }[]>`INSERT INTO invoices
    (clinic_id,subscription_id,total_amount,status,due_date,paid_at)
    VALUES(${f.clinicId}::uuid,${f.subscriptionId}::uuid,${amount},${status},current_date,
      ${status === 'paid' ? new Date() : null}) RETURNING id`;
  assert.ok(row);
  return row.id;
}
let legacy: Fixture | undefined;
const cluster = await startScratchSchema({
  port: PORT,
  beforeMigration: {
    file: '0136_trial_resource_limits.sql',
    async run(sql) {
      legacy = await fixture(sql);
      // Reproduce the Supabase default grants, absent from a bare Postgres.
      await sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role`;
    },
  },
});
try {
  assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
  assert.equal(new URL(cluster.url).port, String(PORT));
  const { sql } = cluster;
  const grants = await sql<{ readable: boolean; writable: boolean; excessive: boolean }[]>`
    SELECT has_table_privilege('service_role',c.oid,'SELECT') AS readable,
      has_table_privilege('service_role',c.oid,'INSERT') AND has_table_privilege('service_role',c.oid,'UPDATE') AS writable,
      has_table_privilege('service_role',c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('trial_access_policies','trial_resource_usage')`;
  assert.equal(grants.length, 2);
  for (const row of grants)
    assert.deepEqual(row, { readable: true, writable: true, excessive: false });
  checks++;
  await assert.rejects(
    () =>
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE service_role`;
        await tx`DELETE FROM public.trial_resource_usage`;
      }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === '42501',
  );
  checks++;
  assert.ok(legacy);
  assert.equal(
    (await sql`SELECT * FROM trial_access_policies WHERE clinic_id=${legacy.clinicId}::uuid`)
      .length,
    0,
  );
  for (let i = 0; i < 11; i++) await patient(sql, legacy);
  checks++;
  const oldPlan = await fixture(sql, 'clinica');
  assert.equal(
    (await sql`SELECT * FROM trial_access_policies WHERE clinic_id=${oldPlan.clinicId}::uuid`)
      .length,
    0,
  );
  checks++;
  const f = await fixture(sql),
    other = await fixture(sql);
  const bulk = await fixture(sql);
  await denied(
    () => sql`INSERT INTO patients(clinic_id,nome,cpf_encrypted,cpf_hash)
    SELECT ${bulk.clinicId}::uuid,'Synthetic bulk','synthetic-cipher',g::text
    FROM generate_series(1,11) g`,
    'patients',
  );
  assert.equal(await usage(sql, bulk, 'patients'), 0);
  assert.equal(
    (await sql`SELECT id FROM patients WHERE clinic_id=${bulk.clinicId}::uuid`).length,
    0,
  );
  checks++;
  const retryId = randomUUID();
  for (let i = 0; i < 2; i++)
    await sql`INSERT INTO patients(id,clinic_id,nome,cpf_encrypted,cpf_hash)
    VALUES(${retryId}::uuid,${bulk.clinicId}::uuid,'Synthetic retry','synthetic-cipher',${retryId})
    ON CONFLICT (id) DO NOTHING`;
  assert.equal(await usage(sql, bulk, 'patients'), 1);
  checks++;
  await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    await tx`SELECT set_config('app.current_clinic',${bulk.clinicId},true)`;
    await tx`INSERT INTO patients(clinic_id,nome,cpf_encrypted,cpf_hash)
      VALUES(${bulk.clinicId}::uuid,'Synthetic authenticated creation','synthetic-cipher',${randomUUID()})`;
  });
  assert.equal(await usage(sql, bulk, 'patients'), 2);
  checks++;
  await sql`CREATE ROLE qoro_trial_unprivileged NOLOGIN NOBYPASSRLS`;
  await sql`ALTER FUNCTION public.enforce_trial_resource_limit() OWNER TO qoro_trial_unprivileged`;
  await assert.rejects(
    () => patient(sql, bulk),
    (error: unknown) =>
      error instanceof Error && error.message.includes('Invalid trial function owner'),
  );
  await sql`ALTER FUNCTION public.enforce_trial_resource_limit() OWNER TO postgres`;
  assert.equal(await usage(sql, bulk, 'patients'), 2);
  checks++; // A misconfigured definer fails closed instead of treating RLS-hidden policy as legacy.
  const p = await patient(sql, f);
  for (let i = 0; i < 8; i++) await patient(sql, f);
  const race = await Promise.allSettled(Array.from({ length: 12 }, () => patient(sql, f)));
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of race)
    if (r.status === 'rejected')
      assert.equal(trialAccessErrorFrom(r.reason)?.restriction, 'patients');
  assert.equal(await usage(sql, f, 'patients'), 10);
  checks++;
  await sql`DELETE FROM patients WHERE clinic_id=${f.clinicId}::uuid AND id<>${p}::uuid`;
  await denied(() => patient(sql, f), 'patients');
  await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    await tx`SELECT set_config('app.current_clinic',${other.clinicId},true)`;
    assert.equal(
      (await tx`SELECT * FROM trial_access_policies WHERE clinic_id=${f.clinicId}::uuid`).length,
      0,
    );
  });
  checks++;
  await assert.rejects(
    () =>
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('app.current_clinic',${f.clinicId},true)`;
        await tx`UPDATE trial_access_policies SET released_at=now() WHERE clinic_id=${f.clinicId}::uuid`;
      }),
    (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '42501',
  );
  checks++;
  const createProcedure =
    () => sql`INSERT INTO procedures(clinic_id,codigo,descricao,valor_padrao,duracao_padrao_min)
    VALUES(${f.clinicId}::uuid,${randomUUID()},'Synthetic procedure',100,30) RETURNING id`;
  const [procedure] = await createProcedure();
  assert.ok(procedure);
  for (let i = 1; i < 15; i++) await createProcedure();
  await denied(createProcedure, 'procedures');
  for (let i = 0; i < 15; i++)
    await sql`INSERT INTO schedulable_resources(clinic_id,name,type)
    VALUES(${f.clinicId}::uuid,${randomUUID()},'room')`;
  await denied(
    () =>
      sql`INSERT INTO schedulable_resources(clinic_id,name,type) VALUES(${f.clinicId}::uuid,${randomUUID()},'room')`,
    'resources',
  );
  for (let i = 0; i < 15; i++)
    await sql`INSERT INTO prescription_templates(clinic_id,doctor_id,nome) VALUES(${f.clinicId}::uuid,${f.ownerId}::uuid,${randomUUID()})`;
  await denied(
    () =>
      sql`INSERT INTO prescription_templates(clinic_id,doctor_id,nome) VALUES(${f.clinicId}::uuid,${f.ownerId}::uuid,${randomUUID()})`,
    'document_templates',
  );
  const document = (prescription: boolean) =>
    prescription
      ? sql`INSERT INTO prescriptions(clinic_id,patient_id,doctor_id,medicamentos_encrypted,snapshot_patient_nome,snapshot_doctor_nome,snapshot_doctor_crm)
      VALUES(${f.clinicId}::uuid,${p}::uuid,${f.ownerId}::uuid,'synthetic-cipher','Synthetic','Synthetic','synthetic')`
      : sql`INSERT INTO medical_documents(clinic_id,patient_id,doctor_id,type,content_encrypted,snapshot_patient_nome,snapshot_doctor_nome,snapshot_doctor_crm)
      VALUES(${f.clinicId}::uuid,${p}::uuid,${f.ownerId}::uuid,'atestado','synthetic-cipher','Synthetic','Synthetic','synthetic')`;
  for (let i = 0; i < 15; i++) await document(i % 2 === 0);
  await denied(() => document(true), 'documents');
  await denied(() => document(false), 'documents');
  const appointment = (offset: number) => sql`INSERT INTO appointments
    (clinic_id,doctor_id,patient_id,procedure_id,scheduled_at,duration_min,status,valor,created_via,
      snapshot_procedure_name,snapshot_procedure_valor,snapshot_procedure_duracao_min,snapshot_doctor_nome)
    VALUES(${f.clinicId}::uuid,${f.ownerId}::uuid,${p}::uuid,${procedure.id}::uuid,
      now()+(${offset}::int * interval '1 day'),30,'agendado',100,'attendant','Synthetic',100,30,'Synthetic')`;
  for (let i = 1; i <= 15; i++) await appointment(i);
  await denied(() => appointment(16), 'appointments');
  const [originalAppointment] = await sql<
    { id: string }[]
  >`SELECT id FROM appointments WHERE clinic_id=${f.clinicId}::uuid LIMIT 1`;
  assert.ok(originalAppointment);
  await denied(
    () =>
      sql.begin(async (tx) => {
        await tx`UPDATE appointments SET status='cancelado' WHERE id=${originalAppointment.id}::uuid`;
        await tx`INSERT INTO appointments(clinic_id,doctor_id,patient_id,procedure_id,scheduled_at,duration_min,status,valor,created_via,
      snapshot_procedure_name,snapshot_procedure_valor,snapshot_procedure_duracao_min,snapshot_doctor_nome,rescheduled_from_appointment_id)
      SELECT clinic_id,doctor_id,patient_id,procedure_id,scheduled_at+interval '60 days',duration_min,'agendado',valor,'attendant',
      snapshot_procedure_name,snapshot_procedure_valor,snapshot_procedure_duracao_min,snapshot_doctor_nome,id
      FROM appointments WHERE id=${originalAppointment.id}::uuid`;
      }),
    'appointments',
  );
  const [preservedAppointment] = await sql<
    { status: string }[]
  >`SELECT status FROM appointments WHERE id=${originalAppointment.id}::uuid`;
  assert.equal(preservedAppointment?.status, 'agendado');
  checks++; // A quota failure cannot cancel the original appointment during a reschedule.
  const financial = (
    tipo: string,
  ) => sql`INSERT INTO lancamentos(clinic_id,tipo,descricao,valor,created_via)
    VALUES(${f.clinicId}::uuid,${tipo}::lancamento_tipo,'Synthetic',100,'manual') RETURNING id`;
  let paymentEntry = '';
  for (const tipo of ['receber', 'pagar']) {
    for (let i = 0; i < 15; i++) {
      const [row] = await financial(tipo);
      assert.ok(row);
      paymentEntry = String(row.id);
    }
    await denied(() => financial(tipo), tipo === 'receber' ? 'receivables' : 'expenses');
  }
  for (let i = 0; i < 15; i++)
    await sql`INSERT INTO payment_transactions(clinic_id,lancamento_id,kind,amount)
    VALUES(${f.clinicId}::uuid,${paymentEntry}::uuid,'payment',1)`;
  await denied(
    () => sql`INSERT INTO payment_transactions(clinic_id,lancamento_id,kind,amount)
    VALUES(${f.clinicId}::uuid,${paymentEntry}::uuid,'payment',1)`,
    'payments',
  );
  for (const metric of Object.keys(TRIAL_RESOURCE_LIMITS)) {
    assert.equal(await usage(sql, f, metric), metric === 'patients' ? 10 : 15, metric);
    checks++;
  }
  await denied(
    () => sql`INSERT INTO clinic_whatsapp_numbers(clinic_id,provider,phone_number,meta_phone_id,token_encrypted,active)
    VALUES(${f.clinicId}::uuid,'meta','+5500000000000','synthetic-phone','synthetic-cipher',true)`,
    'whatsapp',
  );
  await denied(
    () => sql`INSERT INTO clinic_payment_accounts(clinic_id,api_key_encrypted,webhook_ref,active)
    VALUES(${f.clinicId}::uuid,'synthetic-cipher',${randomUUID()}::uuid,true)`,
    'asaas',
  );
  const extra = randomUUID();
  await sql`INSERT INTO auth.users(id,email) VALUES(${extra}::uuid,${`${extra}@example.invalid`})`;
  await denied(
    () =>
      sql`INSERT INTO profiles(id,clinic_id,nome,role,ativo) VALUES(${extra}::uuid,${f.clinicId}::uuid,'Synthetic member','attendant',true)`,
    'team_invites',
  );
  await sql`UPDATE subscriptions SET billing_status='active' WHERE id=${f.subscriptionId}::uuid`;
  await denied(() => patient(sql, f), 'patients'); // ACTIVE alone is not payment.
  const db = connection(sql);
  await releaseTrialAfterVerifiedPaymentTx(db, f.clinicId, await invoice(sql, other, 'paid'));
  await releaseTrialAfterVerifiedPaymentTx(db, f.clinicId, await invoice(sql, f, 'open'));
  await releaseTrialAfterVerifiedPaymentTx(db, f.clinicId, await invoice(sql, f, 'paid', 0));
  await denied(() => patient(sql, f), 'patients');
  await sql`UPDATE subscriptions SET trial_ends_at=now()-interval '1 second' WHERE id=${other.subscriptionId}::uuid`;
  await denied(() => patient(sql, other), 'expired');
  const [originalPayment] = await sql<
    { id: string }[]
  >`SELECT id FROM payment_transactions WHERE clinic_id=${f.clinicId}::uuid LIMIT 1`;
  assert.ok(originalPayment);
  await sql`UPDATE subscriptions SET trial_ends_at=now()-interval '1 second' WHERE id=${f.subscriptionId}::uuid`;
  await sql`INSERT INTO payment_transactions(clinic_id,lancamento_id,kind,amount,original_payment_id,reason)
    VALUES(${f.clinicId}::uuid,${paymentEntry}::uuid,'refund',0.5,${originalPayment.id}::uuid,'Synthetic correction')`;
  assert.equal(await usage(sql, f, 'payments'), 15);
  checks++;
  const paidInvoice = await invoice(sql, f, 'paid');
  await releaseTrialAfterVerifiedPaymentTx(db, f.clinicId, paidInvoice);
  await releaseTrialAfterVerifiedPaymentTx(db, f.clinicId, paidInvoice); // Idempotent release.
  await sql.begin(async (locked) => {
    await locked`SELECT * FROM trial_access_policies WHERE clinic_id=${f.clinicId}::uuid FOR UPDATE`;
    await sql.begin(async (independent) => {
      await independent`SET LOCAL lock_timeout='200ms'`;
      await independent`INSERT INTO patients(clinic_id,nome,cpf_encrypted,cpf_hash)
        VALUES(${f.clinicId}::uuid,'Synthetic independent paid creation','synthetic-cipher',${randomUUID()})`;
    });
  });
  checks++; // Paid creation no longer waits on the temporary quota lock.
  for (let i = 0; i < 16; i++) await patient(sql, f);
  await appointment(16);
  await document(true);
  await createProcedure();
  await financial('receber');
  await financial('pagar');
  await sql`INSERT INTO payment_transactions(clinic_id,lancamento_id,kind,amount) VALUES(${f.clinicId}::uuid,${paymentEntry}::uuid,'payment',1)`;
  await sql`INSERT INTO schedulable_resources(clinic_id,name,type) VALUES(${f.clinicId}::uuid,${randomUUID()},'room')`;
  await sql`INSERT INTO prescription_templates(clinic_id,doctor_id,nome) VALUES(${f.clinicId}::uuid,${f.ownerId}::uuid,${randomUUID()})`;
  await sql`INSERT INTO clinic_whatsapp_numbers(clinic_id,provider,phone_number,meta_phone_id,token_encrypted,active)
    VALUES(${f.clinicId}::uuid,'meta','+5500000000000','synthetic-phone','synthetic-cipher',true)`;
  await sql`INSERT INTO clinic_payment_accounts(clinic_id,api_key_encrypted,webhook_ref,active) VALUES(${f.clinicId}::uuid,'synthetic-cipher',${randomUUID()}::uuid,true)`;
  await sql`INSERT INTO profiles(id,clinic_id,nome,role,ativo) VALUES(${extra}::uuid,${f.clinicId}::uuid,'Synthetic member','attendant',true)`;
  checks++;
  for (const metric of Object.keys(TRIAL_RESOURCE_LIMITS)) {
    assert.equal(
      await usage(sql, f, metric),
      metric === 'patients' ? 10 : 15,
      `Paid usage no longer capped: ${metric}`,
    );
  }
  checks++;
  // Removing evaluation quotas never removes the purchased seat capacity.
  for (let i = 0; i < 3; i++) {
    const member = randomUUID();
    await sql`INSERT INTO auth.users(id,email) VALUES(${member}::uuid,${`${member}@example.invalid`})`;
    if (i < 2) {
      await sql`INSERT INTO profiles(id,clinic_id,nome,role,ativo,invite_accepted_at)
        VALUES(${member}::uuid,${f.clinicId}::uuid,'Synthetic staff','attendant',true,now())`;
    } else {
      await assert.rejects(
        () => sql`INSERT INTO profiles(id,clinic_id,nome,role,ativo,invite_accepted_at)
        VALUES(${member}::uuid,${f.clinicId}::uuid,'Synthetic fourth staff','attendant',true,now())`,
        (e: unknown) =>
          typeof e === 'object' &&
          e !== null &&
          'constraint_name' in e &&
          e.constraint_name === 'offer_2026_seat_limit',
      );
    }
  }
  checks++;
  const cleanup = await fixture(sql);
  await releaseTrialAfterVerifiedPaymentTx(
    db,
    cleanup.clinicId,
    await invoice(sql, cleanup, 'paid'),
  );
  await sql`DELETE FROM clinics WHERE id=${cleanup.clinicId}::uuid`;
  assert.equal(
    (await sql`SELECT * FROM trial_access_policies WHERE clinic_id=${cleanup.clinicId}::uuid`)
      .length,
    0,
  );
  assert.equal(
    (await sql`SELECT * FROM trial_resource_usage WHERE clinic_id=${cleanup.clinicId}::uuid`)
      .length,
    0,
  );
  checks++; // New recovery metadata does not break existing clinic cascade cleanup.
  await mkdir('dist', { recursive: true });
  const evidence = {
    observedAt: new Date().toISOString(),
    status: 'PASS',
    checks,
    environment: 'synthetic_loopback_postgres',
    migrations: ['0136_trial_resource_limits', '0137_trial_service_role_privileges'],
    remoteWrites: 0,
    providerCalls: 0,
  };
  await writeFile('dist/trial-resource-limits.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await cluster.stop();
}
