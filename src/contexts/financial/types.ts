/**
 * Financial DTOs + Zod input schemas (C9). Tipos cruzam a fronteira RSC↔action;
 * dinheiro trafega como `number` (numeric(12,2) no banco → Number() na borda).
 */
import { z } from 'zod';

import { CNPJ_INVALID_MESSAGE, parseOptionalCnpj } from '@/lib/validation/cnpj';

import type { CommercialPaymentMethod } from './commercial-method';

export type LancamentoTipo = 'receber' | 'pagar';
export type LancamentoStatus = 'pendente' | 'parcial' | 'pago' | 'cancelado' | 'estornado';
export type LancamentoCreatedVia = 'auto' | 'manual' | 'estorno';
export type PaymentTransactionKind = 'payment' | 'refund';

// --- projeções (read-side) -------------------------------------------------

export interface LancamentoSummary {
  id: string;
  clinicId: string;
  unitId: string | null;
  tipo: LancamentoTipo;
  descricao: string;
  valor: number;
  valorPago: number;
  status: LancamentoStatus;
  dueDate: string | null; // 'YYYY-MM-DD'
  paidAt: string | null; // ISO
  patientId: string | null;
  supplierId: string | null;
  appointmentId: string | null;
  paymentMethod: string | null;
  createdVia: LancamentoCreatedVia;
  reversesLancamentoId: string | null;
  snapshotProcedureName: string | null;
  snapshotDoctorNome: string | null;
  createdAt: string; // ISO
}

export interface AppointmentFinancialEconomics {
  appointmentId: string;
  providerGrossAmount: number | null;
  providerFeeAmount: number | null;
  earlySettlementFeeAmount: number | null;
  providerNetAmount: number | null;
  payout: {
    calculationBasis: 'gross' | 'net';
    basisAmount: number | null;
    payoutAmount: number | null;
    status: 'pending_economics' | 'calculated' | 'cancelled';
  } | null;
}

/** Item do Caixa: lançamento + nome do paciente resolvido (patient-first UX). */
export interface CaixaItem extends LancamentoSummary {
  pacienteNome: string | null;
  paymentEconomics: AppointmentFinancialEconomics | null;
  chargeEconomics?: {
    chargeId: string;
    appointmentId: string;
    kind: 'deposit' | 'remainder';
    status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'failed';
    requestedAmount: number;
    providerGrossAmount: number | null;
    providerFeeAmount: number | null;
    providerNetAmount: number | null;
  }[];
  commercialPaymentMethod?: CommercialPaymentMethod | null;
}

export interface FaturamentoPendenciaDTO {
  id: string;
  appointmentId: string;
  motivo: string;
  valor: number | null;
  createdAt: string;
}

/** Tudo que a tela /caixa precisa em uma carga. */
export interface CaixaDTO {
  pendentes: CaixaItem[]; // a receber, status pendente
  parciais: CaixaItem[]; // a receber, status parcial
  pagosHoje: CaixaItem[]; // liquidados hoje
  pendencias: FaturamentoPendenciaDTO[]; // atendimentos não faturados (banner)
}

/** Cards do dashboard financeiro (Fase 2) + fonte de listCashFlow. */
export interface CashFlowDTO {
  receber: number; // total em aberto a receber
  pagar: number; // total em aberto a pagar
  recebidoHoje: number;
  pagoHoje: number;
  saldoHoje: number; // recebidoHoje - pagoHoje
  /**
   * Contagens que acompanham os totais. A referência de setembro/2026 escreve
   * "12 lançamentos · 1 vencido" sob o valor: sem elas a sublinha só repetia o
   * rótulo ("Pendências em aberto"), que o número acima já dizia.
   */
  contagens: {
    receber: number;
    receberVencidos: number;
    pagar: number;
    recebimentos: number;
    pagamentos: number;
  };
}

export interface SupplierSummary {
  /** DATA-004 — token de versão para o compare-and-swap da edição. */
  updatedAt: string | null;
  id: string;
  razaoSocial: string;
  cnpj: string | null;
  contato: string | null;
  condicaoPagamento: string | null;
  ativo: boolean;
}

export interface PaymentMethodDTO {
  code: string;
  label: string;
}

