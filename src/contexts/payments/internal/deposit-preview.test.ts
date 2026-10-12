/**
 * Prévia do sinal para o resumo do agente (08/10/2026). A prévia precisa dar a
 * MESMA resposta que o `createDepositCharge` daria depois: um resumo prometendo
 * sinal que não vem, ou escondendo um que vem, engana o paciente sobre a reserva.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDepositPolicy: vi.fn(),
  resolveCheckoutWindow: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../queries', () => ({ getDepositPolicy: mocks.getDepositPolicy }));
vi.mock('./hosted-checkout', () => ({ resolveCheckoutWindow: mocks.resolveCheckoutWindow }));

import { previewDepositForBooking } from './deposit-preview';

const POLICY = {
  enabled: true,
  percent: 50,
  cancellationWindowHours: 24,
  appliesToFirstVisit: true,
  appliesToReturn: true,
};

const base = (over: Record<string, unknown> = {}) => ({
  clinicId: 'clinic-1',
  patientId: 'patient-1',
  basePrice: 150,
  isReturnVisit: vi.fn(async () => false),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDepositPolicy.mockResolvedValue(POLICY);
  mocks.resolveCheckoutWindow.mockReturnValue({ minutesToExpire: 60, expiresAt: new Date() });
});

describe('previewDepositForBooking', () => {
  it('política ligada: o mesmo percentual do sinal cobrado depois', async () => {
    await expect(previewDepositForBooking(base())).resolves.toEqual({ amount: 75 });
  });

  it('política desligada: sem sinal, e nem pergunta se é retorno', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ ...POLICY, enabled: false });
    const input = base();
    await expect(previewDepositForBooking(input)).resolves.toBeNull();
    expect(input.isReturnVisit).not.toHaveBeenCalled();
  });

  it('sem paciente identificado não há a quem cobrar', async () => {
    await expect(previewDepositForBooking(base({ patientId: null }))).resolves.toBeNull();
    expect(mocks.getDepositPolicy).not.toHaveBeenCalled();
  });

  it('retorno fora da regra da clínica: sem sinal', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ ...POLICY, appliesToReturn: false });
    await expect(
      previewDepositForBooking(base({ isReturnVisit: vi.fn(async () => true) })),
    ).resolves.toBeNull();
  });

  it('abaixo do mínimo do gateway (R$ 5,00): sem sinal', async () => {
    await expect(previewDepositForBooking(base({ basePrice: 8 }))).resolves.toBeNull();
  });

  it('consulta perto demais para abrir o Checkout: sem sinal', async () => {
    mocks.resolveCheckoutWindow.mockReturnValue(null);
    await expect(
      previewDepositForBooking(base({ scheduledAt: new Date(Date.now() + 10 * 60_000) })),
    ).resolves.toBeNull();
  });

  it('sem horário escolhido ainda, a janela do Checkout não entra na conta', async () => {
    mocks.resolveCheckoutWindow.mockReturnValue(null);
    await expect(previewDepositForBooking(base())).resolves.toEqual({ amount: 75 });
    expect(mocks.resolveCheckoutWindow).not.toHaveBeenCalled();
  });
});
