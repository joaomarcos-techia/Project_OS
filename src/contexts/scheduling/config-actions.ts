'use server';

/**
 * Schedule-config Server Actions (C6): doctor_availability + clinic_holidays.
 * CRUD com idempotência + audit, sem evento de domínio. Conflitos (UNIQUE /
 * EXCLUDE de overlap interno de disponibilidade) → SchedulingConflictError.
 *
 * Permissão: manage:availability.
 */
import { and, eq, sql } from 'drizzle-orm';

/* eslint-disable boundaries/element-types -- profiles é declarado no schema de identity (Drizzle FK vive onde a tabela é declarada); leitura tenant-scoped via tx (RLS aplica). Mesma exceção de clinical/internal/doctor.ts e tenant-context.ts. */
import { profiles } from '@/contexts/identity/schema';
/* eslint-enable boundaries/element-types */

import { PERMISSIONS } from '@/lib/auth/permissions';
import { practitionerSql } from '@/lib/auth/practitioner';
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
        // F-04/F-05 (auditoria 2026-06-10): valida vínculo doctor↔clínica DENTRO
        // do tx tenant-scoped (mesmo padrão do buildSnapshot) — RLS faz o
        // cross-tenant retornar 0 linhas. Sem isto, um gestor da clínica A com
        // o UUID de um profile da clínica B criava availability "fantasma" e o
        // EXCLUDE global (doctor_id, weekday, range) passava a rejeitar janelas
        // legítimas da clínica B (interferência cross-tenant). Também exige
        // practitioner (role='doctor' OU CRM — ADR-032 §2) + ativo + não soft-deletado (F-05).
        const doc = await tx.execute<{ id: string }>(
          sql`SELECT id FROM profiles
               WHERE id = ${data.doctorId}
                 AND ${practitionerSql(profiles.role, profiles.crm)}
                 AND ativo = true
                 AND deleted_at IS NULL
               LIMIT 1`,
        );
        if (!doc[0]) {
          throw new SchedulingValidationError('médico inválido para esta clínica');
        }
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
