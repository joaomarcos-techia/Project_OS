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

/**
 * Código que a Meta põe no callback `failed` (`errors[0].code`, ex.: 131042),
 * como string de dígitos. Vira campo do evento e `failed_reason` do job C14, e é
 * lido dentro da TX do webhook: formato inesperado devolve null em vez de lançar
 * — um código estranho não pode virar 500 e reentrega infinita da Meta. Callback
 * sem `errors` (outros status, outros provedores) também devolve null.
 */
export function providerFailureCode(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const errors = (raw as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return null;
  const first: unknown = errors[0];
  if (typeof first !== 'object' || first === null) return null;
  const code = (first as { code?: unknown }).code;
  const text =
    typeof code === 'number' && Number.isSafeInteger(code)
      ? String(code)
      : typeof code === 'string'
        ? code.trim()
        : '';
  return /^\d{1,10}$/.test(text) ? text : null;
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
