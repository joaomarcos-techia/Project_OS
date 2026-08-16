'use server';

/**
 * Agenda — Server Actions. Cria atendimento em dois modos:
 *   - 'agora'    → encaixe/walk-in (createWalkInAppointment, status 'chegou')
 *   - 'agendar'  → data/hora (createAppointment, status 'agendado')
 *
 * Segurança (defesa em profundidade):
 *   - gate por edit:agenda ANTES de qualquer leitura;
 *   - VALIDA que o paciente pertence à clínica para dar mensagem amigável cedo.
 *     O isolamento real (gap S1) é garantido no CORE do C6 desde R1
 *     (assertPatientInClinic em createAppointmentCore/walk-in), cobrindo TODOS os
 *     chamadores — esta checagem aqui é só UX/early-fail.
 *   - 'agendar' converte a hora local da CLÍNICA → instante UTC server-side
 *     (zonedWallToUtc, DST-correct) — nunca confia no fuso do browser.
 * As permissões finais (requireFreshPermission edit:agenda) e o anti-conflito
 * (EXCLUDE) são reaplicados dentro de createAppointment/createWalkInAppointment.
 */
import { revalidatePath } from 'next/cache';

import { getPatientSummaryById, listPatients } from '@/contexts/patient/queries';
import {
  createAppointment,
  createDoctorAbsence,
  createRecurringAppointments,
  createWalkInAppointment,
  recoverAppointment,
} from '@/contexts/scheduling/actions';
import { listAppointments } from '@/contexts/scheduling/queries';
import { zonedWallToUtc } from '@/contexts/scheduling/slot-resolver';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission, requireClinicId, requireUser } from '@/lib/auth/tenant-context';

export type CriarAtendimentoInput = {
  patientId: string;
  procedureId: string;
  doctorId: string;
  urgencia?: boolean;
  observacoes?: string;
  resourceIds?: string[];
} & (
  | { modo: 'agora' }
  | {
      modo: 'agendar';
      date: string;
      time: string;
      recurrence?: { intervalWeeks: number; occurrences: number };
    }
);

export type CriarAtendimentoResult =
  | { ok: true; id: string; modo: 'agora' | 'agendar'; createdCount: number }
  | { ok: false; message: string };

export type AgendaOperationState =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | null;

function messageFrom(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: string }).name;
    if (name === 'AuthError') return 'Sem permissão para criar atendimento.';
    if (name === 'SchedulingConflictError')
      return 'Já existe um atendimento nesse horário para este profissional.';
  }
  if (err instanceof Error) return err.message;
  return 'Erro ao criar atendimento.';
}

async function scheduledAtIso(clinicId: string, date: string, time: string): Promise<string> {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) throw new Error('Informe data e hora válidas.');
  const tz = (await getClinicTimezone(clinicId)) ?? 'America/Sao_Paulo';
  // Interpreta a hora informada como hora de PAREDE da clínica → instante UTC.
  return zonedWallToUtc(+d[1]!, +d[2]!, +d[3]!, +t[1]!, +t[2]!, tz).toISOString();
}

