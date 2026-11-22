import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as TenantExport from '@/lib/audit/tenant-export';

const seams = vi.hoisted(() => ({
  exportTenantAudit: vi.fn(),
  getClinicTimezone: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: vi.fn(async () => ({ userId: 'user-1' })),
  requireFreshPermission: vi.fn(async () => undefined),
  requireClinicId: vi.fn(async () => 'clinic-a'),
}));
vi.mock('@/lib/audit/tenant-export', async (importOriginal) => ({
  ...(await importOriginal<typeof TenantExport>()),
  exportTenantAudit: seams.exportTenantAudit,
}));
vi.mock('@/lib/audit/log', () => ({ logAudit: seams.logAudit }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: vi.fn(async () => ({})),
}));
vi.mock('@/lib/db/tenant', () => ({
  withTenant: vi.fn(async (_clinicId: string, run: (tx: unknown) => unknown) => run({})),
}));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone: seams.getClinicTimezone }));

import { exportAuditAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  seams.exportTenantAudit.mockImplementation(
    async (_clinicId: string, range: { from: Date; to: Date }) => ({
      csv: 'data_hora',
      rowCount: 0,
      truncated: false,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    }),
  );
});

const rangeOf = () => seams.exportTenantAudit.mock.calls[0]?.[1] as { from: Date; to: Date };

describe('exportAuditAction: "De" e "Até" são dias da clínica', () => {
  it.each([
    ['America/Sao_Paulo', '2026-08-01T03:00:00.000Z', '2026-08-17T02:59:59.999Z'],
    ['America/Fortaleza', '2026-08-01T03:00:00.000Z', '2026-08-17T02:59:59.999Z'],
    ['UTC', '2026-08-01T00:00:00.000Z', '2026-08-16T23:59:59.999Z'],
  ])('%s', async (timeZone, from, to) => {
    seams.getClinicTimezone.mockResolvedValue(timeZone);
    const result = await exportAuditAction('2026-08-01', '2026-08-16');
    expect(result.ok).toBe(true);
    expect(rangeOf().from.toISOString()).toBe(from);
    expect(rangeOf().to.toISOString()).toBe(to);
  });

  it('virada de ano: o último dia vai até 23h59 de 31/12 em Brasília', async () => {
    seams.getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
    await exportAuditAction('2026-12-01', '2026-12-31');
    expect(rangeOf().to.toISOString()).toBe('2027-01-01T02:59:59.999Z');
  });

  it.each([
    ['vazio', '', '2026-08-16'],
    ['formato de tela', '01/08/2026', '2026-08-16'],
    ['dia inexistente', '2026-02-30', '2026-03-01'],
    ['instante', '2026-08-01T00:00:00Z', '2026-08-16'],
  ])('período inválido (%s) volta como erro de entrada, sem consultar', async (_c, from, to) => {
    seams.getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
    await expect(exportAuditAction(from, to)).resolves.toEqual({
      ok: false,
      message: 'Informe um período válido.',
    });
    expect(seams.exportTenantAudit).not.toHaveBeenCalled();
  });

  it('o nome do arquivo segue com as datas pedidas', async () => {
    seams.getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
    const result = await exportAuditAction('2026-08-01', '2026-08-16');
    expect(result.ok && result.filename).toBe('auditoria-2026-08-01-a-2026-08-16.csv');
  });
});
