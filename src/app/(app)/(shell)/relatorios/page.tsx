/**
 * /relatorios — painéis Solo: faturamento · no-show · ocupação (promessa do
 * plano base). Sem lib de gráfico (decisão): KPIs + barras CSS. Leitura
 * tenant-scoped; faturamento exige view:financial (gate no loader). Ocupação usa
 * o slot-resolver canônico (ver data.ts), nunca contagem ingênua.
 */
import { CalendarCheck, FileDown } from 'lucide-react';
import Link from 'next/link';

import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { StackedBar } from '@/components/ui/stacked-bar';
import { SummaryList } from '@/components/ui/summary-list';
import { MetricStrip } from '@/components/ui/metric-strip';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { cn } from '@/lib/ui/cn';

import { getRelatorios, PERIODS, resolvePeriod } from './data';
import styles from './reports.module.css';

export const dynamic = 'force-dynamic';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const user = await requireUser();
  const clinicId = await requireClinicId();
  const { periodo } = await searchParams;
  const period = resolvePeriod(periodo);
  const canFinancial = user.permissions.includes(PERMISSIONS.VIEW_FINANCIAL);

  const data = await getRelatorios(clinicId, period.days, { includeFaturamento: canFinancial });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Gestão' }, { label: 'Relatórios' }]}
        title="Relatórios"
        description={`Período: ${data.fromLabel} – ${data.toLabel} (fuso da clínica).`}
        actions={
          <a
            href={`/relatorios/pdf?periodo=${period.key}`}
            target="_blank"
            rel="noopener"
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm' }),
              'min-h-(--hit-target)',
            )}
          >
            <FileDown aria-hidden="true" className="size-4" />
            Exportar PDF
          </a>
        }
      />

      <nav aria-label="Período do relatório" className="qoro-toolbar">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/relatorios?periodo=${p.key}`}
            aria-current={p.key === period.key ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-(--hit-target) shrink-0 items-center rounded-(--r-sm) px-3 text-(length:--fs-sm) font-medium transition-[background-color,color,box-shadow] duration-(--dur-fast)',
              p.key === period.key
                ? 'bg-surface text-fg shadow-(--elev-raised)'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      <MetricStrip className={styles.metrics ?? ''}>
        {canFinancial ? (
          <StatCard
            emphasis
            label="Faturamento (recebido)"
            value={brl(data.faturamento.recebido)}
            valueTone={data.faturamento.recebido > 0 ? 'positive' : 'default'}
          />
        ) : null}

        <StatCard
          label="No-show"
          value={pct(data.noShow.taxa)}
          hint={`${data.noShow.faltou} falta(s) de ${data.noShow.atendido + data.noShow.faltou} com desfecho`}
        />

        {/* Card montado à mão porque a barra de ocupação não cabe no StatCard —
            mas rótulo, valor e nota seguem os mesmos degraus de tipografia, para
            não destoar dos vizinhos da fileira. */}
        <Card data-slot="stat-card" className="flex flex-col gap-2.5 p-(--card-pad)">
          <span className="text-(length:--fs-xs) font-medium text-fg-muted">Ocupação</span>
          <span
            data-slot="stat-value"
            className="text-(length:--fs-h2) leading-none font-semibold tracking-(--tracking-tight) tabular-nums"
          >
            {pct(data.ocupacao.taxa)}
          </span>
          <div className="h-2 w-full overflow-hidden rounded-full bg-viz-track">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-(--dur-slower) ease-out"
              style={{ width: `${Math.round((data.ocupacao.taxa ?? 0) * 100)}%` }}
            />
          </div>
          <span className="text-(length:--fs-xs) text-fg-subtle">
            {data.ocupacao.taxa == null
              ? 'Sem horários configurados no período.'
              : `${Math.round(data.ocupacao.busyMinutes / 60)}h ocupadas de ${Math.round(
                  (data.ocupacao.busyMinutes + data.ocupacao.freeMinutes) / 60,
                )}h disponíveis`}
          </span>
        </Card>
      </MetricStrip>

      {/* Recebido, pago e saldo estavam concatenados num `hint` de uma linha só,
          o que obrigava a ler três valores monetários numa frase e impedia
          alinhar as casas decimais. */}
      <div className={styles.panels ?? ''}>
        {canFinancial ? (
          <PanelCard
            title="Resultado do período"
            regionLabel="Resultado do período"
            className="mt-(--sp-4)"
          >
            <SummaryList
              rows={[
                { label: 'Recebido', value: brl(data.faturamento.recebido) },
                { label: 'Pago', value: brl(data.faturamento.pago) },
                {
                  label: 'Saldo',
                  value: brl(data.faturamento.saldo),
                  emphasis: true,
                  tone: data.faturamento.saldo >= 0 ? 'positive' : 'negative',
                },
              ]}
            />
          </PanelCard>
        ) : null}

        {/* Volume de atendimentos — os três desfechos são partes do total, então
          a barra empilhada responde "quanto de cada" numa olhada. A grade de
          quatro números exigia dividir de cabeça para chegar na proporção, que
          é a única coisa acionável aqui. */}
        <PanelCard
          title="Volume de atendimentos"
          regionLabel="Volume de atendimentos"
          meta={`${data.noShow.total} no período`}
          className="mt-(--sp-4)"
        >
          {data.noShow.total === 0 ? (
            <EmptyState
              variant="compact"
              icon={<CalendarCheck />}
              title="Nenhum atendimento com desfecho"
              description="Atendidos, faltas e cancelamentos aparecem aqui quando houver movimento no período."
            />
          ) : (
            <StackedBar
              segments={[
                { label: 'Atendidos', value: data.noShow.atendido, amount: data.noShow.atendido },
                { label: 'Faltas', value: data.noShow.faltou, amount: data.noShow.faltou },
                {
                  label: 'Cancelados',
                  value: data.noShow.cancelado,
                  amount: data.noShow.cancelado,
                },
              ]}
            />
          )}
        </PanelCard>
      </div>
    </>
  );
}
