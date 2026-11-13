import 'server-only';

import { sql } from 'drizzle-orm';

import {
  DELIVERY_FAILURE_LIST_LIMIT,
  deliveryFailureWindowStart,
  listRecentProactiveFailures,
} from '@/contexts/ai-agent/queries';
import { practitionerSql, profiles } from '@/contexts/identity';
import { getCurrentPractitioner } from '@/contexts/identity/internal/practitioner';
import { listPatientCards } from '@/contexts/patient/queries';
import { paymentsApiV1 } from '@/contexts/payments';
import { ageFromBirthdate } from '../consultorio/board-logic';
import {
  listAppointments,
  listProcedures,
  listQueueTimestamps,
  listRecurrenceSeriesSummaries,
  listSchedulableResources,
  type RecurrenceSeriesSummary,
} from '@/contexts/scheduling/queries';
import {
  getSchedulingInsuranceOptions,
  type SchedulingInsuranceOptions,
} from '@/contexts/health-insurance/config-queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import type { DepositStatus } from '@/components/ui/status-badge';
import {
  listAppointmentRecoveryKinds,
  type AppointmentRecoveryKind,
} from '@/contexts/scheduling/recovery-policy';
import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';

import {
  buildAgendaDeliveryFailures,
  type AgendaDeliveryFailure,
  type AgendaFailureAppointment,
} from './delivery-failures';
import { type AgendaView, normalizeDateParam, rangeFor, todayYmd } from './range';

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
  /** Idade do paciente — a segunda linha da célula "Paciente" na referência. */
  pacienteIdade: number | null;
  medicoNome: string;
  /** Nome do procedimento no snapshot da criação (coluna "Procedimento"). */
  procedimento: string;
  /** Duração agendada, em minutos — segunda linha da célula "Hora". */
  duracaoMin: number;
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
  /**
   * ADR-049 1.6b — estado do sinal. Sem isto a recepcao nao sabia que a vaga
   * estava SEGURADA aguardando pagamento, nem que seria cancelada sozinha.
   */
  depositStatus: DepositStatus;
  /** Ate quando a vaga fica segurada (ISO). Nao-nulo somente em `pending`. */
  holdExpiresAt: string | null;
  /** Marcado como urgente na criação — a referência põe um selo ao lado do nome. */
  urgencia: boolean;
  /** `walkin` é o encaixe; a referência diz a que horas ele foi criado. */
  createdVia: string;
  /** Criação do atendimento (ISO) — é a hora do encaixe. */
  criadoEm: string;
  /** Check-in na fila do consultório (ISO). Null enquanto não chegou. */
  filaDesde: string | null;
  /** Chamada para atendimento (ISO). Null enquanto não foi chamado. */
  atendimentoDesde: string | null;
}
export interface ProcedureOption {
  id: string;
  descricao: string;
  valorPadrao: number;
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
  /**
   * EC-32 — mensagens automáticas (C14) que não chegaram ao paciente nos
   * últimos 7 dias. A faixa mostra as acionáveis; o selo da linha, todas.
   */
  deliveryFailures: AgendaDeliveryFailure[];
  /** A leitura bateu no teto: pode haver mais falhas no período. */
  deliveryFailuresLimited: boolean;
  /** Fuso da clínica + faixa atual (item 12 — Mês/Semana/Dia). */
  tz: string;
  view: AgendaView;
  ymd: string;
  /**
   * ADR-072 (P4.4): opções da forma de atendimento "Convênio". Ausente/nulo = a clínica
   * não usa convênio (ou o módulo não existe no ambiente) e o formulário fica como era.
   */
  insurance?: SchedulingInsuranceOptions | null;
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
  deliveryFailures: [],
  deliveryFailuresLimited: false,
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

  // TRÊS RODADAS, não dez idas em fila indiana.
  //
  // Cada consulta aqui é um `withTenant` próprio, e cada `withTenant` é um round
  // trip completo — abre transação, troca o papel para `authenticated`, seta o
  // GUC do tenant. Encadear o que não depende um do outro multiplica latência
  // sem motivo: medido no Preview, o documento desta rota levava 3.254 ms
  // streamando, com TTFB de 69 ms. O tempo estava todo aqui.
  //
  // A ordem das rodadas é ditada por dependência real, não por estilo:
  //   1. o que não depende de nada (inclusive o fuso, que a faixa de datas usa,
  //      e as mensagens automáticas que não chegaram);
  //   2. os atendimentos, que precisam da faixa, e a consulta e a cobrança de
  //      cada mensagem que falhou;
  //   3. o que se resolve a partir dos atendimentos.
  const now = new Date();
  const [isPractitioner, tzRaw, proceduresRaw, resourcesRaw, docRows, failures] = await Promise.all(
    [
      getCurrentPractitioner(),
      getClinicTimezone(clinicId),
      listProcedures(clinicId, { onlyActive: true }),
      listSchedulableResources(clinicId),
      withTenant(clinicId, (tx) =>
        tx.execute(
          sql`SELECT id::text AS id, nome FROM profiles
          WHERE ${practitionerSql(profiles.role, profiles.crm)} AND ativo = true AND deleted_at IS NULL
            AND invite_accepted_at IS NOT NULL
          ORDER BY nome`,
        ),
      ) as Promise<unknown> as Promise<Array<{ id: string; nome: string }>>,
      // EC-32 — sem isto a recusa da Meta só aparecia no banco: no sinal, a vaga
      // vencia sem a recepção saber que o paciente não recebeu o link.
      listRecentProactiveFailures(clinicId, { since: deliveryFailureWindowStart(now) }),
    ],
  );

