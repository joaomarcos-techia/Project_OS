import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertClinicalPdfDownloadAllowed: vi.fn(),
  downloadClinicalPdf: vi.fn(),
  getMedicalDocumentPdfRef: vi.fn(),
  getPrescriptionPdfRef: vi.fn(),
  logAudit: vi.fn(),
  requestContext: vi.fn(),
  resourceGate: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/contexts/clinical/queries', () => ({
  getMedicalDocumentPdfRef: mocks.getMedicalDocumentPdfRef,
  getPrescriptionPdfRef: mocks.getPrescriptionPdfRef,
}));
vi.mock('@/lib/auth/page-guard', () => ({ resourceGate: mocks.resourceGate }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertClinicalPdfDownloadAllowed: mocks.assertClinicalPdfDownloadAllowed,
}));
vi.mock('@/lib/audit/log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: mocks.requestContext,
}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));
vi.mock('@/lib/storage/clinical', () => ({ downloadClinicalPdf: mocks.downloadClinicalPdf }));

import { GET as getDocumentPdf } from './(app)/documentos/[id]/pdf/arquivo/route';
import { GET as getPrescriptionPdf } from './(app)/prescricoes/[id]/pdf/arquivo/route';

const ID = '11111111-1111-4111-8111-111111111111';
const CLINIC = '22222222-2222-4222-8222-222222222222';
const pdf = new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' });
const querySource = readFileSync(
  resolve(process.cwd(), 'src/contexts/clinical/queries.ts'),
  'utf8',
);

function queryBodyOf(functionName: string): string {
  const start = querySource.indexOf(`export async function ${functionName}`);
  const next = querySource.indexOf('\nexport async function ', start + 1);
  if (start < 0) throw new Error(`${functionName} ausente`);
  return querySource.slice(start, next < 0 ? querySource.length : next);
}

const routes = [
  {
    kind: 'documento',
    get: getDocumentPdf,
    lookup: mocks.getMedicalDocumentPdfRef,
    baseUrl: `https://app.qoro.dev/documentos/${ID}/pdf/arquivo`,
    path: `${CLINIC}/documents/${ID}.pdf`,
    filename: `documento-${ID}.pdf`,
  },
  {
    kind: 'prescrição',
    get: getPrescriptionPdf,
    lookup: mocks.getPrescriptionPdfRef,
    baseUrl: `https://app.qoro.dev/prescricoes/${ID}/pdf/arquivo`,
    path: `${CLINIC}/prescriptions/${ID}.pdf`,
    filename: `prescricao-${ID}.pdf`,
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resourceGate.mockResolvedValue({ clinicId: CLINIC, user: { userId: 'user-1' } });
  mocks.assertClinicalPdfDownloadAllowed.mockResolvedValue({ ok: true });
  mocks.downloadClinicalPdf.mockResolvedValue(pdf);
  mocks.requestContext.mockResolvedValue({ requestId: 'request-1' });
  mocks.withTenant.mockImplementation(async (_clinicId, callback) => callback({ tx: true }));
  mocks.logAudit.mockResolvedValue('audit-1');
});

