import type { ErrorEvent } from '@sentry/nextjs';

import { sanitizePayload } from '@/lib/sanitize/redact';
import { redactStringValue } from '@/lib/sanitize/patterns';

const INVITE_TOKEN_PATH = /(\/join\/)[^/?#]+/g;

/**
 * Sessão expirada NÃO é incidente — e enchia o Sentry como se fosse.
 *
 * Achado em 14/09, olhando eventos reais: `AuthError: Autenticação necessária`
 * com `reason: TOKEN_INVALID` aparecia repetidamente (`/consultorio`,
 * `/configuracoes/lgpd`, `/agenda`), sempre precedido de um
 * `POST ?grant_type=refresh_token → 400`. Ou seja: o refresh token venceu, a
 * pessoa precisa entrar de novo. É o produto funcionando.
 *
 * O sinal desse caso JÁ EXISTE e é melhor: o construtor de `AuthError` emite
 * `authz.denied` como MÉTRICA (SEC-050), com baixa cardinalidade e sem PII —
 * que é o canal certo para contar sondagem de IDOR. A exceção no Sentry era
 * redundante, e redundância barulhenta enterra o que importa: quota gasta e
 * erro real perdido no meio.
 *
 * Só `unauthenticated` é descartado. `forbidden` (alguém AUTENTICADO tentou o
 * que não pode) e `config` (500) continuam subindo com stack — nesses a
 * pergunta "quem, onde, como chegou aqui" tem resposta útil.
 */
function isExpectedAuthDenial(event: ErrorEvent): boolean {
  const excecoes = event.exception?.values;
  if (!excecoes || excecoes.length === 0) return false;
  return excecoes.some(
    (e) =>
      e.type === 'AuthError' &&
      // A mensagem é o único campo estável aqui: o `code` da classe não
      // sobrevive à serialização do Sentry. As mensagens vêm de
      // AUTH_ERROR_MESSAGE, que é uma tabela fechada.
      (e.value === 'Autenticação necessária' ||
        e.value === 'Sua sessão está desatualizada. Entre novamente.'),
  );
}

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
 *
 * Devolve `null` para DESCARTAR o evento — ver `isExpectedAuthDenial`.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (isExpectedAuthDenial(event)) return null;

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
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(({ data, message, ...breadcrumb }) => {
      const cleaned = sanitizePayload(data);
      const safeData =
        cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)
          ? Object.fromEntries(Object.entries(cleaned))
          : undefined;
      return {
        ...breadcrumb,
        ...(typeof message === 'string' ? { message: scrubRequestUrl(message) } : {}),
        ...(safeData ? { data: safeData } : {}),
      };
    });
  }
  return event;
}
