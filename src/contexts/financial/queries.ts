/**
 * Financial read-side (C9). Tudo tenant-scoped via withTenant (RLS resolve por
 * `app.current_clinic`). REGRA: sem JOIN cross-context — nomes de paciente são
 * resolvidos na camada page (que pode importar o contexto patient), não aqui.
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import {
  cashFlowDaily,
  collectionCases,
  faturamentoPendencias,
  lancamentos,
  patientCredits,
  paymentMethods,
  paymentTransactions,
  professionalPayouts,
  suppliers,
  type LancamentoRow,
  type PaymentTransactionRow,
  type SupplierRow,
} from './schema';
import type {
  AccountingMovementDTO,
  AppointmentFinancialEconomics,
  CashFlowDTO,
  CollectionCaseDTO,
  FaturamentoPendenciaDTO,
  LancamentoCreatedVia,
  LancamentoStatus,
  LancamentoSummary,
  LancamentoTipo,
  PaymentMethodDTO,
  PaymentTransactionSummary,
  SupplierSummary,
} from './types';
import { accountingCashEffect } from './accounting-export';
import { computePayoutReviewBounds, listLatestPayoutReviews } from './internal/payout-review';
import { centsToMoney } from './payout';

const toIso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));
const roundMoney = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Compatibilidade para actions do contexto financeiro: a página usa o read
 * model de tenancy cacheado; este fluxo interno continua sob a fronteira do
 * próprio contexto, sem atravessar as regras de dependência entre contexts.
 */
export async function getClinicTimezone(clinicId: string): Promise<string> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx.execute<{ timezone: string | null }>(
      sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
    );
    return rows[0]?.timezone ?? DEFAULT_TZ;
  });
}

export function toLancamentoSummary(row: LancamentoRow): LancamentoSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    unitId: row.unitId ?? null,
    tipo: row.tipo as LancamentoTipo,
    descricao: row.descricao,
    valor: num(row.valor),
    valorPago: num(row.valorPago),
    valorGlosado: num(row.valorGlosado),
    sourceHiGuideId: row.sourceHiGuideId ?? null,
    status: row.status as LancamentoStatus,
    dueDate: (row.dueDate as string | null) ?? null,
    paidAt: toIso(row.paidAt),
    patientId: row.patientId ?? null,
    supplierId: row.supplierId ?? null,
    appointmentId: row.appointmentId ?? null,
    paymentMethod: row.paymentMethod ?? null,
    createdVia: row.createdVia as LancamentoCreatedVia,
    reversesLancamentoId: row.reversesLancamentoId ?? null,
    snapshotProcedureName: row.snapshotProcedureName ?? null,
    snapshotDoctorNome: row.snapshotDoctorNome ?? null,
    createdAt: toIso(row.createdAt)!,
  };
}

export function toPaymentTransactionSummary(
  row: PaymentTransactionRow,
  refundable: number,
): PaymentTransactionSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    lancamentoId: row.lancamentoId,
    kind: row.kind,
    amount: num(row.amount),
    paymentMethod: row.paymentMethod ?? null,
    occurredAt: toIso(row.occurredAt)!,
    originalPaymentId: row.originalPaymentId ?? null,
    reason: row.reason ?? null,
    createdBy: row.createdBy ?? null,
    refundableAmount: refundable,
  };
}

export async function listPaymentTransactionsForLancamentos(
  clinicId: string,
  lancamentoIds: readonly string[],
): Promise<PaymentTransactionSummary[]> {
  if (lancamentoIds.length === 0) return [];
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          inArray(paymentTransactions.lancamentoId, [...lancamentoIds]),
        ),
      )
      .orderBy(desc(paymentTransactions.occurredAt));

    const refundedByPayment = new Map<string, number>();
    for (const row of rows) {
      if (row.kind === 'refund' && row.originalPaymentId) {
        refundedByPayment.set(
          row.originalPaymentId,
          num(refundedByPayment.get(row.originalPaymentId)) + num(row.amount),
        );
      }
    }
    return rows.map((row) =>
      toPaymentTransactionSummary(
        row,
        row.kind === 'payment'
          ? Math.max(0, roundMoney(num(row.amount) - num(refundedByPayment.get(row.id))))
          : 0,
      ),
    );
  });
}

/**
 * Composição econômica dos atendimentos exibidos no Caixa.
 *
 * Valores do provedor são agregados em centavos e só se tornam conhecidos se
 * TODAS as cobranças do atendimento tiverem aquele fato. Um `NULL` tardio não
 * vira zero e não esconde uma conciliação ainda incompleta.
 */
