import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PaymentsContext from '@/contexts/payments';

const { authorizeAction, getPaymentAccountFees } = vi.hoisted(() => ({
  authorizeAction: vi.fn(),
  getPaymentAccountFees: vi.fn(),
}));

vi.mock('@/lib/auth/action-guard', () => ({ authorizeAction }));
vi.mock('@/contexts/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof PaymentsContext>()),
  getPaymentAccountFees,
}));

import { getPaymentAccountFeesAction } from './actions';

describe('getPaymentAccountFeesAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não consulta chave nem Asaas para usuário sem permissão', async () => {
    authorizeAction.mockResolvedValue({ ok: false, message: 'Acesso negado.' });

    await expect(getPaymentAccountFeesAction()).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      message: 'Acesso negado.',
    });
    expect(getPaymentAccountFees).not.toHaveBeenCalled();
  });

  it('usa exclusivamente a clínica autenticada', async () => {
    authorizeAction.mockResolvedValue({ ok: true, clinicId: 'clinica-autenticada' });
    getPaymentAccountFees.mockResolvedValue({ pix: { regular: 1.99 } });

    await expect(getPaymentAccountFeesAction()).resolves.toEqual({
      ok: true,
      data: { pix: { regular: 1.99 } },
    });
    expect(getPaymentAccountFees).toHaveBeenCalledTimes(1);
    expect(getPaymentAccountFees).toHaveBeenCalledWith('clinica-autenticada');
  });
});
