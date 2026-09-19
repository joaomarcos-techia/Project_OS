/**
 * Créditos do paciente (ADR-051 1.5b.1) — o dinheiro que chega antes da obrigação.
 *
 * Aqui dinheiro entra no lado financeiro. Cada teste protege uma invariante que,
 * invertida, faz a clínica receber baixa em dobro ou o paciente perder o que
 * pagou:
 *   - crédito duplicado sob reentrega do worker;
 *   - crédito liberado depois de já ter virado `valorPago`;
 *   - crédito alocado duas vezes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  isNull: (col: unknown) => ({ isNull: col }),
  or: (...args: unknown[]) => ({ or: args }),
  sql: Object.assign(() => 'NOW', { raw: () => 'NOW' }),
}));
vi.mock('../schema', () => ({
  patientCredits: {
    id: 'pc.id',
    clinicId: 'pc.clinic_id',
    patientChargeId: 'pc.patient_charge_id',
    appointmentId: 'pc.appointment_id',
    status: 'pc.status',
    disputeStatus: 'pc.dispute_status',
    grantedAt: 'pc.granted_at',
  },
}));

import { allocateCredit, grantCredit, listAvailableCredits, releaseCredit } from './credit-store';

const CLINIC = 'clinic-1';
const CHARGE = 'charge-1';

const calls = {
  values: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
};

/** tx falso encadeável: `opts` controla o que cada ramo devolve. */
function stubTx(opts: { inserted?: unknown[]; selected?: unknown[]; updated?: unknown[] } = {}) {
  return {
    insert: () => ({
      values: (v: unknown) => {
        calls.values(v);
        return {
          onConflictDoNothing: () => ({
            returning: async () => opts.inserted ?? [{ id: 'cred-1' }],
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: (c: unknown) => {
          calls.where(c);
          return {
            limit: async () => opts.selected ?? [],
            orderBy: async () => opts.selected ?? [],
          };
        },
      }),
    }),
    update: () => ({
      set: (v: unknown) => {
        calls.set(v);
        return {
          where: (c: unknown) => {
            calls.where(c);
            return { returning: async () => opts.updated ?? [{ id: 'cred-1' }] };
          },
        };
      },
    }),
  } as never;
}

const grantInput = {
  clinicId: CLINIC,
  patientChargeId: CHARGE,
  appointmentId: 'apt-1',
  patientId: 'pac-1',
  amount: 150,
  kind: 'deposit' as const,
  paymentMethod: 'pix',
  grantedAt: new Date('2026-08-25T12:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('grantCredit — um crédito por cobrança', () => {
  it('grava o crédito disponível, sem alocação', async () => {
    await expect(grantCredit(stubTx(), grantInput)).resolves.toBe('cred-1');

    expect(calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC,
        patientChargeId: CHARGE,
        amount: '150.00',
        allocatedAmount: '0',
        status: 'available',
        paymentMethod: 'pix',
      }),
    );
  });

  it('reentrega do worker NÃO cria segundo crédito (UNIQUE barrou)', async () => {
    // Sem isto a clínica receberia baixa em dobro por um pagamento só.
    await expect(grantCredit(stubTx({ inserted: [] }), grantInput)).resolves.toBeNull();
  });

  it('valor vai como decimal de 2 casas — dinheiro nunca vira float na coluna', async () => {
    await grantCredit(stubTx(), { ...grantInput, amount: 33.333 });

    expect(calls.values).toHaveBeenCalledWith(expect.objectContaining({ amount: '33.33' }));
  });

  it('sem forma de pagamento reconhecida, grava null (nunca inventa)', async () => {
    await grantCredit(stubTx(), { ...grantInput, paymentMethod: null });

    expect(calls.values).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: null }));
  });
});

