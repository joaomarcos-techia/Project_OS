/**
 * Hardening 1.H / D13 — isolamento real de clinic_payment_accounts no banco DEV.
 *
 * Usa apenas fixtures sintéticas e não chama Asaas ou Meta. Prova:
 *   1. ENABLE + FORCE RLS e policies esperadas;
 *   2. authenticated lê a própria conta, mas não enxerga a conta de outro tenant;
 *   3. tentativa cross-tenant não altera a conta alheia;
 *   4. colunas de segredo continuam sem grant de leitura para authenticated;
 *   5. cleanup remove exatamente as duas clínicas/contas criadas.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

assertDevContext();

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];
const runId = randomUUID();
const slugSuffix = runId.replaceAll('-', '').slice(0, 12);
const clinicA = randomUUID();
const clinicB = randomUUID();
const accountNameA = `D13 A ${runId.slice(0, 8)}`;
const accountNameB = `D13 B ${runId.slice(0, 8)}`;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
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
      (${clinicA}, ${`d13-a-${slugSuffix}`}, 'D13 Clínica A', 'Fixture sintética', 'active'),
      (${clinicB}, ${`d13-b-${slugSuffix}`}, 'D13 Clínica B', 'Fixture sintética', 'active')
  `);
  await dbAdmin.execute(sql`
    INSERT INTO clinic_payment_accounts (clinic_id, provider, account_name, active)
    VALUES
      (${clinicA}, 'asaas', ${accountNameA}, false),
      (${clinicB}, 'asaas', ${accountNameB}, false)
  `);
}

async function cleanup(): Promise<void> {
  await dbAdmin.execute(sql`DELETE FROM clinics WHERE id IN (${clinicA}, ${clinicB})`);
  const residue = await dbAdmin.execute<{ clinics: number; accounts: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM clinics WHERE id IN (${clinicA}, ${clinicB})) AS clinics,
      (SELECT count(*)::int FROM clinic_payment_accounts
        WHERE clinic_id IN (${clinicA}, ${clinicB})) AS accounts
  `);
  assert(
    residue[0]?.clinics === 0 && residue[0]?.accounts === 0,
    `cleanup incompleto: ${JSON.stringify(residue[0])}`,
  );
}

async function main(): Promise<void> {
  try {
    await createFixtures();

    await step('1 estrutura: clinic_payment_accounts usa ENABLE + FORCE RLS', async () => {
      const rows = await dbAdmin.execute<{ enabled: boolean; forced: boolean }>(sql`
        SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
          FROM pg_class
         WHERE oid = 'public.clinic_payment_accounts'::regclass
      `);
      assert(rows[0]?.enabled === true, 'ENABLE ROW LEVEL SECURITY ausente');
      assert(rows[0]?.forced === true, 'FORCE ROW LEVEL SECURITY ausente');

      const policies = await dbAdmin.execute<{ command: string }>(sql`
        SELECT cmd AS command
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'clinic_payment_accounts'
      `);
      const commands = new Set(policies.map((row) => row.command));
      assert(commands.has('SELECT'), 'policy SELECT ausente');
      assert(commands.has('INSERT'), 'policy INSERT ausente');
      assert(commands.has('UPDATE'), 'policy UPDATE ausente');
      assert(!commands.has('DELETE'), 'policy DELETE não deveria existir');
    });

    await step('2 RLS: clínica A lê a própria conta e não enxerga a conta de B', async () => {
      const rows = await withTenant(clinicA, (tx) =>
        tx.execute<{ clinicId: string; accountName: string }>(sql`
          SELECT clinic_id AS "clinicId", account_name AS "accountName"
            FROM clinic_payment_accounts
           WHERE clinic_id IN (${clinicA}, ${clinicB})
        `),
      );
      assert(rows.length === 1, `A deveria enxergar 1 conta, enxergou ${rows.length}`);
      assert(rows[0]?.clinicId === clinicA, 'A recebeu uma conta de outro tenant');
      assert(rows[0]?.accountName === accountNameA, 'A não recebeu a própria conta esperada');
    });

    await step('3 RLS/grant: clínica A não altera a conta de B', async () => {
      let affected = 0;
      let denied = false;
      try {
        const rows = await withTenant(clinicA, (tx) =>
          tx.execute<{ id: string }>(sql`
            UPDATE clinic_payment_accounts
               SET account_name = 'D13 cross-tenant tamper'
             WHERE clinic_id = ${clinicB}
             RETURNING id
          `),
        );
        affected = rows.length;
      } catch {
        denied = true;
      }
      assert(denied || affected === 0, `cross-tenant alterou ${affected} conta(s)`);

      const persisted = await dbAdmin.execute<{ accountName: string | null }>(sql`
        SELECT account_name AS "accountName"
          FROM clinic_payment_accounts
         WHERE clinic_id = ${clinicB}
      `);
      assert(persisted[0]?.accountName === accountNameB, 'conta de B foi modificada por A');
    });

    await step('4 grant: authenticated não lê api_key_encrypted', async () => {
      let denied = false;
      try {
        await withTenant(clinicA, (tx) =>
          tx.execute(sql`
            SELECT api_key_encrypted
              FROM clinic_payment_accounts
             WHERE clinic_id = ${clinicA}
          `),
        );
      } catch {
        denied = true;
      }
      assert(denied, 'authenticated conseguiu ler a coluna api_key_encrypted');
    });
  } finally {
    await cleanup();
    console.log('[OK]   5 cleanup: zero clínicas/contas sintéticas residuais');
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    throw new Error(`D13 falhou em ${failed.length}/${results.length} checks`);
  }
  console.log(`\nD13 PASS — ${results.length + 1}/${results.length + 1} checks`);
}

main().catch((error) => {
  console.error(errorDetail(error));
  process.exitCode = 1;
});
