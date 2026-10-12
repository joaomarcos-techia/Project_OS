import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { listPatientChargeEconomics } from './charge-economics';

const dialect = new PgDialect();

beforeEach(() => vi.clearAllMocks());

describe('fatos individuais das cobranças no Caixa', () => {
  it('não consulta banco sem atendimento', async () => {
    await expect(listPatientChargeEconomics('clinic-1', [])).resolves.toEqual([]);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('escopa por clínica, deduplica atendimentos e não consulta links ou credenciais', async () => {
    const queries: { text: string; params: unknown[] }[] = [];
    withTenant.mockImplementation(async (_clinicId: string, fn: (tx: unknown) => unknown) =>
      fn({
        execute: async (query: SQL) => {
          const compiled = dialect.sqlToQuery(query);
          queries.push({ text: compiled.sql, params: compiled.params });
          return [
            {
              id: 'charge-1',
              appointment_id: 'appointment-1',
              kind: 'deposit',
              status: 'paid',
              amount: '100.00',
              provider_gross_amount: '100.00',
              provider_fee_amount: '0.00',
              provider_net_amount: '100.00',
            },
            {
              id: 'charge-2',
              appointment_id: 'appointment-1',
              kind: 'remainder',
              status: 'pending',
              amount: '200.00',
              provider_gross_amount: null,
              provider_fee_amount: null,
              provider_net_amount: null,
            },
          ];
        },
      }),
    );

    const result = await listPatientChargeEconomics('clinic-1', [
      'appointment-1',
      'appointment-1',
      'appointment-2',
    ]);

    expect(withTenant).toHaveBeenCalledWith('clinic-1', expect.any(Function));
    expect(queries[0]?.text).toContain('clinic_id = $1::uuid');
    expect(queries[0]?.text).toContain('appointment_id IN ($2::uuid, $3::uuid)');
    expect(queries[0]?.text).not.toMatch(/invoice_url|api_key|provider_payment_id/u);
    expect(queries[0]?.params).toEqual(['clinic-1', 'appointment-1', 'appointment-2']);
    expect(result).toEqual([
      {
        chargeId: 'charge-1',
        appointmentId: 'appointment-1',
        kind: 'deposit',
        status: 'paid',
        requestedAmount: 100,
        providerGrossAmount: 100,
        providerFeeAmount: 0,
        providerNetAmount: 100,
      },
      {
        chargeId: 'charge-2',
        appointmentId: 'appointment-1',
        kind: 'remainder',
        status: 'pending',
        requestedAmount: 200,
        providerGrossAmount: null,
        providerFeeAmount: null,
        providerNetAmount: null,
      },
    ]);
  });
});
