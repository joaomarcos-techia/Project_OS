/**
 * Handler `scheduling.appointment.completed` → recebível do atendimento (C9) e,
 * desde a 1.5b.2, alocação dos créditos já pagos (ADR-051).
 *
 * **Este handler não tinha teste nenhum até a 1.5b.2** (achado **D33**), e é ele
 * que cria TODO recebível do Caixa. As invariantes que ele sustenta:
 *
 *   - o lançamento representa o valor **BRUTO** do atendimento — nunca líquido
 *     do sinal (invariante 3 do ADR-051);
 *   - `valorPago` só nasce com dinheiro que existe como crédito alocado
 *     (invariante 4);
 *   - reentrega do worker **não** duplica lançamento nem realoca crédito;
 *   - falha de alocação derruba o lançamento junto — recebível dizendo
 *     "R$ 100 pagos" com o crédito ainda `available` é dinheiro contável duas
 *     vezes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  publishEvent: vi.fn(),
  listAvailableCredits: vi.fn(),
  allocateCredit: vi.fn(),
  createProfessionalPayoutSnapshot: vi.fn(),
  refreshProfessionalPayout: vi.fn(),
  lancamentoValues: vi.fn(),
  paymentValues: vi.fn(),
  pendenciaValues: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('@/contexts/scheduling', () => ({
  SCHEDULING_EVENTS: { COMPLETED: 'scheduling.appointment.completed' },
}));
vi.mock('../credit-store', () => ({
  listAvailableCredits: mocks.listAvailableCredits,
  allocateCredit: mocks.allocateCredit,
}));
vi.mock('../professional-payout', () => ({
  createProfessionalPayoutSnapshot: mocks.createProfessionalPayoutSnapshot,
  refreshProfessionalPayout: mocks.refreshProfessionalPayout,
}));
vi.mock('../../schema', () => ({
  lancamentos: { __t: 'lancamentos', appointmentId: 'l.appointment_id', id: 'l.id' },
  paymentTransactions: { __t: 'payment_transactions', id: 'pt.id' },
  faturamentoPendencias: { __t: 'faturamento_pendencias', appointmentId: 'fp.appointment_id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  sql: Object.assign((strings: TemplateStringsArray) => ({ __sql: strings.join('?') }), {
    raw: () => 'RAW',
  }),
}));

import { PoisonPillError } from '@/lib/outbox/errors';

import './appointment-completed';

const registration = mocks.registerHandler.mock.calls[0]!;
type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;
const handler = registration[1] as Handler;

/** tx falso: distingue a tabela pelo objeto mockado em `../../schema`. */
function stubTx(opts: { lancamentoRow?: unknown[] } = {}) {
  return {
    execute: async () => [{ timezone: 'America/Sao_Paulo' }],
    insert: (table: { __t: string }) => ({
      values: (v: unknown) => {
        if (table.__t === 'lancamentos') {
          mocks.lancamentoValues(v);
          return {
            onConflictDoNothing: () => ({
              returning: async () => opts.lancamentoRow ?? [{ id: 'lanc-1' }],
            }),
          };
        }
        if (table.__t === 'payment_transactions') {
          mocks.paymentValues(v);
          return { returning: async () => [{ id: 'tx-1' }] };
        }
        mocks.pendenciaValues(v);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as never;
}

const payload = (over: Record<string, unknown> = {}) => ({
  appointmentId: 'apt-1',
  clinicId: 'clinic-1',
  doctorId: 'doc-1',
  patientId: 'pac-1',
  procedureId: 'proc-1',
  unitId: null,
  valor: 200,
  snapshotProcedureName: 'Consulta psiquiátrica',
  snapshotDoctorNome: 'Ana Costa',
  scheduledAt: '2026-08-25T13:00:00.000Z',
  ...over,
});

const run = (over: Record<string, unknown> = {}, opts?: { lancamentoRow?: unknown[] }) =>
  handler({ tx: stubTx(opts), clinicId: 'clinic-1', payload: payload(over), eventId: 'evt-1' });

const lancamento = () => mocks.lancamentoValues.mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAvailableCredits.mockResolvedValue([]);
  mocks.allocateCredit.mockResolvedValue(true);
  mocks.createProfessionalPayoutSnapshot.mockResolvedValue(null);
  mocks.refreshProfessionalPayout.mockResolvedValue('missing');
});

describe('faturamento do atendimento — sem sinal (o caso da maioria)', () => {
  it('registra-se como consumidor de appointment.completed', () => {
    expect(registration[0]).toBe('scheduling.appointment.completed');
  });

  it('cria o recebível pelo valor cheio, pendente e sem baixa', async () => {
    await run();

    expect(lancamento()).toMatchObject({
      tipo: 'receber',
      valor: '200.00',
      valorPago: '0.00',
      status: 'pendente',
    });
    expect(mocks.paymentValues).not.toHaveBeenCalled();
  });

  it('publica lancamento.created', async () => {
    await run();

    const evento = mocks.publishEvent.mock.calls[0]![1] as { eventType: string };
    expect(evento.eventType).toBe('financial.lancamento.created');
  });

  it('tenta criar exatamente um snapshot de repasse com a regra vigente', async () => {
    await run();

    expect(mocks.createProfessionalPayoutSnapshot).toHaveBeenCalledWith(expect.anything(), {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
      professionalId: 'doc-1',
      procedureId: 'proc-1',
      grossAmount: 200,
      occurredAt: new Date('2026-08-25T13:00:00.000Z'),
    });
  });
});

describe('faturamento com sinal já pago (ADR-051 1.5b.2)', () => {
  const credito = (over: Record<string, unknown> = {}) => ({
    id: 'cred-1',
    amount: '100.00',
    paymentMethod: 'pix',
    ...over,
  });

  it('recebível BRUTO com o crédito aplicado: 200 / 100 / parcial', async () => {
    mocks.listAvailableCredits.mockResolvedValue([credito()]);

    await run();

    expect(lancamento()).toMatchObject({
      valor: '200.00', // NUNCA 100: faturamento ≠ recebimento
      valorPago: '100.00',
      status: 'parcial',
    });
  });

  it('deixa a baixa no ledger, com a forma de pagamento de origem', async () => {
    mocks.listAvailableCredits.mockResolvedValue([credito()]);

    await run();

    expect(mocks.paymentValues).toHaveBeenCalledWith(
      expect.objectContaining({
        lancamentoId: 'lanc-1',
        kind: 'payment',
        amount: '100.00',
        paymentMethod: 'pix',
      }),
    );
  });

  it('consome o crédito, apontando o lançamento', async () => {
    mocks.listAvailableCredits.mockResolvedValue([credito()]);

    await run();

    expect(mocks.allocateCredit).toHaveBeenCalledWith(expect.anything(), {
      clinicId: 'clinic-1',
      creditId: 'cred-1',
      lancamentoId: 'lanc-1',
      paymentTransactionId: 'tx-1',
      amount: 100,
    });
  });

  it('crédito que cobre tudo deixa o recebível PAGO', async () => {
    mocks.listAvailableCredits.mockResolvedValue([credito({ amount: '200.00' })]);

    await run();

    expect(lancamento()).toMatchObject({
      valorPago: '200.00',
      status: 'pago',
      paidAt: expect.anything(),
    });
    expect(mocks.refreshProfessionalPayout).toHaveBeenCalledWith(expect.anything(), {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
    });
  });

  it('crédito MAIOR que o valor não infla o valorPago', async () => {
    // Reajuste para baixo depois do sinal: quitar além do valor deixaria o
    // recebível sem lastro (invariante 4).
    mocks.listAvailableCredits.mockResolvedValue([credito({ amount: '300.00' })]);

    await run({ valor: 200 });

    expect(lancamento()).toMatchObject({
      valorPago: '200.00',
      status: 'pago',
      paidAt: expect.anything(),
    });
    expect(mocks.allocateCredit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: 200 }),
    );
  });

  it('sem forma de pagamento no crédito, a baixa vai sem forma (não inventa)', async () => {
    mocks.listAvailableCredits.mockResolvedValue([credito({ paymentMethod: null })]);

    await run();

    expect(mocks.paymentValues).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: null }),
    );
  });
});

