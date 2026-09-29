import { z } from 'zod';

/** Contrato local alinhado à política do produto e ao limite do Supabase Auth. */
export const SIGNUP_PASSWORD_MIN_CHARACTERS = 8;
export const SIGNUP_PASSWORD_MAX_BYTES = 72;

/** O texto das regras, igual em todas as telas que pedem senha. */
export const SIGNUP_PASSWORD_RULES =
  'De 8 a 72 caracteres, sem espaços, com letra maiúscula, minúscula e número. Símbolos são opcionais.';

export type SignupPasswordProblem =
  | 'too_short'
  | 'too_long'
  | 'uppercase'
  | 'lowercase'
  | 'digit'
  | 'whitespace'
  | 'control';

/** O que a senha não cumpre, na ordem das regras. Lista vazia = senha válida. */
export function signupPasswordProblems(password: string): SignupPasswordProblem[] {
  const problems: SignupPasswordProblem[] = [];
  if (Array.from(password).length < SIGNUP_PASSWORD_MIN_CHARACTERS) problems.push('too_short');
  if (new TextEncoder().encode(password).length > SIGNUP_PASSWORD_MAX_BYTES) {
    problems.push('too_long');
  }
  if (!/[A-Z]/u.test(password)) problems.push('uppercase');
  if (!/[a-z]/u.test(password)) problems.push('lowercase');
  if (!/[0-9]/u.test(password)) problems.push('digit');
  if (/\p{White_Space}/u.test(password)) problems.push('whitespace');
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(password)) problems.push('control');
  return problems;
}

const MISSING: Partial<Record<SignupPasswordProblem, string>> = {
  too_short: 'pelo menos 8 caracteres',
  uppercase: 'uma letra maiúscula',
  lowercase: 'uma letra minúscula',
  digit: 'um número',
};

const FORBIDDEN: Partial<Record<SignupPasswordProblem, string>> = {
  too_long: 'A senha pode ter no máximo 72 caracteres.',
  whitespace: 'A senha não pode ter espaços.',
  control: 'A senha tem caracteres inválidos.',
};

function joinPt(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/**
 * Diz exatamente o que falta. Antes, qualquer falha virava "ao menos 8
 * caracteres", e quem esquecia a maiúscula ou o número não sabia o que mudar.
 * Devolve `null` quando a senha cumpre o contrato.
 */
export function signupPasswordMessage(password: string): string | null {
  const problems = signupPasswordProblems(password);
  if (problems.length === 0) return null;
  const missing = problems.flatMap((problem) => MISSING[problem] ?? []);
  const parts = missing.length ? [`A senha precisa ter ${joinPt(missing)}.`] : [];
  for (const problem of problems) {
    const forbidden = FORBIDDEN[problem];
    if (forbidden) parts.push(forbidden);
  }
  return parts.join(' ');
}

/** Puro e compartilhável com a UI; senha nunca é normalizada ou persistida. */
export const signupPasswordSchema = z
  .string()
  .refine((password) => signupPasswordProblems(password).length === 0);
