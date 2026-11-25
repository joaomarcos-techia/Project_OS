import type { Metadata } from 'next';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PanelCard } from '@/components/ui/panel-card';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { listInsurers } from '@/contexts/health-insurance/queries';
import {
  getInsurerReport,
  InsurerReportError,
  OVERDUE_AFTER_DAYS,
  REPORT_MAX_DAYS,
  type InsurerReport,
  type InsurerTotals,
} from '@/contexts/health-insurance/reports';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../_lib/access';

export const metadata: Metadata = { title: 'Relatórios de convênios' };

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/u;
const UUID = /^[0-9a-f-]{36}$/u;

function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 89 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const pct = (bps: number | null) => (bps === null ? '—' : `${(bps / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const days = (d: number | null) => (d === null ? '—' : d.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));

function TotalsRow({ t, label, strong = false }: { t: Omit<InsurerTotals, 'insurerId' | 'insurerName'>; label: string; strong?: boolean }) {
  const cls = strong ? 'font-semibold' : undefined;
  return (
    <TableRow>
      <TableCell className={cls}>{label}</TableCell>
      <TableCell className="text-right tabular-nums">{t.guides}</TableCell>
      <TableCell className="text-right tabular-nums">{brl(t.billedCents)}</TableCell>
      <TableCell className="text-right tabular-nums">{brl(t.paidCents)}</TableCell>
      <TableCell className="text-right tabular-nums">{brl(t.glossOpenCents)}</TableCell>
      <TableCell className="text-right tabular-nums">{brl(t.glossDefinitiveCents)}</TableCell>
      <TableCell className="text-right tabular-nums">{brl(t.pendingCents)}</TableCell>
      <TableCell className="text-right tabular-nums">{pct(t.glossRateBps)}</TableCell>
      <TableCell className="text-right tabular-nums">{days(t.averageDaysToPay)}</TableCell>
      <TableCell className="text-right tabular-nums">{brl(t.overdueCents)}</TableCell>
    </TableRow>
  );
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; insurerId?: string }>;
}) {
  // Valores do faturamento (matriz 4.3): sem a visão de valores, a página nem consulta.
  const access = await conveniosAccess('Relatórios', 'seeValues');
  if (!access.ok) return access.view;
  const sp = await searchParams;
  const base = defaultPeriod();
  const from = sp.from && YMD.test(sp.from) ? sp.from : base.from;
  const to = sp.to && YMD.test(sp.to) ? sp.to : base.to;
  const insurerId = sp.insurerId && UUID.test(sp.insurerId) ? sp.insurerId : null;
  const insurers = await listInsurers(access.clinicId);
  let report: InsurerReport | null = null;
  let error: string | null = null;
  try {
    report = await getInsurerReport(access.clinicId, access.userId, { from, to, insurerId });
  } catch (e) {
    if (!(e instanceof InsurerReportError)) throw e;
    error = e.message;
  }
  const csvHref = `/financeiro/convenios/relatorios/csv?${new URLSearchParams({ from, to, ...(insurerId ? { insurerId } : {}) }).toString()}`;

  return (
    <>
      <ConveniosHeader
        commercial={access.commercial}
        title="Relatórios"
        description="Faturamento, glosa, prazo de recebimento e pendências por operadora, pela data de envio do lote. Os números saem da conta de cada guia, a mesma do financeiro da clínica."
        crumbs={[{ label: 'Relatórios' }]}
      />
      <PanelCard title="Período e operadora" regionLabel="Filtros do relatório" className="mb-(--sp-4)">
        <form method="get" className="flex flex-wrap items-end gap-(--sp-3)">
          <Field label="Enviadas de" htmlFor="rel-from">
            <Input id="rel-from" name="from" type="date" defaultValue={from} />
          </Field>
          <Field label="até" htmlFor="rel-to">
            <Input id="rel-to" name="to" type="date" defaultValue={to} />
          </Field>
          <Field label="Operadora" htmlFor="rel-ins">
            <Select id="rel-ins" name="insurerId" defaultValue={insurerId ?? ''}>
              <option value="">Todas</option>
              {insurers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" size="sm" variant="primary">
            Aplicar
          </Button>
          {report && report.lines.length > 0 ? (
            <a href={csvHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Exportar CSV
            </a>
          ) : null}
        </form>
        <p className="mt-(--sp-2) text-(length:--fs-xs) text-fg-muted">
          Período de até {REPORT_MAX_DAYS} dias. Sem prazo de pagamento cadastrado por operadora, &quot;em atraso&quot; é o pendente
          com mais de {OVERDUE_AFTER_DAYS} dias do envio.
        </p>
      </PanelCard>

      {error ? (
        <Alert variant="warning" title="Não foi possível montar o relatório">
          {error}
        </Alert>
      ) : report && report.lines.length === 0 ? (
        <EmptyState
          title="Nenhuma guia enviada no período"
          description={`Nada enviado à operadora entre ${shortDate(report.filter.from)} e ${shortDate(report.filter.to)}.`}
        />
      ) : report ? (
        <>
          <PanelCard title="Resumo por operadora" regionLabel="Resumo por operadora">
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operadora</TableHead>
                    <TableHead className="text-right">Guias</TableHead>
                    <TableHead className="text-right">Faturado</TableHead>
                    <TableHead className="text-right">Recebido</TableHead>
                    <TableHead className="text-right">Glosa em aberto</TableHead>
                    <TableHead className="text-right">Glosa definitiva</TableHead>
                    <TableHead className="text-right">Pendente</TableHead>
                    <TableHead className="text-right">% glosa</TableHead>
                    <TableHead className="text-right">Prazo médio (dias)</TableHead>
                    <TableHead className="text-right">Em atraso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.insurers.map((t) => (
                    <TotalsRow key={t.insurerId} t={t} label={t.insurerName} />
                  ))}
                  {report.insurers.length > 1 ? <TotalsRow t={report.total} label="Total" strong /> : null}
                </TableBody>
              </Table>
            </TableWrap>
          </PanelCard>
          <PanelCard title="Idade do pendente" regionLabel="Idade do pendente" className="mt-(--sp-4)">
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operadora</TableHead>
                    <TableHead className="text-right">Até 30 dias</TableHead>
                    <TableHead className="text-right">31 a 60</TableHead>
                    <TableHead className="text-right">61 a 90</TableHead>
                    <TableHead className="text-right">Mais de 90</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.insurers.map((t) => (
                    <TableRow key={t.insurerId}>
                      <TableCell>{t.insurerName}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(t.aging.upTo30)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(t.aging.d31to60)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(t.aging.d61to90)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(t.aging.over90)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          </PanelCard>
        </>
      ) : null}
    </>
  );
}
