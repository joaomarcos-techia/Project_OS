/**
 * Scheduling read-side (C6). All reads are tenant-scoped via withTenant (sets
 * `app.current_clinic` so RLS resolves). REGRA: NO cross-context JOIN — we only
 * reference patient_id / doctor_id, never JOIN patients / prontuarios.
 *
 * `getAvailableSlots` is the timezone-aware wrapper around the pure
 * `computeSlots` (slot-resolver.ts): it reads clinics.timezone and converts
 * wall-clock ↔ UTC at the boundary (Intl, DST-correct). Always filters by
 * clinic_id explicitly (REGRA 6.9 — defense in depth even with RLS).
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, desc, eq, gte, inArray, lte, lt, ne, type SQL, sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { AppointmentNotFoundError } from './errors';
import {
  appointments,
  appointmentStateLog,
  clinicHolidays,
  doctorAbsences,
  doctorAvailability,
  procedures,
  schedulableResources,
  waitingQueueEntries,
  waitlistEntries,
  type AppointmentRow,
  type ProcedureRow,
} from './schema';
import {
  computeSlots,
  eachLocalDayInRange,
  localDateMinutes,
  parseTimeToMinutes,
  zonedWallToUtc,
  type LocalAvailability,
  type LocalBusy,
  type LocalHoliday,
} from './slot-resolver';
import type {
  AppointmentStatusDTO,
  AppointmentSummary,
  DoctorAbsenceDTO,
  ProcedureSummary,
  SchedulableResourceDTO,
  Slot,
  WaitlistEntryDTO,
} from './types';

const DEFAULT_TZ = 'America/Sao_Paulo';
const DEFAULT_SLOT_MINUTES = 30;

const toIso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

// --- projections -----------------------------------------------------------

export function toAppointmentSummary(row: AppointmentRow): AppointmentSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    unitId: row.unitId ?? null,
    doctorId: row.doctorId,
    patientId: row.patientId ?? null,
    procedureId: row.procedureId,
    scheduledAt: toIso(row.scheduledAt)!,
    durationMin: row.durationMin,
    status: row.status as AppointmentStatusDTO,
    valor: Number(row.valor),
    valorAjustado: row.valorAjustado,
    valorAjusteMotivo: row.valorAjusteMotivo ?? null,
    snapshotProcedureName: row.snapshotProcedureName,
    snapshotProcedureCodigo: row.snapshotProcedureCodigo ?? null,
    snapshotProcedureCategoria: row.snapshotProcedureCategoria ?? null,
    snapshotProcedureValor: Number(row.snapshotProcedureValor),
    snapshotProcedureDuracaoMin: row.snapshotProcedureDuracaoMin,
    snapshotDoctorNome: row.snapshotDoctorNome,
    snapshotDoctorCrm: row.snapshotDoctorCrm ?? null,
    snapshotDoctorEspecialidade: row.snapshotDoctorEspecialidade ?? null,
    createdVia: row.createdVia,
    urgencia: row.urgencia,
    faturamentoPendente: row.faturamentoPendente,
    observacoes: row.observacoes ?? null,
    rescheduledFromAppointmentId: row.rescheduledFromAppointmentId ?? null,
    recurrenceSeriesId: row.recurrenceSeriesId ?? null,
    recurrenceOccurrence: row.recurrenceOccurrence ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

export function toProcedureSummary(row: ProcedureRow): ProcedureSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    codigo: row.codigo,
    descricao: row.descricao,
    categoria: row.categoria ?? null,
    valorPadrao: Number(row.valorPadrao),
    duracaoPadraoMin: row.duracaoPadraoMin,
    ativo: row.ativo,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

// --- appointment reads -----------------------------------------------------

export async function getAppointment(
  clinicId: string,
  id: string,
): Promise<AppointmentSummary | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(appointments).where(eq(appointments.id, id)).limit(1);
    return row ? toAppointmentSummary(row) : null;
  });
}

export async function getAppointmentOrThrow(
  clinicId: string,
  id: string,
): Promise<AppointmentSummary> {
  const row = await getAppointment(clinicId, id);
  if (!row) throw new AppointmentNotFoundError(id);
  return row;
}

export interface ListAppointmentsOpts {
  from?: Date;
  to?: Date;
  status?: AppointmentStatusDTO[];
  /** RBAC (6.6.9): when set, only this doctor's appointments are returned. */
  restrictToDoctorId?: string;
  limit?: number;
  offset?: number;
}

