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

const SAFE_NEXT_PATHS = new Set([
  '/dashboard',
  '/convite',
  '/reset-password',
  '/cadastro/confirmado',
]);
const INTERNAL_ORIGIN = 'https://auth-confirm.internal';

/**
 * Sanitiza `next` — INVARIANTE de segurança: somente destinos internos
 * necessários pelos fluxos de OTP. A allowlist evita ambiguidades do parser com
 * controles ASCII, whitespace, barras invertidas e URLs protocol-relative.
 */
export function safeNext(raw: string | null | undefined): string {
  const fallback = '/dashboard';
  if (!raw) return fallback;
  if (!raw.startsWith('/') || /[\u0000-\u0020\u007f]/u.test(raw) || raw.includes('\\')) {
    return fallback;
  }

  try {
    const parsed = new URL(raw, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN || parsed.hash || !SAFE_NEXT_PATHS.has(parsed.pathname)) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

/**
 * O link de confirmação do cadastro termina numa tela que só diz "e-mail
 * confirmado" — não mais na revisão.
 *
 * A troca é de UX e de verdade ao mesmo tempo. Quem clica costuma estar no
 * celular, enquanto o cadastro continua aberto no computador; jogar o celular
 * numa revisão de formulário sugeria que a continuação era ali, e no aparelho
 * sem o cookie anônimo ela não era. A aba que começou o cadastro percebe a
 * confirmação sozinha e segue para a escolha do plano; o telefone só precisa dizer que
 * deu certo — com um caminho discreto para continuar ali, se for o caso.
 *
 * `signup` ignora `next` de propósito: o tipo já determina o destino, e aceitar
 * um `next` do e-mail só ampliaria a superfície sem ganho. Os tipos legados e
 * `recovery` continuam presos à allowlist; a rota escolhe o ramo pela identidade
 * autoritativa (draft pré-tenant ou profile existente).
 */
export function safeNextForOtp(raw: string | null | undefined, type: EmailOtpType): string {
  if (type === 'signup') return '/cadastro/confirmado';
  return safeNext(raw);
}

/** Motivo → mensagem amigável (matriz de erros do plano). */
export function verifyErrorReason(message: string | undefined): 'expired' | 'invalid_token' {
  return message && /expired|otp_expired/i.test(message) ? 'expired' : 'invalid_token';
}
