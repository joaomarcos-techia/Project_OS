// Public surface of the `clinical` context (C7).
// Other contexts may only import from this file (eslint-plugin-boundaries).
//
// Exposes: schema entities + enums, event names/payload types, and public DTOs.
// Server Actions, queries and internal handlers are NOT part of the cross-context
// surface — siblings react via outbox events, never direct calls.
export {
  prontuarios,
  prontuarioVersions,
  prescriptions,
  medicalDocuments,
  prescriptionTemplates,
  prontuarioStatus,
  medicalDocumentType,
  prescriptionKind,
} from './schema';

export { CLINICAL_EVENTS } from './events';
export type {
  ProntuarioCreatedPayload,
  ProntuarioSignedPayload,
  PrescriptionCreatedPayload,
  DocumentGeneratedPayload,
} from './events';

export type {
  ProntuarioContent,
  Medicamento,
  MedicalDocumentContent,
  MedicalDocumentType,
  PrescriptionKind,
  ProntuarioStatus,
  ProntuarioSummary,
  ProntuarioDetail,
  PrescriptionSummary,
  PrescriptionTemplateSummary,
  MedicalDocumentSummary,
  ClinicalTemplate,
} from './types';