export async function listAppointments(
  clinicId: string,
  opts: ListAppointmentsOpts = {},
): Promise<AppointmentSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const conds: SQL[] = [eq(appointments.clinicId, clinicId)];
  if (opts.from) conds.push(gte(appointments.scheduledAt, opts.from));
  if (opts.to) conds.push(lt(appointments.scheduledAt, opts.to));
  if (opts.restrictToDoctorId) conds.push(eq(appointments.doctorId, opts.restrictToDoctorId));
  if (opts.status && opts.status.length > 0) {
    // postgres-js não serializa array JS como array PG em `= ANY(${...})`
    // (erro 42809) — usar o helper canônico inArray (lição do C4 / CONVENTIONS).
    conds.push(inArray(appointments.status, opts.status));
  }
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(appointments)
      .where(and(...conds))
      .orderBy(asc(appointments.scheduledAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toAppointmentSummary);
  });
}

export interface ListDoctorAbsencesOpts {
  doctorId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Ausências que intersectam o período informado, ordenadas pelo início. */
export async function listDoctorAbsences(
  clinicId: string,
  opts: ListDoctorAbsencesOpts = {},
): Promise<DoctorAbsenceDTO[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const conds: SQL[] = [eq(doctorAbsences.clinicId, clinicId)];
  if (opts.doctorId) conds.push(eq(doctorAbsences.doctorId, opts.doctorId));
  if (opts.from) conds.push(gte(doctorAbsences.endsAt, opts.from));
  if (opts.to) conds.push(lt(doctorAbsences.startsAt, opts.to));

  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(doctorAbsences)
      .where(and(...conds))
      .orderBy(asc(doctorAbsences.startsAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      doctorId: row.doctorId,
      startsAt: toIso(row.startsAt)!,
      endsAt: toIso(row.endsAt)!,
      reason: row.reason,
      strategy: row.strategy,
      replacementDoctorId: row.replacementDoctorId ?? null,
      affectedAppointments: row.affectedAppointments,
      createdAt: toIso(row.createdAt)!,
    }));
  });
}

/**
 * Consultas futuras que o próprio paciente pode confirmar pelo agente.
 * O filtro vive no Scheduling para que a IA não replique a máquina de estados.
 */
export async function listUpcomingPatientAppointments(
  clinicId: string,
  patientId: string,
  limit = 10,
): Promise<AppointmentSummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 20);
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.patientId, patientId),
          inArray(appointments.status, ['agendado', 'confirmado']),
          gte(appointments.scheduledAt, new Date()),
        ),
      )
      .orderBy(asc(appointments.scheduledAt))
      .limit(safeLimit);
    return rows.map(toAppointmentSummary);
  });
}

export async function hasSubsequentCompletedAppointment(
  clinicId: string,
  input: {
    patientId: string;
    after: Date;
    excludeAppointmentId?: string | null;
    procedureId?: string | null;
    doctorId?: string | null;
  },
): Promise<boolean> {
  return withTenant(clinicId, async (tx) => {
    const conditions: SQL[] = [
      eq(appointments.clinicId, clinicId),
      eq(appointments.patientId, input.patientId),
      eq(appointments.status, 'atendido'),
      gte(appointments.scheduledAt, input.after),
    ];
    if (input.excludeAppointmentId)
      conditions.push(ne(appointments.id, input.excludeAppointmentId));
    if (input.procedureId) conditions.push(eq(appointments.procedureId, input.procedureId));
    else if (input.doctorId) conditions.push(eq(appointments.doctorId, input.doctorId));
    const [row] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(...conditions))
      .limit(1);
    return Boolean(row);
  });
}

/**
 * C8: instante de check-in (última transição → `chegou`) por appointment, para
 * o "tempo aguardando" da Sala de Espera. Lê o appointment_state_log (mesmo
 * contexto). Retorna mapa appointmentId → ISO.
 */
