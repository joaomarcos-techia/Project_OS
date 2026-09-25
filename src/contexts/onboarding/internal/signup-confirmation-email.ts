import 'server-only';

import { createHash, createHmac } from 'node:crypto';
import type { User } from '@supabase/supabase-js';

import { createAdminClient, findAdminUserByEmail } from '@/lib/auth/supabase-admin';
import { sendTransactionalEmail } from '@/lib/email/resend';
import { renderSignupConfirmationEmail } from '@/lib/email/templates/signup-confirmation';
import { env } from '@/lib/env';
import { createSignupConfirmationUrl } from '@/lib/http/application-url';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

import {
  createPendingSignupAppMetadata,
  deriveSignupHandoffCode,
  isPendingSignupUserBound,
  readPendingSignupReference,
} from './signup-auth-binding';
import { validateLegacySignupDeliveryCandidate } from './signup-auth-admin';
import { readSignupDeliveryAttemptState, readSignupReferenceLiveness } from './signup-session';

/**
 * Emissao do link de confirmacao do cadastro + envio pelo Resend.
 *
 * O corpo e a URL ficam no repositorio; o painel do Supabase deixa de ser uma
 * dependencia invisivel. A conta nasce SEM senha, presa ao HMAC do draft em
 * `app_metadata`. A senha definitiva so e aplicada depois da prova do e-mail.
 * Tanto o primeiro envio quanto o reenvio usam um token de `recovery`: ele nao
 * recebe senha e, ao contrario de `magiclink`, nao cria usuario ausente.
 */

export type SignupConfirmationOutcome =
  | { kind: 'sent' }
  | { kind: 'obfuscated' }
  | { kind: 'weak_password' }
  | { kind: 'retryable' }
  | { kind: 'uncertain' };

const ACCOUNT_OUTCOMES = new Set([
  'user_already_exists',
  'email_exists',
  'user_banned',
  'user_not_found',
]);
const RECOVERABLE_EXISTING_ACCOUNT_OUTCOMES = new Set(['user_already_exists', 'email_exists']);
const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const HIBP_TIMEOUT_MS = 5_000;

async function resolveExistingPendingUser(input: {
  user: User;
  email: string;
  signupRef: string;
  attemptEpoch: number;
  stage: 'initial' | 'resend';
}): Promise<
  { kind: 'ready'; user: User; legacy: boolean } | { kind: 'obfuscated' } | { kind: 'uncertain' }
> {
  const pendingRef = readPendingSignupReference(input.user);
  if (pendingRef === input.signupRef) {
    return { kind: 'ready', user: input.user, legacy: false };
  }
  if (pendingRef !== null) {
    const current = await readSignupReferenceLiveness({
      userId: input.user.id,
      email: input.email,
      signupRef: pendingRef,
    });
    if (current === 'unavailable') return { kind: 'uncertain' };
    if (current === 'live') return { kind: 'obfuscated' };
    return { kind: 'ready', user: input.user, legacy: false };
  }
  const candidate = await validateLegacySignupDeliveryCandidate({
    userId: input.user.id,
    email: input.email,
    signupRef: input.signupRef,
    attemptEpoch: input.attemptEpoch,
    stage: input.stage,
  });
  if (!candidate.ok) {
    return { kind: candidate.reason === 'unavailable' ? 'uncertain' : 'obfuscated' };
  }
  return { kind: 'ready', user: candidate.user, legacy: true };
}

function errorCode(error: { code?: string | undefined } | null): string {
  return error?.code ?? '';
}

