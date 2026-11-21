import { NextResponse } from 'next/server';

import { getShellIdentity } from '@/components/painel/shell-identity';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { assertPdfExportAllowed } from '@/lib/auth/rate-limit';
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

  // B6: o render é caro (yoga/WASM) e não tinha teto — um usuário autenticado
  // degradava a instância pedindo PDFs em sequência.
  const rl = await assertPdfExportAllowed(clinicId, user.userId);
  if (!rl.ok) {
    return new NextResponse('Muitos exports em pouco tempo. Aguarde alguns minutos.', {
      status: 429,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const url = new URL(request.url);
  const period = resolvePeriod(url.searchParams.get('periodo') ?? undefined);
  const periodLabel = PERIODS.find((p) => p.key === period.key)?.label ?? period.key;
  const canFinancial = user.permissions.includes(PERMISSIONS.VIEW_FINANCIAL);

  const [data, porProfissional, identity, timeZone] = await Promise.all([
    getRelatorios(clinicId, period.days, { includeFaturamento: canFinancial }),
    getConsolidadoPorProfissional(clinicId, period.days, { includeFaturamento: canFinancial }),
    getShellIdentity(),
    getClinicTimezone(clinicId),
  ]);

  const pdf = await renderRelatorioPDF({
    clinicName: identity.clinicName,
    periodLabel,
    fromLabel: data.fromLabel,
    toLabel: data.toLabel,
    generatedAt: new Date().toLocaleString('pt-BR', { timeZone }),
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
