/**
 * Financial internal API (C12) — superfície versionada (M14) para o AI Agent
 * e para os jobs internos de cobrança. NÃO HTTP. A IA só consulta pendências;
 * as mutações expostas aqui pertencem ao fluxo operacional do job e são
 * executadas com contexto explícito da clínica. Thin wrapper, sem regra de
 * negócio (REGRA 3).
 */
import { getLancamento, listPendingByPatient } from './queries';
import {
  listDunningCandidates,
  listOpenCollectionCaseClinicIds,
  type DunningCandidate,
} from './dunning-candidates';
import type { ManualCollectionStage } from './dunning-policy';
import { resolveSettledCollectionCases, upsertCollectionCase } from './internal/collection-cases';
import type { LancamentoSummary } from './types';

export interface FinancialApiV1 {
  listPendingByPatient(clinicId: string, patientId: string): Promise<LancamentoSummary[]>;
  /** C14 — re-checagem de status no send-time do dunning (guard "já pagou?"). */
  getLancamento(clinicId: string, id: string): Promise<LancamentoSummary | null>;
  /** C14 — recebíveis cobráveis e vencidos (cross-tenant; regra mora no Financial). */
  listDunningCandidates(limit?: number): Promise<DunningCandidate[]>;
  upsertCollectionCase(candidate: DunningCandidate, stage: ManualCollectionStage): Promise<void>;
  listOpenCollectionCaseClinicIds(): Promise<string[]>;
  resolveSettledCollectionCases(clinicId: string): Promise<number>;
}

export const financialApiV1: FinancialApiV1 = {
  listPendingByPatient: (clinicId, patientId) => listPendingByPatient(clinicId, patientId),
  getLancamento: (clinicId, id) => getLancamento(clinicId, id),
  listDunningCandidates: (limit) => listDunningCandidates(limit),
  upsertCollectionCase: (candidate, stage) => upsertCollectionCase(candidate, stage),
  listOpenCollectionCaseClinicIds: () => listOpenCollectionCaseClinicIds(),
  resolveSettledCollectionCases: (clinicId) => resolveSettledCollectionCases(clinicId),
};
