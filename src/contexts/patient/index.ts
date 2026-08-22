// Public surface of the `patient` context (C5).
// Other contexts may only import from this file (eslint-plugin-boundaries).
//
// Exposes: schema entities + enums, event names/payload types, and the public
// DTOs. Server Actions, queries and internal handlers are NOT part of the
// cross-context surface — siblings react via outbox events, never direct calls.
export {
  patients,
  patientConsents,
  patientConsentDecisions,
  patientClinicalData,
  patientAddresses,
  patientEmergencyContacts,
  patientRelationships,
  patientMerges,
  suppressionList,
  lgpdRequests,
  lgpdRequestHistory,
  patientSexo,
  patientAddressTipo,
  suppressionChannel,
  consentPurpose,
  suppressionPurpose,
  lgpdRequestType,
  lgpdRequestStatus,
  lgpdHistoryAction,
  lgpdNotificationChannel,
  patientRelationshipType,
} from './schema';
export { patientApiV1, type PatientApiV1 } from './api';
export { PATIENT_EVENTS } from './events';
export type {
  PatientCreatedPayload,
  PatientUpdatedPayload,
  PatientDeletedPayload,
  PatientDeceasedPayload,
  PatientMergedPayload,
  PatientRelationshipChangedPayload,
  ConsentGrantedPayload,
  ConsentRevokedPayload,
  SuppressionAddedPayload,
  LgpdExportRequestedPayload,
  LgpdDeleteRequestedPayload,
} from './events';
export type {
  Channel,
  ConsentType,
  CreatePatientInput,
  UpdatePatientInput,
  ConsentInput,
  RecordPatientDeathInput,
  PatientGuardianInput,
  LinkPatientRelationshipInput,
  MergePatientsInput,
  PatientRelationshipType,
  PatientRelationshipDTO,
  PatientListItem,
  PatientListResult,
  PatientSummary,
  DecryptedPatient,
  ProactiveContact,
} from './types';
