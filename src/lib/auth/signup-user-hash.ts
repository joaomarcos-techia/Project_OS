import 'server-only';

import { createHmac } from 'node:crypto';

import { env } from '@/lib/env';

/** Identificador pseudônimo para buckets do draft; domínio separado do hash de e-mail. */
export function hashSignupUserId(userId: string): string {
  if (!env.LOGIN_HASH_PEPPER) {
    throw new Error('[auth/signup-user-hash] LOGIN_HASH_PEPPER ausente.');
  }
  return createHmac('sha256', env.LOGIN_HASH_PEPPER)
    .update(`signup-draft-user:v1:${userId}`)
    .digest('hex');
}
