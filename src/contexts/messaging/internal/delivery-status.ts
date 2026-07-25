export type DeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown';

export type ProviderDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

const PROGRESS: Record<Exclude<DeliveryStatus, 'failed' | 'unknown'>, number> = {
  pending: 0,
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export function normalizeProviderDeliveryStatus(status: string): ProviderDeliveryStatus | null {
  const normalized = status.trim().toLowerCase();
  return normalized === 'sent' ||
    normalized === 'delivered' ||
    normalized === 'read' ||
    normalized === 'failed'
    ? normalized
    : null;
}

export function advanceDeliveryStatus(
  current: DeliveryStatus,
  incoming: ProviderDeliveryStatus,
): DeliveryStatus {
  if (current === 'read' || current === 'delivered') return current;
  if (incoming === 'failed') return 'failed';
  if (current === 'failed' || current === 'unknown') return incoming;
  return PROGRESS[incoming] > PROGRESS[current] ? incoming : current;
}
