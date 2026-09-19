/**
 * Smoke somente leitura do CSV contábil contra DEV.
 *
 * Seleciona a clínica com mais movimentos e o mês do movimento mais recente,
 * sem imprimir tenant, descrição ou qualquer dado financeiro identificável.
 * Não cria fixture, não grava auditoria e não chama provider externo.
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import {
  ACCOUNTING_EXPORT_MAX_ROWS,
  accountingCashEffect,
  accountingMonthRange,
  assertAccountingRowLimit,
  currentMonthInTimeZone,
  renderAccountingCsv,
} from '@/contexts/financial/accounting-export';
import { listAccountingMovements } from '@/contexts/financial/queries';
import { dbAdmin } from '@/lib/db';

assertDevContext();

interface CandidateRow {
  [key: string]: unknown;
  clinic_id: string;
  timezone: string | null;
  last_occurred_at: Date | string | null;
  movement_count: number | string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const candidates = await dbAdmin.execute<CandidateRow>(sql`
    SELECT c.id::text AS clinic_id,
           c.timezone,
           max(pt.occurred_at) AS last_occurred_at,
           count(pt.id)::int AS movement_count
      FROM clinics c
      LEFT JOIN payment_transactions pt ON pt.clinic_id = c.id
     GROUP BY c.id, c.timezone
     ORDER BY count(pt.id) DESC, c.created_at ASC
     LIMIT 1
  `);
  const candidate = candidates[0];
  assert(candidate, 'DEV não possui clínica para executar o smoke somente leitura.');

  const timeZone = candidate.timezone ?? 'America/Sao_Paulo';
  const lastOccurred = candidate.last_occurred_at
    ? new Date(candidate.last_occurred_at)
    : new Date();
  const month = currentMonthInTimeZone(timeZone, lastOccurred);
  const range = accountingMonthRange(month, timeZone);
  const movements = await listAccountingMovements(
    candidate.clinic_id,
    range.from,
    range.to,
    ACCOUNTING_EXPORT_MAX_ROWS + 1,
  );
  assertAccountingRowLimit(movements.length);

  if (Number(candidate.movement_count) > 0) {
    assert(movements.length > 0, 'O mês do movimento mais recente retornou CSV vazio.');
  }
  assert(
    new Set(movements.map((movement) => movement.transactionId)).size === movements.length,
    'O JOIN duplicou transações.',
  );
  for (const movement of movements) {
    assert(
      movement.cashEffect ===
        accountingCashEffect(movement.lancamentoTipo, movement.transactionKind, movement.amount),
      'O efeito no caixa diverge do contrato canônico.',
    );
  }

  const csv = renderAccountingCsv(movements, timeZone);
  const header = csv.split('\r\n', 1)[0] ?? '';
  assert(
    header.startsWith('data_movimento;hora_movimento;tipo_movimento'),
    'Cabeçalho CSV inválido.',
  );
  assert(!/paciente|cpf|diagnostico|prontuario/i.test(header), 'O CSV expôs coluna clínica/PII.');

  console.log(
    JSON.stringify({
      ok: true,
      month,
      rowCount: movements.length,
      csvBytes: Buffer.byteLength(csv, 'utf8'),
      mutationCount: 0,
    }),
  );
}

void main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