export async function getCheckInTimes(
  clinicId: string,
  appointmentIds: string[],
): Promise<Record<string, string>> {
  if (appointmentIds.length === 0) return {};
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        appointmentId: appointmentStateLog.appointmentId,
        transitionedAt: appointmentStateLog.transitionedAt,
      })
      .from(appointmentStateLog)
      .where(
        and(
          eq(appointmentStateLog.clinicId, clinicId),
          eq(appointmentStateLog.toStatus, 'chegou'),
          inArray(appointmentStateLog.appointmentId, appointmentIds),
        ),
      )
      .orderBy(desc(appointmentStateLog.transitionedAt));
    const out: Record<string, string> = {};
    for (const r of rows) {
      // ordenado desc → o primeiro visto por appointment é o mais recente.
      if (!out[r.appointmentId]) out[r.appointmentId] = (r.transitionedAt as Date).toISOString();
    }
    return out;
  });
}

/** Timezone da clínica (CONGELADO: 1 clínica = 1 tz; default America/Sao_Paulo). */
export async function getClinicTimezone(clinicId: string): Promise<string> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx.execute<{ timezone: string | null }>(
      sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
    );
    return rows[0]?.timezone ?? DEFAULT_TZ;
  });
}

// --- procedure reads -------------------------------------------------------

export async function getProcedure(clinicId: string, id: string): Promise<ProcedureSummary | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx.select().from(procedures).where(eq(procedures.id, id)).limit(1);
    return row ? toProcedureSummary(row) : null;
  });
}

export async function listProcedures(
  clinicId: string,
  opts: { onlyActive?: boolean } = {},
): Promise<ProcedureSummary[]> {
  const conds: SQL[] = [eq(procedures.clinicId, clinicId)];
  if (opts.onlyActive) conds.push(eq(procedures.ativo, true));
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(procedures)
      .where(and(...conds))
      .orderBy(asc(procedures.descricao));
    return rows.map(toProcedureSummary);
  });
}

// --- horários (disponibilidade + feriados) ---------------------------------

export interface DoctorAvailabilityDTO {
  id: string;
  doctorId: string;
  weekday: number; // 0=domingo .. 6=sábado
  startTime: string; // HH:MM[:SS]
  endTime: string;
}

/** Janelas recorrentes de disponibilidade (tela de Configurações › Horários). */
export async function listDoctorAvailability(
  clinicId: string,
  doctorId?: string,
): Promise<DoctorAvailabilityDTO[]> {
  const conds: SQL[] = [eq(doctorAvailability.clinicId, clinicId)];
  if (doctorId) conds.push(eq(doctorAvailability.doctorId, doctorId));
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        id: doctorAvailability.id,
        doctorId: doctorAvailability.doctorId,
        weekday: doctorAvailability.weekday,
        startTime: doctorAvailability.startTime,
        endTime: doctorAvailability.endTime,
      })
      .from(doctorAvailability)
      .where(and(...conds))
      .orderBy(asc(doctorAvailability.weekday), asc(doctorAvailability.startTime));
    return rows.map((r) => ({
      id: r.id,
      doctorId: r.doctorId,
      weekday: r.weekday,
      startTime: r.startTime,
      endTime: r.endTime,
    }));
  });
}

export interface HolidayDTO {
  id: string;
  date: string; // YYYY-MM-DD
  reason: string | null;
}

/** Feriados/bloqueios de dia inteiro da clínica (tela de Horários). */
export async function listHolidays(clinicId: string): Promise<HolidayDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({ id: clinicHolidays.id, date: clinicHolidays.date, reason: clinicHolidays.reason })
      .from(clinicHolidays)
      .where(eq(clinicHolidays.clinicId, clinicId))
      .orderBy(asc(clinicHolidays.date));
    return rows.map((r) => ({ id: r.id, date: r.date as string, reason: r.reason ?? null }));
  });
}

export interface WaitingQueueInfo {
  appointmentId: string;
  priority: 'urgent' | 'normal';
  status: 'waiting' | 'in_service' | 'completed' | 'cancelled';
  queuedAt: string;
  estimatedWaitMinutesAtEntry: number;
}

