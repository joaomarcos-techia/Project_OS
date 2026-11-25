import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

const mocks = vi.hoisted(() => ({
  resourceGate: vi.fn(),
  assertClinicalPdfDownloadAllowed: vi.fn(),
  readTissFile: vi.fn(),
  requestContext: vi.fn(),
  store: { put: vi.fn(), get: vi.fn(), remove: vi.fn() },
}));

vi.mock('@/lib/auth/page-guard', () => ({ resourceGate: mocks.resourceGate }));
vi.mock('@/lib/auth/rate-limit', () => ({ assertClinicalPdfDownloadAllowed: mocks.assertClinicalPdfDownloadAllowed }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({ requestContext: mocks.requestContext }));
vi.mock('@/lib/storage/tiss-files', () => ({ supabaseTissObjectStore: () => mocks.store }));
vi.mock('@/contexts/health-insurance/downloads', () => {
  class TissFileIntegrityError extends Error {}
  class TissFileMissingError extends Error {}
  return { readTissFile: mocks.readTissFile, TissFileIntegrityError, TissFileMissingError };
});

import { TissFileIntegrityError, TissFileMissingError } from '@/contexts/health-insurance/downloads';

import { GET } from './route';

const FILE = '11111111-1111-4111-8111-111111111111';
const call = (id = FILE) =>
  GET(new Request(`https://app.qoro.dev/financeiro/convenios/arquivos/${id}`), { params: Promise.resolve({ fileId: id }) });

describe('GET /financeiro/convenios/arquivos/:fileId (P12.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceGate.mockResolvedValue({ clinicId: 'clinic-1', user: { userId: 'user-1' } });
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValue({ ok: true });
    mocks.requestContext.mockResolvedValue({ requestId: 'req-1', ip: null, userAgent: null });
    mocks.readTissFile.mockResolvedValue({
      outcome: 'granted',
      fileId: FILE,
      kind: 'batch_xml',
      bytes: Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><x/>', 'latin1'),
      contentSha256: 'a'.repeat(64),
      mediaType: 'application/xml',
      fileName: 'lote-12.xml',
    });
  });

  it('exige gerenciar financeiro, lê pela clínica da sessão com finalidade e entrega sem cache', async () => {
    const res = await call();
    expect(mocks.resourceGate).toHaveBeenCalledWith([PERMISSIONS.VIEW_FATURAMENTO_CONVENIO]);
    expect(mocks.readTissFile).toHaveBeenCalledWith(mocks.store, expect.objectContaining({
      clinicId: 'clinic-1',
      fileId: FILE,
      userId: 'user-1',
      purpose: 'download_arquivo',
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=ISO-8859-1');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="lote-12.xml"');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sem permissão, ID inválido e arquivo de outra clínica/inexistente: o mesmo 404, sem tocar o armazenamento', async () => {
    mocks.resourceGate.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect((await call('não-é-uuid')).status).toBe(404);
    expect(mocks.readTissFile).not.toHaveBeenCalled();
    mocks.readTissFile.mockResolvedValueOnce(null);
    const notFound = await call();
    expect([notFound.status, await notFound.text()]).toEqual([404, '']);
  });

  it('limite de taxa: 429 antes de ler', async () => {
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
    const res = await call();
    expect(res.status).toBe(429);
    expect(mocks.readTissFile).not.toHaveBeenCalled();
  });

  it('arquivo adulterado ou ausente: 409 sem detalhe técnico; armazenamento fora: 503', async () => {
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
