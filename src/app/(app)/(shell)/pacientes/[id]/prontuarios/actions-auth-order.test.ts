import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateProntuario = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/contexts/clinical/actions', () => ({
  createMedicalDocument: vi.fn(),
  createPrescription: vi.fn(),
  createProntuario: vi.fn(),
  signProntuario: vi.fn(),
  updateProntuario,
}));

import { autosaveProntuario } from './actions';

describe('autosaveProntuario — ordem de autenticação', () => {
  beforeEach(() => {
    updateProntuario.mockReset();
  });

  it('delega ao domínio antes de validar a entrada e não expõe detalhes do Zod sem sessão', async () => {
    const authError = Object.assign(new Error('detalhe interno'), { name: 'AuthError' });
    updateProntuario.mockRejectedValueOnce(authError);

    const entradaInvalida = undefined as never;
    const result = await autosaveProntuario('id-invalido', entradaInvalida, Number.NaN);

    expect(updateProntuario).toHaveBeenCalledWith('id-invalido', entradaInvalida, Number.NaN);
    expect(result).toEqual({
      ok: false,
      kind: 'error',
      message: 'Sem permissão para esta ação.',
    });
  });
});
