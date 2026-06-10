/** lib/messaging transport errors. `code` para o caller mapear. */

/** ZApi (esqueleto C10) — método não implementado. */
export class ProviderNotImplementedError extends Error {
  readonly code = 'provider_not_implemented';
  constructor(provider: string, method: string) {
    super(`[messaging] ${provider}.${method}() não implementado (C10 esqueleto).`);
    this.name = 'ProviderNotImplementedError';
  }
}

/**
 * Falha DEFINITIVA do provider — recebeu resposta HTTP de erro (4xx/5xx).
 * O sender mapeia para status `failed` (sabemos que NÃO foi aceito).
 */
export class ProviderSendError extends Error {
  readonly code = 'provider_send_error';
  readonly httpStatus: number | null;
  readonly raw: unknown;
  constructor(message: string, httpStatus: number | null, raw: unknown = null) {
    super(message);
    this.name = 'ProviderSendError';
    this.httpStatus = httpStatus;
    this.raw = raw;
  }
}

/**
 * Falha INDETERMINADA — timeout/abort/connection reset, sem resposta. Não
 * sabemos se a Meta recebeu. O sender mapeia para status `unknown` (NÃO
 * `failed`) — o callback de status assíncrono revela a verdade em C14.
 */
export class ProviderUnreachableError extends Error {
  readonly code = 'provider_unreachable';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderUnreachableError';
  }
}
