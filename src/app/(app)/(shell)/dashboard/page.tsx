import {
  Banknote,
  CalendarDays,
  CircleAlert,
  Clock3,
  House,
  MessageCircle,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { redirect, unstable_rethrow } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
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
import { AuthError, getCurrentUser } from '@/lib/auth/tenant-context';
import { env } from '@/lib/env';
import { formatBRL } from '@/lib/format';
import { captureBackgroundError } from '@/lib/observability/capture';

import { currentOnboardingProgress } from '../_painel/onboarding-progress';

import { ActivationChecklist } from './_components/activation-checklist';
import { ActivityFeed } from './_components/activity-feed';
import { PendingItem } from './_components/pending-item';
import { RefreshButton } from './_components/refresh-button';
import { RevenueChart, RevenueTodayLegend } from './_components/revenue-chart';
import { WhatsappSendAlert, type WhatsappSendAlertData } from './_components/whatsapp-send-alert';
import { getActivationChecklist, getDashboard, getWhatsappSendAlert } from './data';
import { dashboardDemoData } from './demo-data';
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

/** No fuso da clínica: o servidor roda em UTC e a recepção lê o relógio dela. */
function hora(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "1 cobrança" / "3 cobranças" — o número sempre acompanha a palavra certa. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

type BlockRead<T> = { ok: true; value: T } | { ok: false };
type CashFlowSeries = Awaited<ReturnType<typeof listCashFlowDaily>>;
type ActivityBlock = { activity: AuditActivity[]; actorNames: Map<string, string> };

function blockOk<T>(value: T): BlockRead<T> {
  return { ok: true, value };
}

/**
 * Leitura de um bloco secundário: se falhar, só esse bloco avisa. A agenda e a
 * fila, que carregaram, continuam na tela da recepção.
 *
 * `unstable_rethrow` vem primeiro porque redirect e os sinais internos do Next
 * também chegam aqui como exceção. `AuthError` sobe pelo mesmo motivo: sessão
 * derrubada ou permissão negada não é falha de um bloco.
 */
async function readBlock<T>(
  block: string,
  clinicId: string,
  read: () => Promise<T>,
): Promise<BlockRead<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthError) throw error;
    captureBackgroundError(error, { flow: `dashboard.${block}`, clinicId });
    return { ok: false };
  }
}

/**
 * O que um bloco mostra quando a leitura falhou. Nunca zero nem bloco ausente:
 * "R$ 0,00" diria que não entrou dinheiro, e sumir diria que não há pendência.
 */
