import {
  ArrowRight,
  Banknote,
  BarChart3,
  Calendar,
  Clock,
  Sparkles,
  Stethoscope,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { AppointmentStatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/ui/cn';

import { getDashboard } from './data';

export const dynamic = 'force-dynamic';

type Tone = 'primary' | 'amber' | 'teal' | 'muted';

const TONE: Record<Tone, string> = {
  primary: 'bg-primary-50 text-primary-600 dark:bg-primary-600/15 dark:text-primary-300',
  amber: 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100',
  teal: 'bg-accent-500/15 text-accent-600 dark:text-accent-400',
  muted: 'bg-surface-inset text-fg-subtle',
};

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'primary',
  soon = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint: string;
  tone?: Tone;
  soon?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className={cn('flex size-9 items-center justify-center rounded-lg', TONE[tone])}>
            <Icon className="size-4.5" />
          </span>
          {soon ? <Badge tone="gray">em breve</Badge> : null}
        </div>
        <div>
          <p className="text-[12.5px] font-medium text-fg-muted">{label}</p>
          <p
            className={cn(
              'mt-0.5 text-2xl font-semibold tracking-[-0.02em]',
              soon ? 'text-fg-subtle' : 'text-fg',
            )}
          >
            {value}
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function SoonPanel({ icon: Icon, title, note }: { icon: LucideIcon; title: string; note: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex items-start gap-3 p-5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-surface-inset text-fg-subtle">
          <Icon className="size-4.5" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg-muted">{title}</h3>
            <Badge tone="gray">em breve</Badge>
          </div>
          <p className="mt-1 text-xs text-fg-subtle">{note}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default async function DashboardPage() {
  const d = await getDashboard();

  if (!d.hasClinic) {
    return (
      <>
        <PageHeader title="Visão geral" />
        <Alert variant="info">Selecione uma clínica para ver o painel operacional.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="O pulso da clínica — agenda e atendimento de hoje."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile icon={Calendar} label="Consultas hoje" value={d.consultasHoje} hint="agendadas para hoje" />
        <StatTile icon={Clock} tone="amber" label="Aguardando" value={d.aguardando} hint="na sala de espera" />
        <StatTile icon={Stethoscope} tone="teal" label="Em atendimento" value={d.emAtendimento} hint="agora" />
        <StatTile icon={Wallet} tone="muted" label="Recebimentos" value="—" hint="Financeiro" soon />
        <StatTile icon={Banknote} tone="muted" label="Faturado hoje" value="—" hint="Financeiro" soon />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Panel
          title="Próximos na agenda"
          action={
            <Link
              href="/consultorio"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Abrir consultório <ArrowRight className="size-4" />
            </Link>
          }
        >
          {d.proximos.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nada para hoje.</p>
          ) : (
            <ul className="flex flex-col">
              {d.proximos.map((p) => (
                <li
                  key={p.appointmentId}
                  className="flex items-center gap-3 border-b border-border py-2.5 last:border-0"
                >
                  <span className="w-12 shrink-0 font-mono text-xs text-fg-muted">{hora(p.horario)}</span>
                  <span className="flex-1 truncate text-sm font-medium">{p.nome}</span>
                  <AppointmentStatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <SoonPanel
            icon={BarChart3}
            title="Faturamento · últimos 7 dias"
            note="Chega com o módulo Financeiro."
          />
          <SoonPanel icon={Sparkles} title="Alertas da IA" note="Chega com o Agente de IA." />
        </div>
      </div>
    </>
  );
}
