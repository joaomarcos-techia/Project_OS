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

import { and, asc, desc, eq, gte, inArray, lte, lt, type SQL, sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { AppointmentNotFoundError } from './errors';
import {
  appointments,
  appointmentStateLog,
  clinicHolidays,
  doctorAvailability,
  procedures,
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
import type { AppointmentStatusDTO, AppointmentSummary, ProcedureSummary, Slot } from './types';

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
      const startAt = zonedWallToUtc(y!, m!, d!, Math.floor(s.startMin / 60), s.startMin % 60, timeZone);
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
