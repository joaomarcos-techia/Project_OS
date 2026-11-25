import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

const mocks = vi.hoisted(() => ({
  resourceGate: vi.fn(),
  assertClinicalPdfDownloadAllowed: vi.fn(),
  exportCsv: vi.fn(),
}));

vi.mock('@/lib/auth/page-guard', () => ({ resourceGate: mocks.resourceGate }));
vi.mock('@/lib/auth/rate-limit', () => ({ assertClinicalPdfDownloadAllowed: mocks.assertClinicalPdfDownloadAllowed }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({ requestContext: async () => ({ requestId: 'r1', ip: null, userAgent: null }) }));
vi.mock('@/contexts/health-insurance/reports', () => {
  class InsurerReportError extends Error {
    constructor(message: string, readonly code: 'invalid' | 'too_large') {
      super(message);
    }
  }
  return { exportInsurerReportCsv: mocks.exportCsv, InsurerReportError };
});

import { InsurerReportError } from '@/contexts/health-insurance/reports';

import { GET } from './route';

const INSURER = '33333333-3333-4333-8333-333333333333';
const call = (query: string) => GET(new Request(`https://app.qoro.dev/financeiro/convenios/relatorios/csv${query}`));

describe('GET /financeiro/convenios/relatorios/csv (P9.10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceGate.mockResolvedValue({ clinicId: 'clinic-1', user: { userId: 'user-1', permissions: [PERMISSIONS.VIEW_FATURAMENTO_CONVENIO] } });
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValue({ ok: true });
    mocks.exportCsv.mockResolvedValue({ csv: `${String.fromCharCode(0xfeff)}Operadora;Guia\r\n`, rows: 0, fileName: 'relatorio-convenios-2026-11-01-a-2026-11-18.csv' });
  });

  it('portão de ver valores do faturamento; CSV auditado pela clínica da sessão, sem cache', async () => {
    const res = await call(`?from=2026-11-01&to=2026-11-18&insurerId=${INSURER}`);
    expect(mocks.resourceGate).toHaveBeenCalledWith([PERMISSIONS.VIEW_FATURAMENTO_CONVENIO]);
    expect(mocks.exportCsv).toHaveBeenCalledWith('clinic-1', 'user-1', { from: '2026-11-01', to: '2026-11-18', insurerId: INSURER }, expect.objectContaining({ requestId: 'r1' }));
    expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control')]).toEqual([200, 'text/csv; charset=utf-8', 'private, no-store, max-age=0']);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="relatorio-convenios-2026-11-01-a-2026-11-18.csv"');
    // O BOM vai no corpo (o TextDecoder o esconde no text()): o Excel em português abre em UTF-8.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('sem a permissão (recepção, médica, sem sessão, desativado): 404 igual a inexistente, nada é lido', async () => {
    mocks.resourceGate.mockResolvedValueOnce(null);
    const res = await call('?from=2026-11-01&to=2026-11-18');
    expect(res.status).toBe(404);
    expect(mocks.exportCsv).not.toHaveBeenCalled();
  });

  it('período malformado e operadora inválida: 400 sem consultar; limite de downloads: 429', async () => {
    expect((await call('?from=01/11/2026&to=2026-11-18')).status).toBe(400);
    expect((await call('?from=2026-11-01&to=2026-11-18&insurerId=nao-uuid')).status).toBe(400);
    expect(mocks.exportCsv).not.toHaveBeenCalled();
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValueOnce({ ok: false });
    expect((await call('?from=2026-11-01&to=2026-11-18')).status).toBe(429);
  });

  it('período grande demais: 413 com a mensagem; outro erro: 503 sem detalhe interno', async () => {
    mocks.exportCsv.mockRejectedValueOnce(new InsurerReportError('O período tem mais de 10.000 guias.', 'too_large'));
    const big = await call('?from=2026-01-01&to=2026-11-18');
    expect([big.status, await big.text()]).toEqual([413, 'O período tem mais de 10.000 guias.']);
    mocks.exportCsv.mockRejectedValueOnce(new Error('connection terminated: postgres://x'));
    const down = await call('?from=2026-11-01&to=2026-11-18');
    expect(down.status).toBe(503);
    expect(await down.text()).not.toMatch(/postgres/u);
  });
});
