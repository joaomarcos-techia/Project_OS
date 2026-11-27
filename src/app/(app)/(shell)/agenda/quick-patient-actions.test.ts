import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPatient: vi.fn(),
  requireCachedPermission: vi.fn(),
}));

vi.mock('@/contexts/patient/actions', () => ({ createPatient: mocks.createPatient }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireCachedPermission: mocks.requireCachedPermission,
}));

import { PatientConflictError, PatientValidationError } from '@/contexts/patient/errors';

import { criarPacienteRapido } from './quick-patient-actions';

beforeEach(() => {
  mocks.createPatient.mockReset();
  mocks.requireCachedPermission.mockReset();
  mocks.requireCachedPermission.mockResolvedValue(undefined);
});

// UX-006 (docs/otimização_ui_final.md)
describe('criarPacienteRapido', () => {
  it('exige create:patient antes de qualquer coisa', async () => {
    mocks.requireCachedPermission.mockRejectedValue(
      Object.assign(new Error('x'), { name: 'AuthError' }),
    );

    await expect(criarPacienteRapido({ nome: 'Ana', cpf: '52998224725' })).rejects.toThrow();
    expect(mocks.requireCachedPermission).toHaveBeenCalledWith('create:patient');
    expect(mocks.createPatient).not.toHaveBeenCalled();
  });

  it('cria pelo núcleo do domínio com a chave de idempotência do formulário', async () => {
    mocks.createPatient.mockResolvedValue({ id: 'p-1', nome: 'Ana Souza' });

    const res = await criarPacienteRapido({
      nome: '  Ana Souza ',
      cpf: '529.982.247-25',
      telefone: '',
      idempotencyKey: 'chave-1',
    });

    expect(res).toEqual({ ok: true, id: 'p-1', nome: 'Ana Souza' });
    expect(mocks.createPatient).toHaveBeenCalledWith(
      { nome: 'Ana Souza', cpf: '529.982.247-25' },
      'chave-1',
    );
  });

  it('devolve erro por campo quando faltam nome e CPF, sem chamar o domínio', async () => {
    const res = await criarPacienteRapido({ nome: ' ', cpf: '' });

    expect(res).toEqual({
      ok: false,
      fieldErrors: { nome: 'Informe o nome do paciente.', cpf: 'Informe o CPF com 11 dígitos.' },
      message: null,
    });
    expect(mocks.createPatient).not.toHaveBeenCalled();
  });

  it('CPF já cadastrado vira erro no campo CPF, sem criar outro', async () => {
    mocks.createPatient.mockRejectedValue(
      new PatientConflictError('CPF ou e-mail já cadastrado nesta clínica'),
    );

    const res = await criarPacienteRapido({ nome: 'Ana', cpf: '52998224725' });

    expect(res.ok).toBe(false);
    expect(!res.ok && res.fieldErrors.cpf).toMatch(/Já existe um paciente com este CPF/);
  });

  it('CPF inválido no domínio vira erro no campo CPF', async () => {
    mocks.createPatient.mockRejectedValue(new PatientValidationError('CPF inválido'));

    const res = await criarPacienteRapido({ nome: 'Ana', cpf: '11111111111' });

    expect(!res.ok && res.fieldErrors.cpf).toBe('CPF inválido. Confira os 11 dígitos.');
  });

  it('falha inesperada do domínio não é engolida', async () => {
    mocks.createPatient.mockRejectedValue(new Error('pool esgotado'));

    await expect(criarPacienteRapido({ nome: 'Ana', cpf: '52998224725' })).rejects.toThrow(
      'pool esgotado',
    );
  });
});
