/**
 * Lógica PURA do board do Consultório (C8) — sem I/O, sem `'use server'`, sem
 * `server-only`. Extraída de `actions.ts` (que, sendo `'use server'`, só pode
 * exportar funções async) para ficar testável em isolamento (vitest).
 *
 * Aqui mora: mapeamento de erro→`ActionResult` (o banner de concorrência depende
 * disso), a janela do dia no timezone da clínica (DST-correct), o cálculo de
 * idade e a montagem/bucketização dos cards. Nada toca o banco.
 */
import { allowedTransitions, type AppointmentState } from '@/contexts/scheduling/state-machine';
import type { AppointmentStatusDTO, AppointmentSummary } from '@/contexts/scheduling/types';

import type { ActionResult, BoardCardDTO, BoardDTO } from './board-types';

export const BOARD_LIMIT = 50;
export const DAY_FETCH_CAP = 200;
export const STATUS_TODAY: AppointmentStatusDTO[] = [
  'agendado',
  'confirmado',
  'chegou',
  'em_atendimento',
  'atendido',
];

export const EMPTY_BOARD: BoardDTO = {
  activeDoctorId: null,
  doctors: [],
  aChegar: [],
  salaEspera: [],
  emAtendimento: [],
  finalizadas: [],
  truncated: false,
};

export type Sexo = 'M' | 'F' | 'O' | 'N';

/** Forma mínima do paciente que o card precisa (subconjunto de PatientCard). */
export interface CardPatient {
  nome: string;
  alergias: string[];
  dataNascimento: string | null;
  sexo: Sexo | null;
}

// --- ActionResult helpers ---------------------------------------------------

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

/**
 * Traduz um erro de domínio para `ActionResult` (sem redirect). O `name` do erro
 * é o contrato — as actions de C6/C7 lançam erros nomeados; aqui viram código +
 * mensagem em pt-BR para o usuário. Desconhecido → `error` genérico.
 */
export function fail(err: unknown): { ok: false; code: string; message: string } {
  const name =
    err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
  switch (name) {
    case 'InvalidTransitionError':
      return {
        ok: false,
        code: 'invalid_transition',
        message: 'Esta ação não é mais possível — o paciente já mudou de etapa.',
      };
    case 'SchedulingConflictError':
      return { ok: false, code: 'conflict', message: 'Conflito de estado. Recarregue o quadro.' };
    case 'AppointmentNotFoundError':
      return { ok: false, code: 'not_found', message: 'Agendamento não encontrado.' };
    case 'AuthError':
      return { ok: false, code: 'forbidden', message: 'Você não tem permissão para esta ação.' };
    case 'IdempotencyConflictError':
      return {
        ok: false,
        code: 'duplicate',
        message: 'Reenvio duplicado com dados diferentes. Recarregue e tente de novo.',
      };
    case 'ProntuarioConflitoError':
      return {
        ok: false,
        code: 'conflict',
        message: 'O prontuário foi alterado em outra janela. Recarregue.',
      };
    default:
      return {
        ok: false,
        code: 'error',
        message: err instanceof Error ? err.message : 'Erro inesperado.',
      };
  }
}

// --- timezone / janela do dia ----------------------------------------------

/** local→UTC offset (ms) de uma data num timezone IANA (DST-correct via Intl). */
export function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    // hourCycle:'h23' (não hour12:false): evita o bug do ICU que renderiza
    // meia-noite como "24" em alguns runtimes (Node/UTC do CI) → offset +21h errado.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(map.year!, map.month! - 1, map.day!, map.hour!, map.minute!, map.second!);
  return asUtc - date.getTime();
}

