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
import {
  requireCachedAnyPermission,
  requireCachedPermission,
  requireClinicId,
  requireUser,
} from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { publishEvent } from '@/lib/outbox/publish';

import {
  FinancialValidationError,
  LancamentoNotFoundError,
  SupplierNotFoundError,
} from './errors';
import { FINANCIAL_EVENTS } from './events';
import { idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import {
  assertLancamentoTransition,
  calcStatusPagamento,
  clinicDayBounds,
  estornoDescricao,
  estornoTipoOposto,
  round2,
} from './logic';
import {
  getCashFlowToday,
  getClinicTimezone,
  toLancamentoSummary,
  toSupplierSummary,
} from './queries';
import { lancamentos, paymentProofs, suppliers } from './schema';

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
  type SupplierSummary,
} from './types';

const money = (n: number): string => round2(n).toFixed(2);

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

      const valorTotal = Number(lanc.valor);
      const novoPago = round2(Number(lanc.valorPago) + data.valorPago);
      if (novoPago > valorTotal + 1e-9) {
        throw new FinancialValidationError('Valor pago excede o valor do lançamento.');
      }
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
          clinicId,
          valor: valorTotal,
          valorPago: novoPago,
          status: novoStatus,
          paymentMethod: data.paymentMethod,
        },
        idempotencyKey: `${idempotencyKey}:paid`,
      });
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
}

export async function createEstorno(
  input: CreateEstornoInput,
  idempotencyKey: string,
): Promise<EstornoResult> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.MANAGE_FINANCIAL);
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
      // pendente/parcial/pago → estornado. Já cancelado/estornado = inválido.
      assertLancamentoTransition(orig.status, 'estornado');

      // Lançamento de compensação (append-only). status='estornado' (NÃO 'pago')
      // para não virar uma 2ª linha "pago" no Caixa; appointment_id=null preserva
      // o UNIQUE do original.
      const [estorno] = await tx
        .insert(lancamentos)
        .values({
          clinicId,
          unitId: orig.unitId,
          tipo: estornoTipoOposto(orig.tipo),
          descricao: estornoDescricao(orig.descricao),
          valor: orig.valor,
          valorPago: '0',
          status: 'estornado',
          patientId: orig.patientId,
          supplierId: orig.supplierId,
          appointmentId: null,
          createdVia: 'estorno',
          reversesLancamentoId: orig.id,
          createdBy: user.userId,
        })
        .returning();

      const [updatedOrig] = await tx
        .update(lancamentos)
        .set({ status: 'estornado', updatedAt: sql`now()` })
        .where(and(eq(lancamentos.id, orig.id), eq(lancamentos.clinicId, clinicId)))
        .returning();

      await publishEvent(tx, {
        clinicId,
        eventType: FINANCIAL_EVENTS.LANCAMENTO_ESTORNADO,
        payload: {
          originalId: orig.id,
          estornoId: estorno!.id,
          clinicId,
          valor: Number(orig.valor),
          motivo: data.motivo,
        },
        idempotencyKey: `${idempotencyKey}:estornado`,
      });
      return {
        original: toLancamentoSummary(updatedOrig!),
        estorno: toLancamentoSummary(estorno!),
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
      idempotency: { key: idemKey('create_supplier', idempotencyKey), payload: jsonSafe(data), ttlSeconds: MUTATION_IDEM_TTL_SECONDS },
      audit: { action: 'financial.supplier.created', resourceType: 'supplier', resourceId: null, before: null, requestContext: ctx },
    },
    async (tx) => {
      const [row] = await tx
        .insert(suppliers)
        .values({
          clinicId,
          razaoSocial: data.razaoSocial,
          cnpj: data.cnpj ?? null,
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
      idempotency: { key: idemKey('update_supplier', idempotencyKey), payload: jsonSafe({ id, ...data }), ttlSeconds: MUTATION_IDEM_TTL_SECONDS },
      audit: { action: 'financial.supplier.updated', resourceType: 'supplier', resourceId: id, before: null, requestContext: ctx },
    },
    async (tx) => {
      const [row] = await tx
        .update(suppliers)
        .set({
          razaoSocial: data.razaoSocial,
          cnpj: data.cnpj ?? null,
          contato: data.contato ?? null,
          condicaoPagamento: data.condicaoPagamento ?? null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(suppliers.id, id), eq(suppliers.clinicId, clinicId)))
        .returning();
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
      idempotency: { key: idemKey('set_supplier_ativo', idempotencyKey), payload: jsonSafe({ id, ativo }), ttlSeconds: MUTATION_IDEM_TTL_SECONDS },
      audit: { action: 'financial.supplier.ativo', resourceType: 'supplier', resourceId: id, before: null, requestContext: ctx },
    },
    async (tx) => {
      const [row] = await tx
        .update(suppliers)
        .set({ ativo, updatedAt: sql`now()` })
        .where(and(eq(suppliers.id, id), eq(suppliers.clinicId, clinicId)))
        .returning();
      if (!row) throw new SupplierNotFoundError(id);
      return toSupplierSummary(row);
    },
  );
}
