import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

const mocks = vi.hoisted(() => ({
  resourceGate: vi.fn(),
  assertClinicalPdfDownloadAllowed: vi.fn(),
  findSadtRequestDocument: vi.fn(),
  readTissFile: vi.fn(),
  requestContext: vi.fn(),
  store: { put: vi.fn(), get: vi.fn(), remove: vi.fn() },
}));

vi.mock('@/lib/auth/page-guard', () => ({ resourceGate: mocks.resourceGate }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertClinicalPdfDownloadAllowed: mocks.assertClinicalPdfDownloadAllowed,
}));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: mocks.requestContext,
}));
vi.mock('@/lib/storage/tiss-files', () => ({ supabaseTissObjectStore: () => mocks.store }));
vi.mock('@/contexts/health-insurance/downloads', () => {
  class TissFileIntegrityError extends Error {}
  class TissFileMissingError extends Error {}
  return {
    findSadtRequestDocument: mocks.findSadtRequestDocument,
    readTissFile: mocks.readTissFile,
    TissFileIntegrityError,
    TissFileMissingError,
  };
});

import {
  TissFileIntegrityError,
  TissFileMissingError,
} from '@/contexts/health-insurance/downloads';

import { GET } from './route';

const REQUEST = '22222222-2222-4222-8222-222222222222';
const PDF = '33333333-3333-4333-8333-333333333333';
const call = (id = REQUEST, query = '') =>
  GET(new Request(`https://app.qoro.dev/financeiro/convenios/solicitacoes/${id}/pdf${query}`), {
    params: Promise.resolve({ requestId: id }),
  });

describe('GET /financeiro/convenios/solicitacoes/:requestId/pdf (P6.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceGate.mockResolvedValue({ clinicId: 'clinic-1', user: { userId: 'user-1' } });
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValue({ ok: true });
    mocks.requestContext.mockResolvedValue({ requestId: 'req-1', ip: null, userAgent: null });
    mocks.findSadtRequestDocument.mockResolvedValue({
      state: 'ready',
      pdfFileId: PDF,
      xmlFileId: 'x',
    });
    mocks.readTissFile.mockResolvedValue({
      outcome: 'granted',
      fileId: PDF,
      kind: 'authorization_request_pdf',
      bytes: Buffer.from('%PDF-1.3 sintético'),
      contentSha256: 'b'.repeat(64),
      mediaType: 'application/pdf',
      fileName: 'solicitacao-sp-sadt-42.pdf',
    });
  });

  it('exige ver o financeiro, lê o PDF GUARDADO da clínica da sessão com finalidade auditada, sem cache', async () => {
    const res = await call();
    expect(mocks.resourceGate).toHaveBeenCalledWith([PERMISSIONS.OPERATE_CONVENIOS, PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO]);
    expect(mocks.findSadtRequestDocument).toHaveBeenCalledWith('clinic-1', REQUEST, 'user-1');
    expect(mocks.readTissFile).toHaveBeenCalledWith(
      mocks.store,
      expect.objectContaining({
        clinicId: 'clinic-1',
        fileId: PDF,
        userId: 'user-1',
        purpose: 'download_arquivo',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      'inline; filename="solicitacao-sp-sadt-42.pdf"',
    );
    expect(res.headers.get('x-content-sha256')).toBe('b'.repeat(64));
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await call(REQUEST, '?download=1')).headers.get('content-disposition')).toBe(
      'attachment; filename="solicitacao-sp-sadt-42.pdf"',
    );
  });

  it('sem permissão, ID inválido e solicitação de outra clínica ou inexistente: o mesmo 404, sem ler arquivo', async () => {
    mocks.resourceGate.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect((await call('não-é-uuid')).status).toBe(404);
    mocks.findSadtRequestDocument.mockResolvedValueOnce(null);
    const notFound = await call();
    expect([notFound.status, await notFound.text()]).toEqual([404, '']);
    expect(mocks.readTissFile).not.toHaveBeenCalled();
  });

  it('estado: sem autorização exigida ou documento ainda não gerado = 409 com a orientação, nunca PDF remontado', async () => {
    mocks.findSadtRequestDocument.mockResolvedValueOnce({ state: 'no_authorization' });
    const none = await call();
    expect(none.status).toBe(409);
    expect(await none.text()).toMatch(/não exige autorização/u);
    mocks.findSadtRequestDocument.mockResolvedValueOnce({
      state: 'not_generated',
      status: 'awaiting_authorization',
    });
    const pending = await call();
    expect(pending.status).toBe(409);
    expect(await pending.text()).toMatch(/ainda não foi gerado/u);
    expect(mocks.readTissFile).not.toHaveBeenCalled();
  });

  it('limite de taxa: 429 antes de qualquer leitura', async () => {
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValueOnce({
      ok: false,
      reason: 'rate_limited',
    });
    const res = await call();
    expect(res.status).toBe(429);
    expect(mocks.findSadtRequestDocument).not.toHaveBeenCalled();
  });

  it('documento adulterado ou ausente: 409 sem detalhe técnico; falha de armazenamento: 503', async () => {
    mocks.readTissFile.mockRejectedValueOnce(new TissFileIntegrityError('x'));
    const tampered = await call();
    expect(tampered.status).toBe(409);
    expect(await tampered.text()).not.toMatch(/sha|storage|ref/iu);
    mocks.readTissFile.mockRejectedValueOnce(new TissFileMissingError('x'));
    expect((await call()).status).toBe(409);
    mocks.readTissFile.mockRejectedValueOnce(new Error('rede'));
    expect((await call()).status).toBe(503);
  });
});
