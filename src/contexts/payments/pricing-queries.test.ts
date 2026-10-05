import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const { withTenantMock, hasAdvancedFinancialPolicies } = vi.hoisted(() => ({
  withTenantMock: vi.fn(),
  hasAdvancedFinancialPolicies: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: withTenantMock }));
vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasAdvancedFinancialPolicies },
}));

import type { Tx } from '@/lib/db';
import {
  getEffectivePaymentPricingMode,
  listProcedurePaymentPrices,
  matchesConfiguredProcedurePriceSnapshot,
  resolveConfiguredProcedurePaymentPrice,
} from './pricing-queries';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const PROCEDURE_ID = '22222222-2222-4222-8222-222222222222';
const PRICE_ID = '33333333-3333-4333-8333-333333333333';

function queryResolving(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const query = Object.assign(promise, {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
  });
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  return query;
}

function stubTenantReads(...reads: unknown[][]) {
  const pending = [...reads];
  withTenantMock.mockImplementation(
    async (clinicId: string, operation: (tx: unknown) => unknown) => {
      const rows = pending.shift();
      if (!rows) throw new Error('leitura tenant inesperada');
      return operation({ select: () => queryResolving(rows) });
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasAdvancedFinancialPolicies.mockResolvedValue(true);
});

describe('getEffectivePaymentPricingMode', () => {
  it('ignora política antiga após downgrade para Solo na mesma transação', async () => {
    hasAdvancedFinancialPolicies.mockResolvedValue(false);
    const tx = { select: vi.fn() } as unknown as Tx;
    await expect(getEffectivePaymentPricingMode(tx, CLINIC_ID)).resolves.toBe('absorb_fees');
    expect(hasAdvancedFinancialPolicies).toHaveBeenCalledWith(CLINIC_ID, tx);
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('lê a política ativa da clínica no snapshot transacional', async () => {
    const tx = {
      select: vi.fn(() => queryResolving([{ mode: 'payment_method_pricing' }])),
    } as unknown as Tx;
    await expect(getEffectivePaymentPricingMode(tx, CLINIC_ID)).resolves.toBe(
      'payment_method_pricing',
    );
    expect(hasAdvancedFinancialPolicies).toHaveBeenCalledWith(CLINIC_ID, tx);
    expect(tx.select).toHaveBeenCalledTimes(1);
  });

  it('usa ABSORB_FEES quando Clínica/Pro ainda não configurou política', async () => {
    const tx = { select: vi.fn(() => queryResolving([])) } as unknown as Tx;
    await expect(getEffectivePaymentPricingMode(tx, CLINIC_ID)).resolves.toBe('absorb_fees');
  });
});

describe('resolveConfiguredProcedurePaymentPrice', () => {
  it('não oferece uma versão com vigência futura na listagem', async () => {
    const query = queryResolving([]);
    withTenantMock.mockImplementation(
      async (_clinicId: string, operation: (tx: unknown) => unknown) =>
        operation({ select: () => query }),
    );

    await listProcedurePaymentPrices(CLINIC_ID);

    const where = new PgDialect().sqlToQuery(query.where.mock.calls[0]![0] as SQL).sql;
    expect(where).toMatch(/effective_from.*<= now\(\)/);
  });

  it('não cota uma versão com vigência futura para o paciente', async () => {
    const policy = queryResolving([{ mode: 'payment_method_pricing' }]);
    const prices = queryResolving([]);
    let read = 0;
    withTenantMock.mockImplementation(
      async (_clinicId: string, operation: (tx: unknown) => unknown) =>
        operation({ select: () => [policy, prices][read++] }),
    );

    await resolveConfiguredProcedurePaymentPrice({
      clinicId: CLINIC_ID,
      procedureId: PROCEDURE_ID,
      standardGrossAmount: 250,
      paymentMethod: 'pix',
    });

    const where = new PgDialect().sqlToQuery(prices.where.mock.calls[0]![0] as SQL).sql;
    expect(where).toMatch(/effective_from.*<= now\(\)/);
  });

  it('no Solo ignora a política antiga após downgrade e mantém o bruto padrão', async () => {
    hasAdvancedFinancialPolicies.mockResolvedValue(false);
    await expect(
      resolveConfiguredProcedurePaymentPrice({
        clinicId: CLINIC_ID,
        procedureId: PROCEDURE_ID,
        standardGrossAmount: 250,
        paymentMethod: 'pix',
      }),
    ).resolves.toEqual({
      mode: 'absorb_fees',
      grossAmount: 250,
      paymentMethod: null,
      installmentCount: null,
      priceId: null,
      source: 'standard',
    });
    expect(withTenantMock).not.toHaveBeenCalled();
  });
  it('mantém o bruto padrão e não consulta tabela de preços no modo ABSORB_FEES', async () => {
    stubTenantReads([{ mode: 'absorb_fees', updatedAt: new Date('2026-10-02T10:00:00Z') }]);

    await expect(
      resolveConfiguredProcedurePaymentPrice({
        clinicId: CLINIC_ID,
        procedureId: PROCEDURE_ID,
        standardGrossAmount: 250,
        paymentMethod: 'pix',
      }),
    ).resolves.toEqual({
      mode: 'absorb_fees',
      grossAmount: 250,
      paymentMethod: null,
      installmentCount: null,
      priceId: null,
      source: 'standard',
    });
    expect(withTenantMock).toHaveBeenCalledTimes(1);
  });

  it('resolve no tenant autenticado o preço e a versão exatos do cartão', async () => {
    stubTenantReads(
      [{ mode: 'payment_method_pricing', updatedAt: new Date('2026-10-02T10:00:00Z') }],
      [
        {
          id: PRICE_ID,
          clinicId: CLINIC_ID,
          procedureId: PROCEDURE_ID,
          paymentMethod: 'credit_card',
          installmentCount: 3,
          grossAmount: '260.00',
        },
      ],
    );

    await expect(
      resolveConfiguredProcedurePaymentPrice({
        clinicId: CLINIC_ID,
        procedureId: PROCEDURE_ID,
        standardGrossAmount: 250,
        paymentMethod: 'credit_card',
        installmentCount: 3,
      }),
    ).resolves.toEqual({
      mode: 'payment_method_pricing',
      grossAmount: 260,
      paymentMethod: 'credit_card',
      installmentCount: 3,
      priceId: PRICE_ID,
      source: 'explicit_method_price',
    });
    expect(withTenantMock.mock.calls.map((call) => call[0])).toEqual([CLINIC_ID, CLINIC_ID]);
  });

  it('não faz fallback para o preço padrão quando a condição não existe', async () => {
    stubTenantReads(
      [{ mode: 'payment_method_pricing', updatedAt: new Date('2026-10-02T10:00:00Z') }],
      [],
    );

    await expect(
      resolveConfiguredProcedurePaymentPrice({
        clinicId: CLINIC_ID,
        procedureId: PROCEDURE_ID,
        standardGrossAmount: 250,
        paymentMethod: 'pix',
      }),
    ).resolves.toBeNull();
  });
});

describe('matchesConfiguredProcedurePriceSnapshot', () => {
  const input = {
    clinicId: CLINIC_ID,
    procedureId: PROCEDURE_ID,
    priceId: PRICE_ID,
    paymentMethod: 'credit_card' as const,
    installmentCount: 3,
    grossAmount: 260,
  };

  function transaction(policy: unknown[], prices: unknown[]): Tx {
    const reads = [policy, prices];
    return {
      select: vi.fn(() => queryResolving(reads.shift() ?? [])),
    } as unknown as Tx;
  }

  it('recusa versão quando a política deixou de ser preço por método', async () => {
    const tx = transaction([{ mode: 'absorb_fees' }], []);
    await expect(matchesConfiguredProcedurePriceSnapshot(tx, input)).resolves.toBe(false);
    expect(tx.select).toHaveBeenCalledTimes(1);
  });

  it('confere método, parcelas e bruto da versão ativa na mesma transação', async () => {
    const tx = transaction(
      [{ mode: 'payment_method_pricing' }],
      [{ paymentMethod: 'credit_card', installmentCount: 3, grossAmount: '260.00' }],
    );
    await expect(matchesConfiguredProcedurePriceSnapshot(tx, input)).resolves.toBe(true);
    expect(tx.select).toHaveBeenCalledTimes(2);
  });

  it.each([
    { prices: [{ paymentMethod: 'pix', installmentCount: null, grossAmount: '260.00' }] },
    { prices: [{ paymentMethod: 'credit_card', installmentCount: 1, grossAmount: '260.00' }] },
    { prices: [{ paymentMethod: 'credit_card', installmentCount: 3, grossAmount: '261.00' }] },
    { prices: [] },
  ])('recusa condição divergente ou ausente: $prices', async ({ prices }) => {
    const tx = transaction([{ mode: 'payment_method_pricing' }], prices);
    await expect(matchesConfiguredProcedurePriceSnapshot(tx, input)).resolves.toBe(false);
  });
});
