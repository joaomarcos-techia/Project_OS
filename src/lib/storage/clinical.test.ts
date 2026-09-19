import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/supabase-admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { CLINICAL_PDF_BUCKET, downloadClinicalPdf } from './clinical';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ download: mocks.download });
  mocks.createAdminClient.mockReturnValue({ storage: { from: mocks.from } });
});

describe('clinical PDF storage', () => {
  it('baixa o path autorizado no bucket privado sem criar signed URL', async () => {
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    mocks.download.mockResolvedValue({ data: pdf, error: null });

    await expect(downloadClinicalPdf('clinic/prescriptions/id.pdf')).resolves.toBe(pdf);

    expect(mocks.from).toHaveBeenCalledWith(CLINICAL_PDF_BUCKET);
    expect(mocks.download).toHaveBeenCalledWith('clinic/prescriptions/id.pdf');
  });

  it.each([
    [{ data: null, error: { message: 'not found' } }, 'not found'],
    [{ data: null, error: null }, 'sem data'],
  ])('falha fechada quando o Storage não devolve o PDF', async (result, message) => {
    mocks.download.mockResolvedValue(result);

    const failure = downloadClinicalPdf('tenant-sensitive-path/missing.pdf');
    await expect(failure).rejects.toThrow(message);
    await expect(failure).rejects.not.toThrow('tenant-sensitive-path');
  });
});
