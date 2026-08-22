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

import { Bars, ClinicMark } from '../_components/charts';
import { StatCard } from '../_components/stat-card';
import { guardAdminAccess } from '../_lib/guard';
import { formatNumber, formatUSD } from '../_lib/format';
import { adminMetricsRepository } from '../_lib/repositories/metrics.repo';

export const dynamic = 'force-dynamic';

export default async function MetricasPage() {
  await guardAdminAccess();
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);

  const [u, daily, top] = await Promise.all([
    adminMetricsRepository.getUsage({ from: from.toISOString(), to: to.toISOString() }),
    adminMetricsRepository.getDailyTrends(14).catch(() => []),
    adminMetricsRepository.getTopAiConsumers(5).catch(() => []),
  ]);

  const maxUsers = Math.max(1, ...daily.map((d) => d.users));
  const maxCost = Math.max(0.0001, ...daily.map((d) => d.costUsd));
  const userBars = daily.map((d, i) => ({
    label: '',
    value: Math.round((d.users / maxUsers) * 100),
    on: i === daily.length - 1,
  }));
  const costBars = daily.map((d, i) => ({
    label: '',
    value: Math.round((d.costUsd / maxCost) * 100),
    on: i === daily.length - 1,
  }));
  const maxConsumer = Math.max(0.0001, ...top.map((t) => t.costUsd));

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Inteligência' }, { label: 'Métricas' }]}
        title="Métricas"
        description="Engajamento e custo agregados de toda a plataforma — últimos 30 dias."
      />

      <div className="grid grid-cols-2 gap-(--sp-4) lg:grid-cols-3 2xl:grid-cols-5">
        <StatCard label="DAU" value={formatNumber(u.dau)} hint="ativos hoje" />
        <StatCard label="WAU" value={formatNumber(u.wau)} hint="últimos 7 dias" />
        <StatCard label="Conversas IA" value={formatNumber(u.aiConversations)} hint="no período" />
        <StatCard
          label="Mensagens IA"
          value={formatNumber(u.aiMessages)}
          hint={`${formatNumber(u.dailyAvgMessages)}/dia`}
        />
        <StatCard label="Custo Gemini" value={formatUSD(u.geminiCostUsd)} hint="30 dias" />
      </div>

      <div className="mt-(--sp-4) grid gap-(--sp-4) lg:grid-cols-2">
        <PanelCard title="Usuários ativos diários · 14 dias">
          {userBars.some((b) => b.value > 0) ? (
            <Bars data={userBars} />
          ) : (
            <p className="py-(--sp-6) text-center text-(length:--fs-sm) text-fg-subtle">
              Sem atividade no período.
            </p>
          )}
        </PanelCard>
        <PanelCard title="Custo Gemini diário · 14 dias">
          {costBars.some((b) => b.value > 0) ? (
            <Bars data={costBars} />
          ) : (
            <p className="py-(--sp-6) text-center text-(length:--fs-sm) text-fg-subtle">
              Sem custo no período.
            </p>
          )}
        </PanelCard>
      </div>

      <TableWrap className="mt-(--sp-4)">
        <TableToolbar>
          <h4 className="text-(length:--fs-sm) font-semibold">Maiores consumidores de IA</h4>
          <TableToolbarSpacer />
          <span className="text-(length:--fs-xs) text-fg-subtle">por custo · 30 dias</span>
        </TableToolbar>
        {top.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">Sem dados de consumo no período.</p>
        ) : (
          <TableScroll>
            <Table className="min-w-160">
              <TableHeader>
                <TableRow>
                  <TableHead>Clínica</TableHead>
                  <TableHead numeric>Conversas</TableHead>
                  <TableHead numeric>Mensagens</TableHead>
                  <TableHead numeric>Custo</TableHead>
                  <TableHead>Participação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((t, i) => {
                  const pct = Math.round((t.costUsd / maxConsumer) * 100);
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        <span className="flex items-center gap-2.5 font-medium">
                          <ClinicMark nome={t.nome} tint="var(--brand-accent-500)" />
                          {t.nome}
                        </span>
                      </TableCell>
                      <TableCell numeric className="text-fg-muted">
                        {formatNumber(t.conversations)}
                      </TableCell>
                      <TableCell numeric className="text-fg-muted">
                        {formatNumber(t.messages)}
                      </TableCell>
                      <TableCell numeric>{formatUSD(t.costUsd)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="h-1.75 w-24 overflow-hidden rounded-full bg-viz-track">
                            <i
                              className="block h-full rounded-full bg-ai"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-mono text-[11.5px] text-fg-muted">{pct}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </TableWrap>
    </>
  );
}
