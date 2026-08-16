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
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';

import type { SchedulingActionResult } from './action-result';
import { SchedulingValidationError } from './errors';
import { asConflict, idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import { toActionResult } from './internal/action-result';
import {
  assertCanManageClinicSchedule,
  assertCanManageDoctorSchedule,
} from './internal/availability-scope';
import { assertUnitInClinic } from './internal/tenant-references';
import { clinicHolidays, doctorAvailability, schedulableResources } from './schema';
import { parseTimeToMinutes } from './slot-resolver';
import {
  CreateHolidaySchema,
  CreateSchedulableResourceSchema,
  SetAvailabilitySchema,
  SetAvailabilityWindowsSchema,
  type CreateHolidayInput,
  type CreateSchedulableResourceInput,
  type SchedulableResourceDTO,
  type SetAvailabilityInput,
  type SetAvailabilityWindowsInput,
} from './types';

/**
 * AUTHZ-007 — remover uma janela é mexer na agenda de quem ela pertence, mas o
 * cliente só manda o `id`. Resolvemos o dono no banco, dentro do tenant, e só
 * então decidimos. Confiar num `doctorId` vindo do formulário reintroduziria o
 * mesmo bug por outro caminho.
 *
 * Janela inexistente cai no ramo administrativo: assim a resposta não revela
 * se o id existe para quem não pode administrar.
 */
async function assertOwnsAvailabilityWindow(
  actor: {
    userId: string;
    isSuperAdmin: boolean;
    aal: 'aal1' | 'aal2' | null;
    permissions: readonly string[];
  },
  clinicId: string,
  windowId: string,
): Promise<void> {
  const [row] = await withTenant(clinicId, (tx) =>
    tx
      .select({ doctorId: doctorAvailability.doctorId })
      .from(doctorAvailability)
      .where(and(eq(doctorAvailability.clinicId, clinicId), eq(doctorAvailability.id, windowId)))
      .limit(1),
  );
  await assertCanManageDoctorSchedule(actor, row?.doctorId ?? '');
}

export async function createSchedulableResource(
  input: CreateSchedulableResourceInput,
  idempotencyKey: string,
): Promise<SchedulingActionResult<SchedulableResourceDTO>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
    // AUTHZ-007 — sala/equipamento é recurso COMPARTILHADO da clínica, não a
    // agenda de ninguém. `manage:availability` sozinha não basta.
    await assertCanManageClinicSchedule();
    const data = CreateSchedulableResourceSchema.parse(input);
    const clinicId = await requireClinicId();
    const ctx = await requestContext();

    return idempotentMutation(
      {
        idempotency: {
          key: idemKey('resource_create', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: 'scheduling.resource.created',
          resourceType: 'schedulable_resource',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        await assertUnitInClinic(tx, clinicId, data.unitId);
        const [row] = await tx
          .insert(schedulableResources)
          .values({
            clinicId,
            unitId: data.unitId ?? null,
            name: data.name,
            type: data.type,
            createdBy: user.userId,
          })
          .returning();
        return {
          id: row!.id,
          name: row!.name,
          type: row!.type,
          unitId: row!.unitId ?? null,
          active: row!.active,
        };
      },
    );
  });
}

export async function setSchedulableResourceActive(
  id: string,
  active: boolean,
  idempotencyKey: string,
): Promise<SchedulingActionResult<{ id: string; active: boolean }>> {
  return toActionResult(async () => {
    await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
    await assertCanManageClinicSchedule(); // AUTHZ-007 — recurso compartilhado
    const clinicId = await requireClinicId();
    const ctx = await requestContext();
    return idempotentMutation(
      {
        idempotency: {
          key: idemKey('resource_active', idempotencyKey),
          payload: jsonSafe({ id, active }),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: 'scheduling.resource.active_changed',
          resourceType: 'schedulable_resource',
          resourceId: id,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [row] = await tx
          .update(schedulableResources)
          .set({ active, updatedAt: sql`now()` })
          .where(and(eq(schedulableResources.id, id), eq(schedulableResources.clinicId, clinicId)))
          .returning({ id: schedulableResources.id, active: schedulableResources.active });
        if (!row) throw new SchedulingValidationError('recurso nao encontrado');
        return row;
      },
    );
  });
}

/**
 * DATA-006 — grava o expediente de um dia como UNIDADE ATÔMICA.
 *
 * A UI oferece "expediente com pausa de almoço" e chamava `setDoctorAvailability`
 * duas vezes, cada uma com sua própria transação e sua própria chave idempotente.
 * Quando a tarde conflitava, a manhã já estava persistida: o operador via o erro
 * e concluía que nada tinha sido salvo, enquanto a agenda já abria horários que
 * o profissional não trabalha — e um retry passava a conflitar também na manhã
 * "fantasma" que ele não sabia existir.
 *
 * Uma transação, uma chave, uma auditoria. Qualquer janela que falhe reverte
 * todas: o EXCLUDE de sobreposição continua sendo a barreira de dados, e agora
 * ele derruba o conjunto inteiro em vez de metade dele.
 */
/**
 * F-04/F-05 (auditoria 2026-06-10): valida vínculo doctor↔clínica DENTRO do tx
 * tenant-scoped (mesmo padrão do buildSnapshot) — RLS faz o cross-tenant
 * retornar 0 linhas. Sem isto, um gestor da clínica A com o UUID de um profile
 * da clínica B criava availability "fantasma" e o EXCLUDE global (doctor_id,
 * weekday, range) passava a rejeitar janelas legítimas da clínica B
 * (interferência cross-tenant). Também exige practitioner (role='doctor' OU CRM
 * — ADR-032 §2) + ativo + não soft-deletado (F-05).
 *
 * Extraída em DATA-006 para que a gravação em lote herde exatamente a mesma
 * verificação da gravação de janela única — duas cópias divergiriam.
 */
async function assertPractitionerInClinic(
  tx: Tx,
  clinicId: string,
  doctorId: string,
): Promise<void> {
  const doc = await tx.execute<{ id: string }>(
    sql`SELECT id FROM profiles
       WHERE id = ${doctorId}
         AND clinic_id = ${clinicId}
         AND ${practitionerSql(profiles.role, profiles.crm)}
         AND ativo = true
         AND deleted_at IS NULL
         AND invite_accepted_at IS NOT NULL
       LIMIT 1`,
  );
  if (!doc[0]) {
    throw new SchedulingValidationError('médico inválido para esta clínica');
  }
}

export async function setDoctorAvailabilityWindows(
  input: SetAvailabilityWindowsInput,
  idempotencyKey: string,
): Promise<SchedulingActionResult<{ ids: string[] }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
    const data = SetAvailabilityWindowsSchema.parse(input);
    // AUTHZ-007 — mesma regra da janela única: agenda de outro profissional é
    // ato administrativo revalidado no banco.
    await assertCanManageDoctorSchedule(user, data.doctorId);
    const clinicId = await requireClinicId();
    const ctx = await requestContext();

    try {
      return await idempotentMutation(
        {
          idempotency: {
            key: idemKey('avail_set_windows', idempotencyKey),
            payload: jsonSafe(data),
            ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
          },
          audit: {
            action: 'doctor_availability.set_windows',
            resourceType: 'doctor_availability',
            resourceId: null,
            before: null,
            requestContext: ctx,
          },
        },
        async (tx) => {
          await assertUnitInClinic(tx, clinicId, data.unitId);
          await assertPractitionerInClinic(tx, clinicId, data.doctorId);

          const ids: string[] = [];
          for (const window of data.windows) {
            const [row] = await tx
              .insert(doctorAvailability)
              .values({
                clinicId,
                doctorId: data.doctorId,
                unitId: data.unitId ?? null,
                weekday: data.weekday,
                startTime: window.startTime,
                endTime: window.endTime,
              })
              .returning({ id: doctorAvailability.id });
            ids.push(row!.id);
          }
          return { ids };
        },
      );
    } catch (err) {
      return asConflict(err); // UNIQUE ou EXCLUDE de overlap interno
    }
  });
}

