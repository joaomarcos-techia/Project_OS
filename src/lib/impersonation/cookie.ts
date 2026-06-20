/**
 * Cookie de impersonate (C15) — transporta APENAS o `impersonationId` assinado.
 *
 * A linha em `impersonation_sessions` é a fonte autoritativa (clínica/expiração/
 * revogação). O cookie é só um portador à prova de adulteração: HMAC-SHA256 com
 * `IMPERSONATION_SECRET`. Um cookie com assinatura inválida é tratado como
 * ausente (OR-I6).
 *
 * Server-only.
 */
import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';

export const IMPERSONATION_COOKIE = 'qoro_imp';

const SEP = '.';

function secret(): string {
  const s = env.IMPERSONATION_SECRET;
  if (!s) {
    throw new Error('[impersonation] IMPERSONATION_SECRET é obrigatório em runtime (C15)');
  }
  return s;
}

function mac(id: string): string {
  return createHmac('sha256', secret()).update(id).digest('hex');
}

/** Valor do cookie = `${impersonationId}.${hmac}`. */
export function signImpersonationCookie(impersonationId: string): string {
  return `${impersonationId}${SEP}${mac(impersonationId)}`;
}

/**
 * Verifica a assinatura e devolve o `impersonationId`, ou null se ausente/forjado.
 * Comparação constant-time.
 */
export function readImpersonationCookie(value: string | undefined): string | null {
  if (!value) return null;
  const idx = value.lastIndexOf(SEP);
  if (idx <= 0) return null;
  const id = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = mac(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}
