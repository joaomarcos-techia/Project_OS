export type DeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown';

export type ProviderDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Ordem total do status de um envio (ADR-064). O status gravado é sempre o MAIOR
 * já visto, então não depende da ordem em que os callbacks chegam — e a Meta não
 * garante ordem:
 *   - `unknown` (timeout, sem wamid) fica abaixo de tudo: qualquer callback o resolve;
 *   - `failed` vence `sent`: um `sent` atrasado não "revive" uma recusa. O painel do
 *     ADR-047 e o reenvio manual leem este status;
 *   - `delivered`/`read` vencem `failed`: entrega confirmada nunca é reescrita. A
 *     Meta não emite `failed` e `delivered` para o mesmo wamid; se emitisse, a
 *     entrega seria o fato mais forte, nas duas ordens.
 */
const RANK: Record<DeliveryStatus, number> = {
  unknown: -1,
  pending: 0,
  accepted: 1,
  sent: 2,
  failed: 3,
  delivered: 4,
  read: 5,
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

/** Código da Meta como string de dígitos (1 a 10); qualquer outra forma vira null. */
function digitsCode(code: unknown): string | null {
  const text =
    typeof code === 'number' && Number.isSafeInteger(code)
      ? String(code)
      : typeof code === 'string'
        ? code.trim()
        : '';
  return /^\d{1,10}$/.test(text) ? text : null;
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
  return digitsCode((first as { code?: unknown }).code);
}

/**
 * Código da recusa SÍNCRONA (ADR-064): o corpo de erro HTTP da Graph API
 * (`error.code`, ex.: 131026, 130429, 190), guardado em `provider_response`. É
 * ele que diz à C14 se a recusa merece reenvio. Corpo sem esse campo (HTML de um
 * proxy, 200 sem wamid) devolve null.
 */
export function providerSendErrorCode(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const error = (raw as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  return digitsCode((error as { code?: unknown }).code);
}

/**
 * O que o sender devolve como `errorCode` (ADR-064): o código só de um `failed`
 * SEM wamid, cujo `provider_response` é o corpo de erro HTTP. Um `failed` com
 * wamid foi aceito e recusado depois; o código dele está no callback.
 */
export function syncRefusalCode(
  status: DeliveryStatus,
  providerMessageId: string | null,
  providerResponse: unknown,
): string | null {
  return status === 'failed' && !providerMessageId ? providerSendErrorCode(providerResponse) : null;
}

export function advanceDeliveryStatus(
  current: DeliveryStatus,
  incoming: ProviderDeliveryStatus,
): DeliveryStatus {
  return RANK[incoming] > RANK[current] ? incoming : current;
}