async function mayDeliverCurrentAttempt(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    userId: string;
    email: string;
    signupRef: string;
    attemptEpoch: number;
    stage: 'initial' | 'resend';
    legacy: boolean;
  },
): Promise<boolean> {
  const attemptState = await readSignupDeliveryAttemptState({
    signupRef: input.signupRef,
    attemptEpoch: input.attemptEpoch,
    kind: input.stage,
    userId: input.userId,
  });
  if (attemptState === 'stale') return false;

  const { data, error } = await admin.auth.admin.getUserById(input.userId);
  const user = data.user;
  const pendingRef = user ? readPendingSignupReference(user) : null;
  if (
    error ||
    !user ||
    user.id !== input.userId ||
    user.email?.trim().toLowerCase() !== input.email.trim().toLowerCase() ||
    (pendingRef === null && !input.legacy)
  ) {
    return false;
  }

  // Uma conta Qoro ainda sem senha pode já ter confirmado o e-mail por um
  // draft que venceu antes de expirar. O draft novo precisa conseguir emitir
  // outra prova para que o callback faça claim e rebind da referência. O marker
  // `pending` é a fronteira: conta comum, profile e conta com senha continuam
  // ofuscadas por `pendingRef === null` acima.
  if (pendingRef === null) {
    const candidate = await validateLegacySignupDeliveryCandidate({
      userId: input.userId,
      email: input.email,
      signupRef: input.signupRef,
      attemptEpoch: input.attemptEpoch,
      stage: input.stage,
    });
    return candidate.ok && attemptState === 'pending';
  }
  if (pendingRef !== input.signupRef) {
    const current = await readSignupReferenceLiveness({
      userId: input.userId,
      email: input.email,
      signupRef: pendingRef,
    });
    if (current !== 'gone') return false;
  }
  if (attemptState === 'pending') return true;
  return Boolean(user.email_confirmed_at) && pendingRef === input.signupRef;
}

export type SignupPasswordExposure = 'safe' | 'pwned' | 'unavailable';

/**
 * Consulta HIBP pelo protocolo k-anonymity. Somente os cinco primeiros
 * caracteres do SHA-1 deixam o processo. A senha, o SHA-1 completo e o sufixo
 * nunca sao registrados.
 */
export async function checkSignupPasswordExposure(
  password: string,
): Promise<SignupPasswordExposure> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  let response: Response;
  try {
    response = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
      headers: {
        'Add-Padding': 'true',
        'User-Agent': 'Qoro-signup-password-check',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    });
  } catch {
    return 'unavailable';
  }
  if (!response.ok) return 'unavailable';

  let body: string;
  try {
    body = await response.text();
  } catch {
    return 'unavailable';
  }

  const lines = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.some((line) => !/^[0-9A-F]{35}:\d+$/u.test(line))) {
    return 'unavailable';
  }

  const match = lines.find((line) => line.startsWith(`${suffix}:`));
  if (!match) return 'safe';
  const count = Number.parseInt(match.slice(suffix.length + 1), 10);
  return count > 0 ? 'pwned' : 'safe';
}