export interface PaymentTransactionSummary {
  id: string;
  clinicId: string;
  lancamentoId: string;
  kind: PaymentTransactionKind;
  amount: number;
  paymentMethod: string | null;
  occurredAt: string;
  originalPaymentId: string | null;
  reason: string | null;
  createdBy: string | null;
  /** Disponivel apenas para pagamentos; zero para reembolsos. */
  refundableAmount: number;
}

/**
 * Movimento imutável do ledger preparado para exportação contábil.
 *
 * Não carrega paciente, CPF nem conteúdo clínico. `cashEffect` é positivo
 * quando o movimento aumenta o caixa e negativo quando o reduz.
 */
export interface AccountingMovementDTO {
  transactionId: string;
  lancamentoId: string;
  occurredAt: string;
  transactionKind: PaymentTransactionKind;
  lancamentoTipo: LancamentoTipo;
  description: string;
  amount: number;
  cashEffect: number;
  paymentMethod: string | null;
  paymentMethodLabel: string | null;
  dueDate: string | null;
  lancamentoStatus: LancamentoStatus;
  createdVia: LancamentoCreatedVia;
  supplierName: string | null;
  supplierCnpj: string | null;
  originalPaymentId: string | null;
  reason: string | null;
}

export interface CollectionCaseDTO {
  id: string;
  lancamentoId: string;
  stage: 'd15_review' | 'd30_manual';
  daysOverdue: number;
  residualAmount: number;
  createdAt: string;
}

// --- input schemas (write-side) --------------------------------------------

const money = z.number().finite().positive().max(99_999_999.99, 'valor acima do limite');

const uuid = z.string().uuid();

export const CreateLancamentoSchema = z.object({
  tipo: z.enum(['receber', 'pagar']),
  descricao: z.string().trim().min(1, 'descrição obrigatória').max(200),
  valor: money,
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'data inválida (YYYY-MM-DD)')
    .optional(),
  patientId: uuid.nullable().optional(),
  supplierId: uuid.nullable().optional(),
  unitId: uuid.nullable().optional(),
  paymentMethod: z.string().max(40).nullable().optional(),
});
export type CreateLancamentoInput = z.infer<typeof CreateLancamentoSchema>;

export const ConfirmPaymentSchema = z.object({
  lancamentoId: uuid,
  paymentMethod: z.string().min(1).max(40),
  valorPago: money,
  comprovante: z
    .object({
      type: z.enum(['comprovante', 'nota_fiscal', 'outro']),
      fileStoragePath: z.string().min(1).max(512),
    })
    .nullable()
    .optional(),
});
export type ConfirmPaymentInput = z.infer<typeof ConfirmPaymentSchema>;

export const CancelLancamentoSchema = z.object({
  lancamentoId: uuid,
  motivo: z.string().trim().max(200).nullable().optional(),
});
export type CancelLancamentoInput = z.infer<typeof CancelLancamentoSchema>;

export const CreateEstornoSchema = z.object({
  lancamentoId: uuid,
  paymentId: uuid,
  valor: money,
  paymentMethod: z.string().min(1).max(40),
  motivo: z.string().trim().min(1, 'motivo do estorno obrigatório').max(200),
  comprovante: z
    .object({
      type: z.enum(['comprovante', 'nota_fiscal', 'outro']),
      fileStoragePath: z.string().min(1).max(512),
    })
    .nullable()
    .optional(),
});
export type CreateEstornoInput = z.infer<typeof CreateEstornoSchema>;

export const CreateSupplierSchema = z.object({
  /**
   * DATA-004 — versão lida pelo formulário, conferida no `WHERE` do update.
   * Reusa `updated_at`: nenhuma migration. Ignorada no create.
   */
  expectedUpdatedAt: z.string().datetime().optional(),
  razaoSocial: z.string().trim().min(1, 'razão social obrigatória').max(160),
  // VAL-001 — `trim().max(18)` aceitava `1`, e o banco persistiu `cnpj='1'`.
  // O schema é o boundary: máscara de formulário não protege caller direto.
  // Vazio continua opcional; preenchido normaliza para 14 dígitos canônicos e
  // passa pelos verificadores.
  cnpj: z
    .string()
    .trim()
    .max(18)
    .nullable()
    .optional()
    .refine((value) => parseOptionalCnpj(value).ok, { message: CNPJ_INVALID_MESSAGE }),
  contato: z.string().trim().max(160).nullable().optional(),
  condicaoPagamento: z.string().trim().max(120).nullable().optional(),
});
export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;