export async function listAppointmentFinancialEconomics(
  clinicId: string,
  appointmentIds: readonly string[],
): Promise<AppointmentFinancialEconomics[]> {
  if (appointmentIds.length === 0) return [];
  return withTenant(clinicId, async (tx) => {
    const credits = await tx
      .select({
        appointmentId: patientCredits.appointmentId,
        allocatedAmount: patientCredits.allocatedAmount,
        allocatedReversedAmount: patientCredits.allocatedReversedAmount,
        allocatedPaymentTransactionId: patientCredits.allocatedPaymentTransactionId,
        providerGrossAmount: patientCredits.providerGrossAmount,
        providerFeeAmount: patientCredits.providerFeeAmount,
        earlySettlementFeeAmount: patientCredits.earlySettlementFeeAmount,
        providerNetAmount: patientCredits.providerNetAmount,
      })
      .from(patientCredits)
      .where(
        and(
          eq(patientCredits.clinicId, clinicId),
          inArray(patientCredits.appointmentId, [...appointmentIds]),
        ),
      );
    const refunds = await tx
      .select({
        originalPaymentId: paymentTransactions.originalPaymentId,
        amount: paymentTransactions.amount,
      })
      .from(paymentTransactions)
      .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          eq(lancamentos.clinicId, clinicId),
          eq(lancamentos.tipo, 'receber'),
          eq(paymentTransactions.kind, 'refund'),
          inArray(lancamentos.appointmentId, [...appointmentIds]),
        ),
      );
    const payouts = await tx
      .select({
        id: professionalPayouts.id,
        clinicId: professionalPayouts.clinicId,
        appointmentId: professionalPayouts.appointmentId,
        calculationBasis: professionalPayouts.calculationBasis,
        grossAmount: professionalPayouts.grossAmount,
        ruleKind: professionalPayouts.ruleKind,
        rulePercentage: professionalPayouts.rulePercentage,
        ruleFixedAmount: professionalPayouts.ruleFixedAmount,
        basisAmount: professionalPayouts.basisAmount,
        payoutAmount: professionalPayouts.payoutAmount,
        status: professionalPayouts.status,
      })
      .from(professionalPayouts)
      .where(
        and(
          eq(professionalPayouts.clinicId, clinicId),
          inArray(professionalPayouts.appointmentId, [...appointmentIds]),
        ),
      );
    // Só repasse suspenso ou revisado tem revisão a exibir ou a registrar.
    const reviewable = payouts.filter(
      (payout) => payout.status === 'cancelled' || payout.status === 'reviewed',
    );
    const latestReviews = await listLatestPayoutReviews(
      tx,
      clinicId,
      reviewable.map((payout) => payout.id),
    );
    const reviewBounds = new Map<
      string,
      { ceilingAmount: number; referenceAmount: number | null } | null
    >();
    for (const payout of reviewable) {
      const bounds = await computePayoutReviewBounds(tx, payout);
      reviewBounds.set(
        payout.id,
        bounds
          ? {
              ceilingAmount: centsToMoney(bounds.ceilingCents),
              referenceAmount:
                bounds.referenceCents === null ? null : centsToMoney(bounds.referenceCents),
            }
          : null,
      );
    }

    type Aggregate = {
      count: number;
      grossCount: number;
      grossCents: number;
      feeCount: number;
      feeCents: number;
      earlyFeeCount: number;
      earlyFeeCents: number;
      netCount: number;
      netCents: number;
    };
    const aggregates = new Map<string, Aggregate>();
    const refundByPayment = new Map<string, number>();
    for (const refund of refunds) {
      if (!refund.originalPaymentId) continue;
      refundByPayment.set(
        refund.originalPaymentId,
        (refundByPayment.get(refund.originalPaymentId) ?? 0) +
          Math.round(Number(refund.amount) * 100),
      );
    }
    for (const credit of credits) {
      if (!credit.appointmentId) continue;
      const allocatedCents = Math.round(Number(credit.allocatedAmount) * 100);
      const reversedCents = Math.max(
        Math.round(Number(credit.allocatedReversedAmount) * 100),
        credit.allocatedPaymentTransactionId
          ? (refundByPayment.get(credit.allocatedPaymentTransactionId) ?? 0)
          : 0,
      );
      const activeCents = Math.max(0, allocatedCents - reversedCents);
      if (activeCents === 0) continue;
      const originalGrossCents =
        credit.providerGrossAmount === null
          ? null
          : Math.round(Number(credit.providerGrossAmount) * 100);
      const ratio = originalGrossCents ? activeCents / originalGrossCents : 0;
      const addAllocated = (value: string | null, current: number): number =>
        current + (value === null ? 0 : Math.round(Number(value) * 100 * ratio));
      const current = aggregates.get(credit.appointmentId) ?? {
        count: 0,
        grossCount: 0,
        grossCents: 0,
        feeCount: 0,
        feeCents: 0,
        earlyFeeCount: 0,
        earlyFeeCents: 0,
        netCount: 0,
        netCents: 0,
      };
      current.count += 1;
      current.grossCents += originalGrossCents === null ? 0 : activeCents;
      if (originalGrossCents !== null) current.grossCount += 1;
      // O principal remanescente é observado no ledger; a devolução de taxa e
      // o líquido final não são conhecidos até o provedor conciliá-los.
      if (reversedCents === 0) {
        current.feeCents = addAllocated(credit.providerFeeAmount, current.feeCents);
        current.earlyFeeCents = addAllocated(
          credit.earlySettlementFeeAmount,
          current.earlyFeeCents,
        );
        current.netCents = addAllocated(credit.providerNetAmount, current.netCents);
        if (credit.providerFeeAmount !== null) current.feeCount += 1;
        if (credit.earlySettlementFeeAmount !== null) current.earlyFeeCount += 1;
        if (credit.providerNetAmount !== null) current.netCount += 1;
      }
      aggregates.set(credit.appointmentId, current);
    }

    const payoutByAppointment = new Map(payouts.map((payout) => [payout.appointmentId, payout]));
    const ids = new Set([...aggregates.keys(), ...payoutByAppointment.keys()]);
    const moneyWhenComplete = (sum: number, known: number, total: number): number | null =>
      total > 0 && known === total ? sum / 100 : null;
    return [...ids].map((appointmentId) => {
      const aggregate = aggregates.get(appointmentId);
      const payout = payoutByAppointment.get(appointmentId);
      const count = aggregate?.count ?? 0;
      return {
        appointmentId,
        providerGrossAmount: aggregate
          ? moneyWhenComplete(aggregate.grossCents, aggregate.grossCount, count)
          : null,
        providerFeeAmount: aggregate
          ? moneyWhenComplete(aggregate.feeCents, aggregate.feeCount, count)
          : null,
        earlySettlementFeeAmount: aggregate
          ? moneyWhenComplete(aggregate.earlyFeeCents, aggregate.earlyFeeCount, count)
          : null,
        providerNetAmount: aggregate
          ? moneyWhenComplete(aggregate.netCents, aggregate.netCount, count)
          : null,
        payout: payout
          ? {
              id: payout.id,
              calculationBasis: payout.calculationBasis,
              basisAmount: payout.basisAmount === null ? null : Number(payout.basisAmount),
              payoutAmount: payout.payoutAmount === null ? null : Number(payout.payoutAmount),
              status: payout.status,
              review: (() => {
                const latest = latestReviews.get(payout.id);
                return latest
                  ? {
                      version: latest.version,
                      decidedAmount: latest.decidedAmount,
                      decidedAt: latest.decidedAt,
                    }
                  : null;
              })(),
              reviewBounds: reviewBounds.get(payout.id) ?? null,
            }
          : null,
      };
    });
  });
}