describe('2.H — proxy autenticado de PDF clínico', () => {
  it.each([
    ['getPrescriptionPdfRef', 'prescriptions'],
    ['getMedicalDocumentPdfRef', 'medicalDocuments'],
  ])('%s filtra por id + clinicId e não seleciona conteúdo cifrado', (name, table) => {
    const body = queryBodyOf(name);

    expect(body).toContain(`eq(${table}.id, id)`);
    expect(body).toContain(`eq(${table}.clinicId, clinicId)`);
    expect(body).toContain('pdfStoragePath:');
    expect(body).not.toMatch(
      /decryptJson|contentEncrypted|medicamentosEncrypted|observacoesEncrypted/u,
    );
  });

  it.each(routes)('serve $kind inline sem token de Storage', async (route) => {
    route.lookup.mockResolvedValue({ pdfStoragePath: route.path });

    const response = await route.get(new Request(route.baseUrl), {
      params: Promise.resolve({ id: ID }),
    });

    expect(mocks.resourceGate).toHaveBeenCalledTimes(1);
    expect(mocks.assertClinicalPdfDownloadAllowed).toHaveBeenCalledWith(CLINIC, 'user-1');
    expect(route.lookup).toHaveBeenCalledWith(CLINIC, ID);
    expect(mocks.downloadClinicalPdf).toHaveBeenCalledWith(route.path);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(
      `inline; filename="${route.filename}"`,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(await response.text()).toBe('%PDF-1.7\nfixture');
    expect(mocks.logAudit).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({
        clinicId: CLINIC,
        userId: 'user-1',
        action: expect.stringMatching(/^clinical\.(?:document|prescription)\.pdf_accessed$/u),
        resourceId: ID,
        after: { disposition: 'inline' },
      }),
    );
    expect(JSON.stringify(mocks.logAudit.mock.calls)).not.toMatch(
      /patient|pdfStoragePath|medicamento|conteúdo/iu,
    );
  });

  it.each(routes)('força attachment somente com download=1 para $kind', async (route) => {
    route.lookup.mockResolvedValue({ pdfStoragePath: route.path });

    const response = await route.get(new Request(`${route.baseUrl}?download=1`), {
      params: Promise.resolve({ id: ID }),
    });

    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="${route.filename}"`,
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({ after: { disposition: 'attachment' } }),
    );
  });

  it.each(routes)('nega $kind antes da consulta e do Storage', async (route) => {
    mocks.resourceGate.mockResolvedValue(null);

    const response = await route.get(new Request(route.baseUrl), {
      params: Promise.resolve({ id: ID }),
    });

    expect(response.status).toBe(404);
    expect(mocks.assertClinicalPdfDownloadAllowed).not.toHaveBeenCalled();
    expect(route.lookup).not.toHaveBeenCalled();
    expect(mocks.downloadClinicalPdf).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it.each(routes)('não usa ID inválido para consultar $kind', async (route) => {
    const response = await route.get(new Request(route.baseUrl), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.assertClinicalPdfDownloadAllowed).not.toHaveBeenCalled();
    expect(route.lookup).not.toHaveBeenCalled();
    expect(mocks.downloadClinicalPdf).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it.each(routes)(
    'torna $kind inexistente, cross-tenant ou sem arquivo indistinguível em 404',
    async (route) => {
      route.lookup.mockResolvedValueOnce(null).mockResolvedValueOnce({ pdfStoragePath: null });

      const missing = await route.get(new Request(route.baseUrl), {
        params: Promise.resolve({ id: ID }),
      });
      const withoutFile = await route.get(new Request(route.baseUrl), {
        params: Promise.resolve({ id: ID }),
      });

      expect(missing.status).toBe(404);
      expect(withoutFile.status).toBe(404);
      expect(mocks.downloadClinicalPdf).not.toHaveBeenCalled();
      expect(mocks.logAudit).not.toHaveBeenCalled();
    },
  );

  it.each(routes)('limita $kind antes da consulta e do Storage', async (route) => {
    mocks.assertClinicalPdfDownloadAllowed.mockResolvedValue({
      ok: false,
      reason: 'rate_limited',
    });

    const response = await route.get(new Request(route.baseUrl), {
      params: Promise.resolve({ id: ID }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('900');
    expect(route.lookup).not.toHaveBeenCalled();
    expect(mocks.downloadClinicalPdf).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it('propaga falha do Storage sem devolver conteúdo parcial', async () => {
    mocks.getPrescriptionPdfRef.mockResolvedValue({ pdfStoragePath: routes[1].path });
    mocks.downloadClinicalPdf.mockRejectedValue(new Error('storage unavailable'));

    await expect(
      getPrescriptionPdf(new Request(routes[1].baseUrl), {
        params: Promise.resolve({ id: ID }),
      }),
    ).rejects.toThrow('storage unavailable');
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it('propaga falha da auditoria em vez de devolver PDF sem trilha', async () => {
    mocks.getPrescriptionPdfRef.mockResolvedValue({ pdfStoragePath: routes[1].path });
    mocks.logAudit.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      getPrescriptionPdf(new Request(routes[1].baseUrl), {
        params: Promise.resolve({ id: ID }),
      }),
    ).rejects.toThrow('audit unavailable');
  });
});
