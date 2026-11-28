import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireFreshPermission: vi.fn(),
  requireClinicId: vi.fn(),
  idempotentMutation: vi.fn(),
  publishEvent: vi.fn(),
  insertScheduledAppointment: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: mocks.requireUser,
  requireFreshPermission: mocks.requireFreshPermission,
  requireClinicId: mocks.requireClinicId,
}));
vi.mock('@/lib/idempotency/mutation', () => ({ idempotentMutation: mocks.idempotentMutation }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('./internal/action-helpers', () => ({
  asConflict: (e: unknown) => {
    throw e;
  },
  idemKey: (_a: string, k: string) => k,
  jsonSafe: (v: unknown) => v,
  requestContext: () => Promise.resolve({ correlationId: null }),
}));
vi.mock('./internal/appointment-core', async (orig) => ({
  ...(await orig<object>()),
  insertScheduledAppointment: mocks.insertScheduledAppointment,
}));

import { importAppointmentHistory } from './actions';
import { HistoricalAppointmentImportSchema } from './types';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const BATCH = '99999999-9999-4999-8999-999999999999';
const base = {
  doctorId: '00000000-0000-4000-8000-000000000001',
  patientId: '00000000-0000-4000-8000-000000000002',
  procedureId: '00000000-0000-4000-8000-000000000003',
  scheduledAt: '2025-07-24T10:00:00-03:00',
  historicalStatus: 'atendido' as const,
};
const input = (items: unknown[]) => ({
  source: 'Sistema legado',
  justification: 'Migração autorizada',
  items,
});

/** Transação fake: o lote nasce, o update conclui, e cada chamada fica registrada. */
function fakeTx() {
  const calls: string[] = [];
  const chain = {
    values: vi.fn(() => chain),
    returning: vi.fn(async () => [{ id: BATCH }]),
    set: vi.fn(() => chain),
    where: vi.fn(async () => undefined),
  };
  const tx = {
    insert: vi.fn(() => {
      calls.push('insert-batch');
      return chain;
    }),
    update: vi.fn(() => {
      calls.push('update-batch');
      return chain;
    }),
  };
  return { tx, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: 'user-1' });
  mocks.requireFreshPermission.mockResolvedValue(undefined);
  mocks.requireClinicId.mockResolvedValue(CLINIC);
  let n = 0;
  mocks.insertScheduledAppointment.mockImplementation(async () => ({ id: `appt-${++n}` }));
  mocks.publishEvent.mockResolvedValue(undefined);
});

describe('P4.7-b: esquema do convênio histórico', () => {
  it('convênio exige registro ANS; registro exige convênio; plano exige registro; registro com 6 dígitos', () => {
    const parse = (item: object) =>
      HistoricalAppointmentImportSchema.safeParse(input([{ ...base, ...item }])).success;
    expect(parse({ billingMode: 'convenio', insurerAnsRegistry: '123456', planCode: 'OURO' })).toBe(
      true,
    );
    expect(parse({ billingMode: 'convenio' })).toBe(false);
    expect(parse({ insurerAnsRegistry: '123456' })).toBe(false);
    expect(parse({ billingMode: 'particular', insurerAnsRegistry: '123456' })).toBe(false);
    expect(parse({ billingMode: 'convenio', insurerAnsRegistry: '12345' })).toBe(false);
    expect(parse({ planCode: 'OURO' })).toBe(false);
    expect(parse({})).toBe(true);
  });
});

describe('P4.7-b: importação com a porta do Convênios', () => {
  it('linha de convênio sem a porta é recusada antes de abrir a transação', async () => {
    await expect(
      importAppointmentHistory(
        input([{ ...base, billingMode: 'convenio', insurerAnsRegistry: '123456' }]) as never,
        'key-1',
      ),
    ).rejects.toThrow(/convênio não está disponível/u);
    expect(mocks.idempotentMutation).not.toHaveBeenCalled();
  });

  it('valida TODAS as linhas antes de gravar; erro recusa o lote inteiro com a linha e o motivo', async () => {
    const { tx, calls } = fakeTx();
    mocks.idempotentMutation.mockImplementation(async (_o: unknown, fn: (t: unknown) => unknown) =>
      fn(tx),
    );
    const port = {
      resolve: vi.fn(async () => {
        calls.push('resolve');
        return {
          ok: false as const,
          errors: [
            'linha 2: a operadora com registro ANS 999999 não está cadastrada nesta clínica',
          ],
        };
      }),
      record: vi.fn(),
    };
    await expect(
      importAppointmentHistory(
        input([base, { ...base, billingMode: 'convenio', insurerAnsRegistry: '999999' }]) as never,
        'key-2',
        { historicalCoverage: port as never },
      ),
    ).rejects.toThrow(/importação recusada: linha 2: .*999999/u);
    expect(port.resolve).toHaveBeenCalledWith(tx, CLINIC, [
      { line: 2, insurerAnsRegistry: '999999', planCode: null },
    ]);
    expect(calls).toEqual(['resolve']);
    expect(mocks.insertScheduledAppointment).not.toHaveBeenCalled();
    expect(port.record).not.toHaveBeenCalled();
  });

  it('linha válida: grava atendimento importado e a referência do MESMO atendimento, sem guia nem cobrança', async () => {
    const { tx, calls } = fakeTx();
    mocks.idempotentMutation.mockImplementation(async (_o: unknown, fn: (t: unknown) => unknown) =>
      fn(tx),
    );
    const port = {
      resolve: vi.fn(async () => ({
        ok: true as const,
        byLine: new Map([[2, { insurerId: 'ins-1', planId: 'plan-1' }]]),
      })),
      record: vi.fn(async () => {
        calls.push('record');
      }),
    };
    const result = await importAppointmentHistory(
      input([
        base,
        { ...base, billingMode: 'convenio', insurerAnsRegistry: '123456', planCode: 'OURO' },
      ]) as never,
      'key-3',
      { historicalCoverage: port as never },
    );
    expect(result).toMatchObject({
      batchId: BATCH,
      importedAppointments: 2,
      historicalCoverages: 1,
    });
    expect(port.record).toHaveBeenCalledWith(tx, [
      {
        clinicId: CLINIC,
        appointmentId: 'appt-2',
        insurerId: 'ins-1',
        planId: 'plan-1',
        importBatchId: BATCH,
        createdBy: 'user-1',
      },
    ]);
    const provenance = mocks.insertScheduledAppointment.mock.calls.map(
      (c) => (c[1] as { provenance: { createdVia: string } }).provenance.createdVia,
    );
    expect(provenance).toEqual(['import', 'import']);
    expect(calls).toEqual(['insert-batch', 'record', 'update-batch']);
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        payload: expect.objectContaining({ historicalCoverages: 1, importedAppointments: 2 }),
      }),
    );
  });

  it('lote só particular: a porta nem é chamada', async () => {
    const { tx } = fakeTx();
    mocks.idempotentMutation.mockImplementation(async (_o: unknown, fn: (t: unknown) => unknown) =>
      fn(tx),
    );
    const port = { resolve: vi.fn(), record: vi.fn() };
    const result = await importAppointmentHistory(input([base]) as never, 'key-4', {
      historicalCoverage: port as never,
    });
    expect(result.historicalCoverages).toBe(0);
    expect(port.resolve).not.toHaveBeenCalled();
    expect(port.record).not.toHaveBeenCalled();
  });
});
