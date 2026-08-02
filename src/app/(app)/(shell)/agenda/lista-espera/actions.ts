'use server';

import { createWaitlistEntry } from '@/contexts/scheduling/actions';
import { zonedWallToUtc } from '@/contexts/scheduling/slot-resolver';
import type { CreateWaitlistEntryInput, WaitlistEntryDTO } from '@/contexts/scheduling/types';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { requireClinicId } from '@/lib/auth/tenant-context';

function localBoundary(ymd: string, endOfDay: boolean, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error('Data de preferência inválida.');
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
): Promise<WaitlistEntryDTO> {
  const clinicId = await requireClinicId();
  const timezone = await getClinicTimezone(clinicId);
  return createWaitlistEntry(
    {
      patientId: input.patientId,
      procedureId: input.procedureId,
      doctorId: input.doctorId ?? null,
      priority: input.priority ?? 'normal',
      notes: input.notes,
      ...(input.preferredFromDate
        ? { preferredFrom: localBoundary(input.preferredFromDate, false, timezone) }
        : {}),
      ...(input.preferredUntilDate
        ? { preferredUntil: localBoundary(input.preferredUntilDate, true, timezone) }
        : {}),
    },
    idempotencyKey,
  );
}