describe('idempotência e falhas', () => {
  it('reentrega não realoca crédito: o lançamento já existia', async () => {
    mocks.listAvailableCredits.mockResolvedValue([
      { id: 'cred-1', amount: '100.00', paymentMethod: 'pix' },
    ]);

    await run({}, { lancamentoRow: [] }); // UNIQUE(appointment_id) barrou

    expect(mocks.allocateCredit).not.toHaveBeenCalled();
    expect(mocks.createProfessionalPayoutSnapshot).not.toHaveBeenCalled();
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('crédito indisponível na hora de alocar ABORTA — nada de valorPago sem lastro', async () => {
    mocks.listAvailableCredits.mockResolvedValue([
      { id: 'cred-1', amount: '100.00', paymentMethod: 'pix' },
    ]);
    mocks.allocateCredit.mockResolvedValue(false);

    await expect(run()).rejects.toThrow(/não estava disponível/);
  });

  it('clínica divergente é poison pill, não retentativa', async () => {
    const err = await run({ clinicId: 'clinic-INTRUSA' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PoisonPillError);
    expect(mocks.lancamentoValues).not.toHaveBeenCalled();
  });

  it('valor inválido vira pendência, sem lançamento e sem consumir crédito', async () => {
    mocks.listAvailableCredits.mockResolvedValue([
      { id: 'cred-1', amount: '100.00', paymentMethod: 'pix' },
    ]);

    await run({ valor: 0 });

    expect(mocks.pendenciaValues).toHaveBeenCalled();
    expect(mocks.lancamentoValues).not.toHaveBeenCalled();
    // O crédito continua disponível: há dinheiro do paciente e uma pessoa
    // precisa decidir o que fazer com ele.
    expect(mocks.allocateCredit).not.toHaveBeenCalled();
  });
});
