'use server';

import type { SchedulingActionResult } from '@/contexts/scheduling/action-result';
import { createWaitlistEntry } from '@/contexts/scheduling/actions';
import { zonedWallToUtc } from '@/contexts/scheduling/slot-resolver';
import type { CreateWaitlistEntryInput, WaitlistEntryDTO } from '@/contexts/scheduling/types';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { requireClinicId } from '@/lib/auth/tenant-context';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * OBS-002 — converte a data local em instante UTC, ou devolve `null` se a
 * entrada não for uma data-calendário.
 *
 * Antes isto lançava um `Error` cru AQUI, fora do boundary da action do
 * contexto: a exceção atravessava a fronteira RSC, o runtime de produção
 * mascarava a mensagem e o cliente recebia HTTP 500 com um alert vazio. Data
 * inválida é entrada do usuário, não falha interna.
 */
function localBoundary(ymd: string, endOfDay: boolean, timezone: string): string | null {
  const match = YMD.exec(ymd);
  if (!match) return null;
  return zonedWallToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    timezone,
  ).toISOString();
}

export async function createWaitlistFromUi(
  input: Omit<CreateWaitlistEntryInput, 'preferredFrom' | 'preferredUntil'> & {
    preferredFromDate?: string;
    preferredUntilDate?: string;
  },
  idempotencyKey: string,
): Promise<SchedulingActionResult<WaitlistEntryDTO>> {
  const clinicId = await requireClinicId();
  const timezone = await getClinicTimezone(clinicId);

  const preferredFrom = input.preferredFromDate
    ? localBoundary(input.preferredFromDate, false, timezone)
    : undefined;
  const preferredUntil = input.preferredUntilDate
    ? localBoundary(input.preferredUntilDate, true, timezone)
    : undefined;
  if (preferredFrom === null || preferredUntil === null) {
    return { ok: false, message: 'Informe uma data de preferência válida.' };
  }

  // O intervalo invertido (`preferredFrom > preferredUntil`) é rejeitado pelo
  // schema DENTRO da action, cujo boundary o traduz em resultado controlado —
  // era o caso que respondia 500 com zero persistência.
  return createWaitlistEntry(
    {
      patientId: input.patientId,
      procedureId: input.procedureId,
      doctorId: input.doctorId ?? null,
      priority: input.priority ?? 'normal',
      notes: input.notes,
      ...(preferredFrom ? { preferredFrom } : {}),
      ...(preferredUntil ? { preferredUntil } : {}),
    },
    idempotencyKey,
  );
}
