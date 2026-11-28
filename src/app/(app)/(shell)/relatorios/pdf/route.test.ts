import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { assertPdfExportAllowed, getClinicTimezone, renderRelatorioPDF } = vi.hoisted(() => ({
  assertPdfExportAllowed: vi.fn(),
  getClinicTimezone: vi.fn(),
  renderRelatorioPDF: vi.fn(),
}));

vi.mock('@/components/painel/shell-identity', () => ({
  getShellIdentity: vi.fn(async () => ({ clinicName: 'Clínica Teste' })),
}));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone }));
vi.mock('@/lib/auth/rate-limit', () => ({ assertPdfExportAllowed }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireClinicId: vi.fn(async () => 'clinic-a'),
  requireUser: vi.fn(async () => ({ userId: 'user-1', permissions: [] })),
}));
vi.mock('@/lib/pdf/relatorio', () => ({ renderRelatorioPDF }));
vi.mock('../data', () => ({
  PERIODS: [{ key: '30d', label: '30 dias' }],
  resolvePeriod: () => ({ key: '30d', days: 30 }),
  getRelatorios: vi.fn(async () => ({
    fromLabel: '01/09',
    toLabel: '30/09',
    faturamento: 0,
    noShow: 0,
    ocupacao: 0,
  })),
  getConsolidadoPorProfissional: vi.fn(async () => []),
}));

import { GET } from './route';

const request = new Request('https://app.example.test/relatorios/pdf?periodo=30d');

describe('GET /relatorios/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: new Date('2026-09-14T12:15:00.000Z') });
    getClinicTimezone.mockResolvedValue('Asia/Tokyo');
    assertPdfExportAllowed.mockResolvedValue({ ok: true });
    renderRelatorioPDF.mockResolvedValue(Buffer.from('pdf'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('carimba a geração no fuso da clínica', async () => {
    await GET(request);

    // 12:15Z é 21:15 em Tóquio e 09:15 em São Paulo.
    expect(renderRelatorioPDF).toHaveBeenCalledWith(
      expect.objectContaining({ generatedAt: '14/09/2026, 21:15:00' }),
    );
  });

  it('não consulta a clínica quando o limite de exportações bloqueia', async () => {
    assertPdfExportAllowed.mockResolvedValue({ ok: false });

    const response = await GET(request);

    expect(response.status).toBe(429);
    expect(getClinicTimezone).not.toHaveBeenCalled();
  });
});
