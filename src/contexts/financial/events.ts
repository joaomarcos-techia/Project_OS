/**
 * Financial context events (C9). Producer-side Zod schemas registrados no catálogo
 * do outbox no load do módulo (importado via barrel `src/lib/db/schema/index.ts`
 * através de `./schema`).
 *
 * Regras frozen (ADR-011):
 *   - Nomes 3-segmentos `<context>.<entity>.<action>` (CHECK regex no outbox).
 *   - Payload JSON-safe: timestamps `z.string().datetime()` (NUNCA z.date());
 *     dinheiro `z.number()`; só ids + escalares NÃO-sensíveis (sem PII).
 *
 * Ownership (R3): o Financial NÃO escreve `appointments`. Ele emite
 *   `financial.lancamento.created` (com appointmentId) e `financial.faturamento.pendente`;
 *   handlers do Scheduling consomem e marcam `appointments.faturamento_pendente`.
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

export const FINANCIAL_EVENTS = {
  LANCAMENTO_CREATED: 'financial.lancamento.created',
  LANCAMENTO_PAID: 'financial.lancamento.paid',
  LANCAMENTO_CANCELLED: 'financial.lancamento.cancelled',
  LANCAMENTO_ESTORNADO: 'financial.lancamento.estornado',
  FATURAMENTO_PENDENTE: 'financial.faturamento.pendente',
  /** D50: o valor recebido excedeu o saldo e deve voltar ao paciente. */
  EXCESS_REFUND_REQUESTED: 'financial.patient_refund.requested',
} as const;

const uuid = z.string().uuid();
const tipoEnum = z.enum(['receber', 'pagar']);
const statusEnum = z.enum(['pendente', 'parcial', 'pago', 'cancelado', 'estornado']);

// --- lancamento.created ----------------------------------------------------
// `appointmentId` não-nulo = origem appointment (handler do Scheduling limpa a
// flag faturamento_pendente). null = lançamento manual.
export const LancamentoCreatedSchema = z.object({
  lancamentoId: uuid,
  clinicId: uuid,
  tipo: tipoEnum,
  valor: z.number().nonnegative(),
  appointmentId: uuid.nullable(),
  patientId: uuid.nullable(),
  createdVia: z.enum(['auto', 'manual', 'estorno']),
});
export type LancamentoCreatedPayload = z.infer<typeof LancamentoCreatedSchema>;

// --- lancamento.paid -------------------------------------------------------
export const LancamentoPaidSchema = z.object({
  lancamentoId: uuid,
  transactionId: uuid,
  clinicId: uuid,
  valor: z.number().nonnegative(),
  amount: z.number().positive(),
  valorPago: z.number().nonnegative(),
  status: statusEnum,
  paymentMethod: z.string().nullable(),
  /**
   * 08/10/2026 — o atendimento do recebível e a origem da baixa. Com eles o
   * Payments fecha o link do restante quando a recepção registra o pagamento
   * (`manual`); a baixa que veio do próprio link é `gateway`. Aditivos e
   * opcionais: eventos anteriores seguem válidos e não fecham nada.
   */
  appointmentId: uuid.nullable().optional(),
  source: z.enum(['manual', 'gateway']).optional(),
});
export type LancamentoPaidPayload = z.infer<typeof LancamentoPaidSchema>;

// --- lancamento.cancelled --------------------------------------------------
export const LancamentoCancelledSchema = z.object({
  lancamentoId: uuid,
  clinicId: uuid,
  reason: z.string().nullable(),
});
export type LancamentoCancelledPayload = z.infer<typeof LancamentoCancelledSchema>;

// --- lancamento.estornado (append-only; lineage explícito) -----------------
export const LancamentoEstornadoSchema = z.object({
  originalId: uuid,
  paymentTransactionId: uuid,
  refundTransactionId: uuid,
  clinicId: uuid,
  valor: z.number().positive(),
  paymentMethod: z.string(),
  motivo: z.string(),
});
export type LancamentoEstornadoPayload = z.infer<typeof LancamentoEstornadoSchema>;

// --- faturamento.pendente (Scheduling reage → marca appointments.flag) -----
export const FaturamentoPendenteSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  motivo: z.string(),
  valor: z.number().nonnegative(),
});
export type FaturamentoPendentePayload = z.infer<typeof FaturamentoPendenteSchema>;

// --- patient_refund.requested (D50) ---------------------------------------
export const ExcessRefundRequestedSchema = z.object({
  clinicId: uuid,
  appointmentId: uuid,
  chargeId: uuid,
  amount: z.number().positive(),
  requestedAt: z.string().datetime(),
});
export type ExcessRefundRequestedPayload = z.infer<typeof ExcessRefundRequestedSchema>;

registerEventSchema(FINANCIAL_EVENTS.LANCAMENTO_CREATED, LancamentoCreatedSchema);
registerEventSchema(FINANCIAL_EVENTS.LANCAMENTO_PAID, LancamentoPaidSchema);
registerEventSchema(FINANCIAL_EVENTS.LANCAMENTO_CANCELLED, LancamentoCancelledSchema);
registerEventSchema(FINANCIAL_EVENTS.LANCAMENTO_ESTORNADO, LancamentoEstornadoSchema);
registerEventSchema(FINANCIAL_EVENTS.FATURAMENTO_PENDENTE, FaturamentoPendenteSchema);
registerEventSchema(FINANCIAL_EVENTS.EXCESS_REFUND_REQUESTED, ExcessRefundRequestedSchema);
