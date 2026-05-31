'use server';

/**
 * Schedule-config Server Actions (C6): doctor_availability + clinic_holidays.
 * CRUD com idempotência + audit, sem evento de domínio. Conflitos (UNIQUE /
 * EXCLUDE de overlap interno de disponibilidade) → SchedulingConflictError.
 *
 * Permissão: manage:availability.
 */
import { and, eq } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';

import { SchedulingValidationError } from './errors';
import { asConflict, idemKey, IDEM_TTL, jsonSafe, requestContext } from './internal/action-helpers';
import { clinicHolidays, doctorAvailability } from './schema';
import { parseTimeToMinutes } from './slot-resolver';
import {
  CreateHolidaySchema,
  SetAvailabilitySchema,
  type CreateHolidayInput,
  type SetAvailabilityInput,
} from './types';

export async function setDoctorAvailability(
  input: SetAvailabilityInput,
  idempotencyKey: string,
): Promise<{ id: string }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
  const data = SetAvailabilitySchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  if (parseTimeToMinutes(data.endTime) <= parseTimeToMinutes(data.startTime)) {
    throw new SchedulingValidationError('end_time deve ser maior que start_time');
  }

  try {
    return await idempotentMutation(
      {
        idempotency: { key: idemKey('avail_set', idempotencyKey), payload: jsonSafe(data), ttlSeconds: IDEM_TTL },
        audit: {
          action: 'doctor_availability.set',
          resourceType: 'doctor_availability',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [row] = await tx
          .insert(doctorAvailability)
          .values({
            clinicId,
            doctorId: data.doctorId,
            unitId: data.unitId ?? null,
            weekday: data.weekday,
            startTime: data.startTime,
            endTime: data.endTime,
          })
          .returning({ id: doctorAvailability.id });
        return { id: row!.id };
      },
    );
  } catch (err) {
    return asConflict(err); // UNIQUE ou EXCLUDE de overlap interno
  }
}

export async function removeDoctorAvailability(
  id: string,
  idempotencyKey: string,
): Promise<{ id: string; removed: boolean }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: { key: idemKey('avail_remove', idempotencyKey), payload: jsonSafe({ id }), ttlSeconds: IDEM_TTL },
      audit: {
        action: 'doctor_availability.removed',
        resourceType: 'doctor_availability',
        resourceId: id,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const deleted = await tx
        .delete(doctorAvailability)
        .where(and(eq(doctorAvailability.clinicId, clinicId), eq(doctorAvailability.id, id)))
        .returning({ id: doctorAvailability.id });
      return { id, removed: deleted.length > 0 };
    },
  );
}

export async function createHoliday(
  input: CreateHolidayInput,
  idempotencyKey: string,
): Promise<{ id: string }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
  const data = CreateHolidaySchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  try {
    return await idempotentMutation(
      {
        idempotency: { key: idemKey('holiday_create', idempotencyKey), payload: jsonSafe(data), ttlSeconds: IDEM_TTL },
        audit: {
          action: 'clinic_holiday.created',
          resourceType: 'clinic_holiday',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [row] = await tx
          .insert(clinicHolidays)
          .values({
            clinicId,
            date: data.date,
            reason: data.reason ?? null,
            unitId: data.unitId ?? null,
            startTime: data.startTime ?? null,
            endTime: data.endTime ?? null,
          })
          .returning({ id: clinicHolidays.id });
        return { id: row!.id };
      },
    );
  } catch (err) {
    return asConflict(err);
  }
}

export async function removeHoliday(
  id: string,
  idempotencyKey: string,
): Promise<{ id: string; removed: boolean }> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: { key: idemKey('holiday_remove', idempotencyKey), payload: jsonSafe({ id }), ttlSeconds: IDEM_TTL },
      audit: {
        action: 'clinic_holiday.removed',
        resourceType: 'clinic_holiday',
        resourceId: id,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const deleted = await tx
        .delete(clinicHolidays)
        .where(and(eq(clinicHolidays.clinicId, clinicId), eq(clinicHolidays.id, id)))
        .returning({ id: clinicHolidays.id });
      return { id, removed: deleted.length > 0 };
    },
  );
}
