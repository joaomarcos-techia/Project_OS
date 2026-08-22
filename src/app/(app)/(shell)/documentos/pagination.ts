import type { ClinicalDocumentKind } from '@/contexts/clinical/queries';

export interface DocumentosSearchParams {
  q?: string;
  tipo?: string;
  page?: string;
}

export interface DocumentosPaginationFilters {
  q?: string;
  kind?: ClinicalDocumentKind;
}

export function parseDocumentosPage(value: string | undefined): number {
  const page = Number(value ?? '1');
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/** Preserva busca e tipo entre páginas; a primeira página usa a URL canônica. */
export function documentosPageHref(filters: DocumentosPaginationFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.kind) params.set('tipo', filters.kind);
  if (page > 1) params.set('page', String(page));

  const query = params.toString();
  return query ? `/documentos?${query}` : '/documentos';
}