/**
 * C12 — cobranças PENDENTES de um paciente (a receber; pendente ou parcial).
 * Read-only; consumida pela tool list_pending_payments do AI Agent (com gating
 * de identidade por telefone verificado feito na saga). Sem JOIN cross-context
 * (patientId é coluna). A IA NUNCA cria/edita cobrança (par.12 — proibido).
 */
export async function listPendingByPatient(
  clinicId: string,
  patientId: string,
): Promise<LancamentoSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.clinicId, clinicId),
          eq(lancamentos.patientId, patientId),
          eq(lancamentos.tipo, 'receber'),
          inArray(lancamentos.status, ['pendente', 'parcial']),
        ),
      )
      .orderBy(desc(lancamentos.createdAt))
      .limit(50);
    return rows.map(toLancamentoSummary);
  });
}

/**
 * Saldo em aberto do recebível de um atendimento (ADR-051 1.5b.3a).
 *
 * **Por que este seam existe:** o Payments precisa saber quanto ainda falta para
 * decidir se cobra o restante — e essa resposta é do FINANCIAL, que é a fonte da
 * verdade. Se o Payments calculasse por conta própria (valor do procedimento
 * menos o que ELE recebeu), um pagamento feito em dinheiro na recepção e lançado
 * no Caixa não apareceria: o paciente receberia um link cobrando algo que já
 * pagou. É o pior desfecho possível desta fase.
 *
 * `null` quando não há recebível do atendimento — e `null` significa **não
 * cobrar**, o mesmo modo de falha seguro do `resolveDepositAmount`.
 *
 * Estados terminais (`cancelado`, `estornado`) são excluídos: não há saldo a
 * perseguir num lançamento que deixou de existir como obrigação.
 */