  const tz = tzRaw ?? DEFAULT_TZ;
  const ymd = normalizeDateParam(query.date, tz);
  // Mês pode ter muitos atendimentos; teto generoso p/ clínica pequena.
  const limit = query.view === 'month' ? 1000 : 300;
  const { from, to } = rangeFor(query.view, ymd, tz);

  // A consulta de cada falha pode estar fora da faixa exibida (o sinal de uma
  // consulta da semana que vem), então ela vem por id, em lote. A cobrança só
  // decide se o "Copiar link" aparece; nenhum valor sai daqui.
  const failureAppointmentIds = [
    ...new Set(failures.flatMap((f) => (f.appointmentId ? [f.appointmentId] : []))),
  ];
  const chargeAppointmentIds = [
    ...new Set(failures.flatMap((f) => (f.chargeId && f.appointmentId ? [f.appointmentId] : []))),
  ];
  const [appts, failureAppts, charges] = await Promise.all([
    listAppointments(clinicId, { from, to, limit }),
    listAppointments(clinicId, {
      ids: failureAppointmentIds,
      limit: Math.max(failureAppointmentIds.length, 1),
    }),
    paymentsApiV1.listPatientChargeEconomics(clinicId, chargeAppointmentIds),
  ]);

  const ids = [
    ...new Set([
      ...appts.filter((a) => a.patientId).map((a) => a.patientId!),
      ...failures.flatMap((f) => (f.patientId ? [f.patientId] : [])),
    ]),
  ];
  const seriesIds = [
    ...new Set(appts.map((a) => a.recurrenceSeriesId).filter((id): id is string => id !== null)),
  ];

  const [cards, fila, recurrenceSeries] = await Promise.all([
    listPatientCards(clinicId, ids),
    // Uma leitura em lote, não uma por linha: os carimbos da fila só existem
    // para quem passou pelo consultório, e a maioria do dia nunca tem entrada.
    listQueueTimestamps(
      clinicId,
      appts.filter((a) => a.status === 'chegou' || a.status === 'em_atendimento').map((a) => a.id),
    ),
    // UX-003 — total e estado das séries presentes na faixa. Sem o total,
    // "ocorrência 3" não informa nada; sem `futureActive`, o operador não sabe
    // o que um cancelamento de série atingiria.
    listRecurrenceSeriesSummaries(clinicId, seriesIds),
  ]);

  const nameOf = new Map(cards.map((c) => [c.id, c.nome]));
  const birthOf = new Map(cards.map((c) => [c.id, c.dataNascimento]));
  const procedures = proceduresRaw.map((p) => ({
    id: p.id,
    descricao: p.descricao,
    valorPadrao: p.valorPadrao,
  }));
  const resources = resourcesRaw.map((resource) => ({
    id: resource.id,
    name: resource.name,
    type: resource.type,
  }));
  const doctors = docRows.map((r) => ({ id: r.id, nome: r.nome }));
  const doctorNameOf = new Map(doctors.map((doctor) => [doctor.id, doctor.nome]));
  const filaDe = new Map(fila.map((f) => [f.appointmentId, f]));

  const appointments: AgendaAppt[] = appts.map((a) => ({
    id: a.id,
    doctorId: a.doctorId,
    horario: a.scheduledAt,
    pacienteNome: a.patientId ? (nameOf.get(a.patientId) ?? 'Paciente') : 'Encaixe',
    pacienteIdade: ageFromBirthdate(a.patientId ? (birthOf.get(a.patientId) ?? null) : null),
    medicoNome: doctorNameOf.get(a.doctorId) ?? a.snapshotDoctorNome,
    procedimento: a.snapshotProcedureName,
    duracaoMin: a.durationMin,
    status: a.status,
    recoveryKinds: listAppointmentRecoveryKinds(a.status),
    recurrenceSeriesId: a.recurrenceSeriesId,
    recurrenceOccurrence: a.recurrenceOccurrence,
    depositStatus: a.depositStatus,
    holdExpiresAt: a.holdExpiresAt,
    urgencia: a.urgencia,
    createdVia: a.createdVia,
    criadoEm: a.createdAt,
    filaDesde: filaDe.get(a.id)?.queuedAt ?? null,
    atendimentoDesde: filaDe.get(a.id)?.startedAt ?? null,
  }));

  // Convênio nunca derruba a agenda: falha na leitura = formulário sem a opção.
  const insurance = user.permissions.includes(PERMISSIONS.EDIT_AGENDA)
    ? await getSchedulingInsuranceOptions(clinicId).catch((error: unknown) => {
        console.warn('[agenda] opções de convênio indisponíveis', error instanceof Error ? error.name : 'erro');
        return null;
      })
    : null;

  const deliveryFailures = buildAgendaDeliveryFailures({
    failures,
    appointments: new Map<string, AgendaFailureAppointment>(failureAppts.map((a) => [a.id, a])),
    chargeStatus: new Map(charges.map((charge) => [charge.chargeId, charge.status])),
    patientNames: nameOf,
    now,
    today: todayYmd(tz, now),
  });

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
    deliveryFailures,
    deliveryFailuresLimited: failures.length >= DELIVERY_FAILURE_LIST_LIMIT,
    tz,
    view: query.view,
    ymd,
    insurance,
  };
}
