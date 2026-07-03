import { NextResponse } from 'next/server';

import { getShellIdentity } from '@/components/painel/shell-identity';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { renderRelatorioPDF } from '@/lib/pdf/relatorio';

import { getConsolidadoPorProfissional, getRelatorios, PERIODS, resolvePeriod } from '../data';

// PDF é pesado (yoga/WASM) — Node runtime, nunca Edge; sempre fresco.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /relatorios/pdf?periodo=7d|30d|90d — exporta os Relatórios em PDF
 * (mesmos números da tela; colunas financeiras só com view:financial).
 */
export async function GET(request: Request): Promise<Response> {
  const user = await requireUser();
  const clinicId = await requireClinicId();

  const url = new URL(request.url);
  const period = resolvePeriod(url.searchParams.get('periodo') ?? undefined);
  const periodLabel = PERIODS.find((p) => p.key === period.key)?.label ?? period.key;
  const canFinancial = user.permissions.includes(PERMISSIONS.VIEW_FINANCIAL);

  const [data, porProfissional, identity] = await Promise.all([
    getRelatorios(clinicId, period.days, { includeFaturamento: canFinancial }),
    getConsolidadoPorProfissional(clinicId, period.days, { includeFaturamento: canFinancial }),
    getShellIdentity(),
  ]);

  const pdf = await renderRelatorioPDF({
    clinicName: identity.clinicName,
    periodLabel,
    fromLabel: data.fromLabel,
    toLabel: data.toLabel,
    generatedAt: new Date().toLocaleString('pt-BR'),
    includeFaturamento: canFinancial,
    kpis: {
      faturamento: canFinancial ? data.faturamento : null,
      noShow: data.noShow,
      ocupacao: data.ocupacao,
    },
    porProfissional,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="relatorios-${period.key}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
