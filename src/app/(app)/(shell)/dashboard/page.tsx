import {
  Ban,
  Banknote,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Clock3,
  Sparkles,
  Stethoscope,
  Timer,
  TriangleAlert,
  UserX,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { MetricStrip } from '@/components/ui/metric-strip';
import { PageHeader } from '@/components/ui/page-header';
import { PanelCard } from '@/components/ui/panel-card';
import { StatCard } from '@/components/ui/stat-card';
import { AppointmentStatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/ui/cn';
import { getProfileNames } from '@/contexts/identity/queries';
import { clinicDayBounds } from '@/contexts/financial/logic';
import { getCashFlowToday, listCashFlowDaily } from '@/contexts/financial/queries';
import type { CashFlowDTO } from '@/contexts/financial/types';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { countOpenHandoffs, type HandoffPulse } from '@/contexts/ai-agent/queries';
import { getRecentActivity, type AuditActivity } from '@/lib/audit/recent';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/tenant-context';
import { formatBRL } from '@/lib/format';

import { ActivationChecklist } from './_components/activation-checklist';
import { ActivityFeed } from './_components/activity-feed';
import { RefreshButton } from './_components/refresh-button';
import { RevenueChart } from './_components/revenue-chart';
import { getActivationChecklist, getDashboard } from './data';
import styles from './dashboard.module.css';

export const dynamic = 'force-dynamic';

/* ---- série do gráfico (últimos 7 dias, tz da clínica) ---- */
function ymd(tz: string, offsetDays: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(Date.now() + offsetDays * 86_400_000));
}

function weekdayLabel(date: string): string {
  return new Date(`${date}T12:00:00`)
    .toLocaleDateString('pt-BR', { weekday: 'short' })
    .replace('.', '')
    .slice(0, 3);
}

/** AUTHZ-005 — placeholder para quem não tem `view:financial`. Nunca renderizado. */
const NO_CASH_FLOW: CashFlowDTO = {
  receber: 0,
  pagar: 0,
  recebidoHoje: 0,
  pagoHoje: 0,
  saldoHoje: 0,
  contagens: { receber: 0, receberVencidos: 0, pagar: 0, recebimentos: 0, pagamentos: 0 },
};

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default async function DashboardPage() {
  // Uma sessão expirada, revogada ou desativada é um estado esperado de
  // navegação. O layout também é um backstop, mas segmentos podem renderizar
  // concorrentemente; redirecionar aqui evita que um `AuthError` esperado vire
  // erro 500/Sentry antes do redirect do layout vencer a corrida.
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.clinicId) {
    return (
      <PageHeader
        title="Visão operacional"
        description="Selecione uma clínica para ver o painel operacional."
      />
    );
  }

  const clinicId = user.clinicId;
  const tz = await getClinicTimezone(clinicId);
  const { from, to } = clinicDayBounds(tz);
  const dias = Array.from({ length: 7 }, (_, i) => ymd(tz, i - 6));
  const canAudit = user.permissions.includes(PERMISSIONS.VIEW_AUDIT);
  // AUTHZ-005 — o Dashboard era a única tela que lia caixa sem gate: os cards
  // "A receber"/"Faturado hoje" e a série de 7 dias iam para o RSC de qualquer
  // role. Esconder no cliente não resolveria — o valor já teria sido
  // serializado. A condição decide a QUERY, não o CSS.
  const canViewFinancial =
    (user.isSuperAdmin && user.aal === 'aal2') ||
    user.permissions.includes(PERMISSIONS.VIEW_FINANCIAL);
  // Mesmo gate do item de menu: sem `view:conversations` a fila de handoff nem
  // e consultada, entao o alerta da IA nao existe no HTML.
  const canViewConversations = user.permissions.includes(PERMISSIONS.VIEW_CONVERSATIONS);
  const NO_HANDOFF: HandoffPulse = { abertos: 0, vencidos: 0 };

  // Gráfico: faturamento (recebido) dos últimos 7 dias. Histórico vem do
  // consolidado diário (cash_flow_daily); "hoje" usa o valor ao vivo (o rollup
  // roda 1x/dia, então ainda não fechou o dia corrente).
  const [d, checklist, flow, serie, activity, handoff] = await Promise.all([
    getDashboard(clinicId, tz),
    getActivationChecklist(clinicId),
    // DTO neutro em vez da query: o zero aqui nunca é renderizado (os blocos
    // financeiros somem abaixo), ele só mantém o tipo sem consultar o caixa.
    canViewFinancial ? getCashFlowToday(clinicId, from, to) : Promise.resolve(NO_CASH_FLOW),
    canViewFinancial
      ? listCashFlowDaily(clinicId, dias[0]!, ymd(tz, 1))
      : Promise.resolve<Awaited<ReturnType<typeof listCashFlowDaily>>>([]),
    canAudit ? getRecentActivity(clinicId, 7) : Promise.resolve<AuditActivity[]>([]),
    canViewConversations ? countOpenHandoffs(clinicId) : Promise.resolve(NO_HANDOFF),
  ]);
  const recByDate = new Map(serie.map((s) => [s.date, s.totalRecebido]));
  const chart = dias.map((date, i) => ({
    date,
    label: weekdayLabel(date),
    recebido: i === dias.length - 1 ? flow.recebidoHoje : (recByDate.get(date) ?? 0),
  }));
  const chartTotal = chart.reduce((s, c) => s + c.recebido, 0);

  // Atividade recente (audit) — feed sensível, gateado em view:audit (gestor/owner).
  const actorNames = canAudit
    ? await getProfileNames(clinicId, activity.map((a) => a.userId ?? '').filter(Boolean))
    : new Map<string, string>();

  const hoje = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  // hourCycle:'h23' e nao hour12:false — o mesmo bug do ICU que renderiza
  // meia-noite como "24" ja mordeu em data.ts.
  const relogio = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hourCycle: 'h23', ...opts }).format(
      new Date(),
    );
  const horaLocal = Number(relogio({ hour: '2-digit' }));
  const periodo = horaLocal < 12 ? 'Bom dia' : horaLocal < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiroNome = (user.name ?? '').trim().split(/\s+/)[0] ?? '';
  const atualizadoEm = relogio({ hour: '2-digit', minute: '2-digit' });

  // Quem ja chegou e ainda espera — o nome que o cartao "Aguardando" anuncia.
  const proximoNaFila = d.proximos.find((consulta) => consulta.status === 'chegou');

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Dashboard' }, { label: `Hoje · ${hoje}` }]}
        title={primeiroNome ? `${periodo}, ${primeiroNome}` : periodo}
        description="O pulso da clínica agora"
        meta={<span className="font-mono tabular-nums">atualizado {atualizadoEm}</span>}
        actions={
          <>
            <RefreshButton />
            <Link href="/consultorio" className={buttonVariants()}>
              <Stethoscope aria-hidden="true" className="size-4" />
              Abrir o Consultório
            </Link>
          </>
        }
      />

      {/* Antes do resto: enquanto a ativação não fecha, ela É a prioridade da
          tela — e no rodapé ninguém a encontrava. Não polui o dashboard maduro
          porque o componente se remove sozinho quando os passos terminam. */}
      <ActivationChecklist data={checklist} />

      {/* ---- stat tiles (dados reais) ---- */}
      <PanelCard
        title="Agora"
        regionLabel="Sala de espera e atendimento"
        action={{ label: 'Ver fila no Consultório', href: '/consultorio' }}
        className={styles.metricsPanel ?? ''}
      >
        <MetricStrip className={styles.liveMetrics ?? ''}>
          <StatCard
            label="Aguardando"
            value={d.aguardando}
            hint={proximoNaFila ? `${proximoNaFila.nome} é o próximo` : 'na sala de espera'}
            icon={<Clock3 />}
          />
          {/* Só ganha o tom de alerta quando alguém está de fato atrasado; fila
              em dia mostra o mesmo cartão neutro, sem gritar por nada. */}
          <StatCard
            label="Maior espera"
            value={d.maiorEsperaMin === null ? '—' : d.maiorEsperaMin}
            {...(d.maiorEsperaMin === null ? {} : { suffix: 'min' })}
            hint={
              d.maiorEsperaNome
                ? `${d.maiorEsperaNome} · acima do previsto`
                : 'ninguém acima do previsto'
            }
            icon={<Timer />}
            {...(d.maiorEsperaMin === null ? {} : { className: styles.metricAlert ?? '' })}
          />
          <StatCard
            label="Em atendimento"
            value={d.emAtendimento}
            hint="agora"
            icon={<Stethoscope />}
          />
          <StatCard
            label="Próxima consulta"
            value={d.proximos[0] ? hora(d.proximos[0].horario) : '—'}
            hint={
              d.proximos[0]
                ? `${d.proximos[0].nome} · ${d.proximos[0].procedimento}`
                : 'Nenhuma consulta na fila de hoje'
            }
            icon={<CalendarClock />}
          />
        </MetricStrip>
      </PanelCard>

      <div className={styles.summaryGrid ?? ''}>
        <PanelCard
          title="Operação do turno"
          regionLabel="Operação do turno"
          className={styles.metricsPanel ?? ''}
        >
          <MetricStrip className={styles.summaryMetrics ?? ''}>
            <StatCard
              label="Consultas hoje"
              value={d.consultasHoje}
              hint={`${d.finalizadas} ${d.finalizadas === 1 ? 'finalizada' : 'finalizadas'}`}
              icon={<CalendarDays />}
            />
            <StatCard
              label="Faltas"
              value={d.faltas}
              hint={d.faltaNome ?? (d.faltas === 0 ? 'ninguém faltou' : 'registradas hoje')}
              icon={<UserX />}
            />
            <StatCard
              label="Cancelados"
              value={d.cancelados}
              hint={d.cancelados === 0 ? 'nenhum cancelamento' : 'cancelados hoje'}
              icon={<Ban />}
            />
          </MetricStrip>
        </PanelCard>
        {canViewFinancial ? (
          <PanelCard
            title="Resumo financeiro"
            regionLabel="Resumo financeiro"
            action={{ label: 'Abrir o Financeiro', href: '/financeiro' }}
            className={styles.metricsPanel ?? ''}
          >
            <MetricStrip className={styles.summaryMetrics ?? ''}>
              <StatCard
                label="A receber"
                value={formatBRL(flow.receber)}
                valueTone={flow.receber > 0 ? 'warning' : 'default'}
                hint="pendências em aberto"
                icon={<Wallet />}
              />
              <StatCard
                label="Recebido hoje"
                value={formatBRL(flow.recebidoHoje)}
                valueTone={flow.recebidoHoje > 0 ? 'positive' : 'default'}
                hint="recebido hoje"
                icon={<Banknote />}
              />
              <StatCard
                label="Saldo do dia"
                value={formatBRL(flow.saldoHoje)}
                hint="depois das saídas"
                icon={<Wallet />}
              />
            </MetricStrip>
          </PanelCard>
        ) : null}
      </div>

      {/* Pendências que valem interromper a leitura: dinheiro que ficou para
          trás e gente esperando um humano. Cada faixa é um link para o lugar
          onde aquilo se resolve — nunca um aviso mudo. */}
      {(canViewFinancial && d.naoFaturados > 0) || handoff.abertos > 0 ? (
        <div className={styles.alerts ?? ''}>
          {canViewFinancial && d.naoFaturados > 0 ? (
            <Link href="/caixa" className={cn(styles.alert, styles.alertBilling)}>
              <TriangleAlert aria-hidden="true" />
              <span className={styles.alertText ?? ''}>
                {d.naoFaturados === 1
                  ? '1 atendimento concluído hoje ainda não foi faturado'
                  : `${d.naoFaturados} atendimentos concluídos hoje ainda não foram faturados`}
              </span>
              <span className={styles.alertCta ?? ''}>Abrir o Caixa</span>
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : null}
          {handoff.abertos > 0 ? (
            <Link href="/conversas" className={cn(styles.alert, styles.alertAi)}>
              <Sparkles aria-hidden="true" />
              <span className={styles.alertText ?? ''}>
                {handoff.abertos === 1
                  ? '1 conversa do agente aguardando atendimento humano'
                  : `${handoff.abertos} conversas do agente aguardando atendimento humano`}
                {handoff.vencidos > 0 ? ` · ${handoff.vencidos} com SLA vencido` : ''}
              </span>
              <span className={styles.alertCta ?? ''}>Abrir Conversas IA</span>
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className={canAudit ? styles.contentGrid : styles.contentSingle}>
        <div className={styles.mainColumn ?? ''}>
          <PanelCard
            title="Próximos na agenda"
            regionLabel="Próximos na agenda"
            action={{ label: 'Ver agenda do dia', href: '/agenda' }}
            className={styles.panel ?? ''}
          >
            {d.proximos.length === 0 ? (
              <EmptyState
                variant="compact"
                icon={<CalendarDays />}
                title="Agenda livre hoje"
                description="Nenhum atendimento está agendado para hoje."
              />
            ) : (
              <ul className={styles.appointments ?? ''}>
                {d.proximos.map((p) => (
                  <li key={p.appointmentId}>
                    <span className={styles.appointmentTime ?? ''}>{hora(p.horario)}</span>
                    <span className={styles.patientName ?? ''}>{p.nome}</span>
                    <span className={styles.appointmentProcedure ?? ''}>{p.procedimento}</span>
                    <AppointmentStatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>
          {/* AUTHZ-005 — série, total e o link para /financeiro só existem no
            HTML quando a permissão existe. */}
          {canViewFinancial ? (
            <PanelCard
              title="Faturamento recebido"
              action={{ label: 'Financeiro', href: '/financeiro' }}
              regionLabel="Faturamento recebido"
              className={styles.panel ?? ''}
            >
              {chartTotal === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={<Banknote />}
                  title="Sem recebimentos no período"
                  description="Os valores recebidos aparecem aqui assim que forem registrados."
                />
              ) : (
                <RevenueChart points={chart} />
              )}
            </PanelCard>
          ) : null}
        </div>

        {canAudit ? (
          <div className={styles.rightColumn ?? ''}>
            <PanelCard
              title="Atividade recente"
              regionLabel="Atividade recente"
              className={styles.panel ?? ''}
            >
              {activity.length === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={<Clock3 />}
                  title="Sem atividade recente"
                  description="As próximas ações da equipe aparecerão aqui."
                />
              ) : (
                <ActivityFeed activity={activity} actorNames={actorNames} />
              )}
            </PanelCard>
            {/* Dizer o que a tela ainda NÃO mostra é mais honesto que deixar o
                canto vazio parecendo carregamento travado. */}
            <p className={styles.note ?? ''}>
              Ocupação por profissional ainda não tem fonte de dados nesta clínica.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
