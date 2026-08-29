/**
 * Prova DEV da 0091 sem Asaas/Meta: RLS, lease, dedup, ativação e cleanup.
 * Usa somente fixtures sintéticas e remove as duas clínicas no `finally`.
 */
// MUST be first: loads `.env.local` before any `@/lib/*` module validates env.
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import {
  activateCheckoutGeneration,
  claimInitialCheckoutCharge,
  findPayableCharge,
} from '@/contexts/payments/internal/charge-store';

assertDevContext();

const clinicA = randomUUID();
const clinicB = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const appointmentId = randomUUID();
const run = randomUUID().replaceAll('-', '');

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fixtureDoctorId(): Promise<string> {
  const rows = await dbAdmin.execute<{ id: string }>(sql`
    SELECT id::text AS id
      FROM profiles
     WHERE ativo = true
     ORDER BY id
     LIMIT 1
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error('[checkout-db] DEV precisa de ao menos um profile ativo');
  return id;
}

async function createFixtures(): Promise<void> {
  const doctorId = await fixtureDoctorId();
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, endereco, status, timezone)
    VALUES
      (${clinicA}, ${`checkout-a-${run.slice(0, 12)}`}, 'Checkout DB A', 'Sintética', 'active', 'America/Sao_Paulo'),
      (${clinicB}, ${`checkout-b-${run.slice(0, 12)}`}, 'Checkout DB B', 'Sintética', 'active', 'America/Sao_Paulo')
  `);
  await dbAdmin.execute(sql`
    INSERT INTO patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
    VALUES (${patientId}, ${clinicA}, 'Paciente Checkout Sintético', 'fixture', ${run.padEnd(64, '0').slice(0, 64)})
  `);
  await dbAdmin.execute(sql`
    INSERT INTO procedures (
      id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min
    ) VALUES (
      ${procedureId}, ${clinicA}, ${`CHK-${run.slice(0, 8)}`},
      'Procedimento sintético Checkout', 100.00, 30
    )
  `);
  await dbAdmin.execute(sql`
    INSERT INTO appointments (
      id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
      duration_min, status, valor, snapshot_procedure_name,
      snapshot_procedure_valor, snapshot_procedure_duracao_min,
      snapshot_doctor_nome, created_via
    ) VALUES (
      ${appointmentId}, ${clinicA}, ${doctorId}, ${patientId}, ${procedureId}, now(),
      30, 'faltou', 100.00, 'Procedimento sintético', 100.00, 30,
      'Profissional sintético', 'attendant'
    )
  `);
}

async function cleanup(): Promise<void> {
  await dbAdmin.execute(sql`DELETE FROM clinics WHERE id IN (${clinicA}, ${clinicB})`);
  const residue = await dbAdmin.execute<{ clinics: number; charges: number; generations: number }>(
    sql`
      SELECT
        (SELECT count(*)::int FROM clinics WHERE id IN (${clinicA}, ${clinicB})) AS clinics,
        (SELECT count(*)::int FROM patient_charges WHERE clinic_id = ${clinicA}) AS charges,
        (SELECT count(*)::int FROM patient_checkout_generations WHERE clinic_id = ${clinicA}) AS generations
    `,
  );
  assert(
    residue[0]?.clinics === 0 && residue[0]?.charges === 0 && residue[0]?.generations === 0,
    '[checkout-db] cleanup incompleto',
  );
}

async function main(): Promise<void> {
  try {
    await createFixtures();

    const structure = await dbAdmin.execute<{
      enabled: boolean;
      forced: boolean;
      canDelete: boolean;
    }>(
      sql`
        SELECT
          c.relrowsecurity AS enabled,
          c.relforcerowsecurity AS forced,
          has_table_privilege('authenticated', 'patient_checkout_generations', 'DELETE') AS "canDelete"
        FROM pg_class c
        WHERE c.oid = 'public.patient_checkout_generations'::regclass
      `,
    );
    assert(structure[0]?.enabled === true, 'RLS não está habilitada');
    assert(structure[0]?.forced === true, 'RLS não está forçada');
    assert(structure[0]?.canDelete === false, 'authenticated recebeu DELETE indevido');
    console.log('[OK] 1/5 estrutura e grants');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const first = await claimInitialCheckoutCharge({
      clinicId: clinicA,
      appointmentId,
      patientId,
      kind: 'remainder',
      amount: 75,
      holdExpiresAt: null,
      collectionExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      checkoutExpiresAt: expiresAt,
      leaseUntil: new Date(now.getTime() + 2 * 60 * 1000),
    });
    assert(first.state === 'claimed', 'primeiro worker não adquiriu o lease');
    const replay = await claimInitialCheckoutCharge({
      clinicId: clinicA,
      appointmentId,
      patientId,
      kind: 'remainder',
      amount: 75,
      holdExpiresAt: null,
      collectionExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      checkoutExpiresAt: expiresAt,
      leaseUntil: new Date(now.getTime() + 2 * 60 * 1000),
    });
    assert(replay.state === 'existing', 'replay adquiriu um segundo lease');
    console.log('[OK] 2/5 claim idempotente');

    const counts = await withTenant(clinicA, (tx) =>
      tx.execute<{ charges: number; generations: number }>(sql`
        SELECT
          (SELECT count(*)::int FROM patient_charges WHERE appointment_id = ${appointmentId}) AS charges,
          (SELECT count(*)::int FROM patient_checkout_generations WHERE patient_charge_id = ${first.chargeId}) AS generations
      `),
    );
    assert(counts[0]?.charges === 1 && counts[0]?.generations === 1, 'UNIQUE não conteve replay');
    console.log('[OK] 3/5 uma dívida e uma geração');

    const crossTenant = await withTenant(clinicB, (tx) =>
      tx.execute(sql`
        SELECT id FROM patient_checkout_generations WHERE patient_charge_id = ${first.chargeId}
      `),
    );
    assert(crossTenant.length === 0, 'RLS expôs geração para outro tenant');
    console.log('[OK] 4/5 isolamento cross-tenant');

    const activated = await activateCheckoutGeneration({
      clinicId: clinicA,
      chargeId: first.chargeId,
      generationId: first.generationId,
      generation: first.generation,
      providerCheckoutId: `checkout_${run.slice(0, 16)}`,
      checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=synthetic',
      expiresAt,
      activatedAt: now,
    });
    assert(activated, 'ativação CAS falhou');
    const payable = await findPayableCharge(clinicA, first.chargeId);
    assert(
      payable?.invoiceUrl.includes('checkoutSession') === true,
      'send-time não achou link ativo',
    );
    console.log('[OK] 5/5 ativação e lookup send-time');
  } finally {
    await cleanup();
    console.log('[OK] cleanup sem resíduos');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
