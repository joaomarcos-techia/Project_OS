import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

// eslint-disable-next-line boundaries/element-types -- billingApiV1 é a API versionada de entitlement; o contexto não lê o schema de billing.
import { billingApiV1 } from '@/contexts/billing/api';
import { logAudit } from '@/lib/audit/log';
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';

import {
  calculateProfessionalPayout,
  centsToMoney,
  moneyToCents,
  payoutRuleSnapshot,
} from '../payout';
import {
  clinicFinancialPolicyVersions,
  lancamentos,
  patientCredits,
  paymentTransactions,
  professionalPayoutRules,
  professionalPayouts,
  type ProfessionalPayoutBasis,
  type ProfessionalPayoutRuleRow,
} from '../schema';
import { isEligiblePayoutProfessional } from './payout-professional-eligibility';

function ruleFromRow(row: ProfessionalPayoutRuleRow) {
  return row.kind === 'percentage'
    ? { kind: 'percentage' as const, percentage: Number(row.percentage) }
    : { kind: 'fixed' as const, fixedAmount: Number(row.fixedAmount) };
}

async function resolveApplicableRule(
  tx: Tx,
  input: { clinicId: string; professionalId: string; procedureId: string; at: Date },
): Promise<ProfessionalPayoutRuleRow | null> {
  const [row] = await tx
    .select()
    .from(professionalPayoutRules)
    .where(
      and(
        eq(professionalPayoutRules.clinicId, input.clinicId),
        eq(professionalPayoutRules.professionalId, input.professionalId),
        or(
          eq(professionalPayoutRules.procedureId, input.procedureId),
          isNull(professionalPayoutRules.procedureId),
        ),
        lte(professionalPayoutRules.effectiveFrom, input.at),
        or(
          isNull(professionalPayoutRules.effectiveTo),
          gt(professionalPayoutRules.effectiveTo, input.at),
        ),
      ),
    )
    .orderBy(desc(sql`${professionalPayoutRules.procedureId} IS NOT NULL`))
    .limit(1);
  return row ?? null;
}

async function resolvePayoutBasis(
  tx: Tx,
  clinicId: string,
  at: Date,
): Promise<{ basis: ProfessionalPayoutBasis; policyVersionId: string | null }> {
  const [version] = await tx
    .select({
      id: clinicFinancialPolicyVersions.id,
      basis: clinicFinancialPolicyVersions.professionalPayoutBasis,
    })
    .from(clinicFinancialPolicyVersions)
    .where(
      and(
        eq(clinicFinancialPolicyVersions.clinicId, clinicId),
        lte(clinicFinancialPolicyVersions.effectiveFrom, at),
      ),
    )
    .orderBy(desc(clinicFinancialPolicyVersions.effectiveFrom))
    .limit(1);
  if (version) return { basis: version.basis, policyVersionId: version.id };
  // Antes da primeira mudança versionada, a política histórica é o default
  // GROSS. Consultar a linha corrente aqui faria uma alteração futura para NET
  // mudar retroativamente atendimentos antigos ainda não processados.
  return { basis: 'gross', policyVersionId: null };
}

export async function createProfessionalPayoutSnapshot(
  tx: Tx,
  input: {
    clinicId: string;
    appointmentId: string;
    professionalId: string;
    procedureId: string;
    grossAmount: number;
    occurredAt: Date;
  },
): Promise<string | null> {
  // Downgrade para Solo suspende novos repasses automáticos. Snapshots antigos
  // continuam auditáveis e podem ser reconciliados sem mudar a regra histórica.
  if (!(await billingApiV1.hasAdvancedFinancialPolicies(input.clinicId, tx))) return null;
  const rule = await resolveApplicableRule(tx, {
    clinicId: input.clinicId,
    professionalId: input.professionalId,
    procedureId: input.procedureId,
    at: input.occurredAt,
  });
  // A regra pode ter sobrevivido à desativação ou mudança de papel. A consulta
  // atual do perfil, na mesma transação, impede criar novo passivo indevido.
  if (!rule) return null;
  if (!(await isEligiblePayoutProfessional(tx, input.clinicId, input.professionalId))) return null;

  const { basis, policyVersionId } = await resolvePayoutBasis(tx, input.clinicId, input.occurredAt);
  const resolvedRule = ruleFromRow(rule);
  const calculation = calculateProfessionalPayout({
    grossAmount: input.grossAmount,
    netAmount: null,
    payoutBasis: basis,
    rule: resolvedRule,
  });
  const snapshot = payoutRuleSnapshot(resolvedRule);
  const [created] = await tx
    .insert(professionalPayouts)
    .values({
      clinicId: input.clinicId,
      appointmentId: input.appointmentId,
      professionalId: input.professionalId,
      procedureId: input.procedureId,
      policyVersionId,
      ruleId: rule.id,
      calculationBasis: basis,
      ...snapshot,
      grossAmount: input.grossAmount.toFixed(2),
      basisAmount: calculation.status === 'calculated' ? calculation.basisAmount.toFixed(2) : null,
      payoutAmount:
        calculation.status === 'calculated' ? calculation.payoutAmount.toFixed(2) : null,
      status: calculation.status,
      calculatedAt: calculation.status === 'calculated' ? sql`now()` : null,
    })
    .onConflictDoNothing({ target: professionalPayouts.appointmentId })
    .returning({ id: professionalPayouts.id });

  if (created) {
    metrics.emit('financial.professional_payout.created', {
      clinicId: input.clinicId,
      appointmentId: input.appointmentId,
      payoutId: created.id,
      basis,
      status: calculation.status,
    });
  }
  return created?.id ?? null;
}

