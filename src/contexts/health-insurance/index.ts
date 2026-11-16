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
// P6.6/P12.6 — manutenção de Convênios no fim do cron financial-reconcile (vencimento das
// autorizações a cada execução; resumo diário de alertas só com contagens).
export { runInsuranceMaintenance, type InsuranceMaintenanceSummary } from './maintenance';
// P7.4 — reconcile "convênio sem guia" (chamado pelo cron financial-reconcile; C.7).
export {
  listBillingGapCandidates,
  listCopaySyncCandidates,
  type BillingGapCandidate,
  type CopaySyncCandidate,
} from './billing-gap-candidates';
export {
  reconcileInsuranceBilling,
  type InsuranceReconcileSummary,
} from './internal/billing-reconcile';
// P10.5 — coparticipação acompanha a baixa do gateway (webhook do paciente) e o cron é a garantia.
export {
  reconcileCopayCharges,
  syncCopayForAppointment,
  type CopaySyncSummary,
} from './internal/copay-charge-service';
// P9.2 — prontidão do validador XSD no runtime do app (rota /api/health/tiss-xsd e CI).
export {
  tissXsdLimitsProbe,
  tissXsdSelfCheck,
  type TissXsdLimitsProbe,
  type TissXsdSelfCheck,
} from './tiss/xml/self-check';