/** Primeiro envio: valida a senha, cria a conta passwordless vinculada e envia o token. */
export async function sendSignupConfirmation(input: {
  email: string;
  password: string;
  signupRef: string;
  attemptEpoch: number;
}): Promise<SignupConfirmationOutcome> {
  const exposure = await checkSignupPasswordExposure(input.password);
  if (exposure === 'pwned') return { kind: 'weak_password' };
  if (exposure === 'unavailable') {
    logger.warn('signup.confirmation.password_check_failed', { stage: 'initial' });
    // Nenhum efeito externo aconteceu ainda. A rota pode devolver a reserva e
    // permitir nova tentativa, em vez de prender a sessão em `email_pending`
    // sem usuário nem mensagem para reenviar.
    return { kind: 'retryable' };
  }

  const admin = createAdminClient();
  let expectedUser: User;
  let legacyCandidate = false;
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      email_confirm: false,
      app_metadata: createPendingSignupAppMetadata(input.signupRef),
    });
    if (error) {
      const code = errorCode(error);
      if (code === 'weak_password') return { kind: 'weak_password' };
      if (RECOVERABLE_EXISTING_ACCOUNT_OUTCOMES.has(code)) {
        const existing = await findAdminUserByEmail(input.email);
        if (existing.kind === 'unavailable' || existing.kind === 'missing') {
          return { kind: 'uncertain' };
        }
        const resolved = await resolveExistingPendingUser({
          user: existing.user,
          email: input.email,
          signupRef: input.signupRef,
          attemptEpoch: input.attemptEpoch,
          stage: 'initial',
        });
        if (resolved.kind === 'obfuscated') {
          metrics.emit('signup.confirmation.obfuscated', { stage: 'initial' });
          return { kind: 'obfuscated' };
        }
        if (resolved.kind === 'uncertain') return { kind: 'uncertain' };
        expectedUser = resolved.user;
        legacyCandidate = resolved.legacy;
      } else if (ACCOUNT_OUTCOMES.has(code)) {
        metrics.emit('signup.confirmation.obfuscated', { stage: 'initial' });
        return { kind: 'obfuscated' };
      } else {
        logger.warn('signup.confirmation.user_failed', {
          stage: 'initial',
          code: code || 'unknown',
        });
        return { kind: 'uncertain' };
      }
    } else {
      const createdUser = data?.user;
      const id = createdUser?.id;
      if (
        typeof id !== 'string' ||
        id.length === 0 ||
        !createdUser ||
        !isPendingSignupUserBound(createdUser, input.signupRef)
      ) {
        logger.warn('signup.confirmation.user_failed', { stage: 'initial', code: 'no_user' });
        return { kind: 'uncertain' };
      }
      expectedUser = createdUser;
    }
  } catch {
    return { kind: 'uncertain' };
  }

  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: input.email,
    });
    if (error) {
      const code = errorCode(error);
      logger.warn('signup.confirmation.link_failed', { stage: 'initial', code: code || 'unknown' });
      return { kind: 'uncertain' };
    }
    const linkedUserId = data?.user?.id;
    const tokenHash = data?.properties?.hashed_token;
    if (
      linkedUserId !== expectedUser.id ||
      !data?.user ||
      typeof tokenHash !== 'string' ||
      tokenHash.length === 0
    ) {
      logger.warn('signup.confirmation.link_failed', {
        stage: 'initial',
        code: linkedUserId !== expectedUser.id ? 'user_mismatch' : 'no_token',
      });
      return { kind: 'uncertain' };
    }
    if (
      !(await mayDeliverCurrentAttempt(admin, {
        userId: expectedUser.id,
        email: input.email,
        signupRef: input.signupRef,
        attemptEpoch: input.attemptEpoch,
        stage: 'initial',
        legacy: legacyCandidate,
      }))
    ) {
      return { kind: 'uncertain' };
    }
    return entregar(input.email, tokenHash, input.signupRef, input.attemptEpoch, 'initial');
  } catch {
    return { kind: 'uncertain' };
  }
}

/**
 * Reenvio: somente uma conta ainda pendente pode receber um novo token.
 * O ID retornado por `generateLink` deve ser o mesmo observado antes da chamada.
 */
