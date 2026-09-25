import { randomInt } from 'node:crypto';

import { env } from '@/lib/env';

const SIGNUP_ACCOUNT_RESPONSE_MIN_MS = 3_000;
const SIGNUP_ACCOUNT_RESPONSE_JITTER_MS = 400;

/**
 * Calcula somente o tempo restante do piso de resposta. Separada do relogio e
 * do timer para que os limites sejam testaveis sem tornar a suite lenta.
 */
export function signupAccountResponseDelayMs(elapsedMs: number, jitterMs: number): number {
  const elapsed = Math.max(0, Math.trunc(elapsedMs));
  const jitter = Math.min(SIGNUP_ACCOUNT_RESPONSE_JITTER_MS, Math.max(0, Math.trunc(jitterMs)));
  return Math.max(0, SIGNUP_ACCOUNT_RESPONSE_MIN_MS + jitter - elapsed);
}

/**
 * Aplica um piso com jitter a toda resposta que ja consultou/criou uma conta.
 * Isso nao promete tempo constante em rede lenta, mas elimina o atalho
 * estrutural em que "conta existente" voltava imediatamente enquanto o envio
 * real ainda precisava criar usuario, gerar token e falar com o Resend.
 */
export async function settleSignupAccountResponse(startedAt: number): Promise<void> {
  if (env.NODE_ENV === 'test') return;
  const jitter = randomInt(SIGNUP_ACCOUNT_RESPONSE_JITTER_MS + 1);
  const delay = signupAccountResponseDelayMs(Date.now() - startedAt, jitter);
  if (delay === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
}
