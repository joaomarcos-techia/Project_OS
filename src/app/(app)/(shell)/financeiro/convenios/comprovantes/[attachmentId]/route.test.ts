import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

const mocks = vi.hoisted(() => ({
  resourceGate: vi.fn(),
  assertClinicalPdfDownloadAllowed: vi.fn(),
  readAuthorizationReceipt: vi.fn(),
  requestContext: vi.fn(),
  store: { put: vi.fn(), get: vi.fn(), remove: vi.fn() },
}));

vi.mock('@/lib/auth/page-guard', () => ({ resourceGate: mocks.resourceGate }));
vi.mock('@/lib/auth/rate-limit', () => ({ assertClinicalPdfDownloadAllowed: mocks.assertClinicalPdfDownloadAllowed }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({ requestContext: mocks.requestContext }));
vi.mock('@/lib/storage/tiss-files', () => ({ supabaseTissObjectStore: () => mocks.store }));
vi.mock('@/contexts/health-insurance/downloads', () => {
  class AuthorizationReceiptUnavailableError extends Error {
    constructor(readonly outcome: string) {
      super(outcome);
    }
  }
  return { readAuthorizationReceipt: mocks.readAuthorizationReceipt, AuthorizationReceiptUnavailableError };
});

import { AuthorizationReceiptUnavailableError } from '@/contexts/health-insurance/downloads';

import { GET } from './route';

const ID = '99999999-9999-4999-8999-999999999999';
const call = (id = ID) =>
  GET(new Request(`https://app.qoro.dev/financeiro/convenios/comprovantes/${id}`), { params: Promise.resolve({ attachmentId: id }) });
const unavailable = (outcome: string) =>
  new (AuthorizationReceiptUnavailableError as unknown as new (o: string) => Error)(outcome);

describe('GET /financeiro/convenios/comprovantes/:attachmentId (P6.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceGate.mockResolvedValue({ clinicId: 'clinic-1', user: { userId: 'user-1' } });
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValue({ ok: true });
    mocks.requestContext.mockResolvedValue({ requestId: 'req-1', ip: null, userAgent: null });
    mocks.readAuthorizationReceipt.mockResolvedValue({
      bytes: Buffer.from('%PDF-1.7 comprovante'),
      contentSha256: 'b'.repeat(64),
      mediaType: 'application/pdf',
      fileName: 'comprovante-autorizacao.pdf',
    });
  });

  it('portão da matriz (recepção OU faturamento), leitura auditada pela clínica e pessoa da sessão, entrega sem cache', async () => {
    const res = await call();
    expect(mocks.resourceGate).toHaveBeenCalledWith([PERMISSIONS.OPERATE_CONVENIOS, PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO]);
    expect(mocks.readAuthorizationReceipt).toHaveBeenCalledWith(mocks.store, {
      clinicId: 'clinic-1',
      attachmentId: ID,
      userId: 'user-1',
      requestContext: { requestId: 'req-1', ip: null, userAgent: null },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('comprovante-autorizacao.pdf');
    expect(res.headers.get('x-content-sha256')).toBe('b'.repeat(64));
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sem permissão, ID inválido e comprovante de outra clínica/inexistente: o mesmo 404, sem ler', async () => {
    mocks.resourceGate.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect((await call('não-é-uuid')).status).toBe(404);
    expect(mocks.readAuthorizationReceipt).not.toHaveBeenCalled();
    mocks.readAuthorizationReceipt.mockResolvedValueOnce(null);
    const notFound = await call();
    expect([notFound.status, await notFound.text()]).toEqual([404, '']);
  });

  it('limite de taxa: 429 antes de ler', async () => {
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
    const res = await call();
    expect(res.status).toBe(429);
    expect(mocks.readAuthorizationReceipt).not.toHaveBeenCalled();
  });

  it('adulterado ou ausente: 409 sem detalhe técnico, nada entregue; armazenamento fora ou erro qualquer: 503', async () => {
    mocks.readAuthorizationReceipt.mockRejectedValueOnce(unavailable('integrity_failed'));
    const tampered = await call();
    expect(tampered.status).toBe(409);
    expect(await tampered.text()).not.toMatch(/sha|storage|ref|PDF/iu);
    mocks.readAuthorizationReceipt.mockRejectedValueOnce(unavailable('missing'));
    expect((await call()).status).toBe(409);
    mocks.readAuthorizationReceipt.mockRejectedValueOnce(unavailable('storage_unavailable'));
    expect((await call()).status).toBe(503);
    mocks.readAuthorizationReceipt.mockRejectedValueOnce(new Error('rede'));
    expect((await call()).status).toBe(503);
  });
});
