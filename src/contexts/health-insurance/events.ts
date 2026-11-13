/**
 * Eventos do contexto `health-insurance` (ADR-072). Schemas Zod registrados no
 * catálogo do outbox ao carregar o módulo (importado pelo barrel de schema via
 * `./schema`). Payload só com ids e escalares não sensíveis: nunca carteirinha,
 * nunca dado clínico.
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

export const HEALTH_INSURANCE_EVENTS = {
  /**
   * Coparticipação confirmada com valor cobrável > 0. O Financeiro (P10.5) cria o
   * recebível do paciente por ESTE valor, nunca pelo valor cheio do atendimento.
   */
  COPAY_CONFIRMED: 'health_insurance.copay.confirmed',
  /**
   * Exportação do lote em segundo plano (R45): o worker gera o XML com a leitura
   * DELEGADA das guias do lote (em nome de quem pediu, permissão conferida de novo na
   * execução). Uma chave por lote e versão: o mesmo pedido nunca vira dois arquivos.
   */
  BATCH_EXPORT_REQUESTED: 'health_insurance.batch.export_requested',
} as const;

const uuid = z.string().uuid();

export const CopayConfirmedSchema = z.object({
  copaymentId: uuid,
  clinicId: uuid,
  appointmentId: uuid,
  patientId: uuid,
  /** Teto do recebível do paciente, em centavos. */
  chargeableCents: z.number().int().positive(),
  /** Nome do procedimento para a descrição do recebível (o mesmo do snapshot do atendimento). */
  procedureName: z.string().min(1).max(200),
});
export type CopayConfirmedPayload = z.infer<typeof CopayConfirmedSchema>;

registerEventSchema(HEALTH_INSURANCE_EVENTS.COPAY_CONFIRMED, CopayConfirmedSchema);

export const BatchExportRequestedSchema = z.object({
  clinicId: uuid,
  batchId: uuid,
  /** Versão do lote no pedido: se o lote mudar antes da execução, nada é exportado. */
  version: z.number().int().positive(),
  /** Quem pediu: a leitura e a auditoria são em nome desta pessoa. */
  requestedBy: uuid,
});
export type BatchExportRequestedPayload = z.infer<typeof BatchExportRequestedSchema>;

registerEventSchema(HEALTH_INSURANCE_EVENTS.BATCH_EXPORT_REQUESTED, BatchExportRequestedSchema);