function BlockUnavailable() {
  return (
    <EmptyState
      variant="compact"
      icon={<CircleAlert />}
      title="Não foi possível carregar este bloco."
    />
  );
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
  const demoMode = Boolean(
    env.DASHBOARD_DEMO_USER_ID === user.userId && env.DASHBOARD_DEMO_CLINIC_ID === clinicId,
  );
  const demoData = demoMode ? dashboardDemoData(user.userId, dias) : null;
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
  // Mesmo gate da tela de WhatsApp (AUTHZ-006): o aviso leva para lá, e é quem
  // gerencia a conta que resolve a pendência na Meta.
  const canManageSettings = user.permissions.includes(PERMISSIONS.MANAGE_SETTINGS);
  const NO_WHATSAPP_ALERT: WhatsappSendAlertData = { account: null, refusals: null };

  // Gráfico: faturamento (recebido) dos últimos 7 dias. Histórico vem do
  // consolidado diário (cash_flow_daily); "hoje" usa o valor ao vivo (o rollup
  // roda 1x/dia, então ainda não fechou o dia corrente).
  //
  // Só `getDashboard` é fatal: sem ele não há tela. Cada leitura secundária
  // passa por `readBlock`. `currentOnboardingProgress` já degrada por dentro.
  const [
    d,
    checklistRead,
    onboarding,
    flowRead,
    serieRead,
    activityRead,
    handoffRead,
    whatsappRead,
  ] = await Promise.all([
    demoData ? Promise.resolve(demoData.dashboard) : getDashboard(clinicId, tz),
    readBlock('checklist', clinicId, () => getActivationChecklist(clinicId)),
    // Memoizado por request: o layout já leu esta linha para montar o tour.
    currentOnboardingProgress(),
    // DTO neutro em vez da query: o zero aqui nunca é renderizado (os blocos
    // financeiros somem abaixo), ele só mantém o tipo sem consultar o caixa.
    canViewFinancial
      ? readBlock('cash_flow', clinicId, async () =>
          demoData ? demoData.flow : getCashFlowToday(clinicId, from, to),
        )
      : blockOk(NO_CASH_FLOW),
    canViewFinancial
      ? readBlock('revenue_series', clinicId, async () =>
          demoData ? demoData.serie : listCashFlowDaily(clinicId, dias[0]!, ymd(tz, 1)),
        )
      : blockOk<CashFlowSeries>([]),
    // Atividade recente (audit) — feed sensível, gateado em view:audit
    // (gestor/owner). Os nomes fazem parte do bloco: sem eles, todo mundo
    // apareceria como "Sistema", o que seria falso.
    canAudit
      ? readBlock('activity', clinicId, async (): Promise<ActivityBlock> => {
          if (demoData) {
            return {
              activity: demoData.activity,
              actorNames: new Map([[user.userId, user.name ?? 'Conta de demonstração']]),
            };
          }
          const activity = await getRecentActivity(clinicId, 7);
          const actorNames = await getProfileNames(
            clinicId,
            activity.map((a) => a.userId ?? '').filter(Boolean),
          );
          return { activity, actorNames };
        })
      : blockOk<ActivityBlock>({ activity: [], actorNames: new Map() }),
    canViewConversations
      ? readBlock('handoff', clinicId, async () =>
          demoData ? demoData.handoff : countOpenHandoffs(clinicId),
        )
      : blockOk(NO_HANDOFF),
    // A prévia ilustrativa não lê estado real de integração.
    canManageSettings && !demoData
      ? readBlock('whatsapp_alert', clinicId, () => getWhatsappSendAlert(clinicId))
      : blockOk(NO_WHATSAPP_ALERT),
  ]);
  const flow = flowRead.ok ? flowRead.value : null;
  const serie = serieRead.ok ? serieRead.value : null;
  const feed = activityRead.ok ? activityRead.value : null;
  const handoff = handoffRead.ok ? handoffRead.value : NO_HANDOFF;
  const whatsappAlert = whatsappRead.ok ? whatsappRead.value : NO_WHATSAPP_ALERT;
  // Com uma destas leituras fora, não dá para afirmar que não há pendência.
  const pendenciasIncertas = !handoffRead.ok || !whatsappRead.ok;
  const checklistDismissed = Boolean(onboarding?.checklistDismissedAt);

  const hasWhatsappAlert =
    whatsappAlert.account !== null || (whatsappAlert.refusals?.count ?? 0) > 0;
  const recByDate = new Map((serie ?? []).map((s) => [s.date, s.totalRecebido]));
  // Hoje vem do caixa e os outros dias da série: sem uma das duas, o gráfico
  // desenharia barras zeradas que não aconteceram.
  const chart =
    flow && serie
      ? dias.map((date, i) => ({
          date,
          label: weekdayLabel(date),
          recebido: i === dias.length - 1 ? flow.recebidoHoje : (recByDate.get(date) ?? 0),
        }))
      : null;
  const chartTotal = (chart ?? []).reduce((s, c) => s + c.recebido, 0);

  // "Quinta-feira, 3 de setembro · atualizado às 22:00" — no fuso da clínica.
  const agora = new Date();
  const hojeExtenso = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(agora);
  const hojeTitulo = hojeExtenso.charAt(0).toUpperCase() + hojeExtenso.slice(1);

  // hourCycle:'h23' e nao hour12:false — o mesmo bug do ICU que renderiza
  // meia-noite como "24" ja mordeu em data.ts.
  const relogio = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hourCycle: 'h23', ...opts }).format(agora);
  const horaLocal = Number(relogio({ hour: '2-digit' }));
  const periodo = horaLocal < 12 ? 'Bom dia' : horaLocal < 18 ? 'Boa tarde' : 'Boa noite';
  const nomeCompleto = (user.name ?? '').trim();
  const atualizadoEm = relogio({ hour: '2-digit', minute: '2-digit' });

  // Quem ja chegou e ainda espera — o nome que o cartao "Aguardando" anuncia.
  const proximoNaFila = d.proximos.find((consulta) => consulta.status === 'chegou');
  // Quem já chegou está no primeiro indicador; aqui interessa quem vem depois.
  const proximaConsulta = d.proximos.find((c) => c.status !== 'chegou') ?? d.proximos[0];

  // Composição do turno. "A chegar" é o que sobra das consultas do dia depois
  // de quem já está na sala, em atendimento, finalizado ou faltou — agendadas e
  // confirmadas. Canceladas ficam FORA do total (regra de `consultasHoje`) e
  // aparecem só como contagem à parte.
  const aChegar = Math.max(
    0,
    d.consultasHoje - d.aguardando - d.emAtendimento - d.finalizadas - d.faltas,
  );
  const turno = [
    { key: 'done', label: 'Finalizadas', count: d.finalizadas, className: styles.done },
    { key: 'now', label: 'Em atendimento', count: d.emAtendimento, className: styles.now },
    { key: 'waiting', label: 'Aguardando', count: d.aguardando, className: styles.waiting },
    { key: 'upcoming', label: 'A chegar', count: aChegar, className: styles.upcoming },
    { key: 'missed', label: 'Faltas', count: d.faltas, className: styles.missed },
  ];
  const turnoDescricao = `${plural(d.consultasHoje, 'consulta', 'consultas')} hoje: ${[
    plural(d.finalizadas, 'finalizada', 'finalizadas'),
    `${d.emAtendimento} em atendimento`,
    `${d.aguardando} aguardando`,
    `${aChegar} a chegar`,
    plural(d.faltas, 'falta', 'faltas'),
  ].join(', ')}; ${plural(d.cancelados, 'cancelada', 'canceladas')} fora do total`;

  // Restam no dia: quem está na sala e quem ainda vai chegar.
  const restantes = d.aguardando + aChegar;

  // "Precisa de você": só o que existe de verdade e a pessoa pode resolver.
  // Ordem fixa — com os envios do WhatsApp bloqueados, lembretes e links de
  // sinal não chegam a NENHUM paciente, então isso vem primeiro.
  const showUnbilled = canViewFinancial && d.naoFaturados > 0;
  const pendencias =
    (hasWhatsappAlert ? 1 : 0) + (showUnbilled ? 1 : 0) + (handoff.abertos > 0 ? 1 : 0);

  return (
    <>
      <PageHeader
        crumbs={[
          {
            label: (
              <>
                <House aria-hidden="true" />
                Dashboard
              </>
            ),
          },
        ]}
        title={nomeCompleto ? `${periodo}, ${nomeCompleto}` : periodo}
        description={`${hojeTitulo} · atualizado às ${atualizadoEm}`}
        {...(demoMode
          ? {
              meta: 'Dados ilustrativos somente nesta página. As demais áreas mostram dados reais.',
            }
          : {})}
        actions={
          <>
            <RefreshButton />
            <Link href="/consultorio" prefetch={false} className={buttonVariants()}>
              Abrir o Consultório
            </Link>
          </>
        }
      />

      <div className={styles.body}>
        {/* Antes do resto: enquanto a ativação não fecha, ela É a prioridade da
            tela. Não polui o dashboard maduro porque o componente se remove
            sozinho quando os passos terminam. */}
        {demoMode ? null : checklistRead.ok ? (
          <ActivationChecklist data={checklistRead.value} dismissed={checklistDismissed} />
        ) : checklistDismissed ? null : (
          <PanelCard
            title="Primeiros passos"
            headingLevel={2}
            regionLabel="Primeiros passos"
            flush
            className={styles.setupCard ?? ''}
          >
            <BlockUnavailable />
          </PanelCard>
        )}

        {/* ---- Agora no consultório: indicadores reais, um link para cada ---- */}
        <MetricStrip
          variant="joined"
          aria-label="Sala de espera e atendimento"
          className={styles.kpis}
        >
          <StatCard
            href="/consultorio"
            label="Aguardando"
            value={d.aguardando}
            hint={proximoNaFila ? `A seguir: ${proximoNaFila.nome}` : 'na sala de espera'}
          />
          {/* Neutro: o produto não define espera aceitável, e um alerta aqui
              afirmaria uma comparação que o sistema não faz. */}
          <StatCard
            href="/consultorio"
            label="Maior espera"
            value={d.maiorEsperaMin === null ? '—' : d.maiorEsperaMin}
            {...(d.maiorEsperaMin === null ? {} : { suffix: 'min' })}
            hint={
              d.maiorEsperaNome
                ? `${d.maiorEsperaNome} espera há mais tempo`
                : 'sem espera registrada'
            }
          />
          <StatCard
            href="/consultorio"
            label="Em atendimento"
            value={d.emAtendimento}
            hint="agora"
          />
          <StatCard
            href="/agenda"
            label="Próxima consulta"
            value={proximaConsulta ? hora(proximaConsulta.horario, tz) : '—'}
            hint={
              proximaConsulta
                ? `${proximaConsulta.nome} · ${proximaConsulta.procedimento}`
                : 'Nenhuma consulta pela frente hoje'
            }
          />
        </MetricStrip>

        <div className={styles.row}>
          <PanelCard
            title="Consultas hoje"
            headingLevel={2}
            regionLabel="Operação do turno"
            action={{ label: 'Abrir a agenda', href: '/agenda' }}
            flush
            className={styles.narrow ?? ''}
          >
            <div className={styles.turn}>
              <p className={styles.turnTotal}>
                <span className={styles.turnValue}>{d.consultasHoje}</span>
                <span className={styles.muted}>no total ·</span>
                <span className={styles.muted}>
                  {plural(d.finalizadas, 'finalizada', 'finalizadas')}
                </span>
              </p>
              {/* Dia sem consulta alguma: o total acima já diz tudo, e medidor
                  vazio com seis linhas de "0" só repetiria. */}
              {d.consultasHoje > 0 || d.cancelados > 0 ? (
                <>
                  <div className={styles.meter} role="img" aria-label={turnoDescricao}>
                    {d.consultasHoje > 0 ? (
                      turno
                        .filter((t) => t.count > 0)
                        .map((t) => (
                          <span key={t.key} className={t.className} style={{ flexGrow: t.count }} />
                        ))
                    ) : (
                      <span className={styles.meterEmpty} />
                    )}
                  </div>
                  {/* Só visual (ver .legend): a leitura completa está no medidor. */}
                  <ul className={styles.legend} aria-hidden="true">
                    {turno.map((t) => (
                      <li key={t.key} data-label={t.label} data-count={t.count}>
                        <span className={cn(styles.swatch, t.className)} />
                      </li>
                    ))}
                    <li data-label="Canceladas" data-count={d.cancelados}>
                      <span className={cn(styles.swatch, styles.cancelled)} />
                    </li>
                  </ul>
                </>
              ) : null}
            </div>
          </PanelCard>

          {canViewFinancial ? (
            <PanelCard
              title="Resumo financeiro do dia"
              headingLevel={2}
              regionLabel="Resumo financeiro"
              action={{ label: 'Abrir o Financeiro', href: '/financeiro' }}
              flush
              className={cn(styles.wide, styles.clip)}
            >
              {flow ? (
                <MetricStrip
                  variant="joined"
                  aria-label="Indicadores financeiros do dia"
                  className={styles.finStrip}
                >
                  <StatCard
                    label="A receber"
                    value={formatBRL(flow.receber)}
                    hint={
                      <>
                        <span>{plural(flow.contagens.receber, 'cobrança', 'cobranças')}</span>
                        {flow.contagens.receberVencidos > 0 ? (
                          <Badge tone="red" dot>
                            {plural(flow.contagens.receberVencidos, 'vencida', 'vencidas')}
                          </Badge>
                        ) : null}
                      </>
                    }
                  />
                  <StatCard
                    label="Recebido hoje"
                    value={formatBRL(flow.recebidoHoje)}
                    valueTone={flow.recebidoHoje > 0 ? 'positive' : 'default'}
                    hint={plural(flow.contagens.recebimentos, 'recebimento', 'recebimentos')}
                  />
                  <StatCard
                    label="Saldo do dia"
                    value={formatBRL(flow.saldoHoje)}
                    hint={
                      flow.pagoHoje === 0
                        ? 'Nenhuma saída hoje'
                        : `Depois de ${formatBRL(flow.pagoHoje)} em saídas`
                    }
                  />
                </MetricStrip>
              ) : (
                <BlockUnavailable />
              )}
            </PanelCard>
          ) : null}
        </div>

        <div className={styles.row}>
          <PanelCard
            title="Próximos na agenda"
            headingLevel={2}
            regionLabel="Próximos na agenda"
            {...(d.proximos.length > 0
              ? { count: <span className="qoro-count">{d.proximos.length}</span> }
              : {})}
            action={{ label: 'Ver o dia inteiro', href: '/agenda' }}
            flush
            className={cn(styles.wide, styles.upcomingCard)}
          >
            {d.proximos.length === 0 ? (
              <EmptyState
                variant="compact"
                icon={<CalendarDays />}
                title={d.consultasHoje === 0 ? 'Agenda livre hoje' : 'Sem próximas consultas hoje'}
                description={
                  d.consultasHoje === 0
                    ? 'Nenhum atendimento está agendado para hoje.'
                    : 'Nenhum paciente a chegar ou aguardando.'
                }
              />
            ) : (
              <>
                <ul className={styles.list}>
                  {d.proximos.map((p) => (
                    <li key={p.appointmentId} className={styles.upRow}>
                      <span className={styles.upTime}>{hora(p.horario, tz)}</span>
                      <span className={styles.cell}>
                        <b className={styles.trunc} title={p.nome}>
                          {p.nome}
                        </b>
                        {p.profissional ? (
                          <span className={cn(styles.trunc, styles.muted)}>{p.profissional}</span>
                        ) : null}
                      </span>
                      <span className={cn(styles.trunc, styles.upProc)} title={p.procedimento}>
                        {p.procedimento}
                      </span>
                      <span className={styles.upStatus}>
                        <AppointmentStatusBadge status={p.status} />
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={styles.foot}>
                  <span>
                    {restantes > d.proximos.length
                      ? `Mostrando ${d.proximos.length} das ${restantes} consultas restantes`
                      : d.proximos.length === 1
                        ? 'Resta 1 consulta hoje'
                        : `Restam ${d.proximos.length} consultas hoje`}
                  </span>
                  <span>{d.consultasHoje} no dia</span>
                </div>
              </>
            )}
          </PanelCard>

          {/* Pendências que valem interromper a leitura. Cada linha leva ao
              lugar onde aquilo se resolve — nunca um aviso mudo. O cartão só
              existe quando há pendência ou quando não deu para saber: vazio,
              diria "nada a fazer" a quem talvez só não tenha permissão para
              ver. */}
          {pendencias > 0 || pendenciasIncertas ? (
            <PanelCard
              title="Precisa de você"
              headingLevel={2}
              regionLabel="Precisa de você"
              {...(pendencias > 0
                ? {
                    count: (
                      <span className="qoro-count" data-tone="danger">
                        {pendencias}
                      </span>
                    ),
                  }
                : {})}
              flush
              className={cn(styles.narrow, styles.pendingCard)}
            >
              {pendencias > 0 ? (
                <ul className={styles.list}>
                  {hasWhatsappAlert ? <WhatsappSendAlert {...whatsappAlert} /> : null}
                  {showUnbilled ? (
                    <PendingItem
                      href="/caixa"
                      tone="warning"
                      icon={<TriangleAlert />}
                      title={
                        d.naoFaturados === 1
                          ? '1 atendimento concluído hoje ainda não foi faturado'
                          : `${d.naoFaturados} atendimentos concluídos hoje ainda não foram faturados`
                      }
                      cta="Abrir o Caixa"
                    />
                  ) : null}
                  {handoff.abertos > 0 ? (
                    <PendingItem
                      href="/conversas"
                      tone={handoff.vencidos > 0 ? 'danger' : 'info'}
                      icon={<MessageCircle />}
                      title={
                        handoff.abertos === 1
                          ? '1 conversa da IA precisa de alguém da equipe'
                          : `${handoff.abertos} conversas da IA precisam de alguém da equipe`
                      }
                      {...(handoff.vencidos > 0
                        ? { detail: `${handoff.vencidos} com resposta atrasada` }
                        : {})}
                      cta="Abrir Conversas IA"
                    />
                  ) : null}
                </ul>
              ) : null}
              {pendenciasIncertas ? <BlockUnavailable /> : null}
            </PanelCard>
          ) : null}
        </div>

        {canViewFinancial || canAudit ? (
          <div className={styles.row}>
            {/* AUTHZ-005 — série, total e o link para /financeiro só existem no
                HTML quando a permissão existe. */}
            {canViewFinancial ? (
              <PanelCard
                title="Faturamento recebido"
                headingLevel={2}
                regionLabel="Faturamento recebido"
                description={chart ? `Últimos 7 dias · ${formatBRL(chartTotal)}` : undefined}
                aside={
                  chart && chartTotal > 0 ? (
                    <RevenueTodayLegend updatedAt={atualizadoEm} />
                  ) : undefined
                }
                flush
                className={styles.wide ?? ''}
              >
                {!chart ? (
                  <BlockUnavailable />
                ) : chartTotal === 0 ? (
                  <EmptyState
                    variant="compact"
                    icon={<Banknote />}
                    title="Sem recebimentos no período"
                    description="Os valores recebidos aparecem aqui assim que forem registrados."
                  />
                ) : (
                  <RevenueChart points={chart} updatedAt={atualizadoEm} />
                )}
              </PanelCard>
            ) : null}

            {canAudit ? (
              <PanelCard
                title="Atividade recente"
                headingLevel={2}
                regionLabel="Atividade recente"
                flush
                className={styles.narrow ?? ''}
              >
                {!feed ? (
                  <BlockUnavailable />
                ) : feed.activity.length === 0 ? (
                  <EmptyState
                    variant="compact"
                    icon={<Clock3 />}
                    title="Sem atividade recente"
                    description="As próximas ações da equipe aparecerão aqui."
                  />
                ) : (
                  <ActivityFeed activity={feed.activity} actorNames={feed.actorNames} tz={tz} />
                )}
              </PanelCard>
            ) : null}
          </div>
        ) : null}

        {/* Dizer o que a tela ainda NÃO mostra é mais honesto que deixar o
            canto vazio parecendo carregamento travado. Sem botão: cadastrar
            horários não faz este número aparecer — ele ainda não tem fonte. */}
        {canAudit ? (
          <p className={styles.occupancy}>Ocupação por profissional ainda não está disponível.</p>
        ) : null}
      </div>
    </>
  );
}
