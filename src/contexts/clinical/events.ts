/**
 * Clinical context events (C7). Producer-side Zod schemas registrados no catálogo
 * do outbox no load do módulo (importado via barrel `src/lib/db/schema/index.ts`
 * através de `./schema`). PlanoAção §7.18 congela os 4 nomes `clinical.*`.
 *
 * Regras frozen (ADR-011):
 *   - Nomes 3-segmentos `<context>.<entity>.<action>` (CHECK regex no outbox).
 *   - Payload JSON-safe: timestamps `z.string().datetime()` (NUNCA z.date()).
 *   - SÓ ids + escalares NÃO-sensíveis. NADA de conteúdo clínico/PII no payload —
 *     o handler busca o detalhe via DB (ADR-011 #27). Sem `*_encrypted`, sem texto livre.
 *   - `clinical.prontuario.signed` carrega `needsReturn` + `returnDays` (C14 agenda followup).
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

export const CLINICAL_EVENTS = {
  PRONTUARIO_CREATED: 'clinical.prontuario.created',
  PRONTUARIO_SIGNED: 'clinical.prontuario.signed',
  PRESCRIPTION_CREATED: 'clinical.prescription.created',
  DOCUMENT_GENERATED: 'clinical.document.generated',
} as const;

const uuid = z.string().uuid();

// --- prontuario.created ----------------------------------------------------
export const ProntuarioCreatedSchema = z.object({
  prontuarioId: uuid,
  clinicId: uuid,
  patientId: uuid,
  doctorId: uuid,
  appointmentId: uuid.nullable(),
  createdBy: uuid,
});
export type ProntuarioCreatedPayload = z.infer<typeof ProntuarioCreatedSchema>;

// --- prontuario.signed (C14 reage → followup) ------------------------------
// C14: `signedDoctorNome` é extensão ADITIVA do contrato v1 (nome de profissional
// NÃO é PII — mesmo precedente de scheduling.appointment.completed). Permite o
// handler de followup montar o template SEM ler clinical no send (handler puro).
export const ProntuarioSignedSchema = z.object({
  prontuarioId: uuid,
  clinicId: uuid,
  patientId: uuid,
  signedBy: uuid,
  signedAt: z.string().datetime(),
  needsReturn: z.boolean(),
  returnDays: z.number().int().positive().nullable(),
  signedDoctorNome: z.string().nullable(),
});
export type ProntuarioSignedPayload = z.infer<typeof ProntuarioSignedSchema>;

// --- prescription.created --------------------------------------------------
// `kind` é extensão ADITIVA do contrato v1 (ADR-015): `.default('simples')` mantém
// payloads/consumidores antigos válidos. NÃO é PII (escalar não-sensível).
export const PrescriptionCreatedSchema = z.object({
  prescriptionId: uuid,
  clinicId: uuid,
  prontuarioId: uuid.nullable(),
  patientId: uuid,
  doctorId: uuid,
  kind: z.enum(['simples', 'controle_especial']).default('simples'),
  createdAt: z.string().datetime(),
});
export type PrescriptionCreatedPayload = z.infer<typeof PrescriptionCreatedSchema>;

// --- document.generated ----------------------------------------------------
export const DocumentGeneratedSchema = z.object({
  documentId: uuid,
  clinicId: uuid,
  patientId: uuid,
  doctorId: uuid,
  type: z.enum(['atestado', 'exame', 'declaracao', 'encaminhamento']),
  createdAt: z.string().datetime(),
});
export type DocumentGeneratedPayload = z.infer<typeof DocumentGeneratedSchema>;

registerEventSchema(CLINICAL_EVENTS.PRONTUARIO_CREATED, ProntuarioCreatedSchema);
registerEventSchema(CLINICAL_EVENTS.PRONTUARIO_SIGNED, ProntuarioSignedSchema);
registerEventSchema(CLINICAL_EVENTS.PRESCRIPTION_CREATED, PrescriptionCreatedSchema);
registerEventSchema(CLINICAL_EVENTS.DOCUMENT_GENERATED, DocumentGeneratedSchema);
