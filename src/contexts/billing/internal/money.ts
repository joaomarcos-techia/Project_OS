/**
 * Money policy (C13 — ADR-025 F5). DB = numeric(12,2); cálculo = inteiro de
 * CENTAVOS; nunca float em soma/rateio. Arredondamento round-half-up.
 *
 * `numeric` do Postgres chega como string no Drizzle ('149.00'); por isso o
 * parse trata string de forma exata (sem multiplicar float).
 */
export type Cents = number; // inteiro

/** Reais (string '149.00' / number 149) → centavos inteiros (round-half-up). */
export function toCents(value: string | number): Cents {
  if (typeof value === 'number') {
    return Math.round(value * 100);
  }
  const norm = value.trim().replace(',', '.');
  const neg = norm.startsWith('-');
  const [intPart = '0', fracRaw = ''] = norm.replace('-', '').split('.');
  const frac = (fracRaw + '00').slice(0, 2);
  const cents = Math.abs(parseInt(intPart, 10) || 0) * 100 + (parseInt(frac, 10) || 0);
  return neg ? -cents : cents;
}

/** Centavos → number reais (2 casas). Para eventos/JSON (`z.number()`). */
export function toReais(cents: Cents): number {
  return Math.round(cents) / 100;
}

/** Centavos → string '149.00' para coluna numeric. */
export function toReaisString(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Rateio determinístico: parte * num / den (round-half-up), em centavos. */
export function proRataCents(totalCents: Cents, numerator: number, denominator: number): Cents {
  if (denominator <= 0) return 0;
  const clampedNum = Math.max(0, Math.min(numerator, denominator));
  return Math.round((totalCents * clampedNum) / denominator);
}
