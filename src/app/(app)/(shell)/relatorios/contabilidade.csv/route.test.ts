import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNTING_EXPORT_MAX_ROWS } from '@/contexts/financial/accounting-export';
import type { AccountingMovementDTO } from '@/contexts/financial/types';
import { PERMISSIONS } from '@/lib/auth/permissions';

const mocks = vi.hoisted(() => ({
  assertPdfExportAllowed: vi.fn(),
  getClinicTimezone: vi.fn(),
  listAccountingMovements: vi.fn(),
  logAudit: vi.fn(),
  requestContext: vi.fn(),
  requireClinicId: vi.fn(),
  requireFreshPermission: vi.fn(),
  requireUser: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('@/contexts/financial/queries', () => ({
  listAccountingMovements: mocks.listAccountingMovements,
}));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone: mocks.getClinicTimezone }));
vi.mock('@/lib/audit/log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: mocks.requestContext,
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertPdfExportAllowed: mocks.assertPdfExportAllowed,
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireClinicId: mocks.requireClinicId,
  requireFreshPermission: mocks.requireFreshPermission,
  requireUser: mocks.requireUser,
}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));

import { GET } from './route';

const movement: AccountingMovementDTO = {
  transactionId: '10000000-0000-4000-8000-000000000001',
  lancamentoId: '20000000-0000-4000-8000-000000000001',
  occurredAt: '2026-08-15T15:34:56.000Z',
  transactionKind: 'payment',
  lancamentoTipo: 'receber',
  description: 'Consulta',
  amount: 150,
  cashEffect: 150,
  paymentMethod: 'pix',
  paymentMethodLabel: 'PIX',
  dueDate: '2026-08-15',
  lancamentoStatus: 'pago',
  createdVia: 'auto',
  supplierName: null,
  supplierCnpj: null,
  originalPaymentId: null,
  reason: null,
};

describe('GET /relatorios/contabilidade.csv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ userId: 'user-1' });
    mocks.requireClinicId.mockResolvedValue('clinic-1');
    mocks.requireFreshPermission.mockResolvedValue(undefined);
    mocks.assertPdfExportAllowed.mockResolvedValue({ ok: true });
    mocks.getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
    mocks.listAccountingMovements.mockResolvedValue([movement]);
    mocks.requestContext.mockResolvedValue({ requestId: 'req-1' });
    mocks.logAudit.mockResolvedValue('audit-1');
    mocks.withTenant.mockImplementation(async (_clinicId, callback) => callback({ tx: true }));
  });

  it('revalida RBAC, limita por tenant e baixa CSV auditado', async () => {
    const response = await GET(
      new Request('https://app.qoro.dev/relatorios/contabilidade.csv?mes=2026-08'),
    );

    expect(mocks.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.VIEW_FINANCIAL);
    expect(mocks.assertPdfExportAllowed).toHaveBeenCalledWith('clinic-1', 'user-1');
    expect(mocks.listAccountingMovements).toHaveBeenCalledWith(
      'clinic-1',
      new Date('2026-08-01T03:00:00.000Z'),
      new Date('2026-09-01T03:00:00.000Z'),
      ACCOUNTING_EXPORT_MAX_ROWS + 1,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain(
      'movimentacao-financeira-2026-08.csv',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toMatch(/^data_movimento/);
    expect(mocks.logAudit).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({
        clinicId: 'clinic-1',
        userId: 'user-1',
        action: 'financial.accounting_export.generated',
        resourceType: 'payment_transactions',
        after: expect.objectContaining({ month: '2026-08', rowCount: 1 }),
      }),
    );
    expect(JSON.stringify(mocks.logAudit.mock.calls)).not.toContain('Consulta');
  });

  it('recusa mês inválido sem consultar o ledger nem auditar', async () => {
    const response = await GET(
      new Request('https://app.qoro.dev/relatorios/contabilidade.csv?mes=2026-13'),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain('mês');
    expect(mocks.listAccountingMovements).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it('recusa excesso em vez de entregar arquivo truncado', async () => {
    mocks.listAccountingMovements.mockResolvedValue(
      Array.from({ length: ACCOUNTING_EXPORT_MAX_ROWS + 1 }, () => movement),
    );

    const response = await GET(
      new Request('https://app.qoro.dev/relatorios/contabilidade.csv?mes=2026-08'),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain('mais de 10.000 movimentos');
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it('aplica rate limit antes de consultar o banco', async () => {
    mocks.assertPdfExportAllowed.mockResolvedValue({ ok: false, reason: 'rate_limited' });

    const response = await GET(
      new Request('https://app.qoro.dev/relatorios/contabilidade.csv?mes=2026-08'),
    );

    expect(response.status).toBe(429);
    expect(mocks.getClinicTimezone).not.toHaveBeenCalled();
    expect(mocks.listAccountingMovements).not.toHaveBeenCalled();
  });

  it('não consulta nem limita quando a permissão fresca é negada', async () => {
    mocks.requireFreshPermission.mockRejectedValue(new Error('PERMISSION_DENIED'));

    await expect(
      GET(new Request('https://app.qoro.dev/relatorios/contabilidade.csv?mes=2026-08')),
    ).rejects.toThrow('PERMISSION_DENIED');

    expect(mocks.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.VIEW_FINANCIAL);
    expect(mocks.requireClinicId).not.toHaveBeenCalled();
    expect(mocks.assertPdfExportAllowed).not.toHaveBeenCalled();
    expect(mocks.listAccountingMovements).not.toHaveBeenCalled();
  });
});
