import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listPatients,
  requireCachedAnyPermission,
  requireCachedPermission,
  requireClinicId,
  requireUser,
} = vi.hoisted(() => ({
  listPatients: vi.fn(),
  requireCachedAnyPermission: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireClinicId: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock('@/contexts/patient/queries', () => ({ listPatients }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireCachedAnyPermission,
  requireCachedPermission,
  requireClinicId,
  requireUser,
}));

import { PERMISSIONS } from '@/lib/auth/permissions';

import { buscarPacientesParaDocumento } from './actions';

describe('buscarPacientesParaDocumento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireClinicId.mockResolvedValue('clinic-a');
    listPatients.mockResolvedValue([{ id: 'patient-a', nome: 'Ana Lima' }]);
  });

  it('aplica os gates antes da leitura tenant-scoped', async () => {
    await expect(buscarPacientesParaDocumento('  Ana  ')).resolves.toEqual([
      { id: 'patient-a', label: 'Ana Lima' },
    ]);

    expect(requireUser).toHaveBeenCalledOnce();
    expect(requireCachedPermission).toHaveBeenCalledWith(PERMISSIONS.VIEW_PATIENT);
    expect(requireCachedAnyPermission).toHaveBeenCalledWith([
      PERMISSIONS.CREATE_PRONTUARIO,
      PERMISSIONS.CREATE_PRESCRIPTION,
    ]);
    expect(listPatients).toHaveBeenCalledWith('clinic-a', {
      search: 'Ana',
      limit: 10,
      excludeDeceased: true,
    });
  });

  it('não consulta o banco com menos de dois caracteres', async () => {
    await expect(buscarPacientesParaDocumento(' a ')).resolves.toEqual([]);
    expect(listPatients).not.toHaveBeenCalled();
  });

  it('interrompe antes da query quando o gate de criação falha', async () => {
    requireCachedAnyPermission.mockRejectedValueOnce(new Error('denied'));

    await expect(buscarPacientesParaDocumento('Ana')).rejects.toThrow('denied');
    expect(requireClinicId).not.toHaveBeenCalled();
    expect(listPatients).not.toHaveBeenCalled();
  });
});
