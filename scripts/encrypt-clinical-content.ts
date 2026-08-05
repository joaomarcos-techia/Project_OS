/**
 * Backfill da cifra de conteúdo clínico (A1 / ADR-044).
 *
 * Cifra o conteúdo das linhas EXISTENTES para as colunas `*_encrypted`
 * (adicionadas pela 0046) — as novas linhas já nascem cifradas pelo código.
 * Roda ENTRE a 0046 e a 0047. A 0047 tem um guard `RAISE EXCEPTION` que aborta
 * se este backfill não tiver rodado, então esquecer isto falha ALTO.
 *
 * A chave vive na app (não em SQL) → tem que ser um script, não uma migration.
 * Scan cross-tenant por `dbAdmin` (auto-allowed em scripts/); a cifra é por
 * clínica com o clinicId de cada linha (o HKDF deriva a chave dela).
 *
 * ⚠️ TRIGGER DE IMUTABILIDADE: `prontuarios`/`prontuario_versions` bloqueiam
 * UPDATE de linha assinada (independente de role — é trigger, não RLS). O UPDATE
 * abaixo liga `app.allow_signed_edit='on'` na MESMA transação; o ramo permissivo
 * do trigger exige que assinatura/identidade NÃO mudem — e não mudam (só a coluna
 * cifrada nova). Sem o bypass, o backfill falharia em todo prontuário assinado.
 *
 * Idempotente: só toca linhas com `<col>_encrypted IS NULL`. `--dry-run` conta
 * sem escrever.
 *
 * Uso:
 *   pnpm tsx scripts/encrypt-clinical-content.ts --dry-run
 *   pnpm tsx scripts/encrypt-clinical-content.ts
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { encryptForTenant } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';

const DRY_RUN = process.argv.includes('--dry-run');

// Permite prod SÓ com --prod explícito (o operador roda na janela manual).
const ALLOW_PROD = process.argv.includes('--prod');
if (!ALLOW_PROD) assertDevContext();

interface TableSpec {
  table: string;
  /** coluna origem (jsonb/text em claro) → coluna destino (text cifrado) */
  cols: { src: string; dst: string; nullable: boolean }[];
  /** liga o bypass da trigger de imutabilidade (só prontuarios) */
  signedBypass?: boolean;
}

const SPECS: TableSpec[] = [
  {
    table: 'prontuarios',
    cols: [{ src: 'content', dst: 'content_encrypted', nullable: false }],
    signedBypass: true,
  },
  {
    table: 'prontuario_versions',
    cols: [{ src: 'content', dst: 'content_encrypted', nullable: false }],
    signedBypass: true, // versions referenciam prontuário assinado; belt-and-suspenders
  },
  {
    table: 'prescriptions',
    cols: [
      { src: 'medicamentos', dst: 'medicamentos_encrypted', nullable: false },
      { src: 'observacoes', dst: 'observacoes_encrypted', nullable: true },
    ],
  },
  {
    table: 'medical_documents',
    cols: [{ src: 'content', dst: 'content_encrypted', nullable: false }],
  },
];

async function backfillTable(spec: TableSpec): Promise<void> {
  // Uma linha precisa de backfill se QUALQUER coluna não-nullable ainda está NULL.
  const pending = spec.cols.filter((c) => !c.nullable).map((c) => `${c.dst} IS NULL`);
  const whereNeedsWork = pending.length > 0 ? pending.join(' OR ') : 'false';

  const rows = (await dbAdmin.execute(
    sql.raw(
      `SELECT id, clinic_id, ${spec.cols.map((c) => c.src).join(', ')} ` +
        `FROM ${spec.table} WHERE ${whereNeedsWork}`,
    ),
  )) as unknown as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    console.log(`  ${spec.table}: 0 linhas pendentes`);
    return;
  }
  if (DRY_RUN) {
    console.log(`  ${spec.table}: ${rows.length} linhas a cifrar (dry-run, nada escrito)`);
    return;
  }

  let done = 0;
  for (const row of rows) {
    const id = row.id as string;
    const clinicId = row.clinic_id as string;

    // Pré-computa os ciphertexts (CPU puro, fora da tx).
    const sets: { dst: string; value: string | null }[] = [];
    for (const c of spec.cols) {
      const raw = row[c.src];
      if (c.nullable && (raw === null || raw === undefined)) {
        sets.push({ dst: c.dst, value: null }); // observacoes NULL → destino NULL
        continue;
      }
      // jsonb vem como objeto/array já parseado pelo driver; text vem como string.
      const plaintext = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {});
      sets.push({ dst: c.dst, value: await encryptForTenant(clinicId, plaintext) });
    }

    await dbAdmin.transaction(async (tx) => {
      if (spec.signedBypass) {
        await tx.execute(sql`SELECT set_config('app.allow_signed_edit', 'on', true)`);
      }
      const assignments = sets
        .map((s) => `${s.dst} = ${s.value === null ? 'NULL' : `'${s.value.replace(/'/g, "''")}'`}`)
        .join(', ');
      await tx.execute(sql.raw(`UPDATE ${spec.table} SET ${assignments} WHERE id = '${id}'`));
      if (spec.signedBypass) {
        await tx.execute(sql`SELECT set_config('app.allow_signed_edit', 'off', true)`);
      }
    });
    done++;
  }
  console.log(`  ${spec.table}: ${done} linhas cifradas`);
}

async function main(): Promise<void> {
  console.log(
    `[encrypt-clinical-content] ${DRY_RUN ? 'DRY-RUN' : 'APLICANDO'}${ALLOW_PROD ? ' (PROD)' : ''}`,
  );
  for (const spec of SPECS) {
    await backfillTable(spec);
  }
  console.log('[encrypt-clinical-content] concluído.');
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('[encrypt-clinical-content] FALHOU:', e);
  process.exit(1);
});
