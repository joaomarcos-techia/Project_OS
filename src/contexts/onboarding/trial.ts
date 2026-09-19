/** Período do trial público do Qoro, em dias. */
export const QORO_TRIAL_DAYS = 14;

/** Cadastro autônomo: inicia somente após a confirmação do checkout. */
export const QORO_SELF_SERVICE_TRIAL_DAYS = 7;

export function formatTrialDays(days: number = QORO_TRIAL_DAYS): string {
  return `${days} dias grátis`;
}
