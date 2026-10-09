/**
 * EC-32 — mensagens automáticas (C14) que não chegaram ao paciente, na forma da
 * Agenda.
 *
 * A leitura do ai-agent diz QUE a mensagem falhou e POR QUÊ; esta camada junta o
 * estado atual da consulta e da cobrança para decidir se ainda há o que a
 * recepção fazer. O caso que motivou tudo é o sinal: o link não chega, o hold
 * vence, a consulta é cancelada sozinha e ninguém soube a tempo.
 *
 * Duas saídas, com critérios diferentes de propósito:
 *  - a FAIXA mostra só o que ainda é acionável (`acionavel`);
 *  - o SELO da linha vale para qualquer falha da janela, inclusive numa
 *    consulta já cancelada, porque explica por que a vaga caiu.
 *
 * A cobrança de D+3/D+7 (`dunning`) fica fora: é dinheiro com valor, e a
 * Agenda não mostra valores.
 */
import type {
  ProactiveDeliveryFailureDTO,
  ProactiveFailureCause,
} from '@/contexts/ai-agent/queries';
import type { AppointmentSummary } from '@/contexts/scheduling/types';

export type AgendaDeliveryFailureKind =
  | 'deposit_link'
  | 'remainder_link'
  | 'reminder'
  | 'no_show_followup'
  | 'waitlist_offer'
  | 'followup';

export interface AgendaDeliveryFailure {
  jobId: string;
  kind: AgendaDeliveryFailureKind;
  /** Null quando o cadastro não resolve (paciente removido ou payload inválido). */
  pacienteNome: string | null;
  /** Consulta da mensagem, ou a vaga liberada na oferta. Null no retorno. */
  appointmentId: string | null;
  /** Quando é a consulta (ou a vaga oferecida), ISO. */
  consultaEm: string | null;
  /** Retorno pedido pelo médico, 'YYYY-MM-DD'. */
  retornoEm: string | null;
  /** Sinal: a vaga segue segurada até este instante (ISO). Null quando já não está. */
  vagaSeguradaAte: string | null;
  /** Ainda há o que a recepção fazer: o item entra na faixa. */
  acionavel: boolean;
  /** Sinal ou saldo com a cobrança ainda pendente: mostra "Copiar link". */
  linkCopiavel: boolean;
  causa: ProactiveFailureCause;
}

/** O mínimo da consulta que a regra precisa — o estado ATUAL, não o do job. */
export type AgendaFailureAppointment = Pick<
  AppointmentSummary,
  'status' | 'scheduledAt' | 'depositStatus' | 'holdExpiresAt'
>;

/** Tipos que ganham selo na linha da consulta. A oferta aponta para a vaga liberada, não para a do paciente. */
export const BADGE_KINDS: ReadonlySet<AgendaDeliveryFailureKind> = new Set([
  'deposit_link',
  'remainder_link',
  'reminder',
  'no_show_followup',
]);

const ACTIVE = new Set(['agendado', 'confirmado']);

export interface BuildAgendaDeliveryFailuresInput {
  failures: readonly ProactiveDeliveryFailureDTO[];
  appointments: ReadonlyMap<string, AgendaFailureAppointment>;
  /** Status da cobrança por id (Payments). */
  chargeStatus: ReadonlyMap<string, string>;
  patientNames: ReadonlyMap<string, string>;
  now: Date;
  /** Hoje, 'YYYY-MM-DD' no fuso da clínica. */
  today: string;
}

function isFuture(iso: string | null, now: Date): boolean {
  return iso !== null && new Date(iso).getTime() > now.getTime();
}

/**
 * Ainda há o que fazer? Cada tipo responde pelo estado de que depende: o sinal
 * pelo hold, o saldo pela cobrança, o lembrete e a oferta pelo horário, o
 * contato pós-falta pela falta ainda valer, o retorno pela data.
 */
function isActionable(
  kind: AgendaDeliveryFailureKind,
  state: {
    appointment: AgendaFailureAppointment | undefined;
    consultaEm: string | null;
    vagaSeguradaAte: string | null;
    chargePending: boolean;
    returnDate: string | null;
    now: Date;
    today: string;
  },
): boolean {
  switch (kind) {
    case 'deposit_link':
      return state.vagaSeguradaAte !== null;
    case 'remainder_link':
      return state.chargePending;
    case 'reminder':
      return (
        state.appointment !== undefined &&
        ACTIVE.has(state.appointment.status) &&
        isFuture(state.consultaEm, state.now)
      );
    case 'no_show_followup':
      return state.appointment?.status === 'faltou';
    case 'waitlist_offer':
      return isFuture(state.consultaEm, state.now);
    case 'followup':
      return state.returnDate !== null && state.returnDate >= state.today;
  }
}

/** Prazo que ordena a faixa: o que vence primeiro vem primeiro. */
function prazo(item: AgendaDeliveryFailure): number {
  if (item.vagaSeguradaAte) return new Date(item.vagaSeguradaAte).getTime();
  if ((item.kind === 'reminder' || item.kind === 'waitlist_offer') && item.consultaEm) {
    return new Date(item.consultaEm).getTime();
  }
  if (item.kind === 'followup' && item.retornoEm) {
    return new Date(`${item.retornoEm}T12:00:00Z`).getTime();
  }
  return Number.POSITIVE_INFINITY;
}

export function buildAgendaDeliveryFailures(
  input: BuildAgendaDeliveryFailuresInput,
): AgendaDeliveryFailure[] {
  const { appointments, chargeStatus, patientNames, now, today } = input;
  const items: AgendaDeliveryFailure[] = [];

  for (const failure of input.failures) {
    const kind = failure.type;
    if (kind === 'dunning') continue;

    const appointment = failure.appointmentId ? appointments.get(failure.appointmentId) : undefined;
    const chargePending =
      failure.chargeId !== null && chargeStatus.get(failure.chargeId) === 'pending';
    const consultaEm = appointment?.scheduledAt ?? failure.scheduledAt;

    // O hold é lido da consulta, que é a dona da vaga; o prazo gravado no job
    // é o de quando ele foi criado.
    const vagaSeguradaAte =
      kind === 'deposit_link' &&
      appointment?.status === 'agendado' &&
      appointment.depositStatus === 'pending' &&
      isFuture(appointment.holdExpiresAt, now)
        ? appointment.holdExpiresAt
        : null;

    // Sem paciente resolvido não há a quem a recepção possa recorrer.
    const acionavel =
      failure.patientId !== null &&
      isActionable(kind, {
        appointment,
        consultaEm,
        vagaSeguradaAte,
        chargePending,
        returnDate: failure.returnDate,
        now,
        today,
      });

    items.push({
      jobId: failure.jobId,
      kind,
      pacienteNome: failure.patientId ? (patientNames.get(failure.patientId) ?? null) : null,
      appointmentId: failure.appointmentId,
      consultaEm,
      retornoEm: failure.returnDate,
      vagaSeguradaAte,
      acionavel,
      linkCopiavel:
        acionavel && (kind === 'deposit_link' || kind === 'remainder_link') && chargePending,
      causa: failure.cause,
    });
  }

  // `sort` é estável: no empate fica a ordem da leitura (a mais recente antes).
  return items.sort((a, b) => {
    const pa = prazo(a);
    const pb = prazo(b);
    if (pa === pb) return 0;
    return pa < pb ? -1 : 1;
  });
}
