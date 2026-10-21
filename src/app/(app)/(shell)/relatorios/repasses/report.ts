import type { MonthlyPayoutSnapshot } from '@/contexts/financial/payout-queries';

export type CompletedConsultation = {
  appointmentId: string;
  completedAt: string;
  professionalName: string;
};

export type PayoutReportLine = CompletedConsultation &
  MonthlyPayoutSnapshot & { effectivePayout: number | null };

const MONTH_PATTERN = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;

export function currentClinicMonth(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Não foi possível determinar o mês da clínica.');
  return `${year}-${month}`;
}

export function resolveReportMonth(value: string | undefined, timezone: string): string {
  return value && MONTH_PATTERN.test(value) ? value : currentClinicMonth(timezone);
}

export function adjacentMonth(month: string, offset: -1 | 1): string {
  const [year, numericMonth] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, numericMonth! - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** O valor anterior nunca reaparece após suspensão; revisão é decisão, não baixa paga. */
export function buildMonthlyPayoutReport(
  completed: readonly CompletedConsultation[],
  payouts: readonly MonthlyPayoutSnapshot[],
) {
  const completionByAppointment = new Map(completed.map((item) => [item.appointmentId, item]));
  const lines: PayoutReportLine[] = payouts.flatMap((payout) => {
    const consultation = completionByAppointment.get(payout.appointmentId);
    if (!consultation) return [];
    return [
      {
        ...consultation,
        ...payout,
        effectivePayout:
          payout.status === 'cancelled'
            ? 0
            : payout.status === 'pending_economics'
              ? null
              : payout.payoutAmount,
      },
    ];
  });
  const cents = (amount: number) => Math.round(amount * 100);
  const sum = (values: readonly number[]) =>
    values.reduce((total, value) => total + cents(value), 0) / 100;
  return {
    lines,
    grossTotal: sum(lines.map((line) => line.grossAmount)),
    effectiveTotal: sum(lines.map((line) => line.effectivePayout ?? 0)),
    suspendedCount: lines.filter((line) => line.status === 'cancelled').length,
    pendingCount: lines.filter((line) => line.status === 'pending_economics').length,
    reviewedCount: lines.filter((line) => line.status === 'reviewed').length,
  };
}