export async function getAppointmentBalance(
  clinicId: string,
  appointmentId: string,
): Promise<{ lancamentoId: string; valor: number; valorPago: number; saldo: number } | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({
        id: lancamentos.id,
        valor: lancamentos.valor,
        valorPago: lancamentos.valorPago,
      })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.clinicId, clinicId),
          eq(lancamentos.appointmentId, appointmentId),
          eq(lancamentos.tipo, 'receber'),
          inArray(lancamentos.status, ['pendente', 'parcial']),
        ),
      )
      .limit(1);
    if (!row) return null;
    const valor = Number(row.valor);
    const valorPago = Number(row.valorPago);
    return {
      lancamentoId: row.id,
      valor,
      valorPago,
      saldo: Math.round((valor - valorPago + Number.EPSILON) * 100) / 100,
    };
  });
}

// --- Caixa -----------------------------------------------------------------

export interface CaixaLancamentos {
  pendentes: LancamentoSummary[];
  parciais: LancamentoSummary[];
  pagosHoje: LancamentoSummary[];
}

/**
 * Recebimentos do Caixa: pendentes, parciais e pagos hoje (janela tz da clínica
 * computada na page). Uma query, split em JS — o operador vê tudo numa carga.
 */
export async function getCaixaLancamentos(
  clinicId: string,
  todayFrom: Date,
  todayTo: Date,
): Promise<CaixaLancamentos> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.tipo, 'receber'),
          // 0153: recebível da OPERADORA não é cobrado na recepção (vive em Convênios).
          isNull(lancamentos.sourceHiGuideId),
          or(
            inArray(lancamentos.status, ['pendente', 'parcial']),
            and(
              eq(lancamentos.status, 'pago'),
              gte(lancamentos.paidAt, todayFrom),
              lt(lancamentos.paidAt, todayTo),
            ),
          ),
        ),
      )
      .orderBy(lancamentos.dueDate, lancamentos.createdAt);

    const out: CaixaLancamentos = { pendentes: [], parciais: [], pagosHoje: [] };
    for (const r of rows) {
      const s = toLancamentoSummary(r);
      if (s.status === 'pendente') out.pendentes.push(s);
      else if (s.status === 'parcial') out.parciais.push(s);
      else out.pagosHoje.push(s);
    }
    return out;
  });
}

/**
 * Contas A PAGAR em aberto (visibilidade no Caixa — antes só mostrava a receber).
 * Read-only: a baixa de pagáveis mora em /financeiro; aqui é só panorama. Não
 * altera nenhuma soma de "a receber" (aditivo).
 */
export async function getCaixaPagaveis(clinicId: string): Promise<LancamentoSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(lancamentos)
      .where(
        and(eq(lancamentos.tipo, 'pagar'), inArray(lancamentos.status, ['pendente', 'parcial'])),
      )
      .orderBy(lancamentos.dueDate, lancamentos.createdAt);
    return rows.map(toLancamentoSummary);
  });
}

export async function getLancamento(
  clinicId: string,
  id: string,
): Promise<LancamentoSummary | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(lancamentos).where(eq(lancamentos.id, id)).limit(1);
    return row ? toLancamentoSummary(row) : null;
  });
}

// --- pendências de faturamento (banner) ------------------------------------

export async function listPendenciasAbertas(clinicId: string): Promise<FaturamentoPendenciaDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(faturamentoPendencias)
      .where(eq(faturamentoPendencias.status, 'aberta'))
      .orderBy(desc(faturamentoPendencias.createdAt))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      appointmentId: r.appointmentId,
      motivo: r.motivo,
      valor: r.valor == null ? null : Number(r.valor),
      createdAt: toIso(r.createdAt)!,
    }));
  });
}

export async function countPendenciasAbertas(clinicId: string): Promise<number> {
  return withTenant(clinicId, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(faturamentoPendencias)
      .where(eq(faturamentoPendencias.status, 'aberta'));
    return r?.n ?? 0;
  });
}

export async function listOpenCollectionCases(clinicId: string): Promise<CollectionCaseDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(collectionCases)
      .where(and(eq(collectionCases.clinicId, clinicId), eq(collectionCases.status, 'open')))
      .orderBy(desc(collectionCases.daysOverdue))
      .limit(100);
    return rows.map((row) => ({
      id: row.id,
      lancamentoId: row.lancamentoId,
      stage: row.stage,
      daysOverdue: row.daysOverdue,
      residualAmount: num(row.residualAmount),
      createdAt: toIso(row.createdAt)!,
    }));
  });
}

// --- fluxo de caixa (ao vivo) ----------------------------------------------

/**
 * Snapshot ao vivo do dia. `recebidoHoje`/`pagoHoje` contam lançamentos que
 * ficaram `pago` hoje (paid_at na janela) — pagamentos parciais entram só ao
 * fechar (modelo simples, sem ledger de pagamentos). Estornos (status='estornado')
 * saem de todas as somas, então pagar+estornar no mesmo dia neta a zero.
 */
