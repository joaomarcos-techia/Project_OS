import type { DoctorAbsencePeriod } from '@/contexts/scheduling/queries';

export interface DoctorAbsenceFilters {
  doctorId?: string;
  period?: DoctorAbsencePeriod;
}

export function parseDoctorAbsencePage(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function parseDoctorAbsencePeriod(value: string | undefined): DoctorAbsencePeriod {
  if (value === 'past' || value === 'all') return value;
  return 'upcoming';
}

/** Preserva apenas filtros validados; a primeira página usa a URL canônica. */
export function doctorAbsencePageHref(filters: DoctorAbsenceFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.doctorId) params.set('profissional', filters.doctorId);
  if (filters.period && filters.period !== 'upcoming') params.set('periodo', filters.period);
  if (page > 1) params.set('page', String(page));

  const query = params.toString();
  return query ? `/agenda/ausencias?${query}` : '/agenda/ausencias';
}
