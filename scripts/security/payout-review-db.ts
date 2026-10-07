/**
 * Camada 4 — revisão humana do repasse contra o SCHEMA REAL, em Postgres
 * descartável. As migrations reais (até a 0113) são aplicadas em ordem e o
 * código de produção é exercitado como a aplicação o exercita: por `withTenant`,
 * com troca de papel para `authenticated` e RLS forçada.
 *
 * O que se prova (decisão de produto de 07/10/2026):
 *   1. exemplo decidido — R$ 150, 50% GROSS, estorno de R$ 50: teto R$ 75,
 *      referência R$ 50, versão 1 com o valor escolhido e o repasse `reviewed`;
 *   2. valor acima do teto é recusado sem gravar versão;
 *   3. corrigir gera a versão 2 e preserva a 1;
 *   4. append-only: UPDATE negado para `authenticated` e bloqueado por trigger
 *      até para o dono da tabela;
 *   5. outra clínica não lê, não grava e não revisa o repasse alheio;
 *   6. estorno posterior re-suspende com auditoria; nova versão volta a valer;
 *   7. o CHECK recusa `reviewed` sem valor decidido;
 *   8. a leitura do Caixa entrega teto, referência e versão vigente.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const PORT = 55481;
const results: { name: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, status: 'FAIL', detail });
    console.log(`FAIL ${name}: ${detail.split('\n')[0]}`);
  }
}

const cluster = await startScratchSchema({ port: PORT });
const sql = cluster.sql;

// A aplicação lê a conexão de `DATABASE_URL` no momento do import.
process.env.DATABASE_URL = cluster.url;
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';
process.env.MAGIC_TOKEN_SECRET ??= 'synthetic-local-payout-review-magic-token';
process.env.LOGIN_HASH_PEPPER ??= 'synthetic-local-payout-review-hash-pepper';
process.env.CRYPTO_SECRET_BACKEND ??= 'env';
process.env.CRYPTO_MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT ??= Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL ??= 'error';

const { recordProfessionalPayoutReview } =
  await import('../../src/contexts/financial/internal/payout-review');
const { refreshProfessionalPayout } =
  await import('../../src/contexts/financial/internal/professional-payout');
const { listAppointmentFinancialEconomics } = await import('../../src/contexts/financial/queries');
const { withTenant } = await import('../../src/lib/db/tenant');

interface Seeded {
  clinicId: string;
  doctorId: string;
  appointmentId: string;
  receivableId: string;
  paymentId: string;
  payoutId: string;
}

/** Atendimento pago (R$ 150), estornado em R$ 50, com repasse GROSS 50% suspenso. */
async function seedSuspendedPayout(label: string): Promise<Seeded> {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  const patientId = randomUUID();
  const procedureId = randomUUID();
  const appointmentId = randomUUID();
  const receivableId = randomUUID();
  const paymentId = randomUUID();
  const chargeId = randomUUID();
  const payoutId = randomUUID();
  await sql`INSERT INTO clinics (id, nome, slug)
    VALUES (${clinicId}::uuid, ${`Clínica ${label}`}, ${`payout-review-${clinicId.slice(0, 8)}`})`;
  await sql`INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (${doctorId}::uuid, ${`doctor-${doctorId.slice(0, 8)}@example.invalid`}, now())`;
  await sql`INSERT INTO profiles (id, clinic_id, nome, role, ativo)
    VALUES (${doctorId}::uuid, ${clinicId}::uuid, 'Profissional sintético', 'doctor', true)`;
  await sql`INSERT INTO patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
    VALUES (${patientId}::uuid, ${clinicId}::uuid, 'Paciente sintético', 'fixture',
            ${patientId.replaceAll('-', '').padEnd(64, '0')})`;
  await sql`INSERT INTO procedures (id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min)
    VALUES (${procedureId}::uuid, ${clinicId}::uuid, ${`PR-${label}`}, 'Consulta', 150, 30)`;
  await sql`INSERT INTO appointments (
      id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status,
      valor, snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min,
      snapshot_doctor_nome, created_via
    ) VALUES (
      ${appointmentId}::uuid, ${clinicId}::uuid, ${doctorId}::uuid, ${patientId}::uuid,
      ${procedureId}::uuid, now() - interval '1 day', 30, 'atendido', 150, 'Consulta', 150, 30,
      'Profissional sintético', 'attendant'
    )`;
  await sql`INSERT INTO lancamentos (
      id, clinic_id, tipo, descricao, valor, valor_pago, status, appointment_id, patient_id,
      created_via
    ) VALUES (
      ${receivableId}::uuid, ${clinicId}::uuid, 'receber', 'Consulta', 150, 100, 'parcial',
      ${appointmentId}::uuid, ${patientId}::uuid, 'manual'
    )`;
  await sql`INSERT INTO payment_transactions (id, clinic_id, lancamento_id, kind, amount)
    VALUES (${paymentId}::uuid, ${clinicId}::uuid, ${receivableId}::uuid, 'payment', 150)`;
  await sql`INSERT INTO payment_transactions (
      clinic_id, lancamento_id, kind, amount, original_payment_id, reason
    ) VALUES (
      ${clinicId}::uuid, ${receivableId}::uuid, 'refund', 50, ${paymentId}::uuid,
      'Devolução parcial ao paciente'
    )`;
  await sql`INSERT INTO patient_charges (
      id, clinic_id, appointment_id, patient_id, kind, status, amount, provider,
      external_reference, paid_at, provider_gross_amount, provider_fee_amount,
      provider_net_amount, economics_reconciled_at, provider_economics_revision
    ) VALUES (
      ${chargeId}::uuid, ${clinicId}::uuid, ${appointmentId}::uuid, ${patientId}::uuid,
      'remainder', 'paid', 150, 'asaas', ${`remainder:${appointmentId}`}, now(), 150, 3, 147,
      now(), 1
    )`;
  await sql`INSERT INTO patient_credits (
      clinic_id, patient_id, appointment_id, patient_charge_id, amount, allocated_amount,
      allocated_lancamento_id, allocated_payment_transaction_id, allocated_reversed_amount,
      kind, status, provider_gross_amount, provider_fee_amount, provider_net_amount,
      provider_economics_reconciled_at, provider_economics_revision
    ) VALUES (
      ${clinicId}::uuid, ${patientId}::uuid, ${appointmentId}::uuid, ${chargeId}::uuid, 150, 150,
      ${receivableId}::uuid, ${paymentId}::uuid, 50, 'remaining_payment', 'allocated', 150, 3,
      147, now(), 1
    )`;
  await sql`INSERT INTO professional_payouts (
      id, clinic_id, appointment_id, professional_id, procedure_id, calculation_basis,
      rule_kind, rule_percentage, gross_amount, status
    ) VALUES (
      ${payoutId}::uuid, ${clinicId}::uuid, ${appointmentId}::uuid, ${doctorId}::uuid,
      ${procedureId}::uuid, 'gross', 'percentage', 50, 150, 'cancelled'
    )`;
  return { clinicId, doctorId, appointmentId, receivableId, paymentId, payoutId };
}

