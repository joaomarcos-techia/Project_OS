import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/**
 * Comparação de segredos em TEMPO CONSTANTE, à prova de entrada inválida (V12 —
 * auditoria de segurança). Substitui `===`/`!==` de segredos (Bearer
 * `CRON_SECRET`, `verify_token` do Meta) por uma comparação sem side-channel de
 * timing, consistente com o resto do codebase (webhook Asaas/Meta POST já usam
 * constant-time via `timingSafeEqual`/`constantTimeEqual`).
 *
 * Contrato (decisão explícita — para ninguém usar `timingSafeEqual` cru):
 *   - NUNCA lança. `crypto.timingSafeEqual` LANÇA quando os buffers têm tamanhos
 *     diferentes; este wrapper trata isso e também `null`/`undefined` (ex.:
 *     `env.CRON_SECRET` ausente, ou header `Authorization` inexistente).
 *   - Retorna `false` para qualquer entrada inválida — `null`, `undefined`,
 *     tipo não-string, ou tamanhos de byte diferentes.
 *   - Só chama `timingSafeEqual` DEPOIS de normalizar ambos para `Buffer` e
 *     confirmar comprimentos iguais.
 *
 * Nota: a checagem de tamanho antes do `timingSafeEqual` revela o COMPRIMENTO do
 * segredo por timing — trade-off aceito (o comprimento de um segredo de alta
 * entropia não o enfraquece); é o mesmo padrão de `hashesEqual`
 * (crypto/encryption.ts) e `constantTimeEqual` (billing/asaas.ts).
 */
export function safeEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