export async function getWaitingQueueEntries(
  clinicId: string,
  appointmentIds: readonly string[],
): Promise<WaitingQueueInfo[]> {
  if (appointmentIds.length === 0) return [];
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        appointmentId: waitingQueueEntries.appointmentId,
        priority: waitingQueueEntries.priority,
        status: waitingQueueEntries.status,
        queuedAt: waitingQueueEntries.queuedAt,
        estimatedWaitMinutesAtEntry: waitingQueueEntries.estimatedWaitMinutesAtEntry,
      })
      .from(waitingQueueEntries)
      .where(
        and(
          eq(waitingQueueEntries.clinicId, clinicId),
          inArray(waitingQueueEntries.appointmentId, [...appointmentIds]),
        ),
      )
      .orderBy(
        sql`case when ${waitingQueueEntries.status} = 'in_service' then 0 else 1 end`,
        sql`case when ${waitingQueueEntries.priority} = 'urgent' then 0 else 1 end`,
        asc(waitingQueueEntries.queuedAt),
      );
    return rows.map((row) => ({
      ...row,
      queuedAt: row.queuedAt.toISOString(),
    }));
  });
}

export async function listWaitlistEntries(
  clinicId: string,
  includeClosed = false,
): Promise<WaitlistEntryDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const conditions: SQL[] = [eq(waitlistEntries.clinicId, clinicId)];
    if (!includeClosed) conditions.push(inArray(waitlistEntries.status, ['waiting', 'offered']));
    const rows = await tx
      .select()
      .from(waitlistEntries)
      .where(and(...conditions))
      .orderBy(
        sql`case when ${waitlistEntries.priority} = 'urgent' then 0 else 1 end`,
        asc(waitlistEntries.createdAt),
      );
    return rows.map((row) => ({
      id: row.id,
      patientId: row.patientId,
      doctorId: row.doctorId ?? null,
      procedureId: row.procedureId,
      priority: row.priority,
      status: row.status,
      preferredFrom: row.preferredFrom?.toISOString() ?? null,
      preferredUntil: row.preferredUntil?.toISOString() ?? null,
      offeredAppointmentId: row.offeredAppointmentId ?? null,
      bookedAppointmentId: row.bookedAppointmentId ?? null,
      notes: row.notes ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

export async function listSchedulableResources(
  clinicId: string,
  onlyActive = true,
): Promise<SchedulableResourceDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select()
      .from(schedulableResources)
      .where(
        and(
          eq(schedulableResources.clinicId, clinicId),
          ...(onlyActive ? [eq(schedulableResources.active, true)] : []),
        ),
      )
      .orderBy(asc(schedulableResources.type), asc(schedulableResources.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      unitId: row.unitId ?? null,
      active: row.active,
    }));
  });
}

// --- relatórios (agregados de período) -------------------------------------

export interface AppointmentStats {
  total: number;
  atendido: number;
  faltou: number;
  cancelado: number;
  agendado: number;
  confirmado: number;
  /** Soma da duração (min) dos atendimentos que ocupam instante — base da ocupação. */
  busyMinutes: number;
}

export interface AppointmentStatsByDoctor {
  doctorId: string;
  nome: string;
  total: number;
  atendidos: number;
  faltas: number;
  appointmentIds: string[];
}

/**
 * Contagens por status num período [from, to) (Relatórios: no-show, volume) +
 * minutos ocupados (para a ocupação, combinada com a capacidade livre do
 * slot-resolver canônico na page). Uma query agregada (sum(case when)) —
 * tenant-scoped, sem trazer linhas. doctorId opcional restringe ao profissional.
 */
