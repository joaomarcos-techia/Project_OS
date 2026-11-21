'use server';

/**
 * Financial Server Actions (C9). Pipeline congelado (igual clinical/patient):
 *   requireUser → require*Permission → Zod → idempotentMutation({idempotency,audit}, tx => …)
 *
 * Toda transição de status: SELECT ... FOR UPDATE + assertLancamentoTransition
 * (state machine no domínio — logic.ts). O trigger de banco só barra colunas
 * imutáveis. Concorrência ("apenas um vence") = FOR UPDATE + chave idempotente.
 *
 * Estorno é APPEND-ONLY: nunca edita valores do original — cria um lançamento de
 * compensação (status='estornado') e marca o original 'estornado' (só status).
 */
import { and, eq, sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { normalizeCnpj } from '@/lib/validation/cnpj';
import {
  requireCachedAnyPermission,
  requireCachedPermission,
  requireClinicId,
  requireUser,
} from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { matchesExpectedVersion } from '@/lib/db/optimistic-lock';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { publishEvent } from '@/lib/outbox/publish';

import {
  FinancialValidationError,
  LancamentoStateError,
  LancamentoNotFoundError,
  PaymentTransactionNotFoundError,
  SupplierNotFoundError,
} from './errors';
import { catalogPaymentMethodForCommercial } from './commercial-method';
import { FINANCIAL_EVENTS } from './events';
import { idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import { assertFinancialReferencesInClinic } from './internal/tenant-references';
import { assertPaymentFitsBalance, assertRefundFitsPayment } from './internal/payment-ledger';
import {
  assertLancamentoTransition,
  calcStatusPagamento,
  clinicDayBounds,
  estornoDescricao,
  estornoTipoOposto,
  isEstornoIntegral,
  round2,
} from './logic';
import {
  getCashFlowToday,
  getClinicTimezone,
  toLancamentoSummary,
  toPaymentTransactionSummary,
  toSupplierSummary,
} from './queries';
import { refreshProfessionalPayout } from './internal/professional-payout';
import { lancamentos, paymentProofs, paymentTransactions, suppliers } from './schema';

/**
 * Operar o caixa (confirmar/cancelar pagamento) aceita qualquer um dos dois —
 * decisão de RBAC do founder. Uma lista só, para os dois call-sites não divergirem.
 */
const CAIXA_PERMISSIONS = [PERMISSIONS.OPERATE_CAIXA, PERMISSIONS.MANAGE_FINANCIAL] as const;
import {
  CancelLancamentoSchema,
  ConfirmPaymentSchema,
  CreateEstornoSchema,
  CreateLancamentoSchema,
  CreateSupplierSchema,
  type CancelLancamentoInput,
  type CashFlowDTO,
  type ConfirmPaymentInput,
  type CreateEstornoInput,
  type CreateLancamentoInput,
  type CreateSupplierInput,
  type LancamentoSummary,
  type PaymentTransactionSummary,
  type SupplierSummary,
} from './types';

const money = (n: number): string => round2(n).toFixed(2);

async function assertAppointmentPaymentMethod(
  tx: Tx,
  clinicId: string,
  appointmentId: string,
  paymentMethod: string,
): Promise<void> {
  const rows = await tx.execute<{
    pricingPolicyMode: string;
    commercialPaymentMethod: string | null;
  }>(sql`
    SELECT pricing_policy_mode AS "pricingPolicyMode",
           commercial_payment_method AS "commercialPaymentMethod"
    FROM appointments
    WHERE id = ${appointmentId} AND clinic_id = ${clinicId}
    LIMIT 1
  `);
  const appointment = rows[0];
  if (!appointment) throw new FinancialValidationError('atendimento não encontrado nesta clínica');
  if (appointment.pricingPolicyMode === 'absorb_fees') return;
  // 08/10/2026 (decisão do usuário) — dinheiro na recepção sempre quita o
  // atendimento: "pagou o restante em dinheiro" depois do sinal pelo link, e
  // "pagou em dinheiro" sem sinal. A condição comercial continua valendo para
  // os outros meios — cartão no lugar do Pix acordado segue recusado.
  if (paymentMethod === catalogPaymentMethodForCommercial('cash')) return;

  const expected = catalogPaymentMethodForCommercial(appointment.commercialPaymentMethod);
  if (appointment.pricingPolicyMode !== 'payment_method_pricing' || !expected) {
    throw new FinancialValidationError('condição comercial inválida para este atendimento');
  }
  if (paymentMethod !== expected) {
    throw new FinancialValidationError(
      'A forma de pagamento difere da condição comercial acordada para este atendimento.',
    );
  }
}

// --- createLancamento (manual) ---------------------------------------------

export async function createLancamento(
  input: CreateLancamentoInput,
  idempotencyKey: string,
): Promise<LancamentoSummary> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.MANAGE_FINANCIAL);
  const data = CreateLancamentoSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('create_lancamento', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: FINANCIAL_EVENTS.LANCAMENTO_CREATED,
        resourceType: 'lancamento',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      await assertFinancialReferencesInClinic(tx, clinicId, {
        patientId: data.patientId,
        supplierId: data.supplierId,
        unitId: data.unitId,
      });
      const [row] = await tx
        .insert(lancamentos)
        .values({
          clinicId,
          unitId: data.unitId ?? null,
          tipo: data.tipo,
          descricao: data.descricao,
          valor: money(data.valor),
          status: 'pendente',
          dueDate: data.dueDate ?? null,
          patientId: data.patientId ?? null,
          supplierId: data.supplierId ?? null,
          paymentMethod: data.paymentMethod ?? null,
          createdVia: 'manual',
          createdBy: user.userId,
        })
        .returning();

      await publishEvent(tx, {
        clinicId,
        eventType: FINANCIAL_EVENTS.LANCAMENTO_CREATED,
        payload: {
          lancamentoId: row!.id,
          clinicId,
          tipo: data.tipo,
          valor: round2(data.valor),
          appointmentId: null,
          patientId: data.patientId ?? null,
          createdVia: 'manual',
        },
        idempotencyKey: `${idempotencyKey}:lancamento_created`,
      });
      return toLancamentoSummary(row!);
    },
  );
}

