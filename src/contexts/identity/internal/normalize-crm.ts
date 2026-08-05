/**
 * Normalização de CRM/UF antes de persistir e da constraint UNIQUE(clinic_id, crm)
 * (ADR-032 §5). Sem isto o UNIQUE (texto) NÃO protege de fato: " 12345 ", "12345"
 * e "12 345" entrariam como três credenciais distintas (review #8 do founder).
 *
 * Regra: CRM é um identificador contíguo (dígitos, ocasionalmente letras) — remove
 * todos os espaços em branco + uppercase. UF é sigla de estado — trim + uppercase. Vazio → null.
 */
export function normalizeCrm(value: string | null | undefined): string | null {
  if (value == null) return null;
  const norm = value.replace(/\s+/g, '').toUpperCase();
  return norm === '' ? null : norm;
}

export function normalizeCrmUf(value: string | null | undefined): string | null {
  if (value == null) return null;
  const norm = value.trim().toUpperCase();
  return norm === '' ? null : norm;
}
