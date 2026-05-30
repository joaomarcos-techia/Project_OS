import { createHash } from 'node:crypto';

import { PoisonPillError, SideEffectInFlightError } from './errors';
import type { HandlerCtx } from './types';

/**
 * Framework para chamadas a APIs externas a partir de handlers do outbox
 * (CRITICAL-04). Resolve: at-least-once delivery do worker + side-effects
 * externos = duplicate side-effects.
 *
 * Princípio: **dedup at destination**. O provider externo (Meta Cloud API,
 * Stripe, etc.) é responsável por dedup baseado num idempotency-key que NÓS
 * geramos deterministicamente a partir do `eventId` (= outbox row UUID).
 *
 * Garantias:
 *   - Mesmo eventId → mesma providerIdempotencyKey → mesmo side-effect no
 *     destino (provider dedups).
 *   - Múltiplas chamadas com mesma key → provider trata como uma só
 *     (assumindo que o provider suporta idempotency-key; QUASE TODOS suportam).
 *
 * Se o provider NÃO suporta idempotency-key, é PROIBIDO usar este helper
 * naively — o handler precisa de logic separada (consulta status antes de
 * chamar). Esse caso é raro em providers modernos.
 *
 * Pattern de uso:
 *   registerHandler('scheduling.appointment.scheduled', async (ctx) => {
 *     const key = makeProviderIdempotencyKey(ctx, 'whatsapp.send');
 *     await sendWhatsAppMessage({
 *       to: ctx.payload.phone,
 *       template: ctx.payload.template,
 *       idempotencyKey: key,  // Meta Cloud API aceita
 *     });
 *     await ctx.tx.insert(messageLog).values({
 *       eventId: ctx.eventId, externalProviderKey: key, sentAt: sql`now()`,
 *     }).onConflictDoNothing({ target: messageLog.eventId });
 *   });
 *
 * Análises por provider (a manter sincronizada):
 *   - Meta WhatsApp Cloud API: header `idempotency-key` (UUID); dedup window
 *     pelo provider — confirme limites.
 *   - Stripe: header `Idempotency-Key`; dedup window 24h.
 *   - SendGrid: query param `unique_arg`.
 *   - Twilio: header `X-Idempotency-Key`.
 *
 * Provider sem suporte? NÃO USAR este helper diretamente. Documente em
 * runbook + escreva handler com query-status-then-call.
 */
export function makeProviderIdempotencyKey<TPayload>(
  ctx: Pick<HandlerCtx<TPayload>, 'eventId'>,
  sideEffectKey: string,
): string {
  if (!ctx.eventId) {
    throw new Error('makeProviderIdempotencyKey: ctx.eventId is required');
  }
  if (!/^[a-z_][a-z0-9_\.]{0,63}$/.test(sideEffectKey)) {
    throw new Error(
      `makeProviderIdempotencyKey: sideEffectKey "${sideEffectKey}" inválido. ` +
        `Use snake_case + dots, ≤64 chars (e.g. 'whatsapp.send').`,
    );
  }
  // Hash determinístico para limitar tamanho e formato — vários providers
  // querem ≤255 chars, alguns só hex/alphanum. SHA-256 hex = 64 chars,
  // universalmente aceito.
  return createHash('sha256').update(`${ctx.eventId}:${sideEffectKey}`).digest('hex');
}

/**
 * Helper para fetch() com idempotency-key. Provider-agnostic: usa header
 * `Idempotency-Key` (Stripe/Twilio style — Meta usa `idempotency-key` lowercase
 * mas aceita case-insensitive).
 *
 * Não esconde o fetch; o handler vê resposta e decide. Apenas garante que o
 * header certo é setado a partir do eventId.
 */
export async function fetchWithIdempotency<TPayload>(
  ctx: Pick<HandlerCtx<TPayload>, 'eventId'>,
  sideEffectKey: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const key = makeProviderIdempotencyKey(ctx, sideEffectKey);
  const headers = new Headers(init.headers);
  headers.set('Idempotency-Key', key);
  return fetch(url, { ...init, headers });
}

/**
 * Estados possíveis que um provider pode reportar para uma operação
 * identificada por idempotency-key.
 */
