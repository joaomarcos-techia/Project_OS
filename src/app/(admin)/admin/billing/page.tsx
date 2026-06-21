import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/painel/icons';
import { PageHeader } from '@/components/ui/page-header';

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
  const bars = trend.map((t, i) => ({ label: t.label, value: Math.round((t.cents / maxMrr) * 100), on: i === trend.length - 1 }));

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Operação <span className="sep">›</span> <b>Pagamentos</b>
          </>
        }
        title="Pagamentos"
        description="Faturamento consolidado — recebíveis, inadimplência, dunning e reembolsos."
      />

      <div className="stat-row five">
        <StatCard label="MRR" value={formatBRLCents(o.mrrCents)} delta={`ARR ${formatBRLCents(o.arrCents)}`} icon="cash" tone="green" />
        <StatCard label="A receber" value={formatBRLCents(sum(o.open))} hint={`${o.open.length} fatura(s)`} icon="clock" />
        <StatCard label="Em atraso" value={formatBRLCents(sum(o.overdue))} hint={`${o.overdue.length} fatura(s)`} icon="alert" tone="red" />
        <StatCard label="Dunning ativo" value={o.dunning.length} hint="em cobrança" icon="refresh" tone="amber" />
        <StatCard label="Reembolsos" value={o.refunds.length} hint="no período" icon="wallet" tone="teal" />
      </div>

      <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock-head">
          <h4>Faturas recentes</h4>
          <span className="sub">abertas e em atraso · via Asaas</span>
        </div>
        {invoices.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">Nenhuma fatura em aberto.</p>
        ) : (
          <div className="table-wrap">
            <table className="ui-table" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                  <th>Vencimento</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="td-name">
                        <ClinicMark nome={r.clinicNome} />
                        <b style={{ fontWeight: 600 }}>{r.clinicNome}</b>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatBRLCents(r.amountCents)}</td>
                    <td className="td-sub">{formatDate(r.dueDate)}</td>
                    <td>
                      <Badge tone={r.tone}>{r.st}</Badge>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link href={`/admin/clinicas/${r.clinicId}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                        <Icon name="chevR" size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cols-2" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock">
          <div className="cardblock-head">
            <h4>Dunning ativo</h4>
            <span className="sub">cobranças em andamento</span>
          </div>
          {o.dunning.length === 0 ? (
            <p className="px-5 py-4 text-sm text-fg-subtle">Nenhuma clínica em dunning.</p>
          ) : (
            <div className="listrows">
              {o.dunning.map((d) => (
                <Link key={d.clinicId} href={`/admin/clinicas/${d.clinicId}`} className="listrow">
                  <ClinicMark nome={d.nome} tint="var(--warning-500)" />
                  <div className="lr-main">
                    <b>{d.nome}</b>
                    <span className="lr-sub">estágio {d.stage} de cobrança</span>
                  </div>
                  <div className="lr-end">
                    <span className={`hc-dot ${d.stage >= 3 ? 'red' : 'amber'}`} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <h4>Receita · últimos 6 meses</h4>
          {bars.some((b) => b.value > 0) ? (
            <Bars data={bars} />
          ) : (
            <p className="muted" style={{ fontSize: 13, padding: 'var(--sp-6) 0', textAlign: 'center' }}>
              Sem faturas pagas no período.
            </p>
          )}
        </div>
      </div>

      {o.refunds.length > 0 ? (
        <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
          <div className="cardblock-head">
            <h4>Reembolsos</h4>
            <span className="sub">recentes</span>
          </div>
          <div className="listrows">
            {o.refunds.map((r, i) => (
              <Link key={`${r.clinicId}-${i}`} href={`/admin/clinicas/${r.clinicId}`} className="listrow">
                <ClinicMark nome={r.nome} />
                <div className="lr-main">
                  <b>{r.nome}</b>
                  <span className="lr-sub">{formatDateTime(r.at)}</span>
                </div>
                <div className="lr-end">
                  <span className="font-medium tabular-nums">{formatBRLCents(r.amountCents)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
