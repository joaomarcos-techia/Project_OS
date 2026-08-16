import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireFreshPermission = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireFreshPermission: (p: string) => requireFreshPermission(p),
}));

import { PERMISSIONS } from '@/lib/auth/permissions';

import {
  administersTeamSchedule,
  assertCanManageClinicSchedule,
  assertCanManageDoctorSchedule,
  type AvailabilityActor,
} from './availability-scope';

function actor(over: Partial<AvailabilityActor> = {}): AvailabilityActor {
  return {
    userId: 'doctor-1',
    isSuperAdmin: false,
    aal: 'aal1',
    permissions: [PERMISSIONS.MANAGE_AVAILABILITY],
    ...over,
  };
}

beforeEach(() => {
  requireFreshPermission.mockReset();
  requireFreshPermission.mockResolvedValue(undefined);
});

describe('administersTeamSchedule (AUTHZ-007)', () => {
  it('médico com manage:availability NÃO administra a equipe', () => {
    expect(administersTeamSchedule(actor())).toBe(false);
  });

  it('quem tem manage:settings administra', () => {
    expect(
      administersTeamSchedule(
        actor({ permissions: [PERMISSIONS.MANAGE_AVAILABILITY, PERMISSIONS.MANAGE_SETTINGS] }),
      ),
    ).toBe(true);
  });

  it('super_admin só com AAL2 (I-1)', () => {
    expect(administersTeamSchedule(actor({ isSuperAdmin: true, aal: 'aal2' }))).toBe(true);
    expect(administersTeamSchedule(actor({ isSuperAdmin: true, aal: 'aal1' }))).toBe(false);
  });
});

describe('assertCanManageDoctorSchedule', () => {
  it('a própria agenda passa sem exigir capacidade administrativa', async () => {
    await assertCanManageDoctorSchedule(actor(), 'doctor-1');
    expect(requireFreshPermission).not.toHaveBeenCalled();
  });

  it('a agenda de outro exige manage:settings revalidada no banco', async () => {
    await assertCanManageDoctorSchedule(actor(), 'owner-9');
    expect(requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_SETTINGS);
  });

  it('propaga a negativa do fresh-check — o médico não ausenta o owner', async () => {
    requireFreshPermission.mockRejectedValue(new Error('PERMISSION_DENIED'));
    await expect(assertCanManageDoctorSchedule(actor(), 'owner-9')).rejects.toThrow(
      'PERMISSION_DENIED',
    );
  });

  it('id vazio (janela inexistente) cai no ramo administrativo, sem revelar existência', async () => {
    await assertCanManageDoctorSchedule(actor(), '');
    expect(requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_SETTINGS);
  });
});

describe('assertCanManageClinicSchedule', () => {
  it('recurso compartilhado/feriado sempre exige a capacidade administrativa', async () => {
    await assertCanManageClinicSchedule();
    expect(requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_SETTINGS);
  });
});
