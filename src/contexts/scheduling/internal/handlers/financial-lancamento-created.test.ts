import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/financial', () => ({
  FINANCIAL_EVENTS: { LANCAMENTO_CREATED: 'financial.lancamento.created' },
}));

import { appointments } from '../../schema';

import './financial-lancamento-created';

type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: { appointmentId: string | null };
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

describe('handler de lançamento criado na agenda', () => {
  it('registra-se no evento público do Financial', () => {
    expect(registration[0]).toBe('financial.lancamento.created');
  });

  it('limpa o faturamento pendente do agendamento relacionado', async () => {
    const { tx, update, set, where } = transactionMock();

    await handler({ tx, clinicId: 'clinic-1', payload: { appointmentId: 'appointment-1' } });

    expect(update).toHaveBeenCalledWith(appointments);
    expect(set).toHaveBeenCalledWith({
      faturamentoPendente: false,
      updatedAt: expect.anything(),
    });
    expect(where).toHaveBeenCalledOnce();
  });

  it('ignora lançamento manual sem appointmentId', async () => {
    const { tx, update } = transactionMock();

    await handler({ tx, clinicId: 'clinic-1', payload: { appointmentId: null } });

    expect(update).not.toHaveBeenCalled();
  });
});
