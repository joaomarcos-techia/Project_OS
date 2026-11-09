'use server';

/**
 * Server Actions de ORQUESTRAÇÃO do Consultório (C8). NENHUMA regra de negócio
 * mora aqui — cada função delega para contratos já congelados (Scheduling C6 /
 * Clinical C7) e só compõe leituras para o board. O estado nunca é fonte de
 * verdade: toda transição passa pelas actions de C6 (FOR UPDATE + assertTransition
 * + outbox na mesma TX), garantindo "apenas um vence" sob concorrência.
 *
 * Retornam `ActionResult` (sem redirect): o board e o painel central atualizam
 * in-place via Realtime/refetch.
 */
import {
  createMedicalDocument,
  createPrescription,
  createProntuario,
  signProntuario,
} from '@/contexts/clinical/actions';
import { readProntuarioAudited } from '@/contexts/clinical/prontuario-access';
import type {
  CreateMedicalDocumentInput,
  CreatePrescriptionInput,
  ProntuarioDetail,
  SignProntuarioInput,
} from '@/contexts/clinical/types';
import { getCurrentPractitioner } from '@/contexts/identity/internal/practitioner';
import { listPendenciasAbertas } from '@/contexts/financial/queries';
import { listPatientCards } from '@/contexts/patient/queries';
import {
  checkInAppointment,
  completeAppointment,
  markNoShow,
  startAppointment,
} from '@/contexts/scheduling/actions';
import {
  getAppointmentOrThrow,
  getCheckInTimes,
  getWaitingQueueEntries,
  listAppointments,
} from '@/contexts/scheduling/queries';
import { canCompleteClinically } from '@/contexts/scheduling/internal/clinical-completion';
import type { AppointmentStatusDTO } from '@/contexts/scheduling/types';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getCurrentUser, requireUser } from '@/lib/auth/tenant-context';

import {
  DAY_FETCH_CAP,
  EMPTY_BOARD,
  STATUS_TODAY,
  ageFromBirthdate,
  buildCard,
  clinicDayBounds,
  fail,
  motivoOf,
  ok,
  pickByStatus,
} from './board-logic';
import type { ActionResult, AtendimentoDTO, BoardDoctorDTO, BoardDTO } from './board-types';

// timezone é congelado por clínica (1 clínica = 1 tz) → cache de processo, evita
// uma ida ao banco por getBoard (hot path do polling).
const tzCache = new Map<string, string>();
async function clinicTimezoneCached(clinicId: string): Promise<string> {
  const hit = tzCache.get(clinicId);
  if (hit) return hit;
  const tz = await getClinicTimezone(clinicId);
  tzCache.set(clinicId, tz);
  return tz;
}

// --- board read ------------------------------------------------------------