export async function getCashFlowToday(
  clinicId: string,
  todayFrom: Date,
  todayTo: Date,
): Promise<CashFlowDTO> {
  return withTenant(clinicId, async (tx) => {
    const [aberto] = await tx
      .select({
        // 0153: a glosa definitiva da operadora não está mais a receber (0 fora do convênio).
        receber: sql<string>`coalesce(sum(case when ${lancamentos.tipo} = 'receber' then ${lancamentos.valor} - ${lancamentos.valorPago} - ${lancamentos.valorGlosado} else 0 end), 0)`,
        pagar: sql<string>`coalesce(sum(case when ${lancamentos.tipo} = 'pagar' then ${lancamentos.valor} - ${lancamentos.valorPago} else 0 end), 0)`,
        // Contagens vêm da MESMA varredura dos totais: uma query a mais só para
        // contar as linhas que já estão sendo somadas seria ida redundante.
        qtdReceber: sql<number>`coalesce(count(*) filter (where ${lancamentos.tipo} = 'receber'), 0)::int`,
        qtdPagar: sql<number>`coalesce(count(*) filter (where ${lancamentos.tipo} = 'pagar'), 0)::int`,
        qtdReceberVencidos: sql<number>`coalesce(count(*) filter (where ${lancamentos.tipo} = 'receber' and ${lancamentos.dueDate} < current_date), 0)::int`,
      })
      .from(lancamentos)
      .where(inArray(lancamentos.status, ['pendente', 'parcial']));

    const [liquidado] = await tx
      .select({
        recebidoHoje: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
        pagoHoje: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
        qtdRecebimentos: sql<number>`coalesce(count(*) filter (where
          (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'refund')), 0)::int`,
        qtdPagamentos: sql<number>`coalesce(count(*) filter (where
          (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'refund')), 0)::int`,
      })
      .from(paymentTransactions)
      .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          gte(paymentTransactions.occurredAt, todayFrom),
          lt(paymentTransactions.occurredAt, todayTo),
        ),
      );

    const recebidoHoje = num(liquidado?.recebidoHoje);
    const pagoHoje = num(liquidado?.pagoHoje);
    return {
      receber: num(aberto?.receber),
      pagar: num(aberto?.pagar),
      recebidoHoje,
      pagoHoje,
      saldoHoje: Math.round((recebidoHoje - pagoHoje) * 100) / 100,
      contagens: {
        receber: aberto?.qtdReceber ?? 0,
        receberVencidos: aberto?.qtdReceberVencidos ?? 0,
        pagar: aberto?.qtdPagar ?? 0,
        recebimentos: liquidado?.qtdRecebimentos ?? 0,
        pagamentos: liquidado?.qtdPagamentos ?? 0,
      },
    };
  });
}

/**
 * Saldo confirmado pelo provedor que ainda não foi aplicado a um recebível.
 * Inclui o excedente de um crédito parcialmente alocado; exclui estorno e
 * contestação. Não integra "A receber" nem o fluxo mensal.
 */
export async function getAvailablePatientCreditSummary(
  clinicId: string,
): Promise<{ amount: number; count: number }> {
  return withTenant(clinicId, async (tx) => {
    const availableAmount = sql`${patientCredits.amount} - ${patientCredits.allocatedAmount} - ${patientCredits.unallocatedReversedAmount}`;
    const [summary] = await tx
      .select({
        amount: sql<string>`coalesce(sum(greatest(${availableAmount}, 0)), 0)`,
        count: sql<number>`count(*) filter (where ${availableAmount} > 0)::int`,
      })
      .from(patientCredits)
      .where(
        and(
          eq(patientCredits.clinicId, clinicId),
          inArray(patientCredits.status, ['available', 'allocated']),
          or(isNull(patientCredits.disputeStatus), eq(patientCredits.disputeStatus, 'reversed')),
        ),
      );

    return { amount: num(summary?.amount), count: summary?.count ?? 0 };
  });
}

/**
 * Faturamento de um PERÍODO (Relatórios): soma o que ficou `pago` com paid_at na
 * janela [from, to). Mesma semântica do getCashFlowToday (não depende do rollup
 * cash_flow_daily estar populado). Estornos (status='estornado') ficam de fora.
 */
/** Uma semana da série de faturamento — segunda a domingo no fuso da clínica. */
export interface FaturamentoSemana {
  /** Segunda-feira da semana, `YYYY-MM-DD`, já no fuso da clínica. */
  weekStart: string;
  recebido: number;
  pago: number;
  saldo: number;
}

