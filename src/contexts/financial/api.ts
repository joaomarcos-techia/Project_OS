/**
 * Financial internal API (C12) — superfície versionada (M14) para o AI Agent.
 * NÃO HTTP. SOMENTE LEITURA: a IA nunca cria/edita/gera cobrança (par.12 —
 * proibido). Thin wrapper sobre a query; sem lógica de negócio (REGRA 3).
 */
import { listPendingByPatient } from './queries';
import type { LancamentoSummary } from './types';

export interface FinancialApiV1 {
  listPendingByPatient(clinicId: string, patientId: string): Promise<LancamentoSummary[]>;
}

export const financialApiV1: FinancialApiV1 = {
  listPendingByPatient: (clinicId, patientId) => listPendingByPatient(clinicId, patientId),
};