interface PaymentEconomics {
  netCents: number;
  providerFeeCents: number | null;
  earlySettlementFeeCents: number | null;
}

type PaymentEconomicsResult =
  | { status: 'ready'; economics: PaymentEconomics }
  | { status: 'not_paid' | 'reversed' | 'pending' };

async function collectPaymentEconomics(
  tx: Tx,
  input: { clinicId: string; appointmentId: string },
): Promise<PaymentEconomicsResult> {
  const [receivable] = await tx
    .select({ status: lancamentos.status })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.clinicId, input.clinicId),
        eq(lancamentos.appointmentId, input.appointmentId),
        eq(lancamentos.tipo, 'receber'),
      ),
    )
    .limit(1);

  const [unresolvedLoss] = await tx
    .select({ id: patientCredits.id })
    .from(patientCredits)
    .where(
      and(
        eq(patientCredits.clinicId, input.clinicId),
        eq(patientCredits.appointmentId, input.appointmentId),
        inArray(patientCredits.disputeStatus, ['lost', 'cash_undone']),
      ),
    )
    .limit(1);
  if (unresolvedLoss) return { status: 'reversed' };

  const rows = await tx
    .select({
      transactionId: paymentTransactions.id,
      transactionKind: paymentTransactions.kind,
      transactionAmount: paymentTransactions.amount,
      createdBy: paymentTransactions.createdBy,
      creditAmount: patientCredits.amount,
      providerGrossAmount: patientCredits.providerGrossAmount,
      providerFeeAmount: patientCredits.providerFeeAmount,
      providerNetAmount: patientCredits.providerNetAmount,
      earlySettlementFeeAmount: patientCredits.earlySettlementFeeAmount,
    })
    .from(paymentTransactions)
    .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
    .leftJoin(
      patientCredits,
      eq(patientCredits.allocatedPaymentTransactionId, paymentTransactions.id),
    )
    .where(
      and(
        eq(paymentTransactions.clinicId, input.clinicId),
        eq(lancamentos.appointmentId, input.appointmentId),
        eq(lancamentos.tipo, 'receber'),
      ),
    );
  // Enquanto a regra de repasse após estorno não estiver definida, qualquer
  // reversão explícita suspende a obrigação. Não inferir proporção da tarifa.
  if (rows.some((row) => row.transactionKind === 'refund')) return { status: 'reversed' };
  if (receivable?.status !== 'pago') return { status: 'not_paid' };

  const paymentIds = new Set(
    rows.filter((row) => row.transactionKind === 'payment').map((row) => row.transactionId),
  );

  let netCents = 0;
  let providerFeeCents = 0;
  let earlySettlementFeeCents = 0;
  let providerFeeKnown = true;
  let earlySettlementFeeKnown = true;
  for (const row of rows) {
    if (row.transactionKind !== 'payment') continue;
    const transactionCents = moneyToCents(Number(row.transactionAmount));
    if (row.creditAmount === null) {
      // Baixa manual: não há provedor nem tarifa a inventar.
      if (row.createdBy === null) return { status: 'pending' };
      netCents += transactionCents;
      continue;
    }
    if (row.providerGrossAmount === null || row.providerNetAmount === null) {
      return { status: 'pending' };
    }
    const creditGrossCents = moneyToCents(Number(row.providerGrossAmount));
    if (creditGrossCents === 0) return { status: 'pending' };
    const allocatedRatio = transactionCents / creditGrossCents;
    netCents += Math.round(moneyToCents(Number(row.providerNetAmount)) * allocatedRatio);
    if (row.providerFeeAmount !== null) {
      providerFeeCents += Math.round(moneyToCents(Number(row.providerFeeAmount)) * allocatedRatio);
    } else {
      providerFeeKnown = false;
    }
    if (row.earlySettlementFeeAmount !== null) {
      earlySettlementFeeCents += Math.round(
        moneyToCents(Number(row.earlySettlementFeeAmount)) * allocatedRatio,
      );
    } else {
      earlySettlementFeeKnown = false;
    }
  }
  if (paymentIds.size === 0) return { status: 'pending' };
  return {
    status: 'ready',
    economics: {
      netCents,
      providerFeeCents: providerFeeKnown ? providerFeeCents : null,
      earlySettlementFeeCents: earlySettlementFeeKnown ? earlySettlementFeeCents : null,
    },
  };
}