/**
 * Faturamento agregado POR SEMANA, para a série de Relatórios.
 *
 * Mesma regra de sinal de `getFaturamentoPeriodo` (um estorno de "receber" conta
 * como saída, e vice-versa) — se as duas divergissem, o total do período não
 * fecharia com a soma das semanas.
 *
 * O corte de semana usa `date_trunc('week', … AT TIME ZONE tz)`: o Postgres
 * trunca para segunda-feira, e o `AT TIME ZONE` garante que a virada de semana
 * seja a da clínica, não a do UTC. Semanas sem movimento NÃO voltam como zero —
 * elas simplesmente não existem no resultado, e quem chama decide se aquilo é
 * "sem dado" ou "R$ 0" (as duas coisas são diferentes num relatório).
 */
export async function getFaturamentoPorSemana(
  clinicId: string,
  from: Date,
  to: Date,
  timeZone: string,
): Promise<FaturamentoSemana[]> {
  const weekStart = sql<string>`to_char(date_trunc('week', ${paymentTransactions.occurredAt} AT TIME ZONE ${timeZone}), 'YYYY-MM-DD')`;
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        weekStart,
        recebido: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
        pago: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
      })
      .from(paymentTransactions)
      .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          gte(paymentTransactions.occurredAt, from),
          lt(paymentTransactions.occurredAt, to),
        ),
      )
      // GROUP BY/ORDER BY por POSIÇÃO, e não repetindo a expressão: o drizzle
      // renderiza a mesma referência de coluna qualificada na cláusula de grupo
      // ("appointments"."scheduled_at") e sem qualificar na projeção
      // ("scheduled_at"). O Postgres compara as duas SINTATICAMENTE, conclui que
      // a projeção não está agrupada e recusa a query com "must appear in the
      // GROUP BY clause". O ordinal aponta para a mesma expressão sem depender
      // de como cada lado é impresso.
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return rows.map((row) => {
      const recebido = num(row.recebido);
      const pago = num(row.pago);
      return {
        weekStart: row.weekStart,
        recebido,
        pago,
        saldo: Math.round((recebido - pago) * 100) / 100,
      };
    });
  });
}

export async function getFaturamentoPeriodo(
  clinicId: string,
  from: Date,
  to: Date,
): Promise<{ recebido: number; pago: number; saldo: number }> {
  return withTenant(clinicId, async (tx) => {
    const [r] = await tx
      .select({
        recebido: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
        pago: sql<string>`coalesce(sum(case
          when (${lancamentos.tipo} = 'pagar' and ${paymentTransactions.kind} = 'payment')
            or (${lancamentos.tipo} = 'receber' and ${paymentTransactions.kind} = 'refund')
          then ${paymentTransactions.amount} else 0 end), 0)`,
      })
      .from(paymentTransactions)
      .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          gte(paymentTransactions.occurredAt, from),
          lt(paymentTransactions.occurredAt, to),
        ),
      );
    const recebido = num(r?.recebido);
    const pago = num(r?.pago);
    return { recebido, pago, saldo: Math.round((recebido - pago) * 100) / 100 };
  });
}

/**
 * Ledger detalhado para o relatório mensal enviado à contabilidade.
 *
 * A consulta não seleciona paciente nem conteúdo clínico. Os dois lados do JOIN
 * carregam o predicado de tenant, além da RLS ativada por `withTenant`.
 */
export async function listAccountingMovements(
  clinicId: string,
  from: Date,
  to: Date,
  limit: number,
): Promise<AccountingMovementDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        transactionId: paymentTransactions.id,
        lancamentoId: paymentTransactions.lancamentoId,
        occurredAt: paymentTransactions.occurredAt,
        transactionKind: paymentTransactions.kind,
        lancamentoTipo: lancamentos.tipo,
        description: lancamentos.descricao,
        amount: paymentTransactions.amount,
        paymentMethod: paymentTransactions.paymentMethod,
        paymentMethodLabel: paymentMethods.label,
        dueDate: lancamentos.dueDate,
        lancamentoStatus: lancamentos.status,
        createdVia: lancamentos.createdVia,
        supplierName: suppliers.razaoSocial,
        supplierCnpj: suppliers.cnpj,
        originalPaymentId: paymentTransactions.originalPaymentId,
        reason: paymentTransactions.reason,
      })
      .from(paymentTransactions)
      .innerJoin(
        lancamentos,
        and(
          eq(lancamentos.id, paymentTransactions.lancamentoId),
          eq(lancamentos.clinicId, clinicId),
        ),
      )
      .leftJoin(
        suppliers,
        and(eq(suppliers.id, lancamentos.supplierId), eq(suppliers.clinicId, clinicId)),
      )
      .leftJoin(paymentMethods, eq(paymentMethods.code, paymentTransactions.paymentMethod))
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          gte(paymentTransactions.occurredAt, from),
          lt(paymentTransactions.occurredAt, to),
        ),
      )
      .orderBy(asc(paymentTransactions.occurredAt), asc(paymentTransactions.id))
      .limit(limit);

    return rows.map((row) => {
      const amount = num(row.amount);
      return {
        transactionId: row.transactionId,
        lancamentoId: row.lancamentoId,
        occurredAt: toIso(row.occurredAt)!,
        transactionKind: row.transactionKind,
        lancamentoTipo: row.lancamentoTipo,
        description: row.description,
        amount,
        cashEffect: accountingCashEffect(row.lancamentoTipo, row.transactionKind, amount),
        paymentMethod: row.paymentMethod ?? null,
        paymentMethodLabel: row.paymentMethodLabel ?? null,
        dueDate: row.dueDate ?? null,
        lancamentoStatus: row.lancamentoStatus,
        createdVia: row.createdVia,
        supplierName: row.supplierName ?? null,
        supplierCnpj: row.supplierCnpj ?? null,
        originalPaymentId: row.originalPaymentId ?? null,
        reason: row.reason ?? null,
      };
    });
  });
}

