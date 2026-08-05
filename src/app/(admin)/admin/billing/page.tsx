import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { PanelCard } from '@/components/ui/panel-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { TableToolbar, TableToolbarSpacer } from '@/components/ui/table-toolbar';
import { cn } from '@/lib/ui/cn';

import { Bars, ClinicMark } from '../_components/charts';
import { StatCard } from '../_components/stat-card';
import { guardAdminAccess } from '../_lib/guard';
import { formatBRLCents, formatDate, formatDateTime } from '../_lib/format';
import { billingOverviewRepository } from '../_lib/repositories/billing.repo';
import { adminMetricsRepository } from '../_lib/repositories/metrics.repo';
import type { InvoiceRowDTO } from '../_lib/dto';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  await guardAdminAccess();
  const [o, trend] = await Promise.all([
    billingOverviewRepository.getOverview(),
    adminMetricsRepository.getMrrTrend(6).catch(() => []),
  ]);

  const sum = (rows: InvoiceRowDTO[]) => rows.reduce((s, r) => s + r.amountCents, 0);
  const invoices = [
    ...o.overdue.map((r) => ({ ...r, st: 'Atrasada', tone: 'red' as const })),
    ...o.open.map((r) => ({ ...r, st: 'Aberta', tone: 'amber' as const })),
  ];

  const maxMrr = Math.max(1, ...trend.map((t) => t.cents));
  const bars = trend.map((t, i) => ({
    label: t.label,
    value: Math.round((t.cents / maxMrr) * 100),
    on: i === trend.length - 1,
  }));

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Pagamentos' }]}
        title="Pagamentos"
        description="Faturamento consolidado — recebíveis, inadimplência, dunning e reembolsos."
      />

      <div className="grid grid-cols-2 gap-(--sp-4) lg:grid-cols-3 2xl:grid-cols-5">
        <StatCard
          label="MRR"
          value={formatBRLCents(o.mrrCents)}
          hint={`ARR ${formatBRLCents(o.arrCents)}`}
        />
        <StatCard
          label="A receber"
          value={formatBRLCents(sum(o.open))}
          hint={`${o.open.length} fatura(s)`}
        />
        <StatCard
          label="Em atraso"
          value={formatBRLCents(sum(o.overdue))}
          hint={`${o.overdue.length} fatura(s)`}
        />
        <StatCard label="Dunning ativo" value={o.dunning.length} hint="em cobrança" />
        <StatCard label="Reembolsos" value={o.refunds.length} hint="no período" />
      </div>

      <TableWrap className="mt-(--sp-4)">
        <TableToolbar>
          <h4 className="text-(length:--fs-sm) font-semibold">Faturas recentes</h4>
          <TableToolbarSpacer />
          <span className="text-(length:--fs-xs) text-fg-subtle">
            abertas e em atraso · via Asaas
          </span>
        </TableToolbar>
        {invoices.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">Nenhuma fatura em aberto.</p>
        ) : (
          <TableScroll>
            <Table className="min-w-155">
              <TableHeader>
                <TableRow>
                  <TableHead>Clínica</TableHead>
                  <TableHead numeric>Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" aria-label="Abrir" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="flex items-center gap-2.5 font-medium">
                        <ClinicMark nome={r.clinicNome} />
                        {r.clinicNome}
                      </span>
                    </TableCell>
                    <TableCell numeric>{formatBRLCents(r.amountCents)}</TableCell>
                    <TableCell className="text-fg-muted">{formatDate(r.dueDate)}</TableCell>
                    <TableCell>
                      <Badge tone={r.tone} dot>
                        {r.st}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/clinicas/${r.clinicId}`}
                        aria-label={`Abrir ${r.clinicNome}`}
                        className="grid size-7 place-items-center rounded-(--r-sm) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
                      >
                        <ChevronRight className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </TableWrap>

      <div className="mt-(--sp-4) grid gap-(--sp-4) lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-border px-(--card-pad) py-3">
            <h4 className="text-(length:--fs-sm) font-semibold">Dunning ativo</h4>
            <span className="text-(length:--fs-xs) text-fg-subtle">cobranças em andamento</span>
          </div>
          {o.dunning.length === 0 ? (
            <p className="px-(--card-pad) py-4 text-sm text-fg-subtle">
              Nenhuma clínica em dunning.
            </p>
          ) : (
            <ul className="flex flex-col">
              {o.dunning.map((d) => (
                <li key={d.clinicId}>
                  <Link
                    href={`/admin/clinicas/${d.clinicId}`}
                    className="flex items-center gap-3 border-b border-border px-(--card-pad) py-3 transition-colors last:border-b-0 hover:bg-surface-hover"
                  >
                    <ClinicMark nome={d.nome} tint="var(--warning-500)" />
                    <div className="min-w-0 flex-1">
                      <b className="block text-(length:--fs-sm) font-semibold">{d.nome}</b>
                      <span className="text-(length:--fs-xs) text-fg-subtle">
                        estágio {d.stage} de cobrança
                      </span>
                    </div>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.75 rounded-full',
                        d.stage >= 3
                          ? 'bg-danger-500 shadow-[0_0_0_3px_color-mix(in_oklch,var(--danger-500)_16%,transparent)]'
                          : 'bg-warning-500 shadow-[0_0_0_3px_color-mix(in_oklch,var(--warning-500)_16%,transparent)]',
                      )}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <PanelCard title="Receita · últimos 6 meses">
          {bars.some((b) => b.value > 0) ? (
            <Bars data={bars} />
          ) : (
            <p className="py-(--sp-6) text-center text-(length:--fs-sm) text-fg-subtle">
              Sem faturas pagas no período.
            </p>
          )}
        </PanelCard>
      </div>

      {o.refunds.length > 0 ? (
        <Card className="mt-(--sp-4)">
          <div className="flex items-center justify-between border-b border-border px-(--card-pad) py-3">
            <h4 className="text-(length:--fs-sm) font-semibold">Reembolsos</h4>
            <span className="text-(length:--fs-xs) text-fg-subtle">recentes</span>
          </div>
          <ul className="flex flex-col">
            {o.refunds.map((r, i) => (
              <li key={`${r.clinicId}-${i}`}>
                <Link
                  href={`/admin/clinicas/${r.clinicId}`}
                  className="flex items-center gap-3 border-b border-border px-(--card-pad) py-3 transition-colors last:border-b-0 hover:bg-surface-hover"
                >
                  <ClinicMark nome={r.nome} />
                  <div className="min-w-0 flex-1">
                    <b className="block text-(length:--fs-sm) font-semibold">{r.nome}</b>
                    <span className="text-(length:--fs-xs) text-fg-subtle">
                      {formatDateTime(r.at)}
                    </span>
                  </div>
                  <span className="font-mono font-medium tabular-nums">
                    {formatBRLCents(r.amountCents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
