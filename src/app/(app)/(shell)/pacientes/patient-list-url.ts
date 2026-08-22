export interface PatientListSearchParams {
  q?: string;
  novo?: string;
  removidos?: string;
  page?: string;
}

type PatientListSearchParamUpdates = {
  [Key in keyof PatientListSearchParams]?: string | undefined;
};

/** Monta URLs da lista sem perder filtros válidos entre paginação e drawer. */
export function patientListHref(
  current: PatientListSearchParams,
  extra: PatientListSearchParamUpdates = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...extra })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/pacientes?${query}` : '/pacientes';
}

/** Parâmetro externo inválido volta à primeira página, sem gerar OFFSET inválido. */
export function parsePatientListPage(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
