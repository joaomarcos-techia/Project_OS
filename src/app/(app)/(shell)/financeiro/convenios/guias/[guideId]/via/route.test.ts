import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

const mocks = vi.hoisted(() => ({
  resourceGate: vi.fn(),
  assertClinicalPdfDownloadAllowed: vi.fn(),
  render: vi.fn(),
  isGuideWithinScope: vi.fn(),
}));

vi.mock('@/lib/auth/page-guard', () => ({ resourceGate: mocks.resourceGate }));
vi.mock('@/lib/auth/rate-limit', () => ({ assertClinicalPdfDownloadAllowed: mocks.assertClinicalPdfDownloadAllowed }));
vi.mock('@/contexts/health-insurance/queries', () => ({ isGuideWithinScope: mocks.isGuideWithinScope }));
vi.mock('@/contexts/health-insurance/downloads', () => {
  class GuideAccessError extends Error {}
  class GuidePrintError extends Error {}
  return { renderIssuedGuideAttendanceCopyPdf: mocks.render, GuideAccessError, GuidePrintError };
});

import { GuideAccessError, GuidePrintError } from '@/contexts/health-insurance/downloads';

import { GET } from './route';

const GUIDE = '22222222-2222-4222-8222-222222222222';
const call = (id = GUIDE, query = '') =>
  GET(new Request(`https://app.qoro.dev/financeiro/convenios/guias/${id}/via${query}`), { params: Promise.resolve({ guideId: id }) });
const as = (permissions: string[]) => ({ clinicId: 'clinic-1', user: { userId: 'user-1', permissions } });

describe('GET /financeiro/convenios/guias/:guideId/via (D-5 fase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceGate.mockResolvedValue(as([PERMISSIONS.VIEW_CONVENIOS, PERMISSIONS.OPERATE_CONVENIOS]));
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValue({ ok: true });
    mocks.isGuideWithinScope.mockResolvedValue(true);
    mocks.render.mockResolvedValue({
      pdf: Buffer.from('%PDF-1.4'),
      fileName: 'via-atendimento-consulta-123-r1.pdf',
      guideNumber: '123',
      revision: 1,
      snapshotSha256: 'b'.repeat(64),
      pages: 1,
    });
  });

  it('recepção: portão da via, escopo da clínica, leitura auditada própria, entrega sem cache', async () => {
    const res = await call();
    expect(mocks.resourceGate).toHaveBeenCalledWith([
      PERMISSIONS.OPERATE_CONVENIOS,
      PERMISSIONS.VIEW_FATURAMENTO_CONVENIO,
      PERMISSIONS.VIEW_CONVENIOS,
    ]);
    expect(mocks.isGuideWithinScope).toHaveBeenCalledWith('clinic-1', GUIDE, { kind: 'clinic' });
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-1', guideId: GUIDE, surface: 'rota_via_atendimento' }));
    // A carteirinha completa nunca é pedida pela rota (mascarada por padrão no domínio).
    expect(mocks.render.mock.calls[0]![0]).not.toHaveProperty('card');
    expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control')]).toEqual([200, 'application/pdf', 'private, no-store, max-age=0']);
    expect(res.headers.get('content-disposition')).toBe('inline; filename="via-atendimento-consulta-123-r1.pdf"');
    expect((await call(GUIDE, '?download=1')).headers.get('content-disposition')).toBe('attachment; filename="via-atendimento-consulta-123-r1.pdf"');
  });

  it('médica (só view:convenios): a posse é conferida ANTES de ler; guia de outra profissional é o mesmo 404, sem leitura', async () => {
    mocks.resourceGate.mockResolvedValue(as([PERMISSIONS.VIEW_CONVENIOS]));
    expect((await call()).status).toBe(200);
    expect(mocks.isGuideWithinScope).toHaveBeenCalledWith('clinic-1', GUIDE, { kind: 'own', professionalId: 'user-1' });
    mocks.isGuideWithinScope.mockResolvedValueOnce(false);
    mocks.render.mockClear();
    const denied = await call();
    expect([denied.status, await denied.text()]).toEqual([404, '']);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.assertClinicalPdfDownloadAllowed).toHaveBeenCalledTimes(1);
  });

  it('sem permissão, ID inválido, outra clínica, não emitida: o mesmo 404', async () => {
    mocks.resourceGate.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect((await call('nao-e-uuid')).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
    mocks.render.mockRejectedValueOnce(new GuideAccessError('x', 'not_found'));
    const r = await call();
    expect([r.status, await r.text()]).toEqual([404, '']);
  });

  it('limite de taxa: 429 antes de ler; revisão sem bloco de impressão: 409 sem detalhe técnico', async () => {
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
    expect((await call()).status).toBe(429);
    expect(mocks.render).not.toHaveBeenCalled();
    mocks.render.mockRejectedValueOnce(new GuidePrintError('x'));
    const r = await call();
    expect(r.status).toBe(409);
    expect(await r.text()).not.toMatch(/sha|snapshot|stack/iu);
  });
});
