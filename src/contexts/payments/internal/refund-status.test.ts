import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { listExcessRefundStatuses, listManualRefundTasks } from './refund-status';

const dialect = new PgDialect();

function stubRows(rows: unknown[]): { sqls: string[]; params: unknown[][] } {
  const sqls: string[] = [];
  const params: unknown[][] = [];
  withTenant.mockImplementation((async (_clinicId: string, fn: (tx: unknown) => unknown) =>
    fn({
      execute: async (query: SQL) => {
        const compiled = dialect.sqlToQuery(query);
        sqls.push(compiled.sql);
        params.push(compiled.params);
        return rows;
      },
    })) as never);
  return { sqls, params };
}

beforeEach(() => vi.clearAllMocks());

describe('listExcessRefundStatuses', () => {
  it('não abre transação quando não há atendimentos', async () => {
    await expect(listExcessRefundStatuses('clinic-1', [])).resolves.toEqual([]);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('lê somente excess, escopa as duas tabelas ao tenant e deduplica ids', async () => {
    const capture = stubRows([]);

    await listExcessRefundStatuses('clinic-1', ['appointment-1', 'appointment-1']);

    expect(withTenant).toHaveBeenCalledWith('clinic-1', expect.any(Function));
    expect(capture.sqls[0]).toContain("i.purpose = 'excess'");
    expect(capture.sqls[0]).toContain('i.clinic_id = $1::uuid');
    expect(capture.sqls[0]).toContain('c.clinic_id = $2::uuid');
    expect(capture.sqls[0]).toContain('c.appointment_id IN ($3::uuid)');
    expect(capture.params[0]).toEqual(['clinic-1', 'clinic-1', 'appointment-1']);
  });

  it.each([
    ['confirmation_pending', 'manual_action_required', 'manual'],
    ['pending', 'provider_readback_unavailable', 'manual'],
    ['pending', null, 'waiting'],
    ['submitting', null, 'waiting'],
    ['confirmation_pending', null, 'waiting'],
    ['confirmed', null, 'confirmed'],
    ['failed', 'refund_cancelled', 'cancelled'],
    ['failed', 'provider_rejected', 'failed'],
  ] as const)('mapeia %s/%s para %s sem vazar ids do provider', async (status, code, state) => {
    stubRows([
      {
        appointment_id: 'appointment-1',
        amount: '10.00',
        status,
        failure_code: code,
        updated_at: new Date('2026-09-06T12:00:00.000Z'),
      },
    ]);

    await expect(listExcessRefundStatuses('clinic-1', ['appointment-1'])).resolves.toEqual([
      {
        appointmentId: 'appointment-1',
        amount: 10,
        state,
      },
    ]);
  });
});

describe('listManualRefundTasks', () => {
  it('inclui cobrança paga sem ID do Asaas como investigação, sem sugerir estorno', async () => {
    const capture = stubRows([
      {
        id: 'charge-1',
        appointment_id: 'appointment-1',
        patient_id: 'patient-1',
        provider_payment_id: null,
        amount: '50.00',
        purpose: 'deposit_closeout',
        status: 'pending',
        failure_code: 'refund_missing_provider_payment_id',
      },
    ]);

    await expect(listManualRefundTasks('clinic-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'charge-1',
        providerPaymentId: null,
        state: 'payment_id_missing',
      }),
    ]);
    expect(capture.sqls[0]).toContain("c.failure_code = 'refund_missing_provider_payment_id'");
    expect(capture.sqls[0]).toContain('c.provider_payment_id IS NULL');
    expect(capture.sqls[0]).toContain('ORDER BY sort_at ASC, id ASC');
    expect(capture.params[0]).toEqual(['clinic-1', 'clinic-1', 'clinic-1']);
  });

  it('lê pendências e falhas com escopo duplo de tenant, sem listar confirmados', async () => {
    const capture = stubRows([
      {
        id: 'intent-1',
        appointment_id: 'appointment-1',
        patient_id: 'patient-1',
        provider_payment_id: 'pay_1',
        amount: '150.00',
        purpose: 'deposit_closeout',
        status: 'confirmation_pending',
        failure_code: 'manual_action_required',
      },
    ]);
    await expect(listManualRefundTasks('clinic-1')).resolves.toEqual([
      {
        id: 'intent-1',
        appointmentId: 'appointment-1',
        patientId: 'patient-1',
        providerPaymentId: 'pay_1',
        amount: 150,
        purpose: 'deposit_closeout',
        state: 'action_required',
      },
    ]);
    expect(capture.sqls[0]).toContain('i.clinic_id = $1::uuid');
    expect(capture.sqls[0]).toContain('c.clinic_id = $2::uuid');
    expect(capture.sqls[0]).toContain("OR i.status = 'failed'");
  });

  it('mantém a falha de readback na fila sem sugerir que o estorno foi feito', async () => {
    stubRows([
      {
        id: 'intent-2',
        appointment_id: 'appointment-2',
        patient_id: 'patient-2',
        provider_payment_id: 'pay_2',
        amount: '30.00',
        purpose: 'excess',
        status: 'pending',
        failure_code: 'provider_readback_unavailable',
      },
    ]);

    await expect(listManualRefundTasks('clinic-1')).resolves.toEqual([
      expect.objectContaining({ id: 'intent-2', state: 'readback_unavailable' }),
    ]);
  });
});
