/**
 * /relatorios — painéis Solo: faturamento · no-show · ocupação (promessa do
 * plano base). Sem lib de gráfico (decisão): KPIs + barras CSS. Leitura
 * tenant-scoped; faturamento exige view:financial (gate no loader). Ocupação usa
 * o slot-resolver canônico (ver data.ts), nunca contagem ingênua.
 */
import Link from 'next/link';

import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { PageHeader } from '@/components/ui/page-header';

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
    <div className="screen">
      <PageHeader
        title="Relatórios"
        description={`Período: ${data.fromLabel} – ${data.toLabel} (fuso da clínica).`}
      />

      <div className="toolbar" style={{ marginBottom: 'var(--sp-4)' }}>
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/relatorios?periodo=${p.key}`}
            className={`badge ${p.key === period.key ? 'blue' : 'gray'}`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Faturamento (gated) */}
        {canFinancial ? (
          <div className="cardblock wrap-pad flex flex-col gap-1">
            <span className="text-sm text-fg-muted">Faturamento (recebido)</span>
            <span className="text-2xl font-semibold">{brl(data.faturamento.recebido)}</span>
            <span className="text-xs text-fg-subtle">
              Pago: {brl(data.faturamento.pago)} · Saldo: {brl(data.faturamento.saldo)}
            </span>
          </div>
        ) : null}

        {/* No-show */}
        <div className="cardblock wrap-pad flex flex-col gap-1">
          <span className="text-sm text-fg-muted">No-show</span>
          <span className="text-2xl font-semibold">{pct(data.noShow.taxa)}</span>
          <span className="text-xs text-fg-subtle">
            {data.noShow.faltou} falta(s) de {data.noShow.atendido + data.noShow.faltou} com desfecho
          </span>
        </div>

        {/* Ocupação */}
        <div className="cardblock wrap-pad flex flex-col gap-2">
          <span className="text-sm text-fg-muted">Ocupação</span>
          <span className="text-2xl font-semibold">{pct(data.ocupacao.taxa)}</span>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-subtle">
            <div
              className="h-full rounded-full bg-primary-600"
              style={{ width: `${Math.round((data.ocupacao.taxa ?? 0) * 100)}%` }}
            />
          </div>
          <span className="text-xs text-fg-subtle">
            {data.ocupacao.taxa == null
              ? 'Sem horários configurados no período.'
              : `${Math.round(data.ocupacao.busyMinutes / 60)}h ocupadas de ${Math.round(
                  (data.ocupacao.busyMinutes + data.ocupacao.freeMinutes) / 60,
                )}h disponíveis`}
          </span>
        </div>
      </div>

      {/* Volume de atendimentos */}
      <div className="cardblock wrap-pad mt-4 flex flex-wrap gap-6">
        <div className="flex flex-col">
          <span className="text-xs text-fg-muted">Total no período</span>
          <span className="text-lg font-semibold">{data.noShow.total}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-fg-muted">Atendidos</span>
          <span className="text-lg font-semibold">{data.noShow.atendido}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-fg-muted">Faltas</span>
          <span className="text-lg font-semibold">{data.noShow.faltou}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-fg-muted">Cancelados</span>
          <span className="text-lg font-semibold">{data.noShow.cancelado}</span>
        </div>
      </div>
    </div>
  );
}
