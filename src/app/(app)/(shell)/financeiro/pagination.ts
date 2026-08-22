export interface FinanceiroPaginationFilters {
  tipo?: string;
  status?: string;
}

export function parseFinanceiroPage(value: string | undefined): number {
  const page = Number(value ?? '1');
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function financeiroPageHref(filters: FinanceiroPaginationFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.tipo) params.set('tipo', filters.tipo);
  if (filters.status) params.set('status', filters.status);
  if (page > 1) params.set('page', String(page));

  const query = params.toString();
  return query ? `/financeiro?${query}` : '/financeiro';
}
