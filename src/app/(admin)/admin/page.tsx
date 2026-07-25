import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/painel/icons';
import { PageHeader } from '@/components/ui/page-header';

import { Bars, ClinicMark, Donut, Legend } from './_components/charts';
import { StatCard } from './_components/stat-card';
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

// Resiliência (2026-07-25): o pool do `dbAdmin` (max:2) + o Transaction Pooler do
// Supabase às vezes estolam sob latência cross-region, e o `statement_timeout` do
// app NÃO é aplicado pelo pooler nem cobre o role do `dbAdmin` — então uma query
// estolada pendurava a página INTEIRA ("loading infinito"). Cada leitura tem
// timeout + fallback: o dashboard SEMPRE renderiza (com dado parcial no pior caso)
// em vez de pendurar. O timeout registra `admin.dash.timeout` p/ observabilidade.
function withTimeout<T>(name: string, p: Promise<T>, fallback: T, ms = 8000): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.error(JSON.stringify({ kind: 'admin.dash.timeout', name, ms }));
      resolve(fallback);
    }, ms);
    p.then(
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      (e) => {
        clearTimeout(timer);
        console.error(JSON.stringify({ kind: 'admin.dash.err', name, err: String(e).slice(0, 160) }));
        resolve(fallback);
      },
    );
  });
}

export default async function AdminDashboardPage() {
  await guardAdminAccess();
  const [m, trend, breakdown, recent, atRisk] = await Promise.all([
    withTimeout('getDashboard', adminMetricsRepository.getDashboard(), {
      mrrCents: 0,
      arrCents: 0,
      churnRatePct: 0,
      monthlyGrowthPct: 0,
      clinics: { active: 0, atRisk: 0, new: 0, cancelled: 0 },
      generatedAt: new Date().toISOString(),
    }),
    withTimeout('getMrrTrend', adminMetricsRepository.getMrrTrend(6), []),
    withTimeout('getStatusBreakdown', adminMetricsRepository.getStatusBreakdown(), {
      active: 0,
      trial: 0,
      atRisk: 0,
      cancelled: 0,
    }),
    withTimeout('list', clinicRepository.list({ pageSize: 4 }), {
      items: [],
      total: 0,
      page: 1,
      pageSize: 4,
    }),
    withTimeout('listAtRisk', clinicRepository.listAtRisk(4), []),
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
        <StatCard label="MRR" value={formatBRLCents(m.mrrCents)} delta={`ARR ${formatBRLCents(m.arrCents)}`} icon="cash" tone="green" />
        <StatCard label="Clínicas ativas" value={m.clinics.active} hint={`${m.clinics.new} novas no mês`} icon="building" />
        <StatCard label="Em risco" value={m.clinics.atRisk} hint="churn provável" icon="alert" tone="amber" />
        <StatCard label="Churn mensal" value={formatPct(m.churnRatePct)} icon="refresh" tone="teal" />
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
            <p className="muted" style={{ fontSize: 13, padding: 'var(--sp-6) 0', textAlign: 'center' }}>
              Sem faturas pagas no período.
            </p>
          )}
        </div>
        <div className="panel">
          <h4>Distribuição de clínicas</h4>
          {donutSegs.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-6)', marginTop: 'var(--sp-4)' }}>
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
                    <span className="lr-sub" style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-2)' }}>
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
