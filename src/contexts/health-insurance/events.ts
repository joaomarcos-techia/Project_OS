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
  /**
   * P9.4: envio do lote exportado pelo webservice HOMOLOGADO da operadora. Uma chave por lote e
   * versão: o mesmo lote nunca sai duas vezes por pedido repetido. Sem operadora homologada
   * (produção hoje), ninguém publica este evento.
   */
  BATCH_SEND_REQUESTED: 'health_insurance.batch.send_requested',
  /**
   * P6.6 — entrega dos avisos de autorização à clínica (e-mail a quem opera Convênios). Só o lote e
   * a contagem: o handler lê os avisos do lote na hora e não manda dado de paciente.
   */
  AUTHORIZATION_ALERTS_DELIVERY_REQUESTED: 'health_insurance.authorization_alerts.delivery_requested',
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

export const BatchSendRequestedSchema = BatchExportRequestedSchema;
export type BatchSendRequestedPayload = z.infer<typeof BatchSendRequestedSchema>;

registerEventSchema(HEALTH_INSURANCE_EVENTS.BATCH_SEND_REQUESTED, BatchSendRequestedSchema);

export const AuthorizationAlertsDeliverySchema = z.object({
  clinicId: uuid,
  /** Lote de avisos (hash dos ids); a chave do evento é o lote. */
  batch: z.string().regex(/^[0-9a-f]{32}$/u),
  count: z.number().int().positive(),
});
export type AuthorizationAlertsDeliveryPayload = z.infer<typeof AuthorizationAlertsDeliverySchema>;

registerEventSchema(HEALTH_INSURANCE_EVENTS.AUTHORIZATION_ALERTS_DELIVERY_REQUESTED, AuthorizationAlertsDeliverySchema);
