import { NextResponse } from 'next/server';

import {
  ACCOUNTING_EXPORT_MAX_ROWS,
  AccountingExportError,
  accountingMonthRange,
  assertAccountingRowLimit,
  renderAccountingCsv,
} from '@/contexts/financial/accounting-export';
import { listAccountingMovements } from '@/contexts/financial/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { logAudit } from '@/lib/audit/log';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { assertPdfExportAllowed } from '@/lib/auth/rate-limit';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const textHeaders = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Export operacional, não fiscal, do ledger da própria clínica. O tenant vem
 * exclusivamente da sessão e a permissão é revalidada no banco porque se trata
 * de extração financeira em massa.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.VIEW_FINANCIAL);
  const clinicId = await requireClinicId();

  // Compartilha o orçamento dos exports de relatório já existente. O nome do
  // helper é histórico (PDF), mas seus baldes são por usuário e por clínica.
  const rateLimit = await assertPdfExportAllowed(clinicId, user.userId);
  if (!rateLimit.ok) {
    return new NextResponse('Muitos exports em pouco tempo. Aguarde alguns minutos.', {
      status: 429,
      headers: textHeaders,
    });
  }

  try {
    const url = new URL(request.url);
    const timeZone = await getClinicTimezone(clinicId);
    const range = accountingMonthRange(url.searchParams.get('mes'), timeZone);
    const movements = await listAccountingMovements(
      clinicId,
      range.from,
      range.to,
      ACCOUNTING_EXPORT_MAX_ROWS + 1,
    );
    assertAccountingRowLimit(movements.length);

    const csv = renderAccountingCsv(movements, timeZone);
    const context = await requestContext();
    await withTenant(clinicId, (tx) =>
      logAudit(tx, {
        clinicId,
        userId: user.userId,
        action: 'financial.accounting_export.generated',
        resourceType: 'payment_transactions',
        resourceId: null,
        before: null,
        // Somente metadados; o conteúdo financeiro do arquivo não vai ao log.
        after: {
          month: range.month,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          rowCount: movements.length,
        },
        requestContext: context,
      }),
    );

    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="movimentacao-financeira-${range.month}.csv"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AccountingExportError) {
      return new NextResponse(error.message, { status: error.httpStatus, headers: textHeaders });
    }
    throw error;
  }
}
