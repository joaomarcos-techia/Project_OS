/**
 * P4.7-b — porta do Convênios para a importação histórica da agenda.
 *
 * Política (fundador, 25/11): atendimentos históricos importados PODEM ser registrados como convênio, mas NÃO geram
 * guia, pendência, recebível nem coparticipação. A referência fica em `hi_historical_coverages` (candidata 0169),
 * que o faturamento nunca lê; a guarda `created_via = 'import'` do faturamento continua valendo.
 *
 * Validação linha a linha, na sessão da clínica (RLS + predicado explícito):
 *   - Convênios contratado (D24) e ligado na clínica — senão a importação inteira é recusada com a mensagem do
 *     bloqueio comercial ou do módulo;
 *   - a operadora (registro ANS) é desta clínica e está ativa; operadora de outra clínica é "não cadastrada";
 *   - o plano, se informado, é o código do plano NA OPERADORA (`hi_plans.operator_code`) e está ativo.
 * Erro em qualquer linha recusa o lote inteiro (a importação é atômica), com o número da linha e o motivo.
 */
import { sql } from 'drizzle-orm';

// eslint-disable-next-line boundaries/element-types -- tipo da porta é o contrato PÚBLICO do Scheduling para a importação histórica (P4.7-b); só tipo, sem import de valor.
import type { HistoricalCoverageLine, HistoricalCoveragePort } from '@/contexts/scheduling';
import type { Tx } from '@/lib/db';

import { assertConveniosOperableTx } from './internal/module-guard';

const STATUS_LABEL: Record<string, string> = {
  draft: 'em rascunho',
  suspended: 'suspensa',
  archived: 'arquivada',
};

export async function resolveHistoricalCoverageLinesTx(
  tx: Tx,
  clinicId: string,
  lines: readonly HistoricalCoverageLine[],
): Promise<
  | { ok: true; byLine: ReadonlyMap<number, { insurerId: string; planId: string | null }> }
  | { ok: false; errors: readonly string[] }
> {
  await assertConveniosOperableTx(tx, clinicId);
  const registries = [...new Set(lines.map((l) => l.insurerAnsRegistry))];
  const insurers = (await tx.execute(sql`
    SELECT id, registro_ans, status FROM public.hi_insurers
     WHERE clinic_id = ${clinicId}::uuid AND registro_ans = ANY(ARRAY[${sql.join(
       registries.map((r) => sql`${r}`),
       sql`, `,
     )}]::text[])`)) as unknown as Array<{ id: string; registro_ans: string; status: string }>;
  const byRegistry = new Map(insurers.map((i) => [i.registro_ans, i]));
  const insurerIds = insurers.map((i) => i.id);
  const plans = insurerIds.length
    ? ((await tx.execute(sql`
        SELECT id, insurer_id, operator_code, status FROM public.hi_plans
         WHERE clinic_id = ${clinicId}::uuid AND insurer_id = ANY(ARRAY[${sql.join(
           insurerIds.map((i) => sql`${i}`),
           sql`, `,
         )}]::uuid[])`)) as unknown as Array<{
        id: string;
        insurer_id: string;
        operator_code: string | null;
        status: string;
      }>)
    : [];

  const errors: string[] = [];
  const byLine = new Map<number, { insurerId: string; planId: string | null }>();
  for (const l of lines) {
    const insurer = byRegistry.get(l.insurerAnsRegistry);
    if (!insurer) {
      errors.push(
        `linha ${l.line}: a operadora com registro ANS ${l.insurerAnsRegistry} não está cadastrada nesta clínica (cadastre em Convênios › Operadoras antes de importar)`,
      );
      continue;
    }
    if (insurer.status !== 'active') {
      errors.push(
        `linha ${l.line}: a operadora com registro ANS ${l.insurerAnsRegistry} está ${STATUS_LABEL[insurer.status] ?? insurer.status}; só operadora ativa`,
      );
      continue;
    }
    let planId: string | null = null;
    if (l.planCode !== null) {
      const plan = plans.find((p) => p.insurer_id === insurer.id && p.operator_code === l.planCode);
      if (!plan) {
        errors.push(
          `linha ${l.line}: o plano "${l.planCode}" não existe na operadora ${l.insurerAnsRegistry} (código do plano na operadora)`,
        );
        continue;
      }
      if (plan.status !== 'active') {
        errors.push(`linha ${l.line}: o plano "${l.planCode}" não está ativo`);
        continue;
      }
      planId = plan.id;
    }
    byLine.set(l.line, { insurerId: insurer.id, planId });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, byLine };
}

export async function recordHistoricalCoveragesTx(
  tx: Tx,
  rows: Parameters<HistoricalCoveragePort<Tx>['record']>[1],
): Promise<void> {
  for (const r of rows) {
    await tx.execute(sql`
      INSERT INTO public.hi_historical_coverages (clinic_id, appointment_id, insurer_id, plan_id, import_batch_id, created_by)
      VALUES (${r.clinicId}::uuid, ${r.appointmentId}::uuid, ${r.insurerId}::uuid, ${r.planId}::uuid,
        ${r.importBatchId}::uuid, ${r.createdBy}::uuid)`);
  }
}

/** A porta que a camada do app injeta em `importAppointmentHistory`. */
export const historicalCoveragePort: HistoricalCoveragePort<Tx> = {
  resolve: resolveHistoricalCoverageLinesTx,
  record: recordHistoricalCoveragesTx,
};
