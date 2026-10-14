/**
 * Patient context events (C5). Producer-side schemas registered in the outbox
 * catalog at module load (imported via the schema barrel).
 *
 * Naming: the frozen C4 regex requires `<context>.<entity>.<action>` (3 seg).
 * PlanoAção §5.2 lists 2-segment names (`patient.created`); those cannot be
 * published under the frozen CHECK constraint. Mapped to sub-entity groups
 * (core/consent/suppression/lgpd) — documented deviation in ADR-012.
 *
 * Payload rule (5.9): NEVER include `*_encrypted` or plaintext CPF/telefone.
 * Only ids + hashes + non-sensitive scalars. JSON-safe (no Date/BigInt).
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

export const PATIENT_EVENTS = {
  CREATED: 'patient.core.created',
  UPDATED: 'patient.core.updated',
  DELETED: 'patient.core.deleted',
  DECEASED: 'patient.core.deceased',
  MERGED: 'patient.core.merged',
  RELATIONSHIP_LINKED: 'patient.relationship.linked',
  RELATIONSHIP_UNLINKED: 'patient.relationship.unlinked',
  CONSENT_GRANTED: 'patient.consent.granted',
  CONSENT_REVOKED: 'patient.consent.revoked',
  SUPPRESSION_ADDED: 'patient.suppression.added',
  LGPD_EXPORT_REQUESTED: 'patient.lgpd.export_requested',
  LGPD_DELETE_REQUESTED: 'patient.lgpd.delete_requested',
} as const;

const uuid = z.string().uuid();

/**
 * LGPD-002 — MINIMIZAÇÃO NA ORIGEM.
 *
 * Este evento carregava `nome`, `cpfHash`, `telefoneHash` e `email`. Não existe
 * consumidor registrado, então todos os 31 eventos em produção terminaram
 * `skipped` — e ficaram guardados, com PII, por até 30 dias pela política de
 * retenção. Sete deles pertenciam a pacientes que JÁ NÃO EXISTIAM em `patients`:
 * o titular recebeu "eliminação concluída" enquanto nome, e-mail e
 * identificadores pseudonimizados seguiam em outra cópia.
 *
 * Hash de 64 caracteres é PSEUDÔNIMO ESTÁVEL, não dado anônimo: quem tem o CPF
 * confirma a correspondência. Publicar isso "porque é hash" não satisfaz
 * minimização.
 *
 * O payload agora carrega apenas as chaves de correlação. Quando existir um
 * consumidor real que precise de mais, ele volta com escopo justificado — e
 * junto com o saneamento no hard-delete, que é o outro lado desta correção.
 */
export const PatientCreatedSchema = z.object({
  patientId: uuid,
  clinicId: uuid,
});
export type PatientCreatedPayload = z.infer<typeof PatientCreatedSchema>;

export const PatientUpdatedSchema = z.object({
  patientId: uuid,
  clinicId: uuid,
  // Field names that changed (no values for sensitive fields).
  changed: z.array(z.string()),
});
export type PatientUpdatedPayload = z.infer<typeof PatientUpdatedSchema>;

export const PatientDeletedSchema = z.object({
  patientId: uuid,
  clinicId: uuid,
  soft: z.boolean(),
});
export type PatientDeletedPayload = z.infer<typeof PatientDeletedSchema>;

export const PatientDeceasedSchema = z.object({
  patientId: uuid,
  clinicId: uuid,
  deceasedAt: z.string().date(),
});
export type PatientDeceasedPayload = z.infer<typeof PatientDeceasedSchema>;

export const PatientMergedSchema = z.object({
  clinicId: uuid,
  sourcePatientId: uuid,
  targetPatientId: uuid,
  mergeId: uuid,
});
export type PatientMergedPayload = z.infer<typeof PatientMergedSchema>;

export const PatientRelationshipChangedSchema = z.object({
  clinicId: uuid,
  relationshipId: uuid,
  responsiblePatientId: uuid,
  dependentPatientId: uuid,
});
export type PatientRelationshipChangedPayload = z.infer<typeof PatientRelationshipChangedSchema>;

export const ConsentGrantedSchema = z.object({
  patientId: uuid,
  clinicId: uuid,
  versao: z.number().int().min(1),
  dadosSaude: z.boolean(),
  compartilhamento: z.boolean(),
  agendamentoWhatsapp: z.boolean().optional(),
  cobrancaWhatsapp: z.boolean(),
  marketing: z.boolean(),
  pesquisa: z.boolean(),
});
export type ConsentGrantedPayload = z.infer<typeof ConsentGrantedSchema>;

export const ConsentRevokedSchema = z.object({
  patientId: uuid,
  clinicId: uuid,
  consentType: z.enum([
    'dados_saude',
    'compartilhamento',
    'agendamento_whatsapp',
    'cobranca_whatsapp',
    'marketing',
    'pesquisa',
  ]),
});
export type ConsentRevokedPayload = z.infer<typeof ConsentRevokedSchema>;

export const SuppressionAddedSchema = z.object({
  clinicId: uuid,
  contactHash: z.string(),
  channel: z.enum(['whatsapp', 'email', 'sms']),
  reason: z.string(),
});
export type SuppressionAddedPayload = z.infer<typeof SuppressionAddedSchema>;

export const LgpdExportRequestedSchema = z.object({
  requestId: uuid,
  patientId: uuid,
  clinicId: uuid,
});
export type LgpdExportRequestedPayload = z.infer<typeof LgpdExportRequestedSchema>;

export const LgpdDeleteRequestedSchema = z.object({
  requestId: uuid,
  patientId: uuid,
  clinicId: uuid,
});
export type LgpdDeleteRequestedPayload = z.infer<typeof LgpdDeleteRequestedSchema>;

registerEventSchema(PATIENT_EVENTS.CREATED, PatientCreatedSchema);
registerEventSchema(PATIENT_EVENTS.UPDATED, PatientUpdatedSchema);
registerEventSchema(PATIENT_EVENTS.DELETED, PatientDeletedSchema);
registerEventSchema(PATIENT_EVENTS.DECEASED, PatientDeceasedSchema);
registerEventSchema(PATIENT_EVENTS.MERGED, PatientMergedSchema);
registerEventSchema(PATIENT_EVENTS.RELATIONSHIP_LINKED, PatientRelationshipChangedSchema);
registerEventSchema(PATIENT_EVENTS.RELATIONSHIP_UNLINKED, PatientRelationshipChangedSchema);
registerEventSchema(PATIENT_EVENTS.CONSENT_GRANTED, ConsentGrantedSchema);
registerEventSchema(PATIENT_EVENTS.CONSENT_REVOKED, ConsentRevokedSchema);
registerEventSchema(PATIENT_EVENTS.SUPPRESSION_ADDED, SuppressionAddedSchema);
registerEventSchema(PATIENT_EVENTS.LGPD_EXPORT_REQUESTED, LgpdExportRequestedSchema);
registerEventSchema(PATIENT_EVENTS.LGPD_DELETE_REQUESTED, LgpdDeleteRequestedSchema);
