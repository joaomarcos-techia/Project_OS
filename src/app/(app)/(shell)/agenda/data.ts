import 'server-only';

import { sql } from 'drizzle-orm';

import { listPatientCards } from '@/contexts/patient/queries';
import { getClinicTimezone, listAppointments, listProcedures } from '@/contexts/scheduling/queries';
import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';

/**
 * Dados da Agenda (v1 — walk-in). Lista os atendimentos de HOJE (fuso da clínica)
 * + insumos do formulário "Novo atendimento" (procedimentos ativos + médicos).
 * Sem calendário/slots ainda — criar atendimento usa o fluxo walk-in do C6.
 */
export interface AgendaAppt {
  id: string;
  horario: string; // ISO
  pacienteNome: string;
  medicoNome: string;
  status: AppointmentStatusDTO;
}
export interface ProcedureOption {
  id: string;
  descricao: string;
}
export interface DoctorOption {
  id: string;
  nome: string;
}
export interface AgendaData {
  hasClinic: boolean;
  isDoctor: boolean;
  selfDoctorId: string | null;
  appointments: AgendaAppt[];
  procedures: ProcedureOption[];
  doctors: DoctorOption[];
}

const DEFAULT_TZ = 'America/Sao_Paulo';

function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    // hourCycle:'h23' (não hour12:false): evita o bug do ICU que renderiza meia-noite como "24".
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') map[p.type] = Number(p.value);
  const asUtc = Date.UTC(map.year!, map.month! - 1, map.day!, map.hour!, map.minute!, map.second!);
  return asUtc - date.getTime();
}

/** Janela [00:00, 24:00) de hoje no fuso da clínica, em instantes UTC. */
function clinicDayBounds(tz: string): { from: Date; to: Date } {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  const utcGuess = Date.UTC(y!, m! - 1, d!, 0, 0, 0);
  const from = new Date(utcGuess - tzOffsetMs(new Date(utcGuess), tz));
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

const EMPTY: AgendaData = {
  hasClinic: false,
  isDoctor: false,
  selfDoctorId: null,
  appointments: [],
  procedures: [],
  doctors: [],
};

export async function getAgendaData(): Promise<AgendaData> {
  const user = await requireUser();
  if (!user.clinicId) return EMPTY;
  const clinicId = user.clinicId;
  const isDoctor = user.role === 'doctor';

  const tz = (await getClinicTimezone(clinicId)) ?? DEFAULT_TZ;
  const { from, to } = clinicDayBounds(tz);
  const appts = await listAppointments(clinicId, { from, to, limit: 200 });

  const ids = [...new Set(appts.filter((a) => a.patientId).map((a) => a.patientId!))];
  const cards = await listPatientCards(clinicId, ids);
  const nameOf = new Map(cards.map((c) => [c.id, c.nome]));

  const procedures = (await listProcedures(clinicId, { onlyActive: true })).map((p) => ({
    id: p.id,
    descricao: p.descricao,
  }));

  const docRows = (await withTenant(clinicId, (tx) =>
    tx.execute(
      sql`SELECT id::text AS id, nome FROM profiles
          WHERE role = 'doctor' AND ativo = true AND deleted_at IS NULL
          ORDER BY nome`,
    ),
  )) as unknown as Array<{ id: string; nome: string }>;
  const doctors = docRows.map((r) => ({ id: r.id, nome: r.nome }));

  const appointments: AgendaAppt[] = appts.map((a) => ({
    id: a.id,
    horario: a.scheduledAt,
    pacienteNome: a.patientId ? (nameOf.get(a.patientId) ?? 'Paciente') : 'Encaixe',
    medicoNome: a.snapshotDoctorNome,
    status: a.status,
  }));

  return {
    hasClinic: true,
    isDoctor,
    selfDoctorId: isDoctor ? user.userId : null,
    appointments,
    procedures,
    doctors,
  };
}