/**
 * 0153: recebível da OPERADORA (guia de convênio enviada) é mantido só pelo Convênios: o
 * pagamento entra pela conta da guia, a glosa definitiva baixa sem caixa e o estorno é
 * compensatório lá. O banco também recusa (gatilhos); aqui a mensagem é clara antes.
 */
const INSURER_RECEIVABLE_MESSAGE =
  'Recebível de convênio: registre pagamento, glosa ou estorno em Convênios (conta da guia), não no Caixa.';

// --- confirmPayment (parcial ou total) -------------------------------------

export async function confirmPayment(
  input: ConfirmPaymentInput,
  idempotencyKey: string,
): Promise<LancamentoSummary> {
  const user = await requireUser();
  await requireCachedAnyPermission(CAIXA_PERMISSIONS);
  const data = ConfirmPaymentSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('confirm_payment', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: FINANCIAL_EVENTS.LANCAMENTO_PAID,
        resourceType: 'lancamento',
        resourceId: data.lancamentoId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [lanc] = await tx
        .select()
        .from(lancamentos)
        .where(and(eq(lancamentos.id, data.lancamentoId), eq(lancamentos.clinicId, clinicId)))
        .for('update')
        .limit(1);
      if (!lanc) throw new LancamentoNotFoundError(data.lancamentoId);
      if (lanc.sourceHiGuideId) throw new FinancialValidationError(INSURER_RECEIVABLE_MESSAGE);

      if (lanc.tipo === 'receber' && lanc.appointmentId) {
        await assertAppointmentPaymentMethod(tx, clinicId, lanc.appointmentId, data.paymentMethod);
      }

      const valorTotal = Number(lanc.valor);
      const novoPago = assertPaymentFitsBalance(valorTotal, Number(lanc.valorPago), data.valorPago);
      const novoStatus = calcStatusPagamento(valorTotal, novoPago);
      // Sob concorrência, o perdedor lê o lançamento já 'pago' → transição
      // 'pago'→'pago' é inválida → LancamentoStateError (409). Apenas um vence.
      assertLancamentoTransition(lanc.status, novoStatus);

      const [updated] = await tx
        .update(lancamentos)
        .set({
          valorPago: money(novoPago),
          status: novoStatus,
          paymentMethod: data.paymentMethod,
          updatedAt: sql`now()`,
          ...(novoStatus === 'pago' ? { paidAt: sql`now()` } : {}),
        })
        .where(and(eq(lancamentos.id, data.lancamentoId), eq(lancamentos.clinicId, clinicId)))
        .returning();

      const [payment] = await tx
        .insert(paymentTransactions)
        .values({
          clinicId,
          lancamentoId: data.lancamentoId,
          kind: 'payment',
          amount: money(data.valorPago),
          paymentMethod: data.paymentMethod,
          createdBy: user.userId,
        })
        .returning();

      if (data.comprovante) {
        // ⚠️ V8 (auditoria de segurança — LATENTE, NÃO explorável hoje):
        // `fileStoragePath` vem do cliente como TEXTO LIVRE (hoje um caminho/URL
        // digitado no Caixa; NÃO há upload nem endpoint que assine este path).
        // ANTES de shipar QUALQUER feature que assine/sirva este path (signed URL
        // via service-role, que IGNORA limites de bucket/RLS), é OBRIGATÓRIO
        // derivar o path server-side OU validar o prefixo `${clinicId}/` — caso
        // contrário vira IDOR cross-tenant de arquivos. Ver
        // docs/achados/auditoria-seguranca-codigo.md (V8).
        await tx.insert(paymentProofs).values({
          clinicId,
          lancamentoId: data.lancamentoId,
          transactionId: payment!.id,
          type: data.comprovante.type,
          fileStoragePath: data.comprovante.fileStoragePath,
          uploadedBy: user.userId,
        });
      }

      await publishEvent(tx, {
        clinicId,
        eventType: FINANCIAL_EVENTS.LANCAMENTO_PAID,
        payload: {
          lancamentoId: data.lancamentoId,
          transactionId: payment!.id,
          clinicId,
          valor: valorTotal,
          amount: round2(data.valorPago),
          valorPago: novoPago,
          status: novoStatus,
          paymentMethod: data.paymentMethod,
          appointmentId: lanc.appointmentId ?? null,
          source: 'manual' as const,
        },
        idempotencyKey: `${idempotencyKey}:paid`,
      });
      if (novoStatus === 'pago' && lanc.appointmentId) {
        await refreshProfessionalPayout(tx, {
          clinicId,
          appointmentId: lanc.appointmentId,
        });
      }
      return toLancamentoSummary(updated!);
    },
  );
}

