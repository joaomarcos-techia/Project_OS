import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

const mocks = vi.hoisted(() => ({
  resourceGate: vi.fn(),
  assertClinicalPdfDownloadAllowed: vi.fn(),
  renderIssuedGuidePdf: vi.fn(),
}));

vi.mock('@/lib/auth/page-guard', () => ({ resourceGate: mocks.resourceGate }));
vi.mock('@/lib/auth/rate-limit', () => ({ assertClinicalPdfDownloadAllowed: mocks.assertClinicalPdfDownloadAllowed }));
vi.mock('@/contexts/health-insurance/downloads', () => {
  class GuideAccessError extends Error {}
  class GuidePrintError extends Error {}
  return { renderIssuedGuidePdf: mocks.renderIssuedGuidePdf, GuideAccessError, GuidePrintError };
});

import { GuideAccessError, GuidePrintError } from '@/contexts/health-insurance/downloads';

import { GET } from './route';

const GUIDE = '22222222-2222-4222-8222-222222222222';
const call = (id = GUIDE, query = '') =>
  GET(new Request(`https://app.qoro.dev/financeiro/convenios/guias/${id}/pdf${query}`), {
    params: Promise.resolve({ guideId: id }),
  });

describe('GET /financeiro/convenios/guias/:guideId/pdf (P7.6/P12.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceGate.mockResolvedValue({ clinicId: 'clinic-1', user: { userId: 'user-1' } });
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValue({ ok: true });
    mocks.renderIssuedGuidePdf.mockResolvedValue({
      pdf: Buffer.from('%PDF-1.4'),
      fileName: 'guia-consulta-123-r1.pdf',
      guideNumber: '123',
      revision: 1,
      snapshotSha256: 'b'.repeat(64),
      pages: 1,
    });
  });

  it('exige ver financeiro e gera do snapshot pela leitura auditada da clínica da sessão', async () => {
    const res = await call();
    expect(mocks.resourceGate).toHaveBeenCalledWith([PERMISSIONS.VIEW_FATURAMENTO_CONVENIO, PERMISSIONS.OPERATE_CONVENIOS]);
    expect(mocks.renderIssuedGuidePdf).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-1', guideId: GUIDE, surface: 'rota_pdf_guia' }),
    );
    expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control')]).toEqual([
      200,
      'application/pdf',
      'private, no-store, max-age=0',
    ]);
    expect(res.headers.get('content-disposition')).toBe('inline; filename="guia-consulta-123-r1.pdf"');
    expect((await call(GUIDE, '?download=1')).headers.get('content-disposition')).toBe(
      'attachment; filename="guia-consulta-123-r1.pdf"',
    );
  });

  it('sem permissão, ID inválido, guia de outra clínica, não emitida ou inexistente: o mesmo 404', async () => {
    mocks.resourceGate.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect((await call('x')).status).toBe(404);
    mocks.renderIssuedGuidePdf.mockRejectedValueOnce(new GuideAccessError('guia inexistente', 'not_found'));
    expect((await call()).status).toBe(404);
  });

  it('revisão emitida sem os dados do impresso: 409 com orientação; limite de taxa: 429', async () => {
    mocks.renderIssuedGuidePdf.mockRejectedValueOnce(new GuidePrintError('sem print'));
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/Reemita a guia/u);
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
    expect((await call()).status).toBe(429);
  });
});
