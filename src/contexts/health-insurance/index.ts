// Superfície pública do context `health-insurance` (convênios e faturamento
// TISS; ADR-072). Outros contexts só importam deste arquivo
// (eslint-plugin-boundaries). O plano de execução é o QORO_TISS_MASTER_PLAN.md.
export {
  CopayConfirmedSchema,
  HEALTH_INSURANCE_EVENTS,
  type CopayConfirmedPayload,
} from './events';
export {
  tissSchemaVersions,
  tissTerminologyVersions,
  tissTerms,
  type TissSchemaVersionRow,
  type TissTermRow,
  type TissTerminologyVersionRow,
} from './schema';
// P7.4 — reconcile "convênio sem guia" (chamado pelo cron financial-reconcile; C.7).
export {
  listBillingGapCandidates,
  type BillingGapCandidate,
} from './billing-gap-candidates';
export {
  reconcileInsuranceBilling,
  type InsuranceReconcileSummary,
} from './internal/billing-reconcile';
// P9.2 — prontidão do validador XSD no runtime do app (rota /api/health/tiss-xsd e CI).
export { tissXsdLimitsProbe, tissXsdSelfCheck, type TissXsdLimitsProbe, type TissXsdSelfCheck } from './tiss/xml/self-check';
