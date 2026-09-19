/**
 * `getAppointmentBalance` (ADR-051 1.5b.3a) — o seam pelo qual o Payments
 * pergunta **quanto ainda falta** antes de cobrar o restante.
 *
 * Por que este seam existe, e por que ele é o dono da resposta: se o Payments
 * calculasse sozinho (valor do procedimento menos o que ELE recebeu), um
 * pagamento feito em dinheiro na recepção e lançado no Caixa não apareceria — e
 * o paciente receberia um link cobrando algo que já pagou.
 *
 * `null` significa **não cobrar**, o mesmo modo de falha seguro do
 * `resolveDepositAmount`.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { getAppointmentBalance } from './queries';

const dialect = new PgDialect();
let capturedWhere: unknown = null;

function stubTx(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          capturedWhere = cond;
          return { limit: async () => rows };
        },
      }),
    }),
  };
}

/** SQL renderizado do WHERE — é como se prova QUAIS status foram excluídos. */
function whereSql(): string {
  return dialect.sqlToQuery(capturedWhere as never).sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedWhere = null;
});

function mount(rows: unknown[]) {
  withTenant.mockImplementation((async (_c: string, fn: (t: unknown) => unknown) =>
    fn(stubTx(rows))) as never);
}

describe('getAppointmentBalance', () => {
  it('devolve o saldo em aberto do recebível', async () => {
    mount([{ id: 'lanc-1', valor: '200.00', valorPago: '100.00' }]);

    await expect(getAppointmentBalance('clinic-1', 'apt-1')).resolves.toEqual({
      lancamentoId: 'lanc-1',
      valor: 200,
      valorPago: 100,
      saldo: 100,
    });
  });

  it('recebível ainda sem baixa devolve o valor inteiro', async () => {
    mount([{ id: 'lanc-1', valor: '200.00', valorPago: '0.00' }]);

    await expect(getAppointmentBalance('clinic-1', 'apt-1')).resolves.toMatchObject({ saldo: 200 });
  });

  it('sem recebível em aberto devolve null — e null significa NÃO cobrar', async () => {
    mount([]);

    await expect(getAppointmentBalance('clinic-1', 'apt-1')).resolves.toBeNull();
  });

  it('só considera recebível PENDENTE ou PARCIAL', async () => {
    // `pago` fora: não há saldo. `cancelado`/`estornado` fora: deixaram de ser
    // obrigação, e perseguir saldo neles cobraria o paciente por nada.
    mount([{ id: 'lanc-1', valor: '200.00', valorPago: '0.00' }]);

    await getAppointmentBalance('clinic-1', 'apt-1');

    const sql = whereSql();
    expect(sql).toContain('status');
    expect(sql).toMatch(/in \(/i);
  });

  it('filtra por clínica E agendamento (isolamento de tenant explícito)', async () => {
    mount([{ id: 'lanc-1', valor: '200.00', valorPago: '0.00' }]);

    await getAppointmentBalance('clinic-1', 'apt-1');

    expect(whereSql()).toContain('clinic_id');
    expect(whereSql()).toContain('appointment_id');
  });

  it('lê pelo caminho tenant (RLS), nunca por dbAdmin', async () => {
    mount([]);

    await getAppointmentBalance('clinic-1', 'apt-1');

    expect(withTenant).toHaveBeenCalledWith('clinic-1', expect.any(Function));
  });

  it('arredonda o saldo em centavos — dinheiro não carrega erro de float', async () => {
    mount([{ id: 'lanc-1', valor: '0.30', valorPago: '0.10' }]);

    await expect(getAppointmentBalance('clinic-1', 'apt-1')).resolves.toMatchObject({
      saldo: 0.2,
    });
  });
});
