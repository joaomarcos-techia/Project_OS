import { PageHeader } from '@/components/ui/page-header';

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
  const userBars = daily.map((d, i) => ({ label: '', value: Math.round((d.users / maxUsers) * 100), on: i === daily.length - 1 }));
  const costBars = daily.map((d, i) => ({ label: '', value: Math.round((d.costUsd / maxCost) * 100), on: i === daily.length - 1 }));
  const maxConsumer = Math.max(0.0001, ...top.map((t) => t.costUsd));

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Inteligência <span className="sep">›</span> <b>Métricas</b>
          </>
        }
        title="Métricas"
        description="Engajamento e custo agregados de toda a plataforma — últimos 30 dias."
      />

      <div className="stat-row five">
        <StatCard label="DAU" value={formatNumber(u.dau)} hint="ativos hoje" icon="users" />
        <StatCard label="WAU" value={formatNumber(u.wau)} hint="últimos 7 dias" icon="users" tone="teal" />
        <StatCard label="Conversas IA" value={formatNumber(u.aiConversations)} hint="no período" icon="chat" tone="teal" />
        <StatCard label="Mensagens IA" value={formatNumber(u.aiMessages)} hint={`${formatNumber(u.dailyAvgMessages)}/dia`} icon="send" />
        <StatCard label="Custo Gemini" value={formatUSD(u.geminiCostUsd)} hint="30 dias" icon="ai" tone="green" />
      </div>

      <div className="cols-2" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="panel">
          <h4>Usuários ativos diários · 14 dias</h4>
          {userBars.some((b) => b.value > 0) ? (
            <Bars data={userBars} />
          ) : (
            <p className="muted" style={{ fontSize: 13, padding: 'var(--sp-6) 0', textAlign: 'center' }}>
              Sem atividade no período.
            </p>
          )}
        </div>
        <div className="panel">
          <h4>Custo Gemini diário · 14 dias</h4>
          {costBars.some((b) => b.value > 0) ? (
            <Bars data={costBars} />
          ) : (
            <p className="muted" style={{ fontSize: 13, padding: 'var(--sp-6) 0', textAlign: 'center' }}>
              Sem custo no período.
            </p>
          )}
        </div>
      </div>

      <div className="cardblock" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="cardblock-head">
          <h4>Maiores consumidores de IA</h4>
          <span className="sub">por custo · 30 dias</span>
        </div>
        {top.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-subtle">Sem dados de consumo no período.</p>
        ) : (
          <div className="table-wrap">
            <table className="ui-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th style={{ textAlign: 'right' }}>Conversas</th>
                  <th style={{ textAlign: 'right' }}>Mensagens</th>
                  <th style={{ textAlign: 'right' }}>Custo</th>
                  <th>Participação</th>
                </tr>
              </thead>
              <tbody>
                {top.map((t, i) => {
                  const pct = Math.round((t.costUsd / maxConsumer) * 100);
                  return (
                    <tr key={i}>
                      <td>
                        <span className="td-name">
                          <ClinicMark nome={t.nome} tint="var(--accent-500)" />
                          <b style={{ fontWeight: 600 }}>{t.nome}</b>
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-2)' }}>{formatNumber(t.conversations)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-2)' }}>{formatNumber(t.messages)}</td>
                      <td style={{ textAlign: 'right' }}>{formatUSD(t.costUsd)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="pbar" style={{ width: 90 }}>
                            <i style={{ width: `${pct}%` }} />
                          </div>
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