/** Janela [00:00, 24:00) do dia-alvo no fuso da clínica, em UTC. */
function dayBoundsFor(tz: string, ymd: string): { from: Date; to: Date } {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const from = zonedWallToUtc(y, m, d, 0, 0, tz);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

function todayYmd(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Anti-duplicidade (guarda de aplicação): a MESMA paciente com a MESMA médica
 * não pode ter dois atendimentos ATIVOS no mesmo dia — bloqueia encaixe e
 * agendamento duplicados. (O EXCLUDE do C6 cobre conflito de horário, não este
 * caso; corrida residual entre requests simultâneos fica para um índice parcial
 * de hardening.)
 */
async function findDuplicadoNoDia(
  clinicId: string,
  input: { patientId: string; doctorId: string },
  ymd: string,
): Promise<boolean> {
  const tz = (await getClinicTimezone(clinicId)) ?? 'America/Sao_Paulo';
  const { from, to } = dayBoundsFor(tz, ymd);
  const ativos = await listAppointments(clinicId, {
    from,
    to,
    restrictToDoctorId: input.doctorId,
    status: ['agendado', 'confirmado', 'chegou', 'em_atendimento'],
    limit: 200,
  });
  return ativos.some((a) => a.patientId === input.patientId);
}

export async function criarAtendimento(
  input: CriarAtendimentoInput,
): Promise<CriarAtendimentoResult> {
  try {
    await requireUser();
    await requireCachedPermission(PERMISSIONS.EDIT_AGENDA);
    const clinicId = await requireClinicId();

    if (!input.procedureId) return { ok: false, message: 'Selecione o procedimento.' };
    if (!input.doctorId) return { ok: false, message: 'Selecione o profissional.' };
    // Paciente DEVE pertencer à clínica (getPatientSummaryById é tenant-scoped via RLS).
    const pat = await getPatientSummaryById(clinicId, input.patientId);
    if (!pat) return { ok: false, message: 'Paciente inválido para esta clínica.' };

    const key = crypto.randomUUID();
    const common = {
      doctorId: input.doctorId,
      patientId: input.patientId,
      procedureId: input.procedureId,
      resourceIds: input.resourceIds ?? [],
      ...(input.urgencia ? { urgencia: true } : {}),
      ...(input.observacoes?.trim() ? { observacoes: input.observacoes.trim() } : {}),
    };

    const tz = (await getClinicTimezone(clinicId)) ?? 'America/Sao_Paulo';
    const diaAlvo = input.modo === 'agendar' ? input.date.trim() : todayYmd(tz);
    if (await findDuplicadoNoDia(clinicId, input, diaAlvo)) {
      return {
        ok: false,
        message: `${pat.nome} já tem um atendimento ativo com este profissional neste dia.`,
      };
    }

    if (input.modo === 'agendar') {
      const scheduledAt = await scheduledAtIso(clinicId, input.date, input.time);
      if (input.recurrence) {
        const series = await createRecurringAppointments(
          {
            ...common,
            firstScheduledAt: scheduledAt,
            intervalWeeks: input.recurrence.intervalWeeks,
            occurrences: input.recurrence.occurrences,
          },
          key,
        );
        return {
          ok: true,
          id: series.appointments[0]!.id,
          modo: 'agendar',
          createdCount: series.appointments.length,
        };
      }
      const r = await createAppointment({ ...common, scheduledAt }, key);
      return { ok: true, id: r.id, modo: 'agendar', createdCount: 1 };
    }
    const r = await createWalkInAppointment(common, key);
    return { ok: true, id: r.id, modo: 'agora', createdCount: 1 };
  } catch (err) {
    return { ok: false, message: messageFrom(err) };
  }
}

/** Busca de pacientes para o seletor do formulário (nome → {id, nome}). */
export async function buscarPacientes(term: string): Promise<Array<{ id: string; nome: string }>> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.VIEW_PATIENT);
  const clinicId = await requireClinicId();
  const t = term.trim();
  if (t.length < 2) return [];
  // UX-001 — o seletor de "Novo atendimento" oferecia paciente falecido e só o
  // submit negava. A guarda do core continua (defesa em profundidade).
  const rows = await listPatients(clinicId, { search: t, limit: 10, excludeDeceased: true });
  return rows.map((p) => ({ id: p.id, nome: p.nome }));
}

export async function corrigirAtendimentoAction(
  _previous: AgendaOperationState,
  formData: FormData,
): Promise<AgendaOperationState> {
  const appointmentId = String(formData.get('appointmentId') ?? '');
  const newDoctorId = String(formData.get('newDoctorId') ?? '').trim();
  try {
    await recoverAppointment(
      {
        appointmentId,
        kind: String(formData.get('kind') ?? '') as
          | 'interrupt'
          | 'exceptional_cancel'
          | 'reopen'
          | 'transfer',
        reason: String(formData.get('reason') ?? ''),
        ...(newDoctorId ? { newDoctorId } : {}),
      },
      String(formData.get('idempotencyKey') ?? ''),
    );
    revalidatePath('/agenda');
    return { ok: true, message: 'Correção registrada na trilha do atendimento.' };
  } catch (error) {
    return { ok: false, message: messageFrom(error) };
  }
}

function localDateTimeToIso(clinicId: string, value: FormDataEntryValue | null): Promise<string> {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(value ?? '').trim());
  if (!match) throw new Error('Informe data e hora válidas.');
  return scheduledAtIso(clinicId, match[1]!, match[2]!);
}

export async function criarAusenciaMedicaAction(
  _previous: AgendaOperationState,
  formData: FormData,
): Promise<AgendaOperationState> {
  try {
    await requireUser();
    await requireCachedPermission(PERMISSIONS.MANAGE_AVAILABILITY);
    const clinicId = await requireClinicId();
    const startsAt = await localDateTimeToIso(clinicId, formData.get('startsAt'));
    const endsAt = await localDateTimeToIso(clinicId, formData.get('endsAt'));
    const replacementDoctorId = String(formData.get('replacementDoctorId') ?? '').trim();
    const result = await createDoctorAbsence(
      {
        doctorId: String(formData.get('doctorId') ?? ''),
        startsAt,
        endsAt,
        reason: String(formData.get('reason') ?? ''),
        strategy: String(formData.get('strategy') ?? '') as 'cancel' | 'transfer',
        ...(replacementDoctorId ? { replacementDoctorId } : {}),
      },
      String(formData.get('idempotencyKey') ?? ''),
    );
    revalidatePath('/agenda');
    revalidatePath('/agenda/ausencias');
    return {
      ok: true,
      message: `${result.affected} atendimento(s) reorganizado(s): ${result.cancelled} cancelado(s) e ${result.transferred} transferido(s).`,
    };
  } catch (error) {
    return { ok: false, message: messageFrom(error) };
  }
}
