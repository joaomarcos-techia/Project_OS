// Public surface of the `patient` context (C5).
// Other contexts may only import from this file (eslint-plugin-boundaries).
//
// Exposes: schema entities + enums, event names/payload types, and the public
// DTOs. Server Actions, queries and internal handlers are NOT part of the
// cross-context surface — siblings react via outbox events, never direct calls.
export {
  patients,
  patientConsents,
  patientClinicalData,
  patientAddresses,
  patientEmergencyContacts,
  suppressionList,
  lgpdRequests,
  patientSexo,
  patientAddressTipo,
  suppressionChannel,
  lgpdRequestType,
  lgpdRequestStatus,
} from './schema';
export { patientApiV1, type PatientApiV1 } from './api';
export { PATIENT_EVENTS } from './events';
export type {
  PatientCreatedPayload,
  PatientUpdatedPayload,
  PatientDeletedPayload,
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
  PatientSummary,
  DecryptedPatient,
  ProactiveContact,
} from './types';
