import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricStrip } from '@/components/ui/metric-strip';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { withQueryDeadline } from '@/lib/db/query-timeout';

import { Bars, ClinicMark, Donut, Legend } from './_components/charts';
import { guardAdminAccess } from './_lib/guard';
import { formatBRLCents, formatDateTime, formatPct } from './_lib/format';
import { clinicRepository } from './_lib/repositories/clinics.repo';
import { adminMetricsRepository } from './_lib/repositories/metrics.repo';

export const dynamic = 'force-dynamic';

const RISK_LABEL: Record<string, string> = {
  suspended_readonly: 'Somente leitura — pagamento pendente',
  suspended: 'Suspensa por inadimplência',
  pending_payment: 'Aguardando pagamento',
};
const SIGNUP_STATUS_LABEL: Record<string, string> = {
  details_complete: 'Perfil respondido',
  identity_pending: 'Dados da conta',
  email_pending: 'Aguardando e-mail',
  email_verified: 'E-mail confirmado',
};
const PROFESSIONALS_LABEL: Record<string, string> = {
  '1': '1 profissional',
  '2_5': '2 a 5 profissionais',
  '6_15': '6 a 15 profissionais',
  '16_plus': '16 ou mais profissionais',
};
const APPOINTMENTS_LABEL: Record<string, string> = {
  ate_20: 'Até 20 por semana',
  '21_50': '21 a 50 por semana',
  '51_100': '51 a 100 por semana',
  '100_plus': 'Mais de 100 por semana',
};
const TOOLING_LABEL: Record<string, string> = {
  nada_papel: 'Nada ou papel',
  agenda_generica: 'Agenda genérica',
  outro_sistema: 'Outro sistema',
};
const DISCOVERY_LABEL: Record<string, string> = {
  busca_google: 'Busca no Google',
  indicacao_colega: 'Indicação de colega',
  redes_sociais: 'Redes sociais',
  grupo_comunidade: 'Grupo ou comunidade',
  evento: 'Evento ou congresso',
  outro: 'Outro',
};

