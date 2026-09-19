import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/financial', () => ({
  FINANCIAL_EVENTS: { FATURAMENTO_PENDENTE: 'financial.faturamento.pendente' },
}));

import { appointments } from '../../schema';

import './financial-faturamento-pendente';

type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: { appointmentId: string };
}) => Promise<void>;

const registration = mocks.registerHandler.mock.calls[0]!;
const handler = registration[1] as Handler;

function transactionMock() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { tx: { update }, update, set, where };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handler de faturamento pendente na agenda', () => {
  it('registra-se no evento público do Financial', () => {
    expect(registration[0]).toBe('financial.faturamento.pendente');
  });

  it('marca o agendamento como pendente de faturamento', async () => {
    const { tx, update, set, where } = transactionMock();

    await handler({ tx, clinicId: 'clinic-1', payload: { appointmentId: 'appointment-1' } });

    expect(update).toHaveBeenCalledWith(appointments);
    expect(set).toHaveBeenCalledWith({
      faturamentoPendente: true,
      updatedAt: expect.anything(),
    });
    expect(where).toHaveBeenCalledOnce();
  });
});
