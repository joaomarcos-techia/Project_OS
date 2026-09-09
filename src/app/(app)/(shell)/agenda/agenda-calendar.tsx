/**
 * Renderização das visões da Agenda (item 12): Mês (calendário), Semana e Dia.
 * Server component — navegação por URL (`?view=&date=`), sem estado cliente.
 * Cancelados aparecem esmaecidos (decisão do founder), não somem.
 */
import { ChevronLeft, ChevronRight, Clock3, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { AppointmentStatusBadge, DepositStatusBadge } from '@/components/ui/status-badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/ui/cn';

import styles from './agenda.module.css';

import type { AgendaAppt, AgendaData } from './data';
import { AppointmentCorrectionDialog } from './appointment-correction-dialog';
import { RecurrenceSeriesDialog } from './recurrence-series-dialog';
import { groupByDay, monthMatrix, shift as shiftYmd, todayYmd, weekDays } from './range';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
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
          <div
            key={w}
            className="px-2 py-2 text-center text-(length:--fs-xs) font-medium text-fg-subtle"
          >
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
            <Link
              href={href('day', ymd)}
              className="flex items-baseline justify-between hover:underline"
            >
              <span className="text-(length:--fs-xs) font-medium text-fg-subtle">
                {WEEKDAYS[i]}
              </span>
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
  const seriesById = new Map(data.recurrenceSeries.map((s) => [s.id, s]));
  const waiting = appts.filter((appointment) => appointment.status === 'chegou').length;
  if (appts.length === 0) {
    return (
      <EmptyState
        title="Nenhum atendimento neste dia"
        description="Clique em “Novo atendimento” quando um paciente chegar ou para agendar."
      />
    );
  }
  return (
    <>
      {waiting > 0 ? (
        <Link href="/consultorio" className={styles.waitingNotice ?? ''}>
          <Clock3 aria-hidden="true" className="size-4 shrink-0" />
          <span className="flex-1 font-medium">
            {waiting} paciente{waiting === 1 ? '' : 's'} na sala de espera
          </span>
          <span className="font-semibold">Abrir no Consultório</span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
        </Link>
      ) : null}
      <div className={cn('qoro-section', styles.day)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hora</TableHead>
              <TableHead>Paciente</TableHead>
              <TableHead>Profissional</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Próxima ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appts.map((a) => {
              const noConsultorio = a.status === 'chegou' || a.status === 'em_atendimento';
              return (
                <TableRow
                  key={a.id}
                  data-status={a.status}
                  className={cn(styles.appointment, isCancelled(a) && 'opacity-60')}
                >
                  <TableCell
                    data-label="Hora"
                    className="font-mono text-(length:--fs-sm) font-medium tabular-nums"
                  >
                    {hora(a.horario, data.tz)}
                  </TableCell>
                  <TableCell data-label="Paciente" className="font-semibold">
                    {a.pacienteNome}
                  </TableCell>
                  <TableCell data-label="Profissional" className="text-fg-muted">
                    {a.medicoNome}
                  </TableCell>
                  <TableCell data-label="Status">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <AppointmentStatusBadge status={a.status} />
                      {/*
                ADR-049 1.6b — o sinal é dimensão ORTOGONAL ao status, então vem
                como badge próprio ao lado, não substituindo. `none` não renderiza
                nada: sinal desligado é o caso da maioria das clínicas, e um
                rótulo em toda consulta treinaria o operador a não olhar.
                O prazo entra no `title` porque é o que decide se ainda dá para
                agir — vaga pendente vira cancelamento sozinha quando ele passa.
              */}
                      <span
                        title={
                          a.depositStatus === 'pending' && a.holdExpiresAt
                            ? `Vaga segurada até ${hora(a.holdExpiresAt, data.tz)}`
                            : undefined
                        }
                      >
                        <DepositStatusBadge status={a.depositStatus} />
                      </span>
                      {/* UX-003 — o vínculo com a série vira visível e acionável aqui. */}
                      {a.recurrenceSeriesId && seriesById.get(a.recurrenceSeriesId) ? (
                        <RecurrenceSeriesDialog
                          series={seriesById.get(a.recurrenceSeriesId)!}
                          occurrence={a.recurrenceOccurrence}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell data-label="Próxima ação">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {noConsultorio ? (
                        <Link
                          href="/consultorio"
                          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                        >
                          <Stethoscope aria-hidden="true" className="size-4" />
                          Abrir no Consultório
                        </Link>
                      ) : null}
                      {data.canEditAgenda && a.recoveryKinds.length > 0 ? (
                        <AppointmentCorrectionDialog appointment={a} doctors={data.doctors} />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className={styles.footer ?? ''}>
          <span className="font-mono tabular-nums">
            {appts.length} atendimento{appts.length === 1 ? '' : 's'} no dia
          </span>
          <span>Faltas e cancelamentos permanecem visíveis no histórico do dia.</span>
        </div>
      </div>
    </>
  );
}

/** Cabeçalho de navegação: alterna visão + prev/próximo/hoje. */
export function AgendaNav({ data, actions }: { data: AgendaData; actions?: ReactNode }) {
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
      aria-current={view === v ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-(--hit-target) items-center rounded-(--r-sm) px-3 text-(length:--fs-sm) font-medium transition-colors',
        view === v
          ? 'bg-surface font-semibold text-fg shadow-xs'
          : 'text-fg-muted hover:bg-surface-hover',
      )}
    >
      {txt}
    </Link>
  );

  // Prev/next continuam URLs determinísticas, calculadas no servidor para preservar o fuso.
  const nav = (dir: -1 | 1, icon: ReactNode, aria: string) => {
    const target = shiftYmd(view, ymd, dir);
    return (
      <Link
        href={href(view, target)}
        aria-label={aria}
        className="inline-flex size-(--hit-target) items-center justify-center rounded-(--r-sm) text-fg-muted transition-colors hover:bg-surface-hover"
      >
        {icon}
      </Link>
    );
  };

  return (
    <section
      aria-label="Controles da agenda"
      className="qoro-toolbar mb-4 flex flex-wrap items-center justify-between gap-3"
    >
      <nav aria-label="Navegação por data" className="flex min-w-0 flex-wrap items-center gap-1">
        {nav(-1, <ChevronLeft aria-hidden="true" className="size-4" />, 'Anterior')}
        <Link href={href(view, todayYmd(tz))} className={buttonVariants({ variant: 'secondary' })}>
          Hoje
        </Link>
        {nav(1, <ChevronRight aria-hidden="true" className="size-4" />, 'Próximo')}
        <span className="ml-2 min-w-0 text-balance text-(length:--fs-sm) font-medium capitalize">
          {label}
        </span>
      </nav>

      <div className={styles.summary ?? ''} aria-label="Resumo dos atendimentos">
        <span>
          {data.appointments.filter((item) => item.status === 'atendido').length} finalizados
        </span>
        <span className="text-warning-700">
          {data.appointments.filter((item) => item.status === 'chegou').length} aguardando
        </span>
        <span className="text-primary">
          {data.appointments.filter((item) => item.status === 'em_atendimento').length} em
          atendimento
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <nav
          aria-label="Visualização da agenda"
          className="flex items-center gap-1 rounded-(--r-md) bg-surface-inset p-0.5"
        >
          {tab('month', 'Mês')}
          {tab('week', 'Semana')}
          {tab('day', 'Dia')}
        </nav>
        {actions}
      </div>
    </section>
  );
}