export async function getBoard(input: { doctorId?: string | null } = {}): Promise<BoardDTO> {
  // Hot path (polling): deriva permissão/clinicId de UM requireUser — evita 2-3
  // round-trips de auth (getClaims) por chamada. A página já barra quem não tem
  // a permissão; aqui é defesa silenciosa.
  const user = await requireUser();
  if (!user.permissions.includes(PERMISSIONS.VIEW_CONSULTORIO) || !user.clinicId) {
    return EMPTY_BOARD;
  }
  const clinicId = user.clinicId;
  // ADR-032/033: capacidade clínica = practitioner (owner-médico incluso), não role==='doctor'.
  // Practitioner vê só a própria fila; front-desk (não-practitioner) vê todas + seletor.
  const isPractitioner = await getCurrentPractitioner();

  const tz = await clinicTimezoneCached(clinicId);
  const { from, to } = clinicDayBounds(tz);

  // Médico → só a própria fila. Demais → todos do dia (deriva o seletor + filtra
  // em JS pela seleção). RLS já isola o tenant; o restrict é RBAC de visão.
  const dayAppts = await listAppointments(clinicId, {
    from,
    to,
    status: STATUS_TODAY,
    ...(isPractitioner ? { restrictToDoctorId: user.userId } : {}),
    limit: DAY_FETCH_CAP,
  });
  const truncated = dayAppts.length >= DAY_FETCH_CAP;

  let doctors: BoardDoctorDTO[] = [];
  let activeDoctorId: string | null = isPractitioner ? user.userId : (input.doctorId ?? null);
  let scoped = dayAppts;
  if (!isPractitioner) {
    const seen = new Map<string, string>();
    for (const a of dayAppts) if (!seen.has(a.doctorId)) seen.set(a.doctorId, a.snapshotDoctorNome);
    doctors = [...seen]
      .map(([id, nome]) => ({ id, nome }))
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
    // Item 13: NUNCA "visão geral" (todos os médicos misturados) — o card não
    // mostra a qual médico o paciente pertence. Sem seleção → default ao 1º
    // médico do dia. O board é sempre a fila de UM médico.
    if (!activeDoctorId) activeDoctorId = doctors[0]?.id ?? null;
    if (activeDoctorId) scoped = dayAppts.filter((a) => a.doctorId === activeDoctorId);
  }

  const patientIds = [...new Set(scoped.filter((a) => a.patientId).map((a) => a.patientId!))];
  const chegouIds = scoped.filter((a) => a.status === 'chegou').map((a) => a.id);
  // leituras independentes em paralelo (1 RTT em vez de 3). Pendências de
  // cobrança são best-effort: o board (Scheduling) nunca quebra por Financial.
  const [cards, checkInTimes, pendencias, queueEntries] = await Promise.all([
    listPatientCards(clinicId, patientIds),
    getCheckInTimes(clinicId, chegouIds),
    listPendenciasAbertas(clinicId).catch(() => []),
    getWaitingQueueEntries(clinicId, chegouIds),
  ]);
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  const semCobranca = new Set(pendencias.map((p) => p.appointmentId).filter(Boolean));
  const queueMap = new Map(
    queueEntries.map((entry, index) => [entry.appointmentId, { ...entry, position: index + 1 }]),
  );

  const now = new Date();
  const pick = (statuses: AppointmentStatusDTO[]) =>
    pickByStatus(scoped, statuses).map((a) =>
      buildCard(
        a,
        a.patientId ? cardMap.get(a.patientId) : undefined,
        checkInTimes[a.id] ?? null,
        now,
      ),
    );
  const waiting = pickByStatus(scoped, ['chegou'])
    .slice()
    .sort((left, right) => {
      const leftPosition = queueMap.get(left.id)?.position ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = queueMap.get(right.id)?.position ?? Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition;
    })
    .map((appointment) => {
      const queue = queueMap.get(appointment.id);
      return buildCard(
        appointment,
        appointment.patientId ? cardMap.get(appointment.patientId) : undefined,
        checkInTimes[appointment.id] ?? null,
        now,
        queue
          ? {
              position: queue.position,
              estimatedWaitMinutes: queue.estimatedWaitMinutesAtEntry,
            }
          : undefined,
      );
    });

  return {
    activeDoctorId,
    doctors,
    aChegar: pick(['agendado', 'confirmado']),
    salaEspera: waiting,
    emAtendimento: pick(['em_atendimento']),
    finalizadas: pick(['atendido']).map((c) => ({
      ...c,
      cobrancaPendente: semCobranca.has(c.appointmentId),
    })),
    truncated,
  };
}

// --- painel central --------------------------------------------------------

