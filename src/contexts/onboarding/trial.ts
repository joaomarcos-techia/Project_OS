/** Período do trial público do Qoro, em dias. */
export const QORO_TRIAL_DAYS = 14;

export function formatTrialDays(days: number = QORO_TRIAL_DAYS): string {
  return `${days} dias grátis`;
}