export async function getAppointmentStats(
  clinicId: string,
  from: Date,
  to: Date,
  doctorId?: string,
): Promise<AppointmentStats> {
  const conds: SQL[] = [
    eq(appointments.clinicId, clinicId),
    gte(appointments.scheduledAt, from),
    lt(appointments.scheduledAt, to),
  ];
  if (doctorId) conds.push(eq(appointments.doctorId, doctorId));
  return withTenant(clinicId, async (tx) => {
    const [r] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        atendido: sql<number>`coalesce(sum(case when ${appointments.status} = 'atendido' then 1 else 0 end), 0)::int`,
        faltou: sql<number>`coalesce(sum(case when ${appointments.status} = 'faltou' then 1 else 0 end), 0)::int`,
        cancelado: sql<number>`coalesce(sum(case when ${appointments.status} = 'cancelado' then 1 else 0 end), 0)::int`,
        agendado: sql<number>`coalesce(sum(case when ${appointments.status} = 'agendado' then 1 else 0 end), 0)::int`,
        confirmado: sql<number>`coalesce(sum(case when ${appointments.status} = 'confirmado' then 1 else 0 end), 0)::int`,
        busyMinutes: sql<number>`coalesce(sum(case when ${appointments.slotOccupiesInstant} = true then ${appointments.durationMin} else 0 end), 0)::int`,
      })
      .from(appointments)
      .where(and(...conds));
    return {
      total: r?.total ?? 0,
      atendido: r?.atendido ?? 0,
      faltou: r?.faltou ?? 0,
      cancelado: r?.cancelado ?? 0,
      agendado: r?.agendado ?? 0,
      confirmado: r?.confirmado ?? 0,
      busyMinutes: r?.busyMinutes ?? 0,
    };
  });
}

/**
 * Consolidado por profissional no período. A agregação acontece no banco e
 * inclui todos os atendimentos; `appointmentIds` é o seam necessário para a
 * camada de relatórios associar recebimentos sem JOIN entre contextos.
 */
export async function getAppointmentStatsByDoctor(
  clinicId: string,
  from: Date,
  to: Date,
): Promise<AppointmentStatsByDoctor[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        doctorId: appointments.doctorId,
        nome: sql<string>`(array_agg(${appointments.snapshotDoctorNome} order by ${appointments.scheduledAt} desc))[1]`,
        total: sql<number>`count(*)::int`,
        atendidos: sql<number>`coalesce(sum(case when ${appointments.status} = 'atendido' then 1 else 0 end), 0)::int`,
        faltas: sql<number>`coalesce(sum(case when ${appointments.status} = 'faltou' then 1 else 0 end), 0)::int`,
        appointmentIds: sql<string[]>`array_agg(${appointments.id})`,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          gte(appointments.scheduledAt, from),
          lt(appointments.scheduledAt, to),
        ),
      )
      .groupBy(appointments.doctorId);

    return rows.map((row) => ({
      doctorId: row.doctorId,
      nome: row.nome,
      total: row.total,
      atendidos: row.atendidos,
      faltas: row.faltas,
      appointmentIds: row.appointmentIds,
    }));
  });
}

/**
 * Compromissos que BLOQUEIAM a desativação de um médico (ADR-032 §4 — "agenda
 * futura ou consulta aberta"). Contrato cross-context exposto via `schedulingApiV1`
 * para o Identity/app-layer decidir o offboarding — Scheduling é dono da regra do
 * que conta como "agenda futura/consulta aberta", ninguém lê `appointments` de fora.
 *
 *   - agenda futura  = agendado/confirmado com `scheduled_at >= agora`
 *   - consulta aberta = chegou/em_atendimento (independe da data — está acontecendo)
 *
 * `nextAt` é o proximo compromisso (para a UI dizer "remaneje X a partir de tal dia").
 */
export interface DoctorCommitments {
  futureCount: number;
  openCount: number;
  nextAt: string | null;
}

export async function getDoctorActiveCommitments(
  clinicId: string,
  doctorId: string,
): Promise<DoctorCommitments> {
  return withTenant(clinicId, async (tx) => {
    const [r] = await tx
      .select({
        futureCount: sql<number>`coalesce(sum(case when ${appointments.status} in ('agendado','confirmado') and ${appointments.scheduledAt} >= now() then 1 else 0 end), 0)::int`,
        openCount: sql<number>`coalesce(sum(case when ${appointments.status} in ('chegou','em_atendimento') then 1 else 0 end), 0)::int`,
        nextAt: sql<
          string | null
        >`min(case when ${appointments.status} in ('agendado','confirmado') and ${appointments.scheduledAt} >= now() then ${appointments.scheduledAt} end)`,
      })
      .from(appointments)
      .where(and(eq(appointments.clinicId, clinicId), eq(appointments.doctorId, doctorId)));
    return {
      futureCount: r?.futureCount ?? 0,
      openCount: r?.openCount ?? 0,
      nextAt: toIso(r?.nextAt ?? null),
    };
  });
}

// --- slot resolver (tz-aware wrapper) --------------------------------------

