/**
 * /relatorios — painéis Solo: faturamento · no-show · ocupação (promessa do
 * plano base). Sem lib de gráfico (decisão): KPIs + barras CSS. Leitura
 * tenant-scoped; faturamento exige view:financial (gate no loader). Ocupação usa
 * o slot-resolver canônico (ver data.ts), nunca contagem ingênua.
 */
import Link from 'next/link';

import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { cn } from '@/lib/ui/cn';

import { getRelatorios, PERIODS, resolvePeriod } from './data';

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
          <nav
            aria-label="Período"
            className="inline-flex gap-0.5 rounded-(--r-md) border border-border bg-surface-inset p-[3px]"
          >
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={`/relatorios?periodo=${p.key}`}
                aria-current={p.key === period.key ? 'page' : undefined}
                className={cn(
                  'rounded-(--r-sm) px-3 py-1.5 text-(length:--fs-sm) font-medium transition-all duration-(--dur-fast)',
                  p.key === period.key
                    ? 'bg-surface text-fg shadow-(--elev-raised)'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        }
      />

      <div className="grid gap-(--sp-4) sm:grid-cols-2 xl:grid-cols-3">
        {canFinancial ? (
          <StatCard
            label="Faturamento (recebido)"
            value={brl(data.faturamento.recebido)}
            hint={`Pago: ${brl(data.faturamento.pago)} · Saldo: ${brl(data.faturamento.saldo)}`}
          />
        ) : null}

        <StatCard
          label="No-show"
          value={pct(data.noShow.taxa)}
          hint={`${data.noShow.faltou} falta(s) de ${data.noShow.atendido + data.noShow.faltou} com desfecho`}
        />

        <Card className="flex flex-col gap-2.5 p-(--card-pad)">
          <span className="font-mono text-(length:--fs-2xs) font-medium tracking-(--tracking-label) text-fg-subtle uppercase">
            Ocupação
          </span>
          <span className="font-display text-[34px] leading-none font-medium tracking-tight">
            {pct(data.ocupacao.taxa)}
          </span>
          <div className="h-1.75 w-full overflow-hidden rounded-full bg-viz-track">
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
      </div>

      {/* Volume de atendimentos */}
      <Card className="mt-(--sp-4) flex flex-wrap gap-8 p-(--card-pad)">
        {(
          [
            ['Total no período', data.noShow.total],
            ['Atendidos', data.noShow.atendido],
            ['Faltas', data.noShow.faltou],
            ['Cancelados', data.noShow.cancelado],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="font-mono text-(length:--fs-2xs) tracking-(--tracking-label) text-fg-subtle uppercase">
              {label}
            </span>
            <span className="font-display text-xl font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
