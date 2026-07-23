/**
 * Renderização das visões da Agenda (item 12): Mês (calendário), Semana e Dia.
 * Server component — navegação por URL (`?view=&date=`), sem estado cliente.
 * Cancelados aparecem esmaecidos (decisão do founder), não somem.
 */
import Link from 'next/link';

import { AppointmentStatusBadge } from '@/components/ui/status-badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/ui/cn';

import type { AgendaAppt, AgendaData } from './data';
import { groupByDay, monthMatrix, shift as shiftYmd, todayYmd, weekDays } from './range';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function hora(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
}

const isCancelled = (a: AgendaAppt) => a.status === 'cancelado' || a.status === 'faltou';

function href(view: string, ymd: string): string {
  return `/agenda?view=${view}&date=${ymd}`;
}

export function AgendaCalendar({ data }: { data: AgendaData }) {
  if (data.view === 'month') return <MonthView data={data} />;
  if (data.view === 'week') return <WeekView data={data} />;
  return <DayView data={data} />;
}

/* ---------------- Mês ---------------- */
function MonthView({ data }: { data: AgendaData }) {
  const [y, m] = data.ymd.split('-').map(Number);
  const weeks = monthMatrix(y!, m!);
  const byDay = groupByDay(data.appointments, data.tz);
  const today = todayYmd(data.tz);
  const monthPrefix = `${y}-${String(m).padStart(2, '0')}`;

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-border bg-surface-inset/40">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-(length:--fs-xs) font-medium text-fg-subtle">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((ymd) => {
          const dayNum = Number(ymd.split('-')[2]);
          const inMonth = ymd.startsWith(monthPrefix);
          const appts = byDay.get(ymd) ?? [];
          const isToday = ymd === today;
          return (
            <Link
              key={ymd}
              href={href('day', ymd)}
              className={cn(
                'flex min-h-24 flex-col gap-1 border-b border-r border-border p-1.5 transition-colors hover:bg-surface-hover',
                !inMonth && 'bg-surface-inset/30 text-fg-subtle',
              )}
            >
              <span
                className={cn(
                  'inline-flex size-6 items-center justify-center self-start rounded-full text-(length:--fs-xs) tabular-nums',
                  isToday && 'bg-primary font-semibold text-on-primary',
                )}
              >
                {dayNum}
              </span>
              <span className="flex flex-col gap-0.5">
                {appts.slice(0, 3).map((a) => (
                  <span
                    key={a.id}
                    className={cn(
                      'truncate rounded-sm bg-surface-inset px-1 py-0.5 text-(length:--fs-2xs) leading-tight',
                      isCancelled(a) && 'text-fg-subtle line-through opacity-60',
                    )}
                  >
                    {hora(a.horario, data.tz)} {a.pacienteNome}
                  </span>
                ))}
                {appts.length > 3 ? (
                  <span className="px-1 text-(length:--fs-2xs) text-fg-subtle">
                    +{appts.length - 3}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------- Semana ---------------- */
function WeekView({ data }: { data: AgendaData }) {
  const days = weekDays(data.ymd);
  const byDay = groupByDay(data.appointments, data.tz);
  const today = todayYmd(data.tz);

  return (
    <div className="grid gap-2 md:grid-cols-7">
      {days.map((ymd, i) => {
        const appts = (byDay.get(ymd) ?? []).sort((a, b) => a.horario.localeCompare(b.horario));
        const [, , dd] = ymd.split('-');
        return (
          <Card key={ymd} className="flex flex-col gap-2 p-2.5">
            <Link href={href('day', ymd)} className="flex items-baseline justify-between hover:underline">
              <span className="text-(length:--fs-xs) font-medium text-fg-subtle">{WEEKDAYS[i]}</span>
              <span
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded-full text-(length:--fs-sm) tabular-nums',
                  ymd === today && 'bg-primary font-semibold text-on-primary',
                )}
              >
                {Number(dd)}
              </span>
            </Link>
            <div className="flex flex-col gap-1">
              {appts.length === 0 ? (
                <span className="text-(length:--fs-2xs) text-fg-subtle">—</span>
              ) : (
                appts.map((a) => (
                  <span
                    key={a.id}
                    className={cn(
                      'truncate rounded-sm bg-surface-inset px-1.5 py-1 text-(length:--fs-2xs) leading-tight',
                      isCancelled(a) && 'text-fg-subtle line-through opacity-60',
                    )}
                  >
                    <span className="font-mono">{hora(a.horario, data.tz)}</span> {a.pacienteNome}
                  </span>
                ))
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------- Dia ---------------- */
function DayView({ data }: { data: AgendaData }) {
  const appts = [...data.appointments].sort((a, b) => a.horario.localeCompare(b.horario));
  if (appts.length === 0) {
    return (
      <EmptyState
        title="Nenhum atendimento neste dia"
        description="Clique em “Novo atendimento” quando um paciente chegar ou para agendar."
      />
    );
  }
  return (
    <Card>
      <ul className="flex flex-col">
        {appts.map((a) => {
          const noConsultorio = a.status === 'chegou' || a.status === 'em_atendimento';
          return (
            <li
              key={a.id}
              className={cn(
                'flex flex-wrap items-center gap-3 border-b border-border px-(--card-pad) py-3 last:border-b-0',
                isCancelled(a) && 'opacity-60',
              )}
            >
              <span className="font-mono text-sm">{hora(a.horario, data.tz)}</span>
              <span className="min-w-0 truncate font-medium">{a.pacienteNome}</span>
              <span className="text-xs text-fg-subtle">{a.medicoNome}</span>
              <AppointmentStatusBadge status={a.status} />
              <span className="flex-1" />
              {noConsultorio ? (
                <Link
                  href="/consultorio"
                  className="text-(length:--fs-sm) font-medium text-link hover:underline"
                >
                  Abrir no Consultório
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Cabeçalho de navegação: alterna visão + prev/próximo/hoje. */
export function AgendaNav({ data }: { data: AgendaData }) {
  const { view, ymd, tz } = data;
  const [y, m] = ymd.split('-').map(Number);
  let label: string;
  if (view === 'month') label = `${MONTHS[m! - 1]} de ${y}`;
  else if (view === 'week') {
    const days = weekDays(ymd);
    const a = days[0]!.split('-');
    const b = days[6]!.split('-');
    label = `${Number(a[2])}/${a[1]} – ${Number(b[2])}/${b[1]}/${b[0]}`;
  } else {
    label = new Date(`${ymd}T12:00:00Z`).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      timeZone: 'UTC',
    });
  }

  const tab = (v: 'month' | 'week' | 'day', txt: string) => (
    <Link
      href={href(v, ymd)}
      className={cn(
        'rounded-(--r-sm) px-2.5 py-1 text-(length:--fs-sm) font-medium transition-colors',
        view === v ? 'bg-primary text-on-primary' : 'text-fg-muted hover:bg-surface-hover',
      )}
    >
      {txt}
    </Link>
  );

  // prev/next via shift são strings — computados aqui p/ manter o server component simples.
  const nav = (dir: -1 | 1, sym: string, aria: string) => {
    const target = shiftYmd(view, ymd, dir);
    return (
      <Link
        href={href(view, target)}
        aria-label={aria}
        className="inline-flex size-7 items-center justify-center rounded-(--r-sm) text-fg-muted hover:bg-surface-hover"
      >
        {sym}
      </Link>
    );
  };

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        {nav(-1, '‹', 'Anterior')}
        {nav(1, '›', 'Próximo')}
        <Link
          href={href(view, todayYmd(tz))}
          className="ml-1 rounded-(--r-sm) px-2.5 py-1 text-(length:--fs-sm) font-medium text-fg-muted hover:bg-surface-hover"
        >
          Hoje
        </Link>
        <span className="ml-2 text-(length:--fs-sm) font-medium capitalize">{label}</span>
      </div>
      <div className="flex items-center gap-1 rounded-(--r-md) bg-surface-inset p-0.5">
        {tab('month', 'Mês')}
        {tab('week', 'Semana')}
        {tab('day', 'Dia')}
      </div>
    </div>
  );
}
