import type { ErrorEvent } from '@sentry/nextjs';

import { sanitizePayload } from '@/lib/sanitize/redact';
import { redactStringValue } from '@/lib/sanitize/patterns';

const INVITE_TOKEN_PATH = /(\/join\/)[^/?#]+/g;

function scrubRequestUrl(url: string): string {
  return redactStringValue(url.replace(INVITE_TOKEN_PATH, '$1[REDACTED]'));
}

/**
 * `beforeSend` scrubber shared by the Sentry client/server/edge configs.
 *
 * Reusa a mesma disciplina `sanitizePayload` do logger/metrics (Bearer/JWT/sk_/
 * DSN + SENSITIVE_KEYS). Combinado com `sendDefaultPii: false`, remove cookies/
 * headers e body da request e redige extra / contexts. URLs de convite
 * e corpos multipart também são tratados explicitamente: token de convite e
 * dados de checkout não podem sair para o Sentry.
 *
 * ⚠️ LIMITES REAIS — leia antes de confiar (corrigido em 2026-07-18, achado N6).
 * O docblock anterior afirmava que "um evento nunca carrega credencial OU
 * PAYLOAD CLÍNICO ao Sentry". A segunda metade era FALSA, e do mesmo jeito que
 * o A1 foi falso: `sanitizePayload` é DENYLIST de nomes de chave. Ela agora
 * cobre as chaves clínicas conhecidas (`content`, `soap`, `medicamentos`, …),
 * mas continua sendo lista — um campo clínico com nome novo passa legível,
 * porque os regexes de valor só reconhecem credencial, nunca prosa em
 * português.
 *
 * Duas consequências operacionais:
 *  1. `tags` NÃO passam por aqui — este scrubber só toca `request`, `extra` e
 *     `contexts`. Tag é o sink MENOS protegido do Sentry. Por isso
 *     [capture.ts] tem um tipo FECHADO: texto livre não chega a virar tag.
 *  2. A defesa de verdade é no CALL-SITE (allowlist tipada em [context.ts] e
 *     [capture.ts]; seam `project` do idempotentMutation para o disco). Isto
 *     aqui é a 2ª camada — não trate como a primeira.
 *
 * Pure (no Node APIs) → safe in the edge and browser runtimes.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    if (typeof event.request.url === 'string') {
      event.request.url = scrubRequestUrl(event.request.url);
    }
    if (event.request.data !== undefined) {
      // Mesmo um objeto pode conter texto clínico sob chave desconhecida.
      // O corpo não é necessário para correlacionar uma falha operacional.
      event.request.data = '[REDACTED_REQUEST_BODY]';
    }
  }
  if (event.extra) {
    event.extra = sanitizePayload(event.extra) as Record<string, unknown>;
  }
  if (event.contexts) {
    event.contexts = sanitizePayload(event.contexts) as typeof event.contexts;
  }
  return event;
}
