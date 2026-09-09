import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));

import { listAccountingMovements } from './queries';

describe('listAccountingMovements', () => {
  beforeEach(() => vi.clearAllMocks());

  it('projeta somente dados financeiros e deriva o sinal do ledger', async () => {
    const rows = [
      {
        transactionId: '10000000-0000-4000-8000-000000000001',
        lancamentoId: '20000000-0000-4000-8000-000000000001',
        occurredAt: new Date('2026-08-15T12:00:00.000Z'),
        transactionKind: 'refund' as const,
        lancamentoTipo: 'receber' as const,
        description: 'Ajuste financeiro',
        amount: '10.00',
        paymentMethod: 'pix',
        paymentMethodLabel: 'PIX',
        dueDate: '2026-08-10',
        lancamentoStatus: 'estornado' as const,
        createdVia: 'auto' as const,
        supplierName: null,
        supplierCnpj: null,
        originalPaymentId: '30000000-0000-4000-8000-000000000001',
        reason: 'Cobrança duplicada',
      },
    ];
    const chain = {
      innerJoin: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn().mockResolvedValue(rows),
    };
    chain.innerJoin.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    let projection: Record<string, unknown> = {};
    const tx = {
      select: vi.fn((fields: Record<string, unknown>) => {
        projection = fields;
        return { from: vi.fn(() => chain) };
      }),
    };
    mocks.withTenant.mockImplementation(async (_clinicId, callback) => callback(tx));

    const result = await listAccountingMovements(
      'clinic-1',
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
      101,
    );

    expect(mocks.withTenant).toHaveBeenCalledWith('clinic-1', expect.any(Function));
    expect(chain.innerJoin).toHaveBeenCalledTimes(1);
    expect(chain.leftJoin).toHaveBeenCalledTimes(2);
    expect(chain.limit).toHaveBeenCalledWith(101);
    expect(Object.keys(projection)).not.toEqual(
      expect.arrayContaining(['patientId', 'patientName', 'cpf', 'appointmentId']),
    );
    expect(result).toEqual([
      expect.objectContaining({
        amount: 10,
        cashEffect: -10,
        occurredAt: '2026-08-15T12:00:00.000Z',
        supplierName: null,
        supplierCnpj: null,
      }),
    ]);
  });

  it('mantém defesa tenant-scoped explícita nos dois lados do JOIN', () => {
    const source = readFileSync(new URL('./queries.ts', import.meta.url), 'utf8');
    const block = source.slice(
      source.indexOf('export async function listAccountingMovements'),
      source.indexOf('export interface AppointmentReceiptTotal'),
    );

    expect(block).toContain('withTenant(clinicId');
    expect(block).toContain('eq(paymentTransactions.clinicId, clinicId)');
    expect(block).toContain('eq(lancamentos.clinicId, clinicId)');
    expect(block).toContain('eq(suppliers.clinicId, clinicId)');
    expect(block).not.toMatch(/patientId|appointmentId|prontuario|diagnostico/i);
  });
});
