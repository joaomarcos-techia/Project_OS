/**
 * Annual prepay (C13). Refund pro-rata DETERMINÍSTICO em centavos (ADR-025 F5).
 * Cancelamento mid-cycle devolve a fração NÃO utilizada do período anual.
 */
import { type Cents, proRataCents } from './money';

const MS_PER_DAY = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * Refund = totalPago × (diasRestantes / diasTotais), round-half-up em centavos.
 * Determinístico, sem float. diasRestantes clampados a [0, diasTotais].
 */
export function annualRefundCents(
  totalPaidCents: Cents,
  periodStart: Date,
  periodEnd: Date,
  cancelDate: Date,
): Cents {
  const totalDays = daysBetween(periodStart, periodEnd);
  if (totalDays <= 0) return 0;
  const usedDays = Math.max(0, Math.min(daysBetween(periodStart, cancelDate), totalDays));
  const remainingDays = totalDays - usedDays;
  return proRataCents(totalPaidCents, remainingDays, totalDays);
}

/** Economia do plano anual vs 12× mensal (centavos). Nunca negativa. */
export function annualSavingsCents(monthlyCents: Cents, annualCents: Cents): Cents {
  return Math.max(0, monthlyCents * 12 - annualCents);
}