export type ProviderSideEffectStatus =
  | 'completed' // operação concluída com sucesso pelo provider
  | 'not_found' // provider não tem registro desta key
  | 'failed'    // provider tem a operação mas marcou como permanente-failed
  | 'pending';  // provider está processando ainda

export interface ProviderStatusCheckOpts<T> {
  /**
   * Consulta o provider: "você já tem esta operação?" Use a idempotency-key
   * que passamos via `makeProviderIdempotencyKey(ctx, sideEffectKey)`.
   * Retorne um dos 4 estados (ver ProviderSideEffectStatus).
   */
  statusCheck: (providerIdempotencyKey: string) => Promise<ProviderSideEffectStatus>;
  /**
   * Chama o provider quando status='not_found'. A idempotency-key é a mesma
   * usada em statusCheck — provider deve dedupar lado-dele se houver.
   */
  call: (providerIdempotencyKey: string) => Promise<T>;
  /**
   * Como retornar quando provider já marcou como 'completed'. Caller decide:
   *   - Re-fetch detalhes do provider (round trip extra)
   *   - Retornar stub `{} as T` (handler downstream deve aceitar)
   *   - Throw se completion sem detalhes é semanticamente impossível
   */
  onAlreadyCompleted: (providerIdempotencyKey: string) => Promise<T>;
}

/**
 * Pattern para handlers que chamam providers SEM suporte nativo a
 * idempotency-key (raros, mas existem — alguns SMS gateways legados, alguns
 * SaaS internos). Em vez de confiar no provider para dedup, perguntamos antes.
 *
 * Para providers COM suporte (Stripe, Meta Cloud API, Twilio, SendGrid),
 * use `makeProviderIdempotencyKey` + `fetchWithIdempotency` direto — mais
 * simples e 1 round trip menos.
 *
 * Fluxo:
 *   1. Gera idemKey determinístico (eventId + sideEffectKey).
 *   2. Pergunta provider: statusCheck(idemKey).
 *   3. Decide:
 *        'completed' → onAlreadyCompleted (idempotent return)
 *        'failed'    → throw PoisonPillError (não retentar — falha permanente)
 *        'pending'   → throw SideEffectInFlightError (worker retry com backoff)
 *        'not_found' → call(idemKey) — chama provider
 *
 * Custo: 1 round trip extra (statusCheck) por chamada bem-sucedida. Aceitável
 * para handlers cuja correção depende criticamente de não-duplicar.
 *
 * Exemplo:
 *   const result = await withProviderStatusCheck(ctx, 'sms.send', {
 *     statusCheck: async (key) => {
 *       const r = await smsGateway.queryStatus(key);
 *       return r.status === 'delivered' ? 'completed'
 *            : r.status === 'failed_perm' ? 'failed'
 *            : r.status === 'queued' ? 'pending'
 *            : 'not_found';
 *     },
 *     call: async (key) => {
 *       return smsGateway.send({ idempotencyKey: key, to, body });
 *     },
 *     onAlreadyCompleted: async (key) => {
 *       return smsGateway.queryDetails(key);  // re-fetch
 *     },
 *   });
 */
export async function withProviderStatusCheck<T, TPayload>(
  ctx: Pick<HandlerCtx<TPayload>, 'eventId'>,
  sideEffectKey: string,
  opts: ProviderStatusCheckOpts<T>,
): Promise<T> {
  const idemKey = makeProviderIdempotencyKey(ctx, sideEffectKey);
  const status = await opts.statusCheck(idemKey);

  switch (status) {
    case 'completed':
      return opts.onAlreadyCompleted(idemKey);
    case 'failed':
      throw new PoisonPillError(
        `provider side-effect '${sideEffectKey}' failed permanently for event ${ctx.eventId}`,
        'side_effect_provider_failed',
      );
    case 'pending':
      throw new SideEffectInFlightError(ctx.eventId, sideEffectKey);
    case 'not_found':
      return opts.call(idemKey);
    default: {
      // Exhaustive check: TypeScript falha se um estado novo for adicionado em
      // ProviderSideEffectStatus sem ser tratado.
      const _exhaustive: never = status;
      throw new Error(`unknown provider status: ${_exhaustive as string}`);
    }
  }
}
