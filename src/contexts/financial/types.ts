/**
 * Financial DTOs + Zod input schemas (C9). Tipos cruzam a fronteira RSC↔action;
 * dinheiro trafega como `number` (numeric(12,2) no banco → Number() na borda).
 */
import { z } from 'zod';

export type LancamentoTipo = 'receber' | 'pagar';
export type LancamentoStatus = 'pendente' | 'parcial' | 'pago' | 'cancelado' | 'estornado';
export type LancamentoCreatedVia = 'auto' | 'manual' | 'estorno';

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

/** Item do Caixa: lançamento + nome do paciente resolvido (patient-first UX). */
export interface CaixaItem extends LancamentoSummary {
  pacienteNome: string | null;
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
}

export interface SupplierSummary {
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

// --- input schemas (write-side) --------------------------------------------

const money = z
  .number()
  .finite()
  .positive()
  .max(99_999_999.99, 'valor acima do limite');

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
  motivo: z.string().trim().min(1, 'motivo do estorno obrigatório').max(200),
});
export type CreateEstornoInput = z.infer<typeof CreateEstornoSchema>;

export const CreateSupplierSchema = z.object({
  razaoSocial: z.string().trim().min(1, 'razão social obrigatória').max(160),
  cnpj: z.string().trim().max(18).nullable().optional(),
  contato: z.string().trim().max(160).nullable().optional(),
  condicaoPagamento: z.string().trim().max(120).nullable().optional(),
});
export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;
