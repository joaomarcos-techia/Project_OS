/**
 * Hardening 1.H — RLS e concorrência real de patient_credits no banco DEV.
 *
 * Usa somente fixtures sintéticas e não chama Asaas, Meta ou qualquer outro
 * provedor. Exercita o Postgres real para provar as garantias que mocks não
 * conseguem demonstrar: RLS, UNIQUE sob corrida, UPDATE condicional e CHECKs
 * financeiros. O cleanup é obrigatório e verifica resíduo zero.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { allocateCredit, releaseCredit } from '@/contexts/financial/internal/credit-store';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

assertDevContext();

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];
const runId = randomUUID();
const slugSuffix = runId.replaceAll('-', '').slice(0, 12);
const clinicA = randomUUID();
const clinicB = randomUUID();

const creditAId = randomUUID();
const creditBId = randomUUID();
const allocationCreditId = randomUUID();
const overAllocationCreditId = randomUUID();
const releaseCreditId = randomUUID();

const chargeAId = randomUUID();
const chargeBId = randomUUID();
const allocationChargeId = randomUUID();
const overAllocationChargeId = randomUUID();
const releaseChargeId = randomUUID();
const concurrentGrantChargeId = randomUUID();
const crossTenantChargeId = randomUUID();

const lancamentoAId = randomUUID();
const lancamentoBId = randomUUID();

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const current = error.stack ?? error.message;
  return error.cause ? `${current}\nCaused by: ${errorDetail(error.cause)}` : current;
}

async function step(name: string, check: () => Promise<void>): Promise<void> {
  try {
    await check();
    results.push({ name, ok: true });
    console.log(`[OK]   ${name}`);
  } catch (error) {
    const detail = errorDetail(error);
    results.push({ name, ok: false, detail });
    console.error(`[FAIL] ${name}\n       ${detail}`);
  }
}

async function createFixtures(): Promise<void> {
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, endereco, status)
    VALUES
      (${clinicA}, ${`h1-credit-a-${slugSuffix}`}, '1.H Crédito Clínica A', 'Fixture sintética', 'active'),
      (${clinicB}, ${`h1-credit-b-${slugSuffix}`}, '1.H Crédito Clínica B', 'Fixture sintética', 'active')
  `);

  await dbAdmin.execute(sql`
    INSERT INTO lancamentos (id, clinic_id, tipo, descricao, valor, created_via)
    VALUES
      (${lancamentoAId}, ${clinicA}, 'receber', '1.H alocação concorrente A', 100, 'manual'),
      (${lancamentoBId}, ${clinicA}, 'receber', '1.H alocação concorrente B', 100, 'manual')
  `);

  await dbAdmin.execute(sql`
    INSERT INTO patient_credits
      (id, clinic_id, patient_charge_id, amount, kind, status)
    VALUES
      (${creditAId}, ${clinicA}, ${chargeAId}, 25, 'deposit', 'available'),
      (${creditBId}, ${clinicB}, ${chargeBId}, 25, 'deposit', 'available'),
      (${allocationCreditId}, ${clinicA}, ${allocationChargeId}, 100, 'deposit', 'available'),
      (${overAllocationCreditId}, ${clinicA}, ${overAllocationChargeId}, 50, 'deposit', 'available'),
      (${releaseCreditId}, ${clinicA}, ${releaseChargeId}, 75, 'deposit', 'available')
  `);
}

async function cleanup(): Promise<void> {
  await dbAdmin.execute(sql`
    DELETE FROM patient_credits WHERE clinic_id IN (${clinicA}, ${clinicB})
  `);
  await dbAdmin.execute(sql`
    DELETE FROM lancamentos WHERE clinic_id IN (${clinicA}, ${clinicB})
  `);
  await dbAdmin.execute(sql`
    DELETE FROM clinics WHERE id IN (${clinicA}, ${clinicB})
  `);

  const residue = await dbAdmin.execute<{
    clinics: number;
    credits: number;
    lancamentos: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM clinics WHERE id IN (${clinicA}, ${clinicB})) AS clinics,
      (SELECT count(*)::int FROM patient_credits
        WHERE clinic_id IN (${clinicA}, ${clinicB})) AS credits,
      (SELECT count(*)::int FROM lancamentos
        WHERE clinic_id IN (${clinicA}, ${clinicB})) AS lancamentos
  `);
  assert(
    residue[0]?.clinics === 0 && residue[0]?.credits === 0 && residue[0]?.lancamentos === 0,
    `cleanup incompleto: ${JSON.stringify(residue[0])}`,
  );
}

async function main(): Promise<void> {
  try {
    await createFixtures();

    await step('1 estrutura: patient_credits usa ENABLE + FORCE RLS', async () => {
      const rows = await dbAdmin.execute<{ enabled: boolean; forced: boolean }>(sql`
        SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
          FROM pg_class
         WHERE oid = 'public.patient_credits'::regclass
      `);
      assert(rows[0]?.enabled === true, 'ENABLE ROW LEVEL SECURITY ausente');
      assert(rows[0]?.forced === true, 'FORCE ROW LEVEL SECURITY ausente');

      const policies = await dbAdmin.execute<{ command: string }>(sql`
        SELECT cmd AS command
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'patient_credits'
      `);
      const commands = new Set(policies.map((row) => row.command));
      assert(commands.has('SELECT'), 'policy SELECT ausente');
      assert(commands.has('INSERT'), 'policy INSERT ausente');
      assert(commands.has('UPDATE'), 'policy UPDATE ausente');
      assert(!commands.has('DELETE'), 'policy DELETE não deveria existir');
    });

    await step('2 RLS: clínica A lê créditos próprios e não enxerga B', async () => {
      const rows = await withTenant(clinicA, (tx) =>
        tx.execute<{ id: string; clinicId: string }>(sql`
          SELECT id, clinic_id AS "clinicId"
            FROM patient_credits
           WHERE id IN (${creditAId}, ${creditBId})
        `),
      );
      assert(rows.length === 1, `A deveria enxergar 1 crédito, enxergou ${rows.length}`);
      assert(rows[0]?.id === creditAId, 'A não recebeu o próprio crédito');
      assert(rows[0]?.clinicId === clinicA, 'A recebeu crédito de outro tenant');
    });

    await step('3 RLS: clínica A não insere crédito para B', async () => {
      let denied = false;
      try {
        await withTenant(clinicA, (tx) =>
          tx.execute(sql`
            INSERT INTO patient_credits
              (clinic_id, patient_charge_id, amount, kind, status)
            VALUES (${clinicB}, ${crossTenantChargeId}, 10, 'deposit', 'available')
          `),
        );
      } catch {
        denied = true;
      }
      assert(denied, 'INSERT cross-tenant não foi rejeitado');

      const persisted = await dbAdmin.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
          FROM patient_credits
         WHERE patient_charge_id = ${crossTenantChargeId}
      `);
      assert(persisted[0]?.count === 0, 'INSERT cross-tenant persistiu uma linha');
    });

    await step('4 RLS/grants: clínica A não altera nem apaga crédito de B', async () => {
      const updated = await withTenant(clinicA, (tx) =>
        tx.execute<{ id: string }>(sql`
          UPDATE patient_credits
             SET amount = 999
           WHERE id = ${creditBId}
           RETURNING id
        `),
      );
      assert(updated.length === 0, `UPDATE cross-tenant alterou ${updated.length} linha(s)`);

      let deleteDenied = false;
      try {
        await withTenant(clinicA, (tx) =>
          tx.execute(sql`DELETE FROM patient_credits WHERE id = ${creditAId}`),
        );
      } catch {
        deleteDenied = true;
      }
      assert(deleteDenied, 'authenticated conseguiu apagar crédito financeiro');

      const persisted = await dbAdmin.execute<{ amount: string }>(sql`
        SELECT amount::text AS amount FROM patient_credits WHERE id = ${creditBId}
      `);
      assert(persisted[0]?.amount === '25.00', 'crédito de B foi modificado');
    });

    await step('5 concorrência: oito grants da mesma cobrança criam um crédito', async () => {
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          withTenant(clinicA, (tx) =>
            tx.execute<{ id: string }>(sql`
              INSERT INTO patient_credits
                (clinic_id, patient_charge_id, amount, kind, status)
              VALUES (${clinicA}, ${concurrentGrantChargeId}, 60, 'deposit', 'available')
              ON CONFLICT DO NOTHING
              RETURNING id
            `),
          ),
        ),
      );
      const winners = attempts.filter((rows) => rows.length === 1).length;
      assert(winners === 1, `esperava 1 grant vencedor, houve ${winners}`);

      const rows = await dbAdmin.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
          FROM patient_credits
         WHERE clinic_id = ${clinicA}
           AND patient_charge_id = ${concurrentGrantChargeId}
      `);
      assert(rows[0]?.count === 1, `UNIQUE deixou ${rows[0]?.count ?? 0} créditos duplicados`);
    });

    await step('6 concorrência: dois allocators só consomem o crédito uma vez', async () => {
      const attempts = await Promise.all([
        withTenant(clinicA, (tx) =>
          allocateCredit(tx, {
            clinicId: clinicA,
            creditId: allocationCreditId,
            lancamentoId: lancamentoAId,
            amount: 100,
          }),
        ),
        withTenant(clinicA, (tx) =>
          allocateCredit(tx, {
            clinicId: clinicA,
            creditId: allocationCreditId,
            lancamentoId: lancamentoBId,
            amount: 100,
          }),
        ),
      ]);
      assert(attempts.filter(Boolean).length === 1, `esperava 1 alocação, veio ${attempts}`);

      const rows = await dbAdmin.execute<{
        status: string;
        amount: string;
        lancamentoId: string | null;
      }>(sql`
        SELECT status, allocated_amount::text AS amount,
               allocated_lancamento_id AS "lancamentoId"
          FROM patient_credits
         WHERE id = ${allocationCreditId}
      `);
      assert(rows[0]?.status === 'allocated', 'crédito não terminou allocated');
      assert(rows[0]?.amount === '100.00', `valor alocado inesperado: ${rows[0]?.amount}`);
      assert(
        rows[0]?.lancamentoId === lancamentoAId || rows[0]?.lancamentoId === lancamentoBId,
        'crédito aponta para lançamento inesperado',
      );
    });

    await step('7 ciclo de vida: crédito alocado não pode ser liberado depois', async () => {
      const outcome = await withTenant(clinicA, (tx) =>
        releaseCredit(tx, {
          clinicId: clinicA,
          patientChargeId: allocationChargeId,
          disposition: 'refunded',
          releasedAt: new Date(),
        }),
      );
      assert(outcome === 'already_resolved', `resultado inesperado: ${outcome}`);

      const rows = await dbAdmin.execute<{ status: string; releasedAt: string | null }>(sql`
        SELECT status, released_at AS "releasedAt"
          FROM patient_credits
         WHERE id = ${allocationCreditId}
      `);
      assert(rows[0]?.status === 'allocated', 'crédito alocado mudou de estado');
      assert(rows[0]?.releasedAt === null, 'crédito alocado recebeu released_at');
    });

    await step('8 integridade: CHECK rejeita alocar mais dinheiro que o recebido', async () => {
      let denied = false;
      try {
        await withTenant(clinicA, (tx) =>
          allocateCredit(tx, {
            clinicId: clinicA,
            creditId: overAllocationCreditId,
            lancamentoId: lancamentoAId,
            amount: 60,
          }),
        );
      } catch {
        denied = true;
      }
      assert(denied, 'banco aceitou allocated_amount maior que amount');

      const rows = await dbAdmin.execute<{ status: string; amount: string }>(sql`
        SELECT status, allocated_amount::text AS amount
          FROM patient_credits
         WHERE id = ${overAllocationCreditId}
      `);
      assert(rows[0]?.status === 'available', 'falha de CHECK deixou mudança parcial');
      assert(rows[0]?.amount === '0.00', 'falha de CHECK alterou allocated_amount');
    });

    await step('9 concorrência: duas liberações produzem um único terminal', async () => {
      const releasedAt = new Date();
      const attempts = await Promise.all([
        withTenant(clinicA, (tx) =>
          releaseCredit(tx, {
            clinicId: clinicA,
            patientChargeId: releaseChargeId,
            disposition: 'refunded',
            releasedAt,
          }),
        ),
        withTenant(clinicA, (tx) =>
          releaseCredit(tx, {
            clinicId: clinicA,
            patientChargeId: releaseChargeId,
            disposition: 'retained',
            releasedAt,
          }),
        ),
      ]);
      assert(
        attempts.filter((result) => result === 'released').length === 1,
        `esperava 1 liberação vencedora, veio ${attempts}`,
      );
      assert(
        attempts.filter((result) => result === 'already_resolved').length === 1,
        `esperava 1 liberação deduplicada, veio ${attempts}`,
      );

      const rows = await dbAdmin.execute<{ status: string; releasedAt: string | null }>(sql`
        SELECT status, released_at AS "releasedAt"
          FROM patient_credits
         WHERE id = ${releaseCreditId}
      `);
      assert(
        rows[0]?.status === 'refunded' || rows[0]?.status === 'retained',
        `estado terminal inesperado: ${rows[0]?.status}`,
      );
      assert(Boolean(rows[0]?.releasedAt), 'terminal ficou sem released_at');
    });
  } finally {
    await cleanup();
    console.log('[OK]   10 cleanup: zero clínicas/créditos/lançamentos sintéticos residuais');
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    throw new Error(`1.H financeiro falhou em ${failed.length}/${results.length} checks`);
  }
  console.log(`\n1.H FINANCIAL PASS — ${results.length + 1}/${results.length + 1} checks`);
}

main().catch((error) => {
  console.error(errorDetail(error));
  process.exitCode = 1;
});