/** Atualiza fatos do provedor e conclui repasse NET somente quando tudo é real. */
export async function refreshProfessionalPayout(
  tx: Tx,
  input: { clinicId: string; appointmentId: string },
): Promise<'missing' | 'pending' | 'calculated' | 'cancelled'> {
  const [payout] = await tx
    .select()
    .from(professionalPayouts)
    .where(
      and(
        eq(professionalPayouts.clinicId, input.clinicId),
        eq(professionalPayouts.appointmentId, input.appointmentId),
        inArray(professionalPayouts.status, ['pending_economics', 'calculated', 'cancelled']),
      ),
    )
    .for('update')
    .limit(1);
  if (!payout) return 'missing';
  // A reversão exige decisão humana. Uma leitura posterior sem o marcador de
  // perda não pode recalcular automaticamente um valor que já foi suspenso.
  if (payout.status === 'cancelled') return 'cancelled';

  const result = await collectPaymentEconomics(tx, input);
  const rule =
    payout.ruleKind === 'percentage'
      ? { kind: 'percentage' as const, percentage: Number(payout.rulePercentage) }
      : { kind: 'fixed' as const, fixedAmount: Number(payout.ruleFixedAmount) };
  if (result.status !== 'ready') {
    if (payout.calculationBasis === 'gross' && result.status !== 'reversed') {
      // GROSS é obrigação pelo atendimento concluído: falta de pagamento ou de
      // fatos do provedor não a cancela. Reversão explícita é tratada abaixo.
      const calculation = calculateProfessionalPayout({
        grossAmount: Number(payout.grossAmount),
        netAmount: null,
        payoutBasis: 'gross',
        rule,
      });
      if (calculation.status !== 'calculated') return 'pending';
      await tx
        .update(professionalPayouts)
        .set({
          providerFeeAmount: null,
          earlySettlementFeeAmount: null,
          netAmount: null,
          basisAmount: calculation.basisAmount.toFixed(2),
          payoutAmount: calculation.payoutAmount.toFixed(2),
          status: 'calculated',
          calculatedAt: payout.calculatedAt ?? sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(professionalPayouts.id, payout.id),
            eq(professionalPayouts.clinicId, input.clinicId),
          ),
        );
      return 'calculated';
    }
    const nextStatus = result.status === 'reversed' ? 'cancelled' : 'pending_economics';
    if (result.status === 'reversed' && payout.status === 'calculated') {
      await logAudit(tx, {
        clinicId: input.clinicId,
        userId: null,
        action: 'financial.professional_payout.suspended',
        resourceType: 'professional_payout',
        resourceId: payout.id,
        before: {
          status: payout.status,
          calculationBasis: payout.calculationBasis,
          basisAmount: payout.basisAmount,
          payoutAmount: payout.payoutAmount,
          providerFeeAmount: payout.providerFeeAmount,
          netAmount: payout.netAmount,
          calculatedAt: payout.calculatedAt,
        },
        after: { status: nextStatus, reason: 'payment_reversed' },
        requestContext: {
          ip: null,
          userAgent: 'clinicaos-financial-worker',
          requestId: randomUUID(),
        },
      });
    }
    await tx
      .update(professionalPayouts)
      .set({
        providerFeeAmount: null,
        earlySettlementFeeAmount: null,
        netAmount: null,
        basisAmount: null,
        payoutAmount: null,
        status: nextStatus,
        calculatedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(professionalPayouts.id, payout.id),
          eq(professionalPayouts.clinicId, input.clinicId),
        ),
      );
    return nextStatus === 'cancelled' ? 'cancelled' : 'pending';
  }

  const { economics } = result;

  const netAmount = centsToMoney(economics.netCents);
  const calculation = calculateProfessionalPayout({
    grossAmount: Number(payout.grossAmount),
    netAmount,
    payoutBasis: payout.calculationBasis,
    rule,
  });
  if (calculation.status !== 'calculated') return 'pending';

  await tx
    .update(professionalPayouts)
    .set({
      providerFeeAmount:
        economics.providerFeeCents === null
          ? null
          : centsToMoney(economics.providerFeeCents).toFixed(2),
      earlySettlementFeeAmount:
        economics.earlySettlementFeeCents === null
          ? null
          : centsToMoney(economics.earlySettlementFeeCents).toFixed(2),
      netAmount: netAmount.toFixed(2),
      basisAmount: calculation.basisAmount.toFixed(2),
      payoutAmount: calculation.payoutAmount.toFixed(2),
      status: 'calculated',
      calculatedAt: payout.calculatedAt ?? sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(professionalPayouts.id, payout.id), eq(professionalPayouts.clinicId, input.clinicId)),
    );

  metrics.emit('financial.professional_payout.calculated', {
    clinicId: input.clinicId,
    appointmentId: input.appointmentId,
    payoutId: payout.id,
    basis: payout.calculationBasis,
    grossAmount: Number(payout.grossAmount),
    providerFeeAmount:
      economics.providerFeeCents === null ? null : centsToMoney(economics.providerFeeCents),
    netAmount,
    payoutAmount: calculation.payoutAmount,
  });
  return 'calculated';
}