async function reviewRows(payoutId: string) {
  return sql<
    { version: number; decided_amount: string; ceiling_amount: string; reason: string }[]
  >`SELECT version, decided_amount::text, ceiling_amount::text, reason
      FROM professional_payout_reviews WHERE payout_id = ${payoutId}::uuid ORDER BY version`;
}

async function payoutState(payoutId: string) {
  const [row] = await sql<
    { status: string; payout_amount: string | null; basis_amount: string | null }[]
  >`SELECT status, payout_amount::text, basis_amount::text
      FROM professional_payouts WHERE id = ${payoutId}::uuid`;
  return row;
}

try {
  const a = await seedSuspendedPayout('A');
  const b = await seedSuspendedPayout('B');

  await check(
    '1. exemplo decidido: teto R$ 75, referência R$ 50, versão 1 e repasse revisado',
    async () => {
      const result = await withTenant(a.clinicId, (tx) =>
        recordProfessionalPayoutReview(tx, {
          clinicId: a.clinicId,
          payoutId: a.payoutId,
          amount: 60,
          reason: 'Atendimento realizado; devolução parcial acordada.',
          decidedBy: a.doctorId,
        }),
      );
      assert.equal(result.version, 1);
      assert.equal(result.ceilingAmount, 75);
      assert.equal(result.referenceAmount, 50);
      assert.equal(result.decidedAmount, 60);
      assert.deepEqual(await payoutState(a.payoutId), {
        status: 'reviewed',
        payout_amount: '60.00',
        basis_amount: '150.00',
      });
    },
  );

  await check('2. valor acima do teto é recusado sem nova versão', async () => {
    await assert.rejects(
      withTenant(a.clinicId, (tx) =>
        recordProfessionalPayoutReview(tx, {
          clinicId: a.clinicId,
          payoutId: a.payoutId,
          amount: 75.01,
          reason: 'Tentativa acima do teto.',
          decidedBy: a.doctorId,
        }),
      ),
      /não pode passar de/,
    );
    assert.equal((await reviewRows(a.payoutId)).length, 1);
  });

  await check('3. corrigir cria a versão 2 e preserva a versão 1', async () => {
    const result = await withTenant(a.clinicId, (tx) =>
      recordProfessionalPayoutReview(tx, {
        clinicId: a.clinicId,
        payoutId: a.payoutId,
        amount: 0,
        reason: 'Correção: profissional abriu mão do repasse.',
        decidedBy: a.doctorId,
      }),
    );
    assert.equal(result.version, 2);
    const rows = await reviewRows(a.payoutId);
    assert.deepEqual(
      rows.map((row) => [row.version, row.decided_amount]),
      [
        [1, '60.00'],
        [2, '0.00'],
      ],
    );
    assert.equal((await payoutState(a.payoutId))?.payout_amount, '0.00');
  });

  await check(
    '4. append-only: UPDATE negado para authenticated e bloqueado para o dono',
    async () => {
      let tenantDenied = false;
      try {
        await sql.begin(async (tx) => {
          await tx`SET LOCAL ROLE authenticated`;
          await tx`SELECT set_config('app.current_clinic', ${a.clinicId}, true)`;
          await tx`UPDATE professional_payout_reviews SET decided_amount = 75
                   WHERE payout_id = ${a.payoutId}::uuid`;
        });
      } catch (error) {
        tenantDenied = String((error as { code?: string }).code) === '42501';
      }
      assert.ok(tenantDenied, 'authenticated conseguiu UPDATE na revisão');
      await assert.rejects(
        sql`UPDATE professional_payout_reviews SET reason = 'reescrita'
           WHERE payout_id = ${a.payoutId}::uuid`,
        /imutável/,
      );
      assert.equal((await reviewRows(a.payoutId))[0]?.decided_amount, '60.00');
    },
  );

  await check('5. outra clínica não lê, não grava e não revisa o repasse alheio', async () => {
    const [seen] = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('app.current_clinic', ${b.clinicId}, true)`;
      return tx<{ n: number }[]>`SELECT count(*)::int AS n FROM professional_payout_reviews
                                  WHERE payout_id = ${a.payoutId}::uuid`;
    });
    assert.equal(seen?.n, 0, 'clínica B leu revisão da A');

    await assert.rejects(
      withTenant(b.clinicId, (tx) =>
        recordProfessionalPayoutReview(tx, {
          clinicId: b.clinicId,
          payoutId: a.payoutId,
          amount: 10,
          reason: 'Tentativa cruzada.',
          decidedBy: b.doctorId,
        }),
      ),
      /Repasse não encontrado nesta clínica/,
    );

    let rlsDenied = false;
    try {
      await sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('app.current_clinic', ${b.clinicId}, true)`;
        await tx`INSERT INTO professional_payout_reviews (
            clinic_id, payout_id, version, ceiling_amount, decided_amount, reason,
            reversal_refunded_amount, reversal_loss, decided_by
          ) VALUES (
            ${a.clinicId}::uuid, ${a.payoutId}::uuid, 9, 75, 1, 'cruzada', 50, false,
            ${b.doctorId}::uuid
          )`;
      });
    } catch (error) {
      rlsDenied = String((error as { code?: string }).code) === '42501';
    }
    assert.ok(rlsDenied, 'RLS aceitou revisão com clinic_id de outra clínica');

    await assert.rejects(
      sql`INSERT INTO professional_payout_reviews (
            clinic_id, payout_id, version, ceiling_amount, decided_amount, reason,
            reversal_refunded_amount, reversal_loss, decided_by
          ) VALUES (
            ${b.clinicId}::uuid, ${a.payoutId}::uuid, 9, 75, 1, 'cruzada', 50, false,
            ${b.doctorId}::uuid
          )`,
      /Revisão de repasse inválida para a clínica/,
    );
    assert.equal((await reviewRows(a.payoutId)).length, 2);
  });

  await check(
    '6. estorno posterior re-suspende com auditoria; nova versão volta a valer',
    async () => {
      const unchanged = await withTenant(a.clinicId, (tx) =>
        refreshProfessionalPayout(tx, { clinicId: a.clinicId, appointmentId: a.appointmentId }),
      );
      assert.equal(unchanged, 'reviewed');

      await sql`INSERT INTO payment_transactions (
        clinic_id, lancamento_id, kind, amount, original_payment_id, reason
      ) VALUES (
        ${a.clinicId}::uuid, ${a.receivableId}::uuid, 'refund', 10, ${a.paymentId}::uuid,
        'Segunda devolução'
      )`;
      const suspended = await withTenant(a.clinicId, (tx) =>
        refreshProfessionalPayout(tx, { clinicId: a.clinicId, appointmentId: a.appointmentId }),
      );
      assert.equal(suspended, 'cancelled');
      assert.deepEqual(await payoutState(a.payoutId), {
        status: 'cancelled',
        payout_amount: null,
        basis_amount: null,
      });
      const [audit] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_events
      WHERE clinic_id = ${a.clinicId}::uuid
        AND action = 'financial.professional_payout.suspended'
        AND after->>'reason' = 'payment_reversed_after_review'`;
      assert.equal(audit?.n, 1);

      const result = await withTenant(a.clinicId, (tx) =>
        recordProfessionalPayoutReview(tx, {
          clinicId: a.clinicId,
          payoutId: a.payoutId,
          amount: 40,
          reason: 'Revisão após a segunda devolução.',
          decidedBy: a.doctorId,
        }),
      );
      assert.equal(result.version, 3);
      assert.equal(result.referenceAmount, 45);
      const stays = await withTenant(a.clinicId, (tx) =>
        refreshProfessionalPayout(tx, { clinicId: a.clinicId, appointmentId: a.appointmentId }),
      );
      assert.equal(stays, 'reviewed');
    },
  );

  await check('7. o CHECK recusa reviewed sem valor decidido', async () => {
    await assert.rejects(
      sql`UPDATE professional_payouts SET status = 'reviewed', payout_amount = NULL
           WHERE id = ${b.payoutId}::uuid`,
      /professional_payouts_status_chk/,
    );
  });

  await check('8. a leitura do Caixa entrega teto, referência e versão vigente', async () => {
    const [economics] = await listAppointmentFinancialEconomics(a.clinicId, [a.appointmentId]);
    assert.ok(economics?.payout, 'sem repasse na leitura');
    assert.equal(economics.payout.status, 'reviewed');
    assert.equal(economics.payout.review?.version, 3);
    assert.equal(economics.payout.review?.decidedAmount, 40);
    assert.deepEqual(economics.payout.reviewBounds, { ceilingAmount: 75, referenceAmount: 45 });
    const [other] = await listAppointmentFinancialEconomics(b.clinicId, [a.appointmentId]);
    assert.equal(other, undefined, 'leitura cruzou o tenant');
  });
} finally {
  await cluster.stop();
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  for (const f of failed) console.log(`\n--- ${f.name}\n${f.detail}`);
  // Nunca lançar daqui: um throw no finally substituiria a causa real.
  if (failed.length > 0) process.exitCode = 1;
}
