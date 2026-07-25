import 'server-only';

import { sql } from 'drizzle-orm';

import { practitionerSql, profiles } from '@/contexts/identity';
import { getCurrentPractitioner } from '@/contexts/identity/internal/practitioner';
import { listPatientCards } from '@/contexts/patient/queries';
import {
  getClinicTimezone,
  listAppointments,
  listProcedures,
  listSchedulableResources,
} from '@/contexts/scheduling/queries';
import {
  listAppointmentRecoveryKinds,
  type AppointmentRecoveryKind,
} from '@/contexts/scheduling/recovery-policy';
import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';

import { type AgendaView, normalizeDateParam, rangeFor } from './range';

/**
 * Dados da Agenda (v1 — walk-in). Lista os atendimentos de HOJE (fuso da clínica)
 * + insumos do formulário "Novo atendimento" (procedimentos ativos + médicos).
 * Sem calendário/slots ainda — criar atendimento usa o fluxo walk-in do C6.
 */
export interface AgendaAppt {
  id: string;
  doctorId: string;
  horario: string; // ISO
  pacienteNome: string;
  medicoNome: string;
  status: AppointmentStatusDTO;
  recoveryKinds: AppointmentRecoveryKind[];
}
export interface ProcedureOption {
  id: string;
  descricao: string;
}
export interface DoctorOption {
  id: string;
  nome: string;
}
export interface ResourceOption {
  id: string;
  name: string;
  type: 'room' | 'equipment' | 'other';
}
export interface AgendaData {
  hasClinic: boolean;
  isPractitioner: boolean;
  selfDoctorId: string | null;
  canEditAgenda: boolean;
  canManageAvailability: boolean;
  appointments: AgendaAppt[];
  procedures: ProcedureOption[];
  doctors: DoctorOption[];
  resources: ResourceOption[];
  /** Fuso da clínica + faixa atual (item 12 — Mês/Semana/Dia). */
  tz: string;
  view: AgendaView;
  ymd: string;
}

const DEFAULT_TZ = 'America/Sao_Paulo';

const EMPTY: AgendaData = {
  hasClinic: false,
  isPractitioner: false,
  selfDoctorId: null,
  canEditAgenda: false,
  canManageAvailability: false,
  appointments: [],
  procedures: [],
  doctors: [],
  resources: [],
  tz: DEFAULT_TZ,
  view: 'day',
  ymd: '',
};

export interface AgendaQuery {
  view: AgendaView;
  /** Data de referência 'YYYY-MM-DD' (ou 'YYYY-MM'); default = hoje. */
  date?: string | undefined;
}

export async function getAgendaData(query: AgendaQuery = { view: 'day' }): Promise<AgendaData> {
  const user = await requireUser();
  if (!user.clinicId) return EMPTY;
  const clinicId = user.clinicId;
  const isPractitioner = await getCurrentPractitioner();

  const tz = (await getClinicTimezone(clinicId)) ?? DEFAULT_TZ;
  const ymd = normalizeDateParam(query.date, tz);
  // Mês pode ter muitos atendimentos; teto generoso p/ clínica pequena.
  const limit = query.view === 'month' ? 1000 : 300;
  const { from, to } = rangeFor(query.view, ymd, tz);
  const appts = await listAppointments(clinicId, { from, to, limit });

  const ids = [...new Set(appts.filter((a) => a.patientId).map((a) => a.patientId!))];
  const cards = await listPatientCards(clinicId, ids);
  const nameOf = new Map(cards.map((c) => [c.id, c.nome]));

  const procedures = (await listProcedures(clinicId, { onlyActive: true })).map((p) => ({
    id: p.id,
    descricao: p.descricao,
  }));
  const resources = (await listSchedulableResources(clinicId)).map((resource) => ({
    id: resource.id,
    name: resource.name,
    type: resource.type,
  }));

  const docRows = (await withTenant(clinicId, (tx) =>
    tx.execute(
      sql`SELECT id::text AS id, nome FROM profiles
          WHERE ${practitionerSql(profiles.role, profiles.crm)} AND ativo = true AND deleted_at IS NULL
            AND invite_accepted_at IS NOT NULL
          ORDER BY nome`,
    ),
  )) as unknown as Array<{ id: string; nome: string }>;
  const doctors = docRows.map((r) => ({ id: r.id, nome: r.nome }));
  const doctorNameOf = new Map(doctors.map((doctor) => [doctor.id, doctor.nome]));

  const appointments: AgendaAppt[] = appts.map((a) => ({
    id: a.id,
    doctorId: a.doctorId,
    horario: a.scheduledAt,
    pacienteNome: a.patientId ? (nameOf.get(a.patientId) ?? 'Paciente') : 'Encaixe',
    medicoNome: doctorNameOf.get(a.doctorId) ?? a.snapshotDoctorNome,
    status: a.status,
    recoveryKinds: listAppointmentRecoveryKinds(a.status),
  }));

  return {
    hasClinic: true,
    isPractitioner,
    selfDoctorId: isPractitioner ? user.userId : null,
    canEditAgenda: user.permissions.includes(PERMISSIONS.EDIT_AGENDA),
    canManageAvailability: user.permissions.includes(PERMISSIONS.MANAGE_AVAILABILITY),
    appointments,
    procedures,
    doctors,
    resources,
    tz,
    view: query.view,
    ymd,
  };
}