export async function resendSignupConfirmation(input: {
  email: string;
  signupRef: string;
  attemptEpoch: number;
}): Promise<SignupConfirmationOutcome> {
  try {
    const admin = createAdminClient();
    const existing = await findAdminUserByEmail(input.email);
    if (existing.kind === 'unavailable') {
      logger.warn('signup.confirmation.user_lookup_failed', { stage: 'resend' });
      return { kind: 'uncertain' };
    }
    let expectedUser: User;
    let legacyCandidate = false;
    if (existing.kind === 'found') {
      const resolved = await resolveExistingPendingUser({
        user: existing.user,
        email: input.email,
        signupRef: input.signupRef,
        attemptEpoch: input.attemptEpoch,
        stage: 'resend',
      });
      if (resolved.kind === 'obfuscated') {
        metrics.emit('signup.confirmation.obfuscated', { stage: 'resend' });
        return { kind: 'obfuscated' };
      }
      if (resolved.kind === 'uncertain') return { kind: 'uncertain' };
      expectedUser = resolved.user;
      legacyCandidate = resolved.legacy;
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: input.email,
        email_confirm: false,
        app_metadata: createPendingSignupAppMetadata(input.signupRef),
      });
      if (createError) {
        const code = errorCode(createError);
        if (code === 'weak_password') return { kind: 'weak_password' };
        if (!RECOVERABLE_EXISTING_ACCOUNT_OUTCOMES.has(code)) {
          if (ACCOUNT_OUTCOMES.has(code)) {
            metrics.emit('signup.confirmation.obfuscated', { stage: 'resend' });
            return { kind: 'obfuscated' };
          }
          logger.warn('signup.confirmation.user_failed', {
            stage: 'resend',
            code: code || 'unknown',
          });
          return { kind: 'uncertain' };
        }
        // Outra requisição pode ter criado a conta entre o lookup e o create.
        const raced = await findAdminUserByEmail(input.email);
        if (raced.kind !== 'found') return { kind: 'uncertain' };
        const resolved = await resolveExistingPendingUser({
          user: raced.user,
          email: input.email,
          signupRef: input.signupRef,
          attemptEpoch: input.attemptEpoch,
          stage: 'resend',
        });
        if (resolved.kind === 'obfuscated') {
          metrics.emit('signup.confirmation.obfuscated', { stage: 'resend' });
          return { kind: 'obfuscated' };
        }
        if (resolved.kind === 'uncertain') return { kind: 'uncertain' };
        expectedUser = resolved.user;
        legacyCandidate = resolved.legacy;
      } else if (created?.user && isPendingSignupUserBound(created.user, input.signupRef)) {
        expectedUser = created.user;
      } else {
        return { kind: 'uncertain' };
      }
    }

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: input.email,
    });
    if (error) {
      const code = errorCode(error);
      logger.warn('signup.confirmation.link_failed', { stage: 'resend', code: code || 'unknown' });
      return { kind: 'uncertain' };
    }

    const linkedUser = data?.user;
    if (
      !linkedUser ||
      typeof linkedUser.id !== 'string' ||
      linkedUser.id !== expectedUser.id ||
      typeof linkedUser.email !== 'string' ||
      linkedUser.email.trim().toLowerCase() !== input.email.trim().toLowerCase()
    ) {
      logger.warn('signup.confirmation.link_failed', { stage: 'resend', code: 'user_mismatch' });
      return { kind: 'uncertain' };
    }
    const tokenHash = data?.properties?.hashed_token;
    if (typeof tokenHash !== 'string' || tokenHash.length === 0) {
      logger.warn('signup.confirmation.link_failed', { stage: 'resend', code: 'no_token' });
      return { kind: 'uncertain' };
    }
    if (
      !(await mayDeliverCurrentAttempt(admin, {
        userId: expectedUser.id,
        email: input.email,
        signupRef: input.signupRef,
        attemptEpoch: input.attemptEpoch,
        stage: 'resend',
        legacy: legacyCandidate,
      }))
    ) {
      return { kind: 'uncertain' };
    }
    return entregar(input.email, tokenHash, input.signupRef, input.attemptEpoch, 'resend');
  } catch {
    return { kind: 'uncertain' };
  }
}

type DeliveryStage = 'initial' | 'resend';

async function entregar(
  email: string,
  tokenHash: string,
  signupRef: string,
  attemptEpoch: number,
  stage: DeliveryStage,
): Promise<SignupConfirmationOutcome> {
  try {
    const first = stage === 'initial';
    const conteudo = renderSignupConfirmationEmail({
      confirmUrl: createSignupConfirmationUrl(tokenHash, 'recovery', signupRef),
      expectedOrigin: env.APP_BASE_URL ?? '',
      verificationCode: deriveSignupHandoffCode(signupRef, attemptEpoch),
      first,
    });
    await sendTransactionalEmail({
      to: email,
      subject: conteudo.subject,
      html: conteudo.html,
      text: conteudo.text,
      idempotencyKey: confirmationIdempotencyKey(tokenHash, stage),
    });
    metrics.emit('signup.confirmation.sent', { stage });
    return { kind: 'sent' };
  } catch (error) {
    logger.warn('signup.confirmation.delivery_failed', {
      stage,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return { kind: 'uncertain' };
  }
}

/** O token nunca atravessa para o header de idempotencia do provedor. */
function confirmationIdempotencyKey(tokenHash: string, stage: DeliveryStage): string {
  const secret = env.MAGIC_TOKEN_SECRET;
  if (!secret) throw new Error('signup confirmation idempotency secret is unavailable');
  const digest = createHmac('sha256', secret)
    .update(`qoro/signup-confirmation/v1:${stage}:${tokenHash}`, 'utf8')
    .digest('hex');
  return `signup-confirmation:${stage}:${digest}`;
}
