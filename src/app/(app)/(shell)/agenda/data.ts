import 'server-only';

import { sql } from 'drizzle-orm';

import { practitionerSql, profiles } from '@/contexts/identity';
import { getCurrentPractitioner } from '@/contexts/identity/internal/practitioner';
import { listPatientCards } from '@/contexts/patient/queries';
import {
  listAppointments,
  listProcedures,
  listRecurrenceSeriesSummaries,
  listSchedulableResources,
  type RecurrenceSeriesSummary,
} from '@/contexts/scheduling/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
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
  /**
   * UX-003 — origem recorrente. A projeção não transportava estes campos, então
   * a Agenda renderizava cada uma das até 104 consultas de uma série como se
   * fosse isolada: o operador não reconhecia o vínculo nem conseguia interromper
   * as futuras de uma vez.
   */
  recurrenceSeriesId: string | null;
  recurrenceOccurrence: number | null;
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
  /**
   * AUTHZ-002 — falso quando a sessão não tem `view:agenda`. Distinto de
   * `hasClinic`: "não pode ver" ≠ "não há clínica", e a tela precisa dizer a
   * coisa certa. Quando falso, TODAS as coleções vêm vazias porque nenhuma
   * query foi executada — não é filtro de render.
   */
  hasAccess: boolean;
  hasClinic: boolean;
  isPractitioner: boolean;
  selfDoctorId: string | null;
  canEditAgenda: boolean;
  canManageAvailability: boolean;
  appointments: AgendaAppt[];
  /** UX-003 — séries recorrentes presentes na faixa exibida. */
  recurrenceSeries: RecurrenceSeriesSummary[];
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
  hasAccess: false,
  hasClinic: false,
  isPractitioner: false,
  selfDoctorId: null,
  canEditAgenda: false,
  canManageAvailability: false,
  appointments: [],
  recurrenceSeries: [],
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

/**
 * Mesma semântica de `requireCachedPermission(VIEW_AGENDA)` sem lançar — o
 * loader devolve estado vazio e a página desenha "Sem acesso" (OBS-001).
 * O JWT é confiável porque `authenticate()` já conferiu `claims_version`
 * contra o banco neste request (ADR-037).
 */
function canViewAgenda(user: {
  isSuperAdmin: boolean;
  aal: string | null;
  permissions: readonly string[];
}): boolean {
  if (user.isSuperAdmin) return user.aal === 'aal2';
  return user.permissions.includes(PERMISSIONS.VIEW_AGENDA);
}

export async function getAgendaData(query: AgendaQuery = { view: 'day' }): Promise<AgendaData> {
  const user = await requireUser();
  if (!user.clinicId) return EMPTY;
  // AUTHZ-002 — o gate mora AQUI, não só na página: `data.ts` é o loader
  // compartilhado (agenda + lista de espera) e é ele quem consulta
  // appointments, patient cards, procedimentos, recursos e profissionais.
  // Gatear só na página deixaria o próximo caller reabrir o vazamento.
  // Sair antes do primeiro SELECT é o ponto: negar depois já serializou.
  if (!canViewAgenda(user)) return { ...EMPTY, hasClinic: true };
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
    recurrenceSeriesId: a.recurrenceSeriesId,
    recurrenceOccurrence: a.recurrenceOccurrence,
  }));

  // UX-003 — total e estado das séries presentes na faixa. Sem o total,
  // "ocorrência 3" não informa nada; sem `futureActive`, o operador não sabe o
  // que um cancelamento de série atingiria.
  const seriesIds = [
    ...new Set(appts.map((a) => a.recurrenceSeriesId).filter((id): id is string => id !== null)),
  ];
  const recurrenceSeries = await listRecurrenceSeriesSummaries(clinicId, seriesIds);

  return {
    hasAccess: true,
    hasClinic: true,
    isPractitioner,
    selfDoctorId: isPractitioner ? user.userId : null,
    canEditAgenda: user.permissions.includes(PERMISSIONS.EDIT_AGENDA),
    canManageAvailability: user.permissions.includes(PERMISSIONS.MANAGE_AVAILABILITY),
    appointments,
    recurrenceSeries,
    procedures,
    doctors,
    resources,
    tz,
    view: query.view,
    ymd,
  };
}
