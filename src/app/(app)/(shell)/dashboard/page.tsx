import {
  Banknote,
  CalendarDays,
  Clock3,
  RefreshCw,
  Sparkles,
  Stethoscope,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PanelCard } from '@/components/ui/panel-card';
import { StatCard } from '@/components/ui/stat-card';
import { AppointmentStatusBadge } from '@/components/ui/status-badge';
import { getProfileNames } from '@/contexts/identity/queries';
import { clinicDayBounds } from '@/contexts/financial/logic';
import { getCashFlowToday, listCashFlowDaily } from '@/contexts/financial/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { getRecentActivity, type AuditActivity } from '@/lib/audit/recent';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/tenant-context';
import { formatBRL } from '@/lib/format';

import { ActivationChecklist } from './_components/activation-checklist';
import { ActivityFeed } from './_components/activity-feed';
import { RevenueChart } from './_components/revenue-chart';
import { getActivationChecklist, getDashboard } from './data';

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

  // Gráfico: faturamento (recebido) dos últimos 7 dias. Histórico vem do
  // consolidado diário (cash_flow_daily); "hoje" usa o valor ao vivo (o rollup
  // roda 1x/dia, então ainda não fechou o dia corrente).
  const [d, checklist, flow, serie, activity] = await Promise.all([
    getDashboard(clinicId, tz),
    getActivationChecklist(clinicId),
    getCashFlowToday(clinicId, from, to),
    listCashFlowDaily(clinicId, dias[0]!, ymd(tz, 1)),
    canAudit ? getRecentActivity(clinicId, 7) : Promise.resolve<AuditActivity[]>([]),
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
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Dashboard' }, { label: `Hoje · ${hoje}` }]}
        title="Visão operacional"
        description="O pulso da clínica em tempo real — agenda, atendimento, caixa e inteligência num só lugar."
        actions={
          <Link href="/dashboard" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            <RefreshCw className="size-3.5" />
            Atualizar
          </Link>
        }
      />

      <ActivationChecklist data={checklist} />

      {/* ---- stat tiles (dados reais) ---- */}
      <div className="grid grid-cols-2 gap-(--sp-4) lg:grid-cols-3 2xl:grid-cols-5">
        <StatCard
          label="Consultas hoje"
          value={d.consultasHoje}
          hint={`${d.finalizadas} finalizadas`}
          icon={<CalendarDays />}
        />
        <StatCard
          label="Aguardando"
          value={d.aguardando}
          hint="na sala de espera"
          icon={<Clock3 />}
        />
        <StatCard
          label="Em atendimento"
          value={d.emAtendimento}
          hint="agora"
          icon={<Stethoscope />}
        />
        <StatCard
          label="A receber"
          value={formatBRL(flow.receber)}
          hint="pendências em aberto"
          icon={<Wallet />}
        />
        <StatCard
          label="Faturado hoje"
          value={formatBRL(flow.recebidoHoje)}
          hint="recebido hoje"
          icon={<Banknote />}
        />
      </div>

      <div className="mt-(--sp-4) grid gap-(--sp-4) xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-(--sp-4)">
          <PanelCard
            title="Faturamento · últimos 7 dias"
            action={{ label: 'Financeiro', href: '/financeiro' }}
          >
            {chartTotal === 0 ? (
              <p className="py-(--sp-6) text-center text-(length:--fs-sm) text-fg-subtle">
                Sem recebimentos registrados no período.
              </p>
            ) : (
              <RevenueChart points={chart} />
            )}
          </PanelCard>

          <div className="grid gap-(--sp-4) md:grid-cols-2">
            <PanelCard
              title="Próximos na agenda"
              action={{ label: 'Ver consultório', href: '/consultorio' }}
            >
              {d.proximos.length === 0 ? (
                <p className="py-2 text-(length:--fs-sm) text-fg-subtle">Nada para hoje.</p>
              ) : (
                <ul className="flex flex-col">
                  {d.proximos.map((p) => (
                    <li
                      key={p.appointmentId}
                      className="flex items-center gap-3 border-b border-border py-2 text-(length:--fs-sm) last:border-b-0"
                    >
                      <span className="font-mono text-(length:--fs-xs) text-fg-subtle">
                        {hora(p.horario)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{p.nome}</span>
                      <AppointmentStatusBadge status={p.status} />
                    </li>
                  ))}
                </ul>
              )}
            </PanelCard>

            <PanelCard title="Ocupação por profissional" meta="em breve">
              <EmptyState
                className="px-(--sp-4) py-(--sp-8)"
                icon={<Users />}
                title="Em breve"
                description="Ocupação por médico chega com a Agenda."
              />
            </PanelCard>
          </div>
        </div>

        <div className="flex flex-col gap-(--sp-4)">
          <PanelCard
            className="border-ai-border"
            title="Alertas da IA"
            titleIcon={<Sparkles className="text-ai" />}
            meta="em breve"
          >
            <EmptyState
              className="px-(--sp-4) py-(--sp-8)"
              icon={<Sparkles />}
              title="Em breve"
              description="Alertas (no-show, cobrança ausente, retorno vencido) chegam com o Agente de IA."
            />
          </PanelCard>

          <PanelCard title="Atividade recente">
            {!canAudit ? (
              <p className="py-2 text-(length:--fs-sm) text-fg-subtle">
                A trilha de atividade fica disponível para gestores.
              </p>
            ) : activity.length === 0 ? (
              <p className="py-2 text-(length:--fs-sm) text-fg-subtle">
                Nenhuma atividade registrada ainda.
              </p>
            ) : (
              <ActivityFeed activity={activity} actorNames={actorNames} />
            )}
          </PanelCard>
        </div>
      </div>
    </>
  );
}
