/**
 * S2 / requisito 83 da ANS: bloqueio da sessão depois de 10 minutos sem atividade, no perfil de segurança TISS.
 *
 * O SERVIDOR decide. O navegador só informa que houve interação, chamando uma action explícita
 * (`registerSessionActivityAction`). A action grava um cookie HttpOnly ASSINADO com o horário da última atividade,
 * preso ao usuário (`sub`) e à sessão (`session_id` do JWT). `authenticate()` confere esse cookie em TODA requisição
 * (página, action, rota) de quem está no alcance do perfil:
 *
 *   - cookie válido, da mesma sessão, com atividade há menos de 10 min → segue;
 *   - cookie válido, da mesma sessão, com atividade há 10 min ou mais → SESSION_LOCKED, mesmo com o token válido;
 *   - cookie fora do alcance (`scope: false`) → nunca bloqueia;
 *   - cookie ausente, adulterado, de outro usuário ou de outra sessão → vale só a autenticação: quem acabou de entrar
 *     (`amr`, até 10 min) segue até a action gravar o cookie; depois disso, BLOQUEIA (fail-closed: apagar o cookie
 *     não destrava nada).
 *
 * O alcance (S1) é calculado por quem grava o cookie (login e action do app, que têm o leitor do rastro TISS). A
 * porta única só verifica a assinatura: nenhuma consulta nova por requisição. Mudança de alcance vale no próximo
 * login ou na próxima renovação.
 *
 * Tudo só vale com `TISS_SECURITY_PROFILE_ENFORCE=true` (desligado por padrão).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { INACTIVITY_LIMIT_MS, sessionActivityDecision } from './security-profile/tiss-policies';

export const SESSION_ACTIVITY_COOKIE = 'qoro_atividade';
/** O cookie só carrega o horário; a validade dele não decide nada (a idade da atividade decide). */
export const SESSION_ACTIVITY_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** O cliente renova no máximo a cada 30 s: o servidor fica, no pior caso, 30 s atrás da última interação. */
export const SESSION_ACTIVITY_RENEW_THROTTLE_MS = 30_000;

export interface SessionActivity {
  /** `sub` do JWT. */
  uid: string;
  /** `session_id` do JWT (cada login é uma sessão nova). */
  sid: string;
  /** Última atividade em ms (relógio do servidor). */
  at: number;
  /** No alcance do perfil TISS quando o cookie foi gravado. */
  scope: boolean;
}

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function encodeSessionActivity(a: SessionActivity, secret: string): string {
  const payload = Buffer.from(JSON.stringify(a)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeSessionActivity(
  value: string | undefined,
  secret: string,
): SessionActivity | null {
  if (!value) return null;
  const [payload, mac, extra] = value.split('.');
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const a = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionActivity;
    if (
      typeof a.uid !== 'string' ||
      typeof a.sid !== 'string' ||
      typeof a.at !== 'number' ||
      !Number.isFinite(a.at) ||
      typeof a.scope !== 'boolean'
    )
      return null;
    return a;
  } catch {
    return null;
  }
}

/** Chave do cookie, derivada do segredo do servidor com separação de domínio (mesmo padrão do `last-access`). */
export function sessionActivitySecret(): string {
  const base = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base)
    throw new Error('[auth/session-activity] SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY ausente.');
  return createHmac('sha256', base).update('qoro/session-activity/v1').digest('base64url');
}

/** O que a porta única precisa do JWT já verificado. */
export interface SessionClaims {
  sub: string;
  sessionId: string | null;
  /** Momento da autenticação (maior `amr[].timestamp`), em ms; `null` se o token não trouxer. */
  authenticatedAt: number | null;
}

export function sessionClaimsFrom(raw: Record<string, unknown>): SessionClaims {
  const sub = typeof raw.sub === 'string' ? raw.sub : '';
  const sessionId = typeof raw.session_id === 'string' ? raw.session_id : null;
  let authenticatedAt: number | null = null;
  if (Array.isArray(raw.amr)) {
    for (const entry of raw.amr) {
      const ts = (entry as { timestamp?: unknown } | null)?.timestamp;
      if (typeof ts === 'number' && Number.isFinite(ts)) {
        authenticatedAt = Math.max(authenticatedAt ?? 0, ts * 1000);
      }
    }
  }
  return { sub, sessionId, authenticatedAt };
}

/**
 * `session_id` de um access token recém-emitido pelo Supabase (login). Não verifica a assinatura: o valor só prende
 * o cookie à sessão, e a porta única compara com o `session_id` VERIFICADO; um valor errado só bloqueia.
 */
export function sessionIdFromAccessToken(token: string | undefined | null): string | null {
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
      session_id?: unknown;
    };
    return typeof p.session_id === 'string' ? p.session_id : null;
  } catch {
    return null;
  }
}

export type SessionLockDecision =
  | { kind: 'active'; source: 'cookie' | 'fresh_login' }
  | { kind: 'out_of_scope' }
  | { kind: 'locked'; reason: 'idle' | 'no_activity_record' };

/**
 * Decisão da porta única. `activity` já decodificado (assinatura conferida); `now` do servidor.
 */
export function decideSessionLock(args: {
  activity: SessionActivity | null;
  claims: SessionClaims;
  now: number;
}): SessionLockDecision {
  const { activity, claims, now } = args;
  const sameSession =
    activity !== null &&
    activity.uid === claims.sub &&
    claims.sessionId !== null &&
    activity.sid === claims.sessionId;
  if (sameSession) {
    if (!activity.scope) return { kind: 'out_of_scope' };
    const decision = sessionActivityDecision({
      lastActivityAt: new Date(activity.at),
      lockedAt: null,
      now: new Date(now),
    });
    return decision === 'locked'
      ? { kind: 'locked', reason: 'idle' }
      : { kind: 'active', source: 'cookie' };
  }
  // Sem registro de atividade desta sessão: só o login recente segura (o tempo de a action gravar o cookie).
  if (
    claims.authenticatedAt !== null &&
    now - claims.authenticatedAt >= 0 &&
    now - claims.authenticatedAt < INACTIVITY_LIMIT_MS
  ) {
    return { kind: 'active', source: 'fresh_login' };
  }
  return { kind: 'locked', reason: 'no_activity_record' };
}

export const SESSION_ACTIVITY_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_ACTIVITY_MAX_AGE_SECONDS,
};
