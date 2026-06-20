/**
 * Helpers de formatação de tela do painel (C15). SEM regra de negócio/cor —
 * só conversão/apresentação (review #10: cor fica na UI).
 */

/** numeric(x,2) (string "149.50" | number) → centavos inteiros. */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatBRLCents(cents: number): string {
  return BRL.format(cents / 100);
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});
export function formatUSD(value: number): string {
  return USD.format(value);
}

const DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const DATETIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DATE.format(d);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : DATETIME.format(d);
}

export function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

const NUM = new Intl.NumberFormat('pt-BR');
export function formatNumber(n: number): string {
  return NUM.format(n);
}
