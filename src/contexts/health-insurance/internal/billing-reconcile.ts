/**
 * Reconcile "convênio sem guia" (P7.4): roda no cron `financial-reconcile` (C.7 do
 * plano; sem cron novo) e garante que nenhum atendimento de convênio concluído
 * dependa de alguém lembrar de procurá-lo.
 *
 * Por candidato, UMA transação própria em `withTenant` (não segura o contador de
 * numeração da clínica entre atendimentos):
 *  1. trava consultiva do atendimento; ocupado → pula (outra reconciliação ou o
 *     worker estão nele) — duas reconciliações simultâneas não duplicam nada;
 *  2. o processamento roda num SAVEPOINT; falha técnica desfaz só ele, e a falha
 *     fica registrada na pendência (tentativas, código, próxima tentativa) na
 *     mesma transação;
 *  3. orçamento de tempo: para antes do prazo e deixa o resto para a próxima volta.
 */
import 'server-only';

import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';

import type { BillingGapCandidate } from '../billing-gap-candidates';

import {
  lockAppointmentBilling,
  processInsuranceBilling,
  recordBillingFailure,
  type BillingProcessOutcome,
} from './billing-recovery';

export interface InsuranceReconcileSummary {
  candidates: number;
  processed: number;
  guideReady: number;
  gapOpen: number;
  closed: number;
  busy: number;
  failed: number;
  skippedForBudget: number;
}

export async function reconcileInsuranceBilling(
  candidates: BillingGapCandidate[],
  opts: { deadlineAt?: number; now?: () => number } = {},
): Promise<InsuranceReconcileSummary> {
  const now = opts.now ?? Date.now;
  const summary: InsuranceReconcileSummary = {
    candidates: candidates.length,
    processed: 0,
    guideReady: 0,
    gapOpen: 0,
    closed: 0,
    busy: 0,
    failed: 0,
    skippedForBudget: 0,
  };
  for (const [index, c] of candidates.entries()) {
    if (opts.deadlineAt !== undefined && now() >= opts.deadlineAt) {
      summary.skippedForBudget = candidates.length - index;
      break;
    }
    const outcome = await withTenant(c.clinicId, async (tx) => {
      const locked = await lockAppointmentBilling(tx, c.appointmentId, 'skip');
      if (!locked) return { kind: 'busy' } as BillingProcessOutcome;
      try {
        return await tx.transaction((sp) =>
          processInsuranceBilling(sp, {
            clinicId: c.clinicId,
            appointmentId: c.appointmentId,
            detectedBy: 'reconcile',
            eventState: c.eventState,
            lock: 'held',
          }),
        );
      } catch (error) {
        await recordBillingFailure(tx, {
          clinicId: c.clinicId,
          appointmentId: c.appointmentId,
          eventState: c.eventState,
          error,
        });
        return { kind: 'failed' } as const;
      }
    });
    summary.processed += 1;
    switch (outcome.kind) {
      case 'guide_ready':
        summary.guideReady += 1;
        if (outcome.gapClosed) summary.closed += 1;
        break;
      case 'gap_open':
        summary.gapOpen += 1;
        break;
      case 'not_applicable':
        if (outcome.gapClosed) summary.closed += 1;
        break;
      case 'busy':
        summary.busy += 1;
        break;
      case 'failed':
        summary.failed += 1;
        break;
      default:
        break;
    }
  }
  metrics.emit('insurance.reconcile.run', { ...summary });
  return summary;
}
