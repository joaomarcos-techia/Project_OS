import 'server-only';

import { z } from 'zod';

import { GatewayReadError, gatewayHttpReadError, parseBillingValue } from '../saas/contracts';

const API_V2 = 'https://api.abacatepay.com/v2';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const envelopeSchema = z
  .object({ success: z.literal(true), data: z.unknown() })
  .refine((value) => value.data !== undefined);
const getPaths = new Set([
  '/stores/get',
  '/products/get',
  '/products/list',
  '/subscriptions/get',
  '/subscriptions/list',
  '/subscriptions/checkouts/get',
  '/subscriptions/checkouts/list',
]);
const postPaths = new Set([
  '/products/create',
  '/subscriptions/create',
  '/subscriptions/change-plan',
  '/subscriptions/cancel',
]);

/** A POST may have committed even if HTTP/parsing fails. No raw cause/body is retained. */
export class AbacatePayCommandError extends Error {
  constructor(readonly httpStatus: number | null = null) {
    super('AbacatePay command outcome unknown; reconcile before retry');
    this.name = 'AbacatePayCommandError';
  }
}

export function createAbacatePayTransport(
  config: { apiKey: string; timeoutMs?: number },
  fetcher: typeof fetch = fetch,
) {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !config.apiKey ||
    /\s/.test(config.apiKey) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000
  ) {
    throw new GatewayReadError('invalid_input');
  }
  const apiKey = config.apiKey;
  return async function request(
    input:
      | { method: 'GET'; path: string; params?: URLSearchParams }
      | { method: 'POST'; path: string; body: unknown },
  ): Promise<unknown> {
    if (!(input.method === 'GET' ? getPaths : postPaths).has(input.path)) {
      throw new GatewayReadError('invalid_input');
    }
    const params = input.method === 'GET' ? input.params : undefined;
    const url = `${API_V2}${input.path}${params ? `?${params.toString()}` : ''}`;
    let body: string | undefined;
    if (input.method === 'POST') {
      try {
        body = JSON.stringify(input.body);
      } catch {
        throw new GatewayReadError('invalid_input');
      }
      if (body === undefined) throw new GatewayReadError('invalid_input');
    }
    const failure = (status: number | null = null): Error =>
      input.method === 'POST'
        ? new AbacatePayCommandError(status)
        : status === null
          ? new GatewayReadError('unavailable')
          : gatewayHttpReadError(status);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: input.method,
        redirect: 'error',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(input.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw failure();
    }
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        throw failure(response.status);
      }
      throw failure(response.status);
    }
    const invalid = (): Error =>
      input.method === 'POST'
        ? new AbacatePayCommandError(response.status)
        : new GatewayReadError('invalid_response');
    if (!response.body) throw invalid();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw invalid();
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof GatewayReadError || error instanceof AbacatePayCommandError) throw error;
      throw failure();
    } finally {
      reader.releaseLock();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw invalid();
    }
    try {
      parseBillingValue(envelopeSchema, parsed);
    } catch {
      throw invalid();
    }
    return parsed;
  };
}
