import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listClinicalDocumentFeedPage, pageGate, redirect } = vi.hoisted(() => ({
  listClinicalDocumentFeedPage: vi.fn(),
  pageGate: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/contexts/clinical/queries', () => ({ listClinicalDocumentFeedPage }));
vi.mock('@/lib/auth/page-guard', () => ({ pageGate }));
vi.mock('next/navigation', () => ({ redirect }));

import DocumentosPage from './page';

const emptyPage = { items: [], total: 0, page: 1, pageSize: 50 };

describe('/documentos pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageGate.mockResolvedValue({
      allowed: true,
      clinicId: 'clinic-a',
      user: { permissions: ['view:prescription'] },
    });
    listClinicalDocumentFeedPage.mockResolvedValue(emptyPage);
  });

  it('aplica RBAC antes de consultar o feed', async () => {
    pageGate.mockResolvedValue({ allowed: false });

    await DocumentosPage({ searchParams: Promise.resolve({}) });

    expect(listClinicalDocumentFeedPage).not.toHaveBeenCalled();
  });

  it('normaliza busca, tipo e página antes da consulta', async () => {
    listClinicalDocumentFeedPage.mockResolvedValue({ ...emptyPage, page: 3 });

    await DocumentosPage({
      searchParams: Promise.resolve({ q: '  Ana  ', tipo: 'document', page: '3' }),
    });

    expect(listClinicalDocumentFeedPage).toHaveBeenCalledWith('clinic-a', {
      search: 'Ana',
      kind: 'document',
      page: 3,
    });
  });

  it('descarta tipo e página externos inválidos', async () => {
    await DocumentosPage({
      searchParams: Promise.resolve({ tipo: 'outro', page: '-1' }),
    });

    expect(listClinicalDocumentFeedPage).toHaveBeenCalledWith('clinic-a', { page: 1 });
  });

  it('redireciona overflow preservando filtros válidos', async () => {
    listClinicalDocumentFeedPage.mockResolvedValue({ items: [], total: 51, page: 9, pageSize: 50 });

    await DocumentosPage({
      searchParams: Promise.resolve({ q: ' Ana ', tipo: 'document', page: '9' }),
    });

    expect(redirect).toHaveBeenCalledWith('/documentos?q=Ana&tipo=document&page=2');
  });

  it('normaliza overflow da lista vazia para a URL base', async () => {
    await DocumentosPage({ searchParams: Promise.resolve({ page: '2' }) });

    expect(redirect).toHaveBeenCalledWith('/documentos');
  });
});
