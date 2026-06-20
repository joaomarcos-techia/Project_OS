import { PageHeader } from '@/components/ui/page-header';

import { StatCard } from '../_components/stat-card';
import { guardAdminAccess } from '../_lib/guard';
import { formatNumber, formatUSD } from '../_lib/format';
import { adminMetricsRepository } from '../_lib/repositories/metrics.repo';

export const dynamic = 'force-dynamic';

export default async function MetricasPage() {
  await guardAdminAccess();
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const u = await adminMetricsRepository.getUsage({
    from: from.toISOString(),
    to: to.toISOString(),
  });

  return (
    <>
      <PageHeader title="Métricas" description="Uso da plataforma nos últimos 30 dias." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="DAU" value={formatNumber(u.dau)} hint="usuários ativos hoje" />
        <StatCard label="WAU" value={formatNumber(u.wau)} hint="últimos 7 dias" />
        <StatCard label="Clínicas ativas" value={formatNumber(u.activeClinics)} hint="com atividade no período" />
        <StatCard label="Conversas IA" value={formatNumber(u.aiConversations)} />
        <StatCard label="Mensagens IA" value={formatNumber(u.aiMessages)} />
        <StatCard label="Tokens" value={formatNumber(u.aiTokens)} />
        <StatCard label="Custo Gemini" value={formatUSD(u.geminiCostUsd)} />
        <StatCard label="Média diária" value={formatNumber(u.dailyAvgMessages)} hint="mensagens/dia" />
      </div>
    </>
  );
}