export interface GetAvailableSlotsOpts {
  clinicId: string;
  from: Date;
  to: Date;
  doctorId?: string;
  procedureId?: string;
  unitId?: string | null;
}

export async function getAvailableSlots(opts: GetAvailableSlotsOpts): Promise<Slot[]> {
  const { clinicId, from, to } = opts;
  return withTenant(clinicId, async (tx) => {
    // 1. clinic timezone (CONGELADO: 1 clínica = 1 tz).
    const tzRows = await tx.execute<{ timezone: string | null }>(
      sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
    );
    const timeZone = tzRows[0]?.timezone ?? DEFAULT_TZ;

    // 2. slot granularity = procedure duration if given, else default.
    let slotMinutes = DEFAULT_SLOT_MINUTES;
    if (opts.procedureId) {
      const [proc] = await tx
        .select({ dur: procedures.duracaoPadraoMin })
        .from(procedures)
        .where(and(eq(procedures.clinicId, clinicId), eq(procedures.id, opts.procedureId)))
        .limit(1);
      if (proc) slotMinutes = proc.dur;
    }

    // 3. availabilities (local wall-clock).
    const availConds: SQL[] = [eq(doctorAvailability.clinicId, clinicId)];
    if (opts.doctorId) availConds.push(eq(doctorAvailability.doctorId, opts.doctorId));
    const availRows = await tx
      .select()
      .from(doctorAvailability)
      .where(and(...availConds));
    const availabilities: LocalAvailability[] = availRows.map((a) => ({
      doctorId: a.doctorId,
      unitId: a.unitId ?? null,
      weekday: a.weekday,
      startMin: parseTimeToMinutes(a.startTime),
      endMin: parseTimeToMinutes(a.endTime),
    }));

    // 4. busy appointments (non-terminal) → local date + minutes.
    const busyConds: SQL[] = [
      eq(appointments.clinicId, clinicId),
      gte(appointments.scheduledAt, from),
      lt(appointments.scheduledAt, to),
      eq(appointments.slotOccupiesInstant, true),
    ];
    if (opts.doctorId) busyConds.push(eq(appointments.doctorId, opts.doctorId));
    const busyRows = await tx
      .select({
        doctorId: appointments.doctorId,
        scheduledAt: appointments.scheduledAt,
        durationMin: appointments.durationMin,
      })
      .from(appointments)
      .where(and(...busyConds));
    const busy: LocalBusy[] = busyRows.map((b) => {
      const { date, minutes } = localDateMinutes(b.scheduledAt as Date, timeZone);
      return { doctorId: b.doctorId, date, startMin: minutes, endMin: minutes + b.durationMin };
    });

    // 5. holidays within the local date window.
    const fromDate = localDateMinutes(from, timeZone).date;
    const toDate = localDateMinutes(to, timeZone).date;
    const holidayRows = await tx
      .select()
      .from(clinicHolidays)
      .where(
        and(
          eq(clinicHolidays.clinicId, clinicId),
          gte(clinicHolidays.date, fromDate),
          lte(clinicHolidays.date, toDate),
        ),
      );
    const holidays: LocalHoliday[] = holidayRows.map((h) => ({
      date: h.date,
      unitId: h.unitId ?? null,
      startMin: h.startTime ? parseTimeToMinutes(h.startTime) : null,
      endMin: h.endTime ? parseTimeToMinutes(h.endTime) : null,
    }));

    // 6. pure compute, then convert local slots back to UTC instants.
    const days = eachLocalDayInRange(from, to, timeZone);
    const localSlots = computeSlots({
      days,
      availabilities,
      busy,
      holidays,
      slotMinutes,
      doctorId: opts.doctorId,
      unitId: opts.unitId,
    });

    return localSlots.map((s): Slot => {
      const [y, m, d] = s.date.split('-').map(Number);
      const startAt = zonedWallToUtc(
        y!,
        m!,
        d!,
        Math.floor(s.startMin / 60),
        s.startMin % 60,
        timeZone,
      );
      const endAt = zonedWallToUtc(y!, m!, d!, Math.floor(s.endMin / 60), s.endMin % 60, timeZone);
      return {
        doctorId: s.doctorId,
        unitId: s.unitId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        durationMin: s.endMin - s.startMin,
      };
    });
  });
}
