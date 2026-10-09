/**
 * Handler `financial.lancamento.paid` → fecha o link do restante (08/10/2026).
 *
 * Protege a FIAÇÃO (a regra é do `charge-closeout.test.ts`): registro no evento
 * certo, execução DETACHED e o filtro — só a baixa da recepção, com atendimento,
 * fecha o link; a baixa que veio do próprio link e eventos antigos passam direto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerDetachedHandler: vi.fn(),
  registerHandler: vi.fn(),
  closeRemainderAfterManualPayment: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({
  registerDetachedHandler: mocks.registerDetachedHandler,
  registerHandler: mocks.registerHandler,
}));
vi.mock('@/contexts/financial', () => ({
  FINANCIAL_EVENTS: { LANCAMENTO_PAID: 'financial.lancamento.paid' },
}));
vi.mock('../charge-closeout', () => ({
  closeRemainderAfterManualPayment: mocks.closeRemainderAfterManualPayment,
}));

import './lancamento-paid';

// Capturado no LOAD do módulo: `clearAllMocks` apagaria o registro.
const registration = mocks.registerDetachedHandler.mock.calls[0]!;
type Handler = (ctx: {
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;
const handler = registration[1] as Handler;

const payload = (over: Record<string, unknown> = {}) => ({
  lancamentoId: 'lanc-1',
  transactionId: 'tx-1',
  clinicId: 'clinic-1',
  valor: 150,
  amount: 75,
  valorPago: 150,
  status: 'pago',
  paymentMethod: 'dinheiro',
  appointmentId: 'apt-1',
  source: 'manual',
  ...over,
});

beforeEach(() => {
  mocks.closeRemainderAfterManualPayment.mockReset();
});

describe('lancamento.paid → link do restante', () => {
  it('registra DETACHED no evento de baixa do Financial', () => {
    expect(registration[0]).toBe('financial.lancamento.paid');
    expect(mocks.registerHandler).not.toHaveBeenCalled();
  });

  it('baixa da recepção com atendimento fecha o link do restante', async () => {
    await handler({ clinicId: 'clinic-1', payload: payload(), eventId: 'e1' });
    expect(mocks.closeRemainderAfterManualPayment).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
    });
  });

  it('também fecha numa baixa parcial: depois do registro manual, o saldo é da recepção', async () => {
    await handler({
      clinicId: 'clinic-1',
      payload: payload({ status: 'parcial', valorPago: 100 }),
      eventId: 'e2',
    });
    expect(mocks.closeRemainderAfterManualPayment).toHaveBeenCalledOnce();
  });

  it.each([
    ['baixa que veio do próprio link', { source: 'gateway' }],
    ['evento anterior ao campo', { source: undefined }],
    ['lançamento sem atendimento', { appointmentId: null }],
  ])('%s: não fecha nada', async (_name, over) => {
    await handler({ clinicId: 'clinic-1', payload: payload(over), eventId: 'e3' });
    expect(mocks.closeRemainderAfterManualPayment).not.toHaveBeenCalled();
  });
});
