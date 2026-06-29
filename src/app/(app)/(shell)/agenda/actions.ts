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
import { getPatientSummaryById, listPatients } from '@/contexts/patient/queries';
import { createAppointment, createWalkInAppointment } from '@/contexts/scheduling/actions';
import { getClinicTimezone } from '@/contexts/scheduling/queries';
import { zonedWallToUtc } from '@/contexts/scheduling/slot-resolver';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission, requireClinicId, requireUser } from '@/lib/auth/tenant-context';

export type CriarAtendimentoInput = {
  patientId: string;
  procedureId: string;
  doctorId: string;
  urgencia?: boolean;
  observacoes?: string;
} & ({ modo: 'agora' } | { modo: 'agendar'; date: string; time: string });

export type CriarAtendimentoResult =
  | { ok: true; id: string; modo: 'agora' | 'agendar' }
  | { ok: false; message: string };

function messageFrom(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: string }).name;
    if (name === 'AuthError') return 'Sem permissão para criar atendimento.';
    if (name === 'SchedulingConflictError') return 'Já existe um atendimento nesse horário para este profissional.';
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
      ...(input.urgencia ? { urgencia: true } : {}),
      ...(input.observacoes?.trim() ? { observacoes: input.observacoes.trim() } : {}),
    };

    if (input.modo === 'agendar') {
      const scheduledAt = await scheduledAtIso(clinicId, input.date, input.time);
      const r = await createAppointment({ ...common, scheduledAt }, key);
      return { ok: true, id: r.id, modo: 'agendar' };
    }
    const r = await createWalkInAppointment(common, key);
    return { ok: true, id: r.id, modo: 'agora' };
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
  const rows = await listPatients(clinicId, { search: t, limit: 10 });
  return rows.map((p) => ({ id: p.id, nome: p.nome }));
}