/** Janela [00:00, 24:00) de HOJE no timezone da clínica, como instantes UTC. */
export function clinicDayBounds(tz: string, now: Date = new Date()): { from: Date; to: Date } {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  const utcGuess = Date.UTC(y!, m! - 1, d!, 0, 0, 0);
  const off = tzOffsetMs(new Date(utcGuess), tz);
  const from = new Date(utcGuess - off);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

// --- demografia do card -----------------------------------------------------

/** Idade em anos a partir de `data_nascimento` (YYYY-MM-DD). null se ausente/inválida. */
export function ageFromBirthdate(dateStr: string | null, now: Date = new Date()): number | null {
  if (!dateStr) return null;
  const b = new Date(dateStr);
  if (Number.isNaN(b.getTime())) return null;
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age -= 1;
  return age >= 0 && age < 200 ? age : null;
}

const SEXO_SHORT: Record<Sexo, string> = { M: 'M', F: 'F', O: 'Outro', N: '—' };
const SEXO_LONG: Record<Sexo, string> = {
  M: 'Masculino',
  F: 'Feminino',
  O: 'Outro',
  N: 'Não informado',
};

export function sexoShort(sexo: Sexo | null): string | null {
  return sexo ? SEXO_SHORT[sexo] : null;
}
export function sexoLong(sexo: Sexo | null): string | null {
  return sexo ? SEXO_LONG[sexo] : null;
}

/** "42 anos · F" / "42 anos" / "F" / "" — linha de demografia do card (DS). */
export function demographicsLine(idade: number | null, sexo: Sexo | null): string {
  const parts: string[] = [];
  if (idade != null) parts.push(`${idade} anos`);
  const s = sexoShort(sexo);
  if (s) parts.push(s);
  return parts.join(' · ');
}

// --- montagem dos cards -----------------------------------------------------

export function motivoOf(
  a: Pick<AppointmentSummary, 'snapshotProcedureName' | 'observacoes'>,
): string {
  return a.observacoes ? `${a.snapshotProcedureName} · ${a.observacoes}` : a.snapshotProcedureName;
}

type CardAppointment = Pick<
  AppointmentSummary,
  | 'id'
  | 'patientId'
  | 'scheduledAt'
  | 'snapshotProcedureName'
  | 'observacoes'
  | 'status'
  | 'urgencia'
>;

/**
 * Monta um `BoardCardDTO` a partir do appointment + paciente resolvido +
 * check-in. Puro: `now` injetado para a idade ser determinística em teste.
 */
export function buildCard(
  a: CardAppointment,
  patient: CardPatient | undefined,
  checkInAt: string | null,
  now: Date = new Date(),
  queue?: { position: number; estimatedWaitMinutes: number },
): BoardCardDTO {
  return {
    appointmentId: a.id,
    patientId: a.patientId,
    pacienteNome: patient?.nome ?? (a.patientId ? 'Paciente' : 'Walk-in'),
    alergias: patient?.alergias ?? [],
    idade: ageFromBirthdate(patient?.dataNascimento ?? null, now),
    sexo: patient?.sexo ?? null,
    horario: a.scheduledAt,
    motivo: motivoOf(a),
    status: a.status,
    urgencia: a.urgencia,
    checkInAt,
    ...(queue
      ? { queuePosition: queue.position, estimatedWaitMinutes: queue.estimatedWaitMinutes }
      : {}),
  };
}

/** Filtra por status e corta no teto da coluna (ordem preservada). */
export function pickByStatus<T extends { status: AppointmentStatusDTO }>(
  appts: readonly T[],
  statuses: readonly AppointmentStatusDTO[],
  limit: number = BOARD_LIMIT,
): T[] {
  return appts.filter((a) => statuses.includes(a.status)).slice(0, limit);
}

export type { ActionResult };

/**
 * STATE-001 — quais ações a UI pode oferecer para um card, DERIVADO da máquina
 * de estados em vez de reescrito no layout.
 *
 * O bug: `CheckinStrip` (agendado/confirmado) não oferecia falta, e
 * `WaitingCard` (chegou) sempre oferecia. Só que a tabela de transições permite
 * `agendado|confirmado → faltou` e PROÍBE `chegou → faltou`. Resultado: a etapa
 * em que registrar falta é válido não tinha o botão, e a etapa que tinha o
 * botão rejeitava a transição com HTTP 200 e zero persistência — a clínica
 * simplesmente não conseguia registrar no-show pela interface.
 *
 * Derivar de `allowedTransitions` faz o layout seguir a regra automaticamente
 * se a tabela mudar, em vez de as duas versões divergirem em silêncio de novo.
 */
export function canMarkNoShow(status: AppointmentStatusDTO): boolean {
  return allowedTransitions(status as AppointmentState).includes('faltou');
}

export function canCheckIn(status: AppointmentStatusDTO): boolean {
  return allowedTransitions(status as AppointmentState).includes('chegou');
}
