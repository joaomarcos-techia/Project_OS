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
// P1.13 — interruptor por clínica e disponibilidade comercial no console da plataforma (super admin com AAL2).
export {
  ConveniosPlatformError,
  listConveniosModuleStates,
  readConveniosModuleState,
  setConveniosModuleForClinic,
  type ConveniosModuleState,
  type ConveniosPlatformErrorCode,
  type SetConveniosModuleResult,
} from './platform';
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
// P4.7-b — convênio em atendimento histórico importado (referência; nunca faturamento).
export {
  historicalCoveragePort,
  recordHistoricalCoveragesTx,
  resolveHistoricalCoverageLinesTx,
} from './historical-coverage';
// S1/S3 — rastro TISS da clínica para o perfil de segurança (só existência).
export { readClinicTissFootprint } from './security-footprint';
// P11 — o que o agente de IA (outro context) usa do Convênios: as consultas da agenda e o adaptador de respostas
// seguras (handoff-agente-p11.md). Nenhum agente aqui; as ferramentas são do registro do agente.
export {
  getSchedulingInsuranceOptions,
  listPatientCardsForScheduling,
  procedureRequiresAuthorization,
  schedulingTermsForProcedure,
  type SchedulingCard,
  type SchedulingInsuranceOptions,
} from './config-queries';
export {
  checkSchedulingChoice,
  recordSchedulingCoverage,
  type SchedulingInsuranceChoice,
} from './scheduling-coverage';
export {
  AGENT_INSURANCE_TEXT,
  agentChoiceVerdict,
  agentInsuranceOptions,
  coverageQuestionReply,
  findUnsafeAgentClaims,
  insuranceReplyGuard,
  insurerNotRecognizedReply,
  insurerOrPrivateReply,
  isInsuranceTalk,
  matchInsurerFromPatientText,
  pickAgentMembership,
  patientInsuranceIntent,
  planNotRecognizedReply,
  plansSaidByPatient,
  resolveInsurerFromPatientText,
  resolvePlanFromPatientText,
  type AgentChoiceVerdict,
  type AgentInsuranceOptions,
  type InsurerResolution,
  type PatientInsuranceIntent,
} from './agent-insurance';