export async function loadAtendimento(
  appointmentId: string,
): Promise<ActionResult<AtendimentoDTO>> {
  try {
    const user = await requireUser();
    if (!user.permissions.includes(PERMISSIONS.VIEW_CONSULTORIO) || !user.clinicId) {
      return { ok: false, code: 'forbidden', message: 'Você não tem permissão para esta ação.' };
    }
    const clinicId = user.clinicId;
    const appt = await getAppointmentOrThrow(clinicId, appointmentId);

    const [cards, existing] = await Promise.all([
      appt.patientId ? listPatientCards(clinicId, [appt.patientId]) : Promise.resolve([]),
      // LGPD (peso 5): o painel decifra o SOAP; a leitura grava
      // `clinical.prontuario.viewed` na mesma tx (ver prontuario-access.ts).
      readProntuarioAudited(clinicId, 'consultorio_atendimento', { appointmentId }),
    ]);
    const card = cards[0];
    let prontuario: ProntuarioDetail | null = existing;
    // Em atendimento, sem prontuário ainda, e o usuário pode criar → cria sob
    // demanda (idempotente no appointment_id). Cobre "atendente chamou, médico
    // senta depois" e o worker de outbox lento (Vercel Hobby).
    if (
      !prontuario &&
      appt.patientId &&
      appt.status === 'em_atendimento' &&
      user.permissions.includes(PERMISSIONS.CREATE_PRONTUARIO)
    ) {
      prontuario = await createProntuario(
        { patientId: appt.patientId, appointmentId },
        crypto.randomUUID(),
      );
    }

    return ok({
      appointmentId,
      patientId: appt.patientId,
      pacienteNome: card?.nome ?? (appt.patientId ? 'Paciente' : 'Paciente sem cadastro'),
      alergias: card?.alergias ?? [],
      idade: ageFromBirthdate(card?.dataNascimento ?? null),
      sexo: card?.sexo ?? null,
      motivo: motivoOf(appt),
      status: appt.status,
      prontuario,
      // AUTHZ-008 — mesma regra pura que a action e o core aplicam.
      canComplete: canCompleteClinically(user, appt.doctorId),
      canEditProntuario: user.permissions.includes(PERMISSIONS.CREATE_PRONTUARIO),
    });
  } catch (err) {
    return fail(err);
  }
}

// --- transições (delegam para C6/C7) ---------------------------------------

/** Chamar próximo: startAppointment (chegou→em_atendimento) + garante prontuário. */
export async function callNextPatient(
  appointmentId: string,
  idempotencyKey: string,
): Promise<ActionResult<{ prontuarioId: string | null }>> {
  try {
    const appt = await startAppointment(appointmentId, idempotencyKey);
    let prontuarioId: string | null = null;
    const user = await getCurrentUser();
    if (appt.patientId && user?.permissions.includes(PERMISSIONS.CREATE_PRONTUARIO)) {
      const p = await createProntuario(
        { patientId: appt.patientId, appointmentId },
        idempotencyKey,
      );
      prontuarioId = p.id;
    }
    return ok({ prontuarioId });
  } catch (err) {
    return fail(err);
  }
}

export async function checkInPatient(
  appointmentId: string,
  idempotencyKey: string,
): Promise<ActionResult> {
  try {
    await checkInAppointment(appointmentId, idempotencyKey);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

export async function markAbsent(
  appointmentId: string,
  idempotencyKey: string,
): Promise<ActionResult> {
  try {
    await markNoShow(appointmentId, idempotencyKey);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

export async function completeConsulta(
  appointmentId: string,
  idempotencyKey: string,
): Promise<ActionResult> {
  try {
    await completeAppointment(appointmentId, idempotencyKey);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

// --- assinatura + documentos inline ----------------------------------------

export async function signConsulta(
  prontuarioId: string,
  input: SignProntuarioInput,
  idempotencyKey: string,
): Promise<ActionResult> {
  try {
    await signProntuario(prontuarioId, input, idempotencyKey);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

export async function emitPrescription(
  input: CreatePrescriptionInput,
  idempotencyKey: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const r = await createPrescription(input, idempotencyKey);
    return ok(r);
  } catch (err) {
    return fail(err);
  }
}

export async function emitDocument(
  input: CreateMedicalDocumentInput,
  idempotencyKey: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const r = await createMedicalDocument(input, idempotencyKey);
    return ok(r);
  } catch (err) {
    return fail(err);
  }
}
