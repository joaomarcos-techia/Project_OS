/**
 * Token do convite mágico (server-only). O link `/join/{raw}` carrega o token CRU;
 * o banco guarda só o HMAC (`token_hash`). Padrão do cookie de impersonate.
 */
import 'server-only';

import { createHmac, randomBytes } from 'node:crypto';

import { env } from '@/lib/env';

function secret(): string {
  const s = env.MAGIC_TOKEN_SECRET;
  if (!s) throw new Error('[onboarding] MAGIC_TOKEN_SECRET é obrigatório em runtime');
  return s;
}

/** HMAC-SHA256 do token cru. Determinístico → lookup por token_hash (unique index). */
export function hashToken(rawToken: string): string {
  return createHmac('sha256', secret()).update(rawToken).digest('hex');
}

/** Gera um token cru (256 bits) + seu hash. O cru só viaja no link, nunca persiste. */
export function generateInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashToken(rawToken) };
}
