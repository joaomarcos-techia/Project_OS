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
