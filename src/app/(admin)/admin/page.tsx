import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/painel/icons';
import { PageHeader } from '@/components/ui/page-header';

import { Bars, ClinicMark, Donut, Legend } from './_components/charts';
import { StatCard } from './_components/stat-card';
import { withQueryFallback } from '@/lib/db/query-timeout';

import { guardAdminAccess } from './_lib/guard';
import { formatBRLCents, formatDateTime, formatPct } from './_lib/format';
import { adminMetricsRepository } from './_lib/repositories/metrics.repo';
import { clinicRepository } from './_lib/repositories/clinics.repo';

export const dynamic = 'force-dynamic';

const RISK_LABEL: Record<string, string> = {
  suspended_readonly: 'Somente leitura — pagamento pendente',
  suspended: 'Suspensa por inadimplência',
  pending_payment: 'Aguardando pagamento',
};

export default async function AdminDashboardPage() {
  await guardAdminAccess();
  // Visão geral → `withQueryFallback`: se uma leitura estolar, o dashboard renderiza
  // com o card zerado em vez de pendurar (o conserto estrutural é o pool max:8 em
  // db/index.ts; isto é a rede de segurança). Emite `query.timeout` p/ alerta.
  const [m, trend, breakdown, recent, atRisk] = await Promise.all([
    withQueryFallback('admin.getDashboard', adminMetricsRepository.getDashboard(), {
      mrrCents: 0,
      arrCents: 0,
      churnRatePct: 0,
      monthlyGrowthPct: 0,
      clinics: { active: 0, atRisk: 0, new: 0, cancelled: 0 },
      generatedAt: new Date().toISOString(),
    }),
    withQueryFallback('admin.getMrrTrend', adminMetricsRepository.getMrrTrend(6), []),
    withQueryFallback('admin.getStatusBreakdown', adminMetricsRepository.getStatusBreakdown(), {
      active: 0,
      trial: 0,
      atRisk: 0,
      cancelled: 0,
    }),
    withQueryFallback('admin.list', clinicRepository.list({ pageSize: 4 }), {
      items: [],
      total: 0,
      page: 1,
      pageSize: 4,
    }),
    withQueryFallback('admin.listAtRisk', clinicRepository.listAtRisk(4), []),
  ]);

  const maxMrr = Math.max(1, ...trend.map((t) => t.cents));
  const bars = trend.map((t, i) => ({
    label: t.label,
    value: Math.round((t.cents / maxMrr) * 100),
    on: i === trend.length - 1,
  }));
  const donutSegs = [
    { color: 'var(--success-500)', value: breakdown.active, label: 'Ativas' },
    { color: 'var(--primary-500)', value: breakdown.trial, label: 'Trial' },
    { color: 'var(--warning-500)', value: breakdown.atRisk, label: 'Em risco' },
    { color: 'var(--neutral-400)', value: breakdown.cancelled, label: 'Canceladas' },
  ].filter((s) => s.value > 0);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Visão geral' }]}
        title="Visão geral"
        description="Saúde do negócio em uma tela — receita, clientes e risco em tempo real."
        actions={
          <Link href="/admin" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            <Icon name="refresh" size={15} />
            Atualizar
          </Link>
        }
      />

      <div className="stat-row five">
        <StatCard
          label="MRR"
          value={formatBRLCents(m.mrrCents)}
          delta={`ARR ${formatBRLCents(m.arrCents)}`}
          icon="cash"
          tone="green"
        />
        <StatCard
          label="Clínicas ativas"
          value={m.clinics.active}
          hint={`${m.clinics.new} novas no mês`}
          icon="building"
        />
        <StatCard
          label="Em risco"
          value={m.clinics.atRisk}
          hint="churn provável"
          icon="alert"
          tone="amber"
        />
        <StatCard
          label="Churn mensal"
          value={formatPct(m.churnRatePct)}
          icon="refresh"
          tone="teal"
        />
        <StatCard
          label="Crescimento MoM"
          value={formatPct(m.monthlyGrowthPct)}
          delta={m.monthlyGrowthPct >= 0 ? 'líquido positivo' : 'em queda'}
          deltaTone={m.monthlyGrowthPct >= 0 ? 'up' : 'down'}
          icon="chart"
        />
      </div>

      <div className="cols-3-2" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="panel">
          <h4>
            Receita paga · últimos 6 meses <Link href="/admin/billing">Pagamentos</Link>
          </h4>
          {bars.some((b) => b.value > 0) ? (
            <Bars data={bars} />
          ) : (
            <p
              className="muted"
              style={{ fontSize: 13, padding: 'var(--sp-6) 0', textAlign: 'center' }}
            >
              Sem faturas pagas no período.
            </p>
          )}
        </div>
        <div className="panel">
          <h4>Distribuição de clínicas</h4>
          {donutSegs.length > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-6)',
                marginTop: 'var(--sp-4)',
              }}
            >
              <Donut segments={donutSegs} />
              <Legend segments={donutSegs} />
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13, padding: 'var(--sp-6) 0' }}>
              Nenhuma clínica cadastrada.
            </p>
          )}
        </div>
      </div>

      <div className="cols-2" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Novas clínicas</h4>
            <span className="sub">mais recentes</span>
          </div>
          <div className="listrows">
            {recent.items.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-subtle">Nenhuma clínica ainda.</p>
            ) : (
              recent.items.map((c) => (
                <Link key={c.id} href={`/admin/clinicas/${c.id}`} className="listrow">
                  <ClinicMark nome={c.nome} />
                  <div className="lr-main">
                    <b>{c.nome}</b>
                    <span className="lr-sub">/{c.slug}</span>
                  </div>
                  <div className="lr-end">
                    {c.planCode ? <Badge tone="blue">{c.planCode}</Badge> : null}
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      {c.lastActivityAt ? formatDateTime(c.lastActivityAt) : 'sem atividade'}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Clínicas em risco</h4>
            <span className="sub">sinais de churn</span>
          </div>
          <div className="listrows">
            {atRisk.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-subtle">Nenhuma clínica em risco. 🎉</p>
            ) : (
              atRisk.map((c) => (
                <Link key={c.id} href={`/admin/clinicas/${c.id}`} className="listrow">
                  <ClinicMark nome={c.nome} tint="var(--warning-500)" />
                  <div className="lr-main">
                    <b>{c.nome}</b>
                    <span
                      className="lr-sub"
                      style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-2)' }}
                    >
                      {RISK_LABEL[c.status] ?? c.status}
                    </span>
                  </div>
                  <div className="lr-end">
                    <Badge tone="amber">risco</Badge>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