export async function setDoctorAvailability(
  input: SetAvailabilityInput,
  idempotencyKey: string,
): Promise<SchedulingActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
    const data = SetAvailabilitySchema.parse(input);
    // AUTHZ-007 — a própria agenda passa direto; a de outro profissional exige a
    // capacidade administrativa revalidada no banco.
    await assertCanManageDoctorSchedule(user, data.doctorId);
    const clinicId = await requireClinicId();
    const ctx = await requestContext();

    if (parseTimeToMinutes(data.endTime) <= parseTimeToMinutes(data.startTime)) {
      throw new SchedulingValidationError('end_time deve ser maior que start_time');
    }

    try {
      return await idempotentMutation(
        {
          idempotency: {
            key: idemKey('avail_set', idempotencyKey),
            payload: jsonSafe(data),
            ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
          },
          audit: {
            action: 'doctor_availability.set',
            resourceType: 'doctor_availability',
            resourceId: null,
            before: null,
            requestContext: ctx,
          },
        },
        async (tx) => {
          await assertUnitInClinic(tx, clinicId, data.unitId);
          await assertPractitionerInClinic(tx, clinicId, data.doctorId);
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
  });
}

export async function removeDoctorAvailability(
  id: string,
  idempotencyKey: string,
): Promise<SchedulingActionResult<{ id: string; removed: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
    const clinicId = await requireClinicId();
    const ctx = await requestContext();
    // AUTHZ-007 — remover janela alheia é mexer na agenda do outro. O dono da
    // janela é lido ANTES, no escopo do tenant, para a decisão não depender do
    // id que o cliente mandou.
    await assertOwnsAvailabilityWindow(user, clinicId, id);

    return idempotentMutation(
      {
        idempotency: {
          key: idemKey('avail_remove', idempotencyKey),
          payload: jsonSafe({ id }),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
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
  });
}

export async function createHoliday(
  input: CreateHolidayInput,
  idempotencyKey: string,
): Promise<SchedulingActionResult<{ id: string }>> {
  return toActionResult(async () => {
    await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
    // AUTHZ-007 — feriado vale para a clínica inteira, não para um profissional.
    await assertCanManageClinicSchedule();
    const data = CreateHolidaySchema.parse(input);
    const clinicId = await requireClinicId();
    const ctx = await requestContext();

    try {
      return await idempotentMutation(
        {
          idempotency: {
            key: idemKey('holiday_create', idempotencyKey),
            payload: jsonSafe(data),
            ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
          },
          audit: {
            action: 'clinic_holiday.created',
            resourceType: 'clinic_holiday',
            resourceId: null,
            before: null,
            requestContext: ctx,
          },
        },
        async (tx) => {
          await assertUnitInClinic(tx, clinicId, data.unitId);
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
  });
}

export async function removeHoliday(
  id: string,
  idempotencyKey: string,
): Promise<SchedulingActionResult<{ id: string; removed: boolean }>> {
  return toActionResult(async () => {
    await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
    await assertCanManageClinicSchedule(); // AUTHZ-007 — feriado é da clínica
    const clinicId = await requireClinicId();
    const ctx = await requestContext();

    return idempotentMutation(
      {
        idempotency: {
          key: idemKey('holiday_remove', idempotencyKey),
          payload: jsonSafe({ id }),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
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
  });
}
