export const LGPD_RESPONSE_SLA_DAYS = 15;

export type LgpdOperationalStatus = 'pending' | 'processing' | 'completed' | 'failed';

export function isLgpdRequestOverdue(input: {
  status: LgpdOperationalStatus;
  dueAt: Date;
  requesterNotifiedAt: Date | null;
  now?: Date;
}): boolean {
  if (input.requesterNotifiedAt || input.status === 'completed') return false;
  return input.dueAt.getTime() < (input.now ?? new Date()).getTime();
}

export function canProcessLgpdRequest(status: LgpdOperationalStatus): boolean {
  return status === 'pending' || status === 'failed';
}

export function canNotifyLgpdRequester(status: LgpdOperationalStatus): boolean {
  return status === 'processing' || status === 'completed' || status === 'failed';
}
