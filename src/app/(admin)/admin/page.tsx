import { PageHeader } from '@/components/ui/page-header';

import { StatCard } from './_components/stat-card';
import { guardAdminAccess } from './_lib/guard';
import { formatBRLCents, formatDateTime, formatNumber, formatPct } from './_lib/format';
import { adminMetricsRepository } from './_lib/repositories/metrics.repo';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  await guardAdminAccess();
  const m = await adminMetricsRepository.getDashboard();

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Métricas globais da plataforma em tempo real."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="MRR (mês atual)" value={formatBRLCents(m.mrrCents)} hint="SUM(faturas pagas)" />
        <StatCard label="ARR" value={formatBRLCents(m.arrCents)} hint="MRR × 12" />
        <StatCard label="Churn (mês)" value={formatPct(m.churnRatePct)} />
        <StatCard label="Crescimento mensal" value={formatPct(m.monthlyGrowthPct)} hint="novas clínicas vs mês anterior" />
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-fg-muted">Clínicas</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ativas" value={formatNumber(m.clinics.active)} />
        <StatCard label="Em risco" value={formatNumber(m.clinics.atRisk)} hint="suspensas / aguardando pagamento" />
        <StatCard label="Novas (mês)" value={formatNumber(m.clinics.new)} />
        <StatCard label="Canceladas" value={formatNumber(m.clinics.cancelled)} />
      </div>

      <p className="mt-6 text-xs text-fg-subtle">Gerado em {formatDateTime(m.generatedAt)}</p>
    </>
  );
}