describe('releaseCredit — sair de `available` sem virar baixa', () => {
  const input = {
    clinicId: CLINIC,
    patientChargeId: CHARGE,
    disposition: 'refunded' as const,
    releasedAt: new Date('2026-08-25T13:00:00.000Z'),
  };

  it('crédito disponível é liberado com a disposition recebida', async () => {
    const tx = stubTx({ selected: [{ id: 'cred-1', status: 'available' }] });

    await expect(releaseCredit(tx, input)).resolves.toBe('released');
    expect(calls.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'refunded', releasedAt: input.releasedAt }),
    );
  });

  it('`retained` é gravado como tal — não se confunde com estorno', async () => {
    // Economicamente opostos: em um o dinheiro saiu, no outro continua sendo
    // receita. Achatar os dois num status só apagaria essa diferença no Caixa.
    const tx = stubTx({ selected: [{ id: 'cred-1', status: 'available' }] });

    await releaseCredit(tx, { ...input, disposition: 'retained' });

    expect(calls.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'retained' }));
  });

  it('crédito JÁ ALOCADO não é liberado — o dinheiro virou valorPago', async () => {
    // Liberar aqui deixaria um recebível quitado sem lastro. Esse caso é estorno
    // de lançamento, caminho que já existe no Financial e tem regra própria.
    const tx = stubTx({ selected: [{ id: 'cred-1', status: 'allocated' }] });

    await expect(releaseCredit(tx, input)).resolves.toBe('already_resolved');
    expect(calls.set).not.toHaveBeenCalled();
  });

  it('crédito inexistente é tolerado (janela de deploy), não vira erro', async () => {
    // Cobrança paga ANTES da 1.5b.1 subir não tem crédito. Lançar aqui prenderia
    // o evento num laço de retentativa por causa de um deploy.
    await expect(releaseCredit(stubTx({ selected: [] }), input)).resolves.toBe('not_found');
  });

  it('corrida perdida no UPDATE devolve already_resolved, não erro', async () => {
    const tx = stubTx({ selected: [{ id: 'cred-1', status: 'available' }], updated: [] });

    await expect(releaseCredit(tx, input)).resolves.toBe('already_resolved');
  });
});

describe('allocateCredit — consumir o crédito num lançamento', () => {
  it('aloca o valor e aponta o lançamento', async () => {
    await expect(
      allocateCredit(stubTx(), {
        clinicId: CLINIC,
        creditId: 'cred-1',
        lancamentoId: 'lanc-1',
        amount: 150,
      }),
    ).resolves.toBe(true);

    expect(calls.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'allocated',
        allocatedAmount: '150.00',
        allocatedLancamentoId: 'lanc-1',
      }),
    );
  });

  it('só aloca a partir de `available` — nunca duas vezes o mesmo dinheiro', async () => {
    const cond = () => calls.where.mock.calls[0]![0] as { and: Array<{ eq: unknown[] }> };

    await allocateCredit(stubTx(), {
      clinicId: CLINIC,
      creditId: 'cred-1',
      lancamentoId: 'lanc-1',
      amount: 150,
    });

    expect(cond().and.some((c) => c.eq[1] === 'available')).toBe(true);
  });

  it('reentrega do `appointment.completed` não realoca (WHERE não acha)', async () => {
    await expect(
      allocateCredit(stubTx({ updated: [] }), {
        clinicId: CLINIC,
        creditId: 'cred-1',
        lancamentoId: 'lanc-1',
        amount: 150,
      }),
    ).resolves.toBe(false);
  });
});

describe('listAvailableCredits', () => {
  it('filtra por clínica, agendamento e `available`', async () => {
    const tx = stubTx({ selected: [{ id: 'cred-1' }] });

    await listAvailableCredits(tx, CLINIC, 'apt-1');

    const cond = calls.where.mock.calls[0]![0] as {
      and: Array<{ eq?: unknown[]; or?: unknown[] }>;
    };
    const valores = cond.and.flatMap((c) => (c.eq ? [c.eq[1]] : []));
    expect(valores).toContain(CLINIC);
    expect(valores).toContain('apt-1');
    expect(valores).toContain('available');
    expect(cond.and.some((c) => c.or)).toBe(true);
  });
});