// --- cancelLancamento (só pendente/parcial) --------------------------------

export async function cancelLancamento(
  input: CancelLancamentoInput,
  idempotencyKey: string,
): Promise<LancamentoSummary> {
  await requireCachedAnyPermission(CAIXA_PERMISSIONS); // cobre confirmar E cancelar
  const data = CancelLancamentoSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('cancel_lancamento', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: FINANCIAL_EVENTS.LANCAMENTO_CANCELLED,
        resourceType: 'lancamento',
        resourceId: data.lancamentoId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [lanc] = await tx
        .select()
        .from(lancamentos)
        .where(and(eq(lancamentos.id, data.lancamentoId), eq(lancamentos.clinicId, clinicId)))
        .for('update')
        .limit(1);
      if (!lanc) throw new LancamentoNotFoundError(data.lancamentoId);
      if (lanc.sourceHiGuideId) throw new FinancialValidationError(INSURER_RECEIVABLE_MESSAGE);
      // Nunca cancelar pago — a state machine barra ('pago'→'cancelado' inválido).
      assertLancamentoTransition(lanc.status, 'cancelado');

      const [updated] = await tx
        .update(lancamentos)
        .set({ status: 'cancelado', updatedAt: sql`now()` })
        .where(and(eq(lancamentos.id, data.lancamentoId), eq(lancamentos.clinicId, clinicId)))
        .returning();

      await publishEvent(tx, {
        clinicId,
        eventType: FINANCIAL_EVENTS.LANCAMENTO_CANCELLED,
        payload: { lancamentoId: data.lancamentoId, clinicId, reason: data.motivo ?? null },
        idempotencyKey: `${idempotencyKey}:cancelled`,
      });
      return toLancamentoSummary(updated!);
    },
  );
}

