/**
 * Políticas do "perfil de segurança TISS" (seção N do QORO_TISS_MASTER_PLAN.md;
 * Componente de Segurança e Privacidade ANS 202511, requisitos 67, 81, 82, 83).
 *
 * PREPARAÇÃO: funções puras, testadas e AINDA NÃO LIGADAS à autenticação. A
 * ligação (tenant-context, fluxos de senha, sessão) espera a aprovação de
 * S2–S4. Nada aqui muda o comportamento atual do Qoro.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { signupPasswordProblems, type SignupPasswordProblem } from '@/lib/auth/signup-password';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// ── R67: composição ────────────────────────────────────────────────────
/**
 * Requisito 67: mínimo de 8 caracteres com ao menos um de cada: maiúscula,
 * minúscula, número e símbolo (ASCII ou Unicode). Soma a exigência de símbolo à
 * regra atual do Qoro, sem afrouxar nenhuma outra.
 */
export type TissPasswordProblem = SignupPasswordProblem | 'symbol';

export function tissPasswordProblems(password: string): TissPasswordProblem[] {
  const problems: TissPasswordProblem[] = signupPasswordProblems(password);
  // Símbolo = qualquer caractere que não seja letra, número, espaço nem controle.
  if (!/[^\p{L}\p{N}\p{White_Space}\p{Cc}]/u.test(password)) problems.push('symbol');
  return problems;
}

// ── R81: prazo de troca ────────────────────────────────────────────────
export const PASSWORD_MAX_AGE_DAYS = 90;
export const PASSWORD_WARN_AGE_DAYS = 75;
const DAY = 86_400_000;

export type PasswordAgeDecision =
  | { kind: 'ok'; daysLeft: number }
  | { kind: 'warn'; daysLeft: number }
  | { kind: 'must_change' };

/**
 * `lastChangedAt` = última troca registrada; `profileActivatedAt` = quando a
 * clínica passou ao perfil TISS. Transição: contas sem troca registrada contam
 * a partir da ativação (90 dias de carência), nunca troca imediata da base.
 */
export function passwordAgeDecision(args: {
  lastChangedAt: Date | null;
  profileActivatedAt: Date;
  now: Date;
}): PasswordAgeDecision {
  const base =
    args.lastChangedAt && args.lastChangedAt > args.profileActivatedAt
      ? args.lastChangedAt
      : args.profileActivatedAt;
  const age = Math.floor((args.now.getTime() - base.getTime()) / DAY);
  if (age > PASSWORD_MAX_AGE_DAYS) return { kind: 'must_change' };
  const daysLeft = PASSWORD_MAX_AGE_DAYS - age;
  return age >= PASSWORD_WARN_AGE_DAYS ? { kind: 'warn', daysLeft } : { kind: 'ok', daysLeft };
}

// ── R82: histórico das 10 últimas ──────────────────────────────────────
export const PASSWORD_HISTORY_SIZE = 10;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEYLEN = 32;

/** Verificador irreversível: scrypt(senha + pepper, sal aleatório). Nunca a senha. */
export interface PasswordVerifier {
  alg: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}

export async function derivePasswordVerifier(
  password: string,
  pepper: string,
): Promise<PasswordVerifier> {
  if (pepper.length < 32) throw new Error('pepper do histórico de senhas curto demais');
  const salt = randomBytes(16);
  const hash = await scrypt(`${password}\u0000${pepper}`, salt, KEYLEN, SCRYPT);
  return {
    alg: 'scrypt',
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
  };
}

/** A senha nova repete alguma das últimas 10? Compara em tempo constante. */
export async function isRecentlyUsedPassword(
  password: string,
  history: readonly PasswordVerifier[],
  pepper: string,
): Promise<boolean> {
  for (const v of history.slice(0, PASSWORD_HISTORY_SIZE)) {
    const hash = await scrypt(`${password}\u0000${pepper}`, Buffer.from(v.salt, 'base64'), KEYLEN, {
      N: v.N,
      r: v.r,
      p: v.p,
      maxmem: SCRYPT.maxmem,
    });
    if (timingSafeEqual(hash, Buffer.from(v.hash, 'base64'))) return true;
  }
  return false;
}

// ── R83: inatividade ───────────────────────────────────────────────────
export const INACTIVITY_LIMIT_MS = 10 * 60_000;
export const INACTIVITY_WARN_MS = 9 * 60_000;

/**
 * Só interação humana renova a atividade: o cliente marca `x-qoro-activity: 1`
 * quando houve tecla, clique ou rolagem; polling e prefetch mandam
 * `x-qoro-background: 1` e nunca renovam. Sem marca, não renova (fail-closed).
 */
export function isUserActivityRequest(headers: { get(name: string): string | null }): boolean {
  if (headers.get('x-qoro-background') === '1') return false;
  return headers.get('x-qoro-activity') === '1';
}

export type SessionActivityDecision = 'active' | 'warn' | 'locked';

/** Decisão do servidor (autoridade): o relógio do cliente não conta. */
export function sessionActivityDecision(args: {
  lastActivityAt: Date;
  lockedAt: Date | null;
  now: Date;
}): SessionActivityDecision {
  if (args.lockedAt) return 'locked';
  const idle = args.now.getTime() - args.lastActivityAt.getTime();
  if (idle >= INACTIVITY_LIMIT_MS) return 'locked';
  return idle >= INACTIVITY_WARN_MS ? 'warn' : 'active';
}
