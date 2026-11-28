/**
 * P9.10 — relatório por operadora e período (superfície pública, só servidor). Quem chama já passou
 * pelo portão de "ver valores do faturamento" (`CONVENIOS_RULES.seeValues`); aqui a leitura roda sob
 * a RLS da clínica da sessão e a exportação grava trilha na mesma transação.
 */
import 'server-only';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { withTenant } from '@/lib/db/tenant';

import {
  buildInsurerReportTx,
  type InsurerReport,
  type ReportFilterInput,
  reportCsv,
} from './internal/insurer-report';

export {
  InsurerReportError,
  OVERDUE_AFTER_DAYS,
  REPORT_MAX_DAYS,
  REPORT_MAX_ROWS,
  type InsurerReport,
  type InsurerTotals,
  type ReportFilterInput,
} from './internal/insurer-report';

export async function getInsurerReport(clinicId: string, userId: string, input: ReportFilterInput): Promise<InsurerReport> {
  return withTenant(clinicId, (tx) => buildInsurerReportTx(tx, clinicId, input), userId);
}

/** CSV do relatório; a exportação fica na trilha da clínica (filtro e quantidade de linhas, sem valores). */
export async function exportInsurerReportCsv(
  clinicId: string,
  userId: string,
  input: ReportFilterInput,
  requestContext: RequestContext,
): Promise<{ csv: string; rows: number; fileName: string }> {
  return withTenant(
    clinicId,
    async (tx) => {
      const report = await buildInsurerReportTx(tx, clinicId, input);
      await logAudit(tx, {
        clinicId,
        userId,
        action: 'health_insurance.report.exported',
        resourceType: 'hi_insurer_report',
        resourceId: null,
        before: null,
        after: { ...report.filter, rows: report.lines.length, format: 'csv' },
        requestContext,
      });
      return {
        csv: reportCsv(report),
        rows: report.lines.length,
        fileName: `relatorio-convenios-${report.filter.from}-a-${report.filter.to}.csv`,
      };
    },
    userId,
  );
}
