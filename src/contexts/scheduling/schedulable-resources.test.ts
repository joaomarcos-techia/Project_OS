import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CreateAppointmentSchema, CreateHolidaySchema, CreateWalkInSchema } from './types';

const core = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/internal/appointment-core.ts'),
  'utf8',
);
const actions = readFileSync(resolve(process.cwd(), 'src/contexts/scheduling/actions.ts'), 'utf8');
const resourcesPage = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/configuracoes/recursos/page.tsx'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0061_schedulable_resources.sql'),
  'utf8',
);

describe('schedulable resources', () => {
  it('aceita recursos apenas nas entradas de agendamento e encaixe', () => {
    const resourceId = '00000000-0000-4000-8000-000000000010';
    const common = {
      doctorId: '00000000-0000-4000-8000-000000000001',
      procedureId: '00000000-0000-4000-8000-000000000002',
      resourceIds: [resourceId],
    };

    expect(
      CreateAppointmentSchema.parse({
        ...common,
        scheduledAt: '2026-07-24T10:00:00-03:00',
      }).resourceIds,
    ).toEqual([resourceId]);
    expect(CreateWalkInSchema.parse(common).resourceIds).toEqual([resourceId]);
    expect(
      CreateHolidaySchema.parse({ date: '2026-07-24', resourceIds: [resourceId] }),
    ).not.toHaveProperty('resourceIds');
  });

  it('bloqueia sobreposicao de sala/equipamento no banco', () => {
    expect(migration).toContain('appointment_resource_reservations_no_overlap');
    expect(migration).toContain('resource_id WITH =');
    expect(migration).toContain("tstzrange(starts_at, ends_at, '[)') WITH &&");
  });

  it('valida recurso ativo e tenant antes de reservar', () => {
    expect(core).toContain('eq(schedulableResources.clinicId, appointment.clinicId)');
    expect(core).toContain('eq(schedulableResources.active, true)');
    expect(migration).toContain('resource reservation tenant/resource mismatch');
  });

  it('preserva reservas no reagendamento e libera no cancelamento/falta', () => {
    expect(core).toContain('oldReservations.map((reservation) => reservation.resourceId)');
    expect(core).toContain("o.target === 'cancelado' || o.target === 'faltou'");
    expect(actions).toContain('setAppointmentResourceReservationsActive');
  });

  it('expõe cadastro de recursos na configuração com a permissão da agenda', () => {
    expect(resourcesPage).toContain('PERMISSIONS.MANAGE_AVAILABILITY');
    expect(resourcesPage).toContain('listSchedulableResources(clinicId, false)');
  });
});
