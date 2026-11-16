import 'server-only';

import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

import { GatewayReadError, gatewayHttpReadError, parseBillingValue } from '../saas/contracts';
import {
  AbacatePayCoordinationError,
  defaultAbacatePayRequestControl,
  type AbacatePayRequestControl,
} from './request-control';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

const API_V2 = 'https://api.abacatepay.com/v2';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const READ_RETRY_DELAY_MS = 100;
const MAX_ADMISSION_ATTEMPTS = 3;
const RETRYABLE_HTTP = new Set([502, 503, 504]);
function fetchFailureKind(error: unknown, timedOut: boolean) {
  if (timedOut) return 'timeout';
  const cause = error instanceof Error ? error.cause : null;
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return 'connect_timeout';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'connection_closed';
  if (typeof code === 'string' && code.startsWith('ERR_TLS_')) return 'tls';
  return 'network_unknown';
}
export interface AbacatePayTransportConfig {
  apiKey: string;
  timeoutMs?: number;
  /** Opt-in GET recovery only. A shared deadline bounds the entire readback. */
  readAttempts?: 1 | 2;
  deadlineMs?: number;
  storeId?: string;
  requestControl?: AbacatePayRequestControl;
}
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
  '/bank-statement/list',
]);
const postPaths = new Set([
  '/products/create',
  '/subscriptions/create',
  '/subscriptions/change-plan',
  '/subscriptions/cancel',
  '/subscriptions/checkouts/delete',
]);

/** A POST may have committed even if HTTP/parsing fails. No raw cause/body is retained. */
export class AbacatePayCommandError extends Error {
  constructor(readonly httpStatus: number | null = null) {
    super('AbacatePay command outcome unknown; reconcile before retry');
    this.name = 'AbacatePayCommandError';
  }
}

export function createAbacatePayTransport(
  config: AbacatePayTransportConfig,
  fetcher: typeof fetch = fetch,
) {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readAttempts = config.readAttempts ?? 1;
  const deadline = config.deadlineMs;
  if (
    !config.apiKey ||
    /\s/.test(config.apiKey) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    ![1, 2].includes(readAttempts) ||
    (deadline !== undefined && !Number.isSafeInteger(deadline))
  ) {
    throw new GatewayReadError('invalid_input');
  }
  const apiKey = config.apiKey;
  const control =
    config.requestControl ??
    defaultAbacatePayRequestControl(config.storeId ?? env.ABACATEPAY_STORE_ID);
  async function requestOnce(
    input:
      | { method: 'GET'; path: string; params?: URLSearchParams }
      | { method: 'POST'; path: string; body: unknown; params?: URLSearchParams },
  ): Promise<unknown> {
    if (!(input.method === 'GET' ? getPaths : postPaths).has(input.path)) {
      throw new GatewayReadError('invalid_input');
    }
    if (
      input.method === 'POST' &&
      (input.path === '/subscriptions/checkouts/delete'
        ? !input.params ||
          [...input.params.keys()].join(',') !== 'id' ||
          !/^bill_[A-Za-z0-9_-]+$/.test(input.params.get('id') ?? '')
        : input.params !== undefined)
    )
      throw new GatewayReadError('invalid_input');
    const params = input.params;
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
    const admissionDeadline = Math.min(deadline ?? Infinity, Date.now() + timeoutMs);
    if (control) {
      for (let attempt = 1; ; attempt++) {
        const admission = await control.admit();
        if (admission.allowed) break;
        if (
          attempt >= MAX_ADMISSION_ATTEMPTS ||
          Date.now() + admission.retryAfterMs >= admissionDeadline
        )
          throw new GatewayReadError('rate_limited', 429);
        await delay(Math.max(1, admission.retryAfterMs));
      }
    }
    const remaining = Math.min(timeoutMs, admissionDeadline - Date.now());
    if (remaining <= 0) throw failure();
    const signal = AbortSignal.timeout(remaining);
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
        signal,
      });
    } catch (error) {
      if (input.method === 'GET')
        metrics.emit('billing.abacatepay.read_transport_failed', {
          operation: input.path,
          phase: 'fetch',
          failureKind: fetchFailureKind(error, signal.aborted),
        });
      try {
        await control?.observe(null);
      } catch (coordinationError) {
        if (input.method === 'GET' && coordinationError instanceof AbacatePayCoordinationError)
          throw coordinationError;
        throw failure();
      }
      throw failure();
    }
    if (!response.ok) {
      try {
        if (response.status === 429) await control?.throttle(response.headers);
        else await control?.observe(response.status);
      } catch (coordinationError) {
        try {
          await response.body?.cancel();
        } catch {
          throw failure(response.status);
        }
        if (input.method === 'GET' && coordinationError instanceof AbacatePayCoordinationError)
          throw coordinationError;
        throw failure(response.status);
      }
      try {
        await response.body?.cancel();
      } catch {
        throw failure(response.status);
      }
      throw failure(response.status);
    }
    try {
      await control?.observe(response.status);
    } catch (coordinationError) {
      try {
        await response.body?.cancel();
      } catch {
        throw failure(response.status);
      }
      if (input.method === 'GET' && coordinationError instanceof AbacatePayCoordinationError)
        throw coordinationError;
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
      if (input.method === 'GET')
        metrics.emit('billing.abacatepay.read_transport_failed', {
          operation: input.path,
          phase: 'response_stream',
          failureKind: 'stream_interrupted',
        });
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
  }
  return async function request(input: Parameters<typeof requestOnce>[0]): Promise<unknown> {
    const attempts = input.method === 'GET' ? readAttempts : 1;
    for (let attempt = 1; ; attempt++) {
      const startedAt = Date.now();
      try {
        return await requestOnce(input);
      } catch (error) {
        const transient =
          error instanceof GatewayReadError &&
          !(error instanceof AbacatePayCoordinationError) &&
          error.code === 'unavailable' &&
          (error.httpStatus === null || RETRYABLE_HTTP.has(error.httpStatus));
        const willRetry =
          transient &&
          attempt < attempts &&
          (deadline === undefined || Date.now() + READ_RETRY_DELAY_MS < deadline);
        if (input.method === 'GET')
          metrics.emit('billing.abacatepay.read_attempt_failed', {
            operation: input.path,
            attempt,
            durationMs: Date.now() - startedAt,
            code: error instanceof GatewayReadError ? error.code : 'unexpected',
            httpStatus: error instanceof GatewayReadError ? error.httpStatus : null,
            willRetry,
          });
        if (!willRetry) throw error;
        await delay(READ_RETRY_DELAY_MS);
      }
    }
  };
}