export interface AppointmentReceiptTotal {
  appointmentId: string;
  recebido: number;
}

/**
 * Total líquido recebido por atendimento. O chamador fornece IDs tenant-scoped
 * vindos de Scheduling; a consulta agrega pagamentos e reembolsos no banco sem
 * acessar tabelas de outro contexto.
 */
export async function getRecebimentosByAppointment(
  clinicId: string,
  appointmentIds: string[],
): Promise<AppointmentReceiptTotal[]> {
  if (appointmentIds.length === 0) return [];

  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        appointmentId: lancamentos.appointmentId,
        recebido: sql<string>`coalesce(sum(case
          when ${paymentTransactions.kind} = 'payment' then ${paymentTransactions.amount}
          when ${paymentTransactions.kind} = 'refund' then -${paymentTransactions.amount}
          else 0 end), 0)`,
      })
      .from(paymentTransactions)
      .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
      .where(
        and(
          eq(paymentTransactions.clinicId, clinicId),
          eq(lancamentos.clinicId, clinicId),
          eq(lancamentos.tipo, 'receber'),
          inArray(lancamentos.appointmentId, appointmentIds),
        ),
      )
      .groupBy(lancamentos.appointmentId);

    return rows.flatMap((row) =>
      row.appointmentId == null
        ? []
        : [{ appointmentId: row.appointmentId, recebido: roundMoney(num(row.recebido)) }],
    );
  });
}

/** Histórico consolidado (cash_flow_daily) — Fase 2 dashboard. */
export async function listCashFlowDaily(
  clinicId: string,
  fromDate: string,
  toDate: string,
): Promise<Array<{ date: string; totalRecebido: number; totalPago: number; saldo: number }>> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(cashFlowDaily)
      .where(and(gte(cashFlowDaily.date, fromDate), lt(cashFlowDaily.date, toDate)))
      .orderBy(cashFlowDaily.date);
    return rows.map((r) => ({
      date: r.date as string,
      totalRecebido: num(r.totalRecebido),
      totalPago: num(r.totalPago),
      saldo: num(r.saldo),
    }));
  });
}

// --- lançamentos (Fase 2 dashboard) + fornecedores -------------------------

export interface ListLancamentosFilter {
  tipo?: LancamentoTipo;
  status?: LancamentoStatus;
  limit?: number;
}

/**
 * P10.6: origem do lançamento. `operadora` = recebível de guia de convênio (0153, mantido pelo
 * Convênios, `source_hi_guide_id` preenchido); `paciente` = todo o resto (particular, fornecedor,
 * avulso). O Caixa já fica só com o que a recepção cobra (`getCaixaLancamentos`).
 */
export type LancamentoOrigem = 'paciente' | 'operadora';

export interface ListLancamentosPageFilter {
  tipo?: LancamentoTipo;
  status?: LancamentoStatus;
  origem?: LancamentoOrigem;
  page?: number;
  pageSize?: number;
}

export interface OpenReceivablesByOrigin {
  paciente: { valor: number; qtd: number };
  operadora: { valor: number; qtd: number };
}

/**
 * P10.6: o "A receber" em aberto separado por origem, com a MESMA fórmula do fluxo
 * (`valor - valor_pago - valor_glosado`, status pendente/parcial): a soma das duas partes é o
 * `receber` de `getCashFlowToday`. A glosa definitiva da operadora não está a receber.
 */
