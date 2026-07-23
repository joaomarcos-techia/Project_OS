/**
 * Lógica pura do `/auth/confirm` (ADR-047 lote / itens 10,11,21) — testável sem
 * Supabase nem Next. O route handler consome estas funções.
 */
import type { EmailOtpType } from '@supabase/supabase-js';

/** Types de OTP que aceitamos no confirm (invite/recovery são os nossos fluxos). */
const VALID_OTP_TYPES: readonly EmailOtpType[] = [
  'invite',
  'recovery',
  'email',
  'magiclink',
  'signup',
  'email_change',
];

export function isValidOtpType(v: string | null): v is EmailOtpType {
  return v !== null && (VALID_OTP_TYPES as readonly string[]).includes(v);
}

/**
 * Sanitiza `next` — INVARIANTE de segurança: só path relativo INTERNO. Bloqueia
 * open-redirect (`//evil.com`, `https://evil.com`, `/\evil.com`, backslashes,
 * URLs absolutas com esquema). Fallback seguro: `/dashboard`.
 */
export function safeNext(raw: string | null | undefined): string {
  const fallback = '/dashboard';
  if (!raw) return fallback;
  // precisa começar com "/" e NÃO ser "//" ou "/\" (protocol-relative / escape)
  if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return fallback;
  // rejeita qualquer coisa com esquema explícito ou backslash (defensivo)
  if (raw.includes('\\') || /^\/*[a-z][a-z0-9+.-]*:/i.test(raw.slice(1))) return fallback;
  return raw;
}

/** Motivo → mensagem amigável (matriz de erros do plano). */
export function verifyErrorReason(message: string | undefined): 'expired' | 'invalid_token' {
  return message && /expired|otp_expired/i.test(message) ? 'expired' : 'invalid_token';
}