// --- createEstorno (append-only) -------------------------------------------

export interface EstornoResult {
  original: LancamentoSummary;
  estorno: LancamentoSummary;
  refund: PaymentTransactionSummary;
}

export async function createEstorno(
  input: CreateEstornoInput,
  idempotencyKey: string,
): Promise<EstornoResult> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.REFUND_FINANCIAL);
  const data = CreateEstornoSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('create_estorno', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: FINANCIAL_EVENTS.LANCAMENTO_ESTORNADO,
        resourceType: 'lancamento',
        resourceId: data.lancamentoId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [orig] = await tx
        .select()
        .from(lancamentos)
        .where(and(eq(lancamentos.id, data.lancamentoId), eq(lancamentos.clinicId, clinicId)))
        .for('update')
        .limit(1);
      if (!orig) throw new LancamentoNotFoundError(data.lancamentoId);
      if (orig.sourceHiGuideId) throw new FinancialValidationError(INSURER_RECEIVABLE_MESSAGE);
      if (orig.status !== 'pago') {
        throw new LancamentoStateError('estorno exige lançamento totalmente pago');
      }
      // `orig` já está bloqueado acima e serializa pagamentos/refunds deste
      // lançamento. payment_transactions é append-only para o runtime
      // (SELECT + INSERT, sem UPDATE), portanto nunca pode receber FOR UPDATE.
      const [payment] = await tx
        .select()
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.id, data.paymentId),
            eq(paymentTransactions.clinicId, clinicId),
            eq(paymentTransactions.lancamentoId, orig.id),
            eq(paymentTransactions.kind, 'payment'),
          ),
        )
        .limit(1);
      if (!payment) throw new PaymentTransactionNotFoundError(data.paymentId);

      const [refundTotals] = await tx
        .select({ total: sql<string>`coalesce(sum(${paymentTransactions.amount}), 0)` })
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.clinicId, clinicId),
            eq(paymentTransactions.originalPaymentId, payment.id),
            eq(paymentTransactions.kind, 'refund'),
          ),
        );
      const valorJaEstornado = Number(refundTotals?.total ?? 0);
      // Invariante 1 — TETO POR PARCELA: não se estorna mais do que aquela
      // transação de pagamento trouxe. Continua olhando só esta parcela.
      assertRefundFitsPayment(Number(payment.amount), valorJaEstornado, data.valor);

      // Invariante 2: só terminaliza quando todas as baixas deste lançamento
      // foram estornadas. Após perda parcial e nova baixa, `valorPago` volta ao
      // bruto, mas o total histórico de pagamentos é maior. Comparar os refunds
      // ao saldo atual encerraria o lançamento com dinheiro ainda no ledger.
      // O `FOR UPDATE` do original serializa ambas as consultas e o novo refund.
      const [ledgerTotals] = await tx
        .select({
          payments: sql<string>`coalesce(sum(case when ${paymentTransactions.kind} = 'payment' then ${paymentTransactions.amount} else 0 end), 0)`,
          refunds: sql<string>`coalesce(sum(case when ${paymentTransactions.kind} = 'refund' then ${paymentTransactions.amount} else 0 end), 0)`,
        })
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.clinicId, clinicId),
            eq(paymentTransactions.lancamentoId, orig.id),
          ),
        );
      const valorEstornado = round2(Number(ledgerTotals?.refunds ?? 0) + data.valor);
      const totalPagoNoLedger = Number(ledgerTotals?.payments ?? 0);
      const estornoIntegral = isEstornoIntegral(totalPagoNoLedger, valorEstornado);

      const [refund] = await tx
        .insert(paymentTransactions)
        .values({
          clinicId,
          lancamentoId: orig.id,
          kind: 'refund',
          amount: money(data.valor),
          paymentMethod: data.paymentMethod,
          originalPaymentId: payment.id,
          reason: data.motivo,
          createdBy: user.userId,
        })
        .returning();

      if (data.comprovante) {
        await tx.insert(paymentProofs).values({
          clinicId,
          lancamentoId: orig.id,
          transactionId: refund!.id,
          type: data.comprovante.type,
          fileStoragePath: data.comprovante.fileStoragePath,
          uploadedBy: user.userId,
        });
      }

      // Estorno é uma compensação append-only. Parcial mantém o lançamento
      // original pago e quita uma saída oposta; o último estorno transforma
      // original e todas as compensações em `estornado`, anulando o efeito no
      // caixa sem alterar valores imutáveis.
      const [compensacao] = await tx
        .insert(lancamentos)
        .values({
          clinicId,
          unitId: orig.unitId,
          tipo: estornoTipoOposto(orig.tipo),
          descricao: estornoDescricao(orig.descricao),
          valor: money(data.valor),
          valorPago: money(data.valor),
          status: estornoIntegral ? 'estornado' : 'pago',
          dueDate: orig.dueDate,
          paidAt: estornoIntegral ? null : sql`now()`,
          patientId: orig.patientId,
          supplierId: orig.supplierId,
          paymentMethod: data.paymentMethod,
          createdVia: 'estorno',
          reversesLancamentoId: orig.id,
          snapshotProcedureName: orig.snapshotProcedureName,
          snapshotDoctorNome: orig.snapshotDoctorNome,
          createdBy: user.userId,
        })
        .returning();

      let original = orig;
      if (estornoIntegral) {
        assertLancamentoTransition(orig.status, 'estornado');
        const [updated] = await tx
          .update(lancamentos)
          .set({ status: 'estornado', updatedAt: sql`now()` })
          .where(and(eq(lancamentos.id, orig.id), eq(lancamentos.clinicId, clinicId)))
          .returning();
        original = updated!;

        await tx
          .update(lancamentos)
          .set({ status: 'estornado', updatedAt: sql`now()` })
          .where(
            and(eq(lancamentos.clinicId, clinicId), eq(lancamentos.reversesLancamentoId, orig.id)),
          );
      }

      await publishEvent(tx, {
        clinicId,
        eventType: FINANCIAL_EVENTS.LANCAMENTO_ESTORNADO,
        payload: {
          originalId: orig.id,
          paymentTransactionId: payment.id,
          refundTransactionId: refund!.id,
          clinicId,
          valor: round2(data.valor),
          paymentMethod: data.paymentMethod,
          motivo: data.motivo,
        },
        idempotencyKey: `${idempotencyKey}:estornado`,
      });
      if (orig.tipo === 'receber' && orig.appointmentId) {
        await refreshProfessionalPayout(tx, {
          clinicId,
          appointmentId: orig.appointmentId,
        });
      }
      return {
        original: toLancamentoSummary(original),
        estorno: toLancamentoSummary(compensacao!),
        refund: toPaymentTransactionSummary(refund!, 0),
      };
    },
  );
}