export default async function AdminDashboardPage() {
  await guardAdminAccess();
  // O overview precisa distinguir zero real de leitura indisponível. Cada consulta
  // tem deadline para não pendurar; timeout/erro sobe ao error boundary da rota,
  // que registra a falha e oferece retry sem exibir KPIs ou listas enganosos.
  const [m, trend, breakdown, recent, atRisk, signupIntakes] = await Promise.all([
    withQueryDeadline('admin.getDashboard', adminMetricsRepository.getDashboard()),
    withQueryDeadline('admin.getMrrTrend', adminMetricsRepository.getMrrTrend(6)),
    withQueryDeadline('admin.getStatusBreakdown', adminMetricsRepository.getStatusBreakdown()),
    withQueryDeadline('admin.list', clinicRepository.list({ pageSize: 4 })),
    withQueryDeadline('admin.listAtRisk', clinicRepository.listAtRisk(4)),
    withQueryDeadline('admin.listSignupIntakes', clinicRepository.listSignupIntakes(8)),
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
    <>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Visão geral' }]}
        title="Visão geral"
        description="Saúde do negócio em uma tela — receita, clientes e risco em tempo real."
      />

      <MetricStrip>
        <StatCard
          label="MRR"
          value={formatBRLCents(m.mrrCents)}
          hint={`ARR ${formatBRLCents(m.arrCents)}`}
        />
        <StatCard
          label="Clínicas ativas"
          value={m.clinics.active}
          hint={`${m.clinics.new} novas no mês`}
        />
        <StatCard label="Em risco" value={m.clinics.atRisk} hint="churn provável" />
        <StatCard label="Churn mensal" value={formatPct(m.churnRatePct)} />
        <StatCard
          label="Crescimento MoM"
          value={formatPct(m.monthlyGrowthPct)}
          delta={{
            direction: m.monthlyGrowthPct >= 0 ? 'up' : 'down',
            tone: m.monthlyGrowthPct >= 0 ? 'positive' : 'negative',
            label: m.monthlyGrowthPct >= 0 ? 'líquido positivo' : 'em queda',
          }}
        />
      </MetricStrip>

      <div className="mt-(--sp-4) grid gap-(--sp-4) xl:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
        <Card role="region" aria-labelledby="admin-revenue-title" className="min-w-0">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle id="admin-revenue-title">Receita paga</CardTitle>
              <CardDescription>Últimos 6 meses</CardDescription>
            </div>
            <Link
              href="/admin/billing"
              className={buttonVariants({
                variant: 'ghost',
                size: 'sm',
                className: 'min-h-(--hit-target) shrink-0',
              })}
            >
              Pagamentos
            </Link>
          </CardHeader>
          <CardContent className="pt-(--sp-4)">
            {bars.some((b) => b.value > 0) ? (
              <Bars data={bars} />
            ) : (
              <EmptyState
                variant="compact"
                title="Sem faturas pagas no período."
                description="A série será exibida quando houver receita confirmada."
              />
            )}
          </CardContent>
        </Card>

        <Card role="region" aria-labelledby="admin-distribution-title" className="min-w-0">
          <CardHeader>
            <CardTitle id="admin-distribution-title">Distribuição de clínicas</CardTitle>
            <CardDescription>Participação por situação operacional</CardDescription>
          </CardHeader>
          <CardContent className="pt-(--sp-4)">
            {donutSegs.length > 0 ? (
              <div className="flex min-h-40 flex-wrap items-center justify-center gap-(--sp-6) sm:flex-nowrap">
                <Donut segments={donutSegs} />
                <Legend segments={donutSegs} />
              </div>
            ) : (
              <EmptyState
                variant="compact"
                title="Nenhuma clínica cadastrada."
                description="A distribuição aparecerá após o primeiro cadastro."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-(--sp-4) grid gap-(--sp-4) xl:grid-cols-2">
        <Card role="region" aria-labelledby="admin-recent-title" className="min-w-0">
          <CardHeader>
            <CardTitle id="admin-recent-title">Novas clínicas</CardTitle>
            <CardDescription>Cadastros mais recentes</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pt-(--sp-3)">
            {recent.items.length === 0 ? (
              <EmptyState
                variant="compact"
                className="border-t border-border"
                title="Nenhuma clínica ainda."
                description="Os novos cadastros aparecerão nesta fila."
              />
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {recent.items.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/clinicas/${c.id}`}
                      className="flex min-h-(--hit-target) items-center gap-3 px-(--card-pad) py-2.5 transition-colors duration-(--dur-fast) hover:bg-surface-hover focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                    >
                      <ClinicMark nome={c.nome} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-(length:--fs-sm) font-medium">
                          {c.nome}
                        </span>
                        <span className="block truncate text-(length:--fs-xs) text-fg-muted">
                          /{c.slug}
                        </span>
                      </span>
                      <span className="ml-auto flex shrink-0 flex-col items-end gap-1 text-right">
                        {c.planCode ? <Badge tone="blue">{c.planCode}</Badge> : null}
                        <span className="font-mono text-(length:--fs-2xs) text-fg-subtle tabular-nums">
                          {c.lastActivityAt ? formatDateTime(c.lastActivityAt) : 'sem atividade'}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card role="region" aria-labelledby="admin-risk-title" className="min-w-0">
          <CardHeader>
            <CardTitle id="admin-risk-title">Clínicas em risco</CardTitle>
            <CardDescription>Sinais de churn que pedem atenção</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pt-(--sp-3)">
            {atRisk.length === 0 ? (
              <EmptyState
                variant="compact"
                className="border-t border-border"
                title="Nenhuma clínica em risco."
                description="Não há sinais de churn entre as clínicas monitoradas."
              />
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {atRisk.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/clinicas/${c.id}`}
                      className="flex min-h-(--hit-target) items-center gap-3 px-(--card-pad) py-2.5 transition-colors duration-(--dur-fast) hover:bg-surface-hover focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                    >
                      <ClinicMark nome={c.nome} tint="var(--warning-500)" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-(length:--fs-sm) font-medium">
                          {c.nome}
                        </span>
                        <span className="block truncate text-(length:--fs-xs) text-fg-muted">
                          {RISK_LABEL[c.status] ?? c.status}
                        </span>
                      </span>
                      <Badge tone="amber">risco</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card role="region" aria-labelledby="admin-signup-intakes-title" className="mt-(--sp-4)">
        <CardHeader>
          <CardTitle id="admin-signup-intakes-title">Cadastros autônomos em andamento</CardTitle>
          <CardDescription>
            Perfil declarado antes da ativação da clínica, limitado aos cadastros ainda válidos.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-(--sp-3)">
          {signupIntakes.length === 0 ? (
            <EmptyState
              variant="compact"
              className="border-t border-border"
              title="Nenhum cadastro autônomo em andamento."
              description="As respostas aparecerão aqui depois que o perfil da clínica for concluído."
            />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {signupIntakes.map((signup) => (
                <li key={signup.id} className="px-(--card-pad) py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-(length:--fs-sm) font-semibold text-fg">
                        {signup.clinicName ?? 'Clínica ainda não informada'}
                      </p>
                      <p className="mt-0.5 text-(length:--fs-xs) text-fg-muted">
                        atualizado em {formatDateTime(signup.updatedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {signup.planCode ? <Badge tone="blue">{signup.planCode}</Badge> : null}
                      <Badge tone={signup.status === 'email_verified' ? 'green' : 'amber'}>
                        {SIGNUP_STATUS_LABEL[signup.status] ?? signup.status}
                      </Badge>
                    </div>
                  </div>
                  <dl className="mt-3 grid gap-3 text-(length:--fs-xs) sm:grid-cols-2 xl:grid-cols-4">
                    <SignupAnswer
                      label="Profissionais"
                      value={
                        PROFESSIONALS_LABEL[signup.professionalsBand] ?? signup.professionalsBand
                      }
                    />
                    <SignupAnswer
                      label="Atendimentos"
                      value={
                        APPOINTMENTS_LABEL[signup.weeklyAppointmentsBand] ??
                        signup.weeklyAppointmentsBand
                      }
                    />
                    <SignupAnswer
                      label="Organização atual"
                      value={TOOLING_LABEL[signup.currentTooling] ?? signup.currentTooling}
                    />
                    <SignupAnswer
                      label="Origem"
                      value={DISCOVERY_LABEL[signup.discoverySource] ?? signup.discoverySource}
                    />
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function SignupAnswer({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-fg">{value}</dd>
    </div>
  );
}
