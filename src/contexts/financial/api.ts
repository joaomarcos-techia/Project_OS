/**
 * Financial internal API (C12) — superfície versionada (M14) para o AI Agent.
 * NÃO HTTP. SOMENTE LEITURA: a IA nunca cria/edita/gera cobrança (par.12 —
 * proibido). Thin wrapper sobre a query; sem lógica de negócio (REGRA 3).
 */
import { getLancamento, listPendingByPatient } from './queries';
import { listDunningCandidates, type DunningCandidate } from './dunning-candidates';
import type { LancamentoSummary } from './types';

export interface FinancialApiV1 {
  listPendingByPatient(clinicId: string, patientId: string): Promise<LancamentoSummary[]>;
  /** C14 — re-checagem de status no send-time do dunning (guard "já pagou?"). */
  getLancamento(clinicId: string, id: string): Promise<LancamentoSummary | null>;
  /** C14 — recebíveis cobráveis e vencidos (cross-tenant; regra mora no Financial). */
  listDunningCandidates(limit?: number): Promise<DunningCandidate[]>;
}

export const financialApiV1: FinancialApiV1 = {
  listPendingByPatient: (clinicId, patientId) => listPendingByPatient(clinicId, patientId),
  getLancamento: (clinicId, id) => getLancamento(clinicId, id),
  listDunningCandidates: (limit) => listDunningCandidates(limit),
};
