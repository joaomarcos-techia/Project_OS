/**
 * HMAC-SHA256 do email + pepper para login_attempts.
 *
 * NUNCA armazenamos email plaintext em login_attempts (privacidade — atacante
 * com SELECT na tabela não infere emails da clínica). Pepper é segredo de env
 * (LOGIN_HASH_PEPPER, min 32 chars). Rotação do pepper invalida windows de
 * rate limit em voo — aceito (windows são curtos, 15 min).
 *
 * Server-only: helper usa node:crypto. Não importável de client components.
 */
import 'server-only';

import { createHmac } from 'node:crypto';

import { env } from '@/lib/env';

export function hashEmail(email: string): string {
  if (!env.LOGIN_HASH_PEPPER) {
    throw new Error(
      '[auth/email-hash] LOGIN_HASH_PEPPER ausente no env. Configure antes de usar login flow.',
    );
  }
  const normalized = email.trim().toLowerCase();
  return createHmac('sha256', env.LOGIN_HASH_PEPPER).update(normalized).digest('hex');
}