export async function getOpenReceivablesByOrigin(clinicId: string): Promise<OpenReceivablesByOrigin> {
  return withTenant(clinicId, async (tx) => {
    const open = sql`${lancamentos.valor} - ${lancamentos.valorPago} - ${lancamentos.valorGlosado}`;
    const [row] = await tx
      .select({
        paciente: sql<string>`coalesce(sum(${open}) filter (where ${lancamentos.sourceHiGuideId} is null), 0)`,
        operadora: sql<string>`coalesce(sum(${open}) filter (where ${lancamentos.sourceHiGuideId} is not null), 0)`,
        qtdPaciente: sql<number>`coalesce(count(*) filter (where ${lancamentos.sourceHiGuideId} is null), 0)::int`,
        qtdOperadora: sql<number>`coalesce(count(*) filter (where ${lancamentos.sourceHiGuideId} is not null), 0)::int`,
      })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.clinicId, clinicId),
          eq(lancamentos.tipo, 'receber'),
          inArray(lancamentos.status, ['pendente', 'parcial']),
        ),
      );
    return {
      paciente: { valor: num(row?.paciente), qtd: Number(row?.qtdPaciente ?? 0) },
      operadora: { valor: num(row?.operadora), qtd: Number(row?.qtdOperadora ?? 0) },
    };
  });
}

export interface PaginatedLancamentos {
  items: LancamentoSummary[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_LANCAMENTOS_PAGE_SIZE = 50;
const MAX_LANCAMENTOS_PAGE_SIZE = 200;

export async function listLancamentos(
  clinicId: string,
  filter: ListLancamentosFilter = {},
): Promise<LancamentoSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const conds = [] as ReturnType<typeof eq>[];
    if (filter.tipo) conds.push(eq(lancamentos.tipo, filter.tipo));
    if (filter.status) conds.push(eq(lancamentos.status, filter.status));
    const rows = await tx
      .select()
      .from(lancamentos)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(lancamentos.createdAt))
      .limit(filter.limit ?? 50);
    return rows.map(toLancamentoSummary);
  });
}

export async function listLancamentosPage(
  clinicId: string,
  filter: ListLancamentosPageFilter = {},
): Promise<PaginatedLancamentos> {
  const requestedPage = filter.page;
  const requestedPageSize = filter.pageSize;
  const page =
    typeof requestedPage === 'number' && Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const pageSize =
    typeof requestedPageSize === 'number' &&
    Number.isSafeInteger(requestedPageSize) &&
    requestedPageSize > 0
      ? Math.min(requestedPageSize, MAX_LANCAMENTOS_PAGE_SIZE)
      : DEFAULT_LANCAMENTOS_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  return withTenant(clinicId, async (tx) => {
    // RLS continua sendo a barreira autoritativa. O predicado explícito reduz a
    // superfície de erro e garante que lista e total usem exatamente o mesmo tenant.
    const conds = [eq(lancamentos.clinicId, clinicId)];
    if (filter.tipo) conds.push(eq(lancamentos.tipo, filter.tipo));
    if (filter.status) conds.push(eq(lancamentos.status, filter.status));
    if (filter.origem === 'operadora') conds.push(isNotNull(lancamentos.sourceHiGuideId));
    else if (filter.origem === 'paciente') conds.push(isNull(lancamentos.sourceHiGuideId));
    const where = and(...conds);

    const [rows, [countRow]] = await Promise.all([
      tx
        .select()
        .from(lancamentos)
        .where(where)
        // created_at não é único; id fecha o empate para evitar itens pulando
        // entre páginas quando dois lançamentos são criados no mesmo instante.
        .orderBy(desc(lancamentos.createdAt), desc(lancamentos.id))
        .limit(pageSize)
        .offset(offset),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(lancamentos)
        .where(where),
    ]);

    return {
      items: rows.map(toLancamentoSummary),
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    };
  });
}

export function toSupplierSummary(r: SupplierRow): SupplierSummary {
  return {
    id: r.id,
    razaoSocial: r.razaoSocial,
    cnpj: r.cnpj ?? null,
    contato: r.contato ?? null,
    condicaoPagamento: r.condicaoPagamento ?? null,
    ativo: r.ativo,
    updatedAt: toIso(r.updatedAt),
  };
}

export async function listSuppliers(
  clinicId: string,
  opts: { onlyActive?: boolean } = {},
): Promise<SupplierSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(suppliers)
      .where(opts.onlyActive ? eq(suppliers.ativo, true) : undefined)
      .orderBy(suppliers.razaoSocial);
    return rows.map(toSupplierSummary);
  });
}

/**
 * Catálogo global de formas de pagamento (ativas), p/ o dialog do Caixa.
 * payment_methods é GLOBAL (sem clinic_id) com policy read-all a authenticated;
 * lemos dentro de withTenant (role authenticated) — a GUC de tenant é inócua aqui.
 */
export async function listPaymentMethods(clinicId: string): Promise<PaymentMethodDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({ code: paymentMethods.code, label: paymentMethods.label })
      .from(paymentMethods)
      .where(eq(paymentMethods.ativo, true))
      .orderBy(paymentMethods.ordem);
    return rows.map((r) => ({ code: r.code, label: r.label }));
  });
}
