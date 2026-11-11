/**
 * Numeração TISS (P7.1): formato dos números alocados por `hi_next_counter`
 * (migration 0144). Puro: a alocação atômica é do banco; aqui só se decide o
 * texto e se respeitam os limites do Padrão TISS 4.03.00.
 *
 * Limites (XSD): `numeroGuiaPrestador` e o número do recurso são `st_texto20`;
 * `numeroLote` e `sequencialTransacao` são `st_texto12`. Número que não cabe é
 * ERRO, nunca truncado: truncar repetiria um número já emitido.
 */
export type CounterKind = 'guide' | 'batch' | 'transaction' | 'appeal';

export const TISS_NUMBER_MAX_LENGTH: Record<CounterKind, number> = {
  guide: 20,
  batch: 12,
  transaction: 12,
  appeal: 20,
};

/** Maior valor do contador (CHECK de `hi_counters.last_value`). */
export const COUNTER_MAX_VALUE = 999_999_999_999;

export class TissNumberingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TissNumberingError';
  }
}

export interface NumberFormat {
  /** Prefixo fixo da clínica (letras e dígitos), ex.: `G`. Opcional. */
  prefix?: string;
  /** Largura mínima com zeros à esquerda, ex.: 7 → `0000042`. */
  width?: number;
}

/**
 * Valor do contador → número TISS. `value` vem do banco como bigint (string no
 * driver); aceita string ou number inteiro positivo.
 */
export function formatTissNumber(
  kind: CounterKind,
  value: string | number,
  fmt: NumberFormat = {},
): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1 || n > COUNTER_MAX_VALUE) {
    throw new TissNumberingError(`valor de contador inválido: ${String(value)}`);
  }
  const prefix = fmt.prefix ?? '';
  if (!/^[0-9A-Z]*$/u.test(prefix)) {
    throw new TissNumberingError('o prefixo da numeração só pode ter letras maiúsculas e dígitos');
  }
  const body = String(n).padStart(fmt.width ?? 1, '0');
  const out = `${prefix}${body}`;
  if (out.length > TISS_NUMBER_MAX_LENGTH[kind]) {
    throw new TissNumberingError(
      `o número ${out} tem ${out.length} caracteres; o Padrão TISS aceita até ${TISS_NUMBER_MAX_LENGTH[kind]} para ${kind}`,
    );
  }
  return out;
}

/**
 * Ordem canônica de alocação quando uma transação precisa de mais de um
 * contador (ex.: lote + transação). Alocar sempre nesta ordem evita deadlock
 * entre transações concorrentes que pegam os mesmos contadores.
 */
export const COUNTER_ALLOCATION_ORDER: readonly CounterKind[] = [
  'transaction',
  'batch',
  'guide',
  'appeal',
];

export function sortForAllocation(kinds: readonly CounterKind[]): CounterKind[] {
  return [...new Set(kinds)].sort(
    (a, b) => COUNTER_ALLOCATION_ORDER.indexOf(a) - COUNTER_ALLOCATION_ORDER.indexOf(b),
  );
}