// --- listCashFlow (read; gate view:financial) ------------------------------

export async function listCashFlow(): Promise<CashFlowDTO> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.VIEW_FINANCIAL);
  const clinicId = await requireClinicId();
  const tz = await getClinicTimezone(clinicId);
  const { from, to } = clinicDayBounds(tz);
  return getCashFlowToday(clinicId, from, to);
}

// --- fornecedores (Fase 2) -------------------------------------------------

export async function createSupplier(
  input: CreateSupplierInput,
  idempotencyKey: string,
): Promise<SupplierSummary> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.MANAGE_FINANCIAL);
  const data = CreateSupplierSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('create_supplier', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'financial.supplier.created',
        resourceType: 'supplier',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [row] = await tx
        .insert(suppliers)
        .values({
          clinicId,
          razaoSocial: data.razaoSocial,
          // VAL-001 — representação canônica; formatação é só apresentação.
          cnpj: normalizeCnpj(data.cnpj),
          contato: data.contato ?? null,
          condicaoPagamento: data.condicaoPagamento ?? null,
          createdBy: user.userId,
        })
        .returning();
      return toSupplierSummary(row!);
    },
  );
}

export async function updateSupplier(
  id: string,
  input: CreateSupplierInput,
  idempotencyKey: string,
): Promise<SupplierSummary> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.MANAGE_FINANCIAL);
  const data = CreateSupplierSchema.parse(input);
  const clinicId = await requireClinicId(); // contexto de clínica; RLS resolve em idempotentMutation, clinicId é belt-and-suspenders no WHERE
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('update_supplier', idempotencyKey),
        payload: jsonSafe({ id, ...data }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'financial.supplier.updated',
        resourceType: 'supplier',
        resourceId: id,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [row] = await tx
        .update(suppliers)
        .set({
          razaoSocial: data.razaoSocial,
          // VAL-001 — representação canônica; formatação é só apresentação.
          cnpj: normalizeCnpj(data.cnpj),
          contato: data.contato ?? null,
          condicaoPagamento: data.condicaoPagamento ?? null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(suppliers.id, id),
            eq(suppliers.clinicId, clinicId),
            // DATA-004 — compare-and-swap. O update casava por `id + clinic_id`
            // e duas edições concorrentes (owner e Financeiro) eram ambas
            // aceitas, com duas auditorias de sucesso; um dos valores sumia.
            // Razão social, CNPJ e contato de fornecedor alimentam contas a
            // pagar: perder a alteração é perder o favorecido certo.
            ...(data.expectedUpdatedAt
              ? [matchesExpectedVersion(suppliers.updatedAt, data.expectedUpdatedAt)]
              : []),
          ),
        )
        .returning();
      // Zero linhas com versão esperada = perdeu a corrida. O throw reverte a
      // tx: o perdedor NÃO deixa auditoria nem idempotência de sucesso.
      if (!row && data.expectedUpdatedAt) {
        throw new FinancialValidationError(
          'Este fornecedor foi alterado em outra janela. Recarregue e refaça a edição.',
        );
      }
      if (!row) throw new SupplierNotFoundError(id);
      return toSupplierSummary(row);
    },
  );
}

/** Ativa/desativa um fornecedor (soft — não deletamos histórico ligado a lançamentos). */
export async function setSupplierAtivo(
  id: string,
  ativo: boolean,
  idempotencyKey: string,
): Promise<SupplierSummary> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.MANAGE_FINANCIAL);
  const clinicId = await requireClinicId(); // contexto de clínica; RLS resolve em idempotentMutation, clinicId é belt-and-suspenders no WHERE
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('set_supplier_ativo', idempotencyKey),
        payload: jsonSafe({ id, ativo }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'financial.supplier.ativo',
        resourceType: 'supplier',
        resourceId: id,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [row] = await tx
        .update(suppliers)
        .set({ ativo, updatedAt: sql`now()` })
        // Ativar/desativar é um toggle idempotente, sem campo em disputa: não
        // faz sentido exigir versão aqui.
        .where(and(eq(suppliers.id, id), eq(suppliers.clinicId, clinicId)))
        .returning();
      if (!row) throw new SupplierNotFoundError(id);
      return toSupplierSummary(row);
    },
  );
}
