import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';

const SIGNUP_BINDING_KEY = 'qoro_self_service_signup';
const SIGNUP_BINDING_VERSION = 1;
const SIGNUP_REFERENCE_PATTERN = /^[a-f0-9]{64}$/u;
const SIGNUP_HANDOFF_CODE_PATTERN = /^\d{8}$/u;

export type SignupPasswordState = 'pending' | 'set';

type SignupBinding = {
  version: typeof SIGNUP_BINDING_VERSION;
  kind: 'self_service';
  signup_ref: string;
  password_state: SignupPasswordState;
  initial_password_ref?: string;
};

type AuthUserWithMetadata = {
  app_metadata?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBinding(user: AuthUserWithMetadata): SignupBinding | null {
  if (!isRecord(user.app_metadata)) return null;
  const candidate = user.app_metadata[SIGNUP_BINDING_KEY];
  if (!isRecord(candidate)) return null;
  if (
    candidate.version !== SIGNUP_BINDING_VERSION ||
    candidate.kind !== 'self_service' ||
    !SIGNUP_REFERENCE_PATTERN.test(
      typeof candidate.signup_ref === 'string' ? candidate.signup_ref : '',
    ) ||
    (candidate.password_state !== 'pending' && candidate.password_state !== 'set') ||
    (candidate.initial_password_ref !== undefined &&
      (candidate.password_state !== 'pending' ||
        typeof candidate.initial_password_ref !== 'string' ||
        !SIGNUP_REFERENCE_PATTERN.test(candidate.initial_password_ref)))
  ) {
    return null;
  }
  return candidate as SignupBinding;
}

/** Leitura tipada do marker server-only, sem aceitar formatos parciais. */
export function readSignupAuthBinding(
  user: AuthUserWithMetadata,
): { signupRef: string; passwordState: SignupPasswordState } | null {
  const binding = readBinding(user);
  return binding ? { signupRef: binding.signup_ref, passwordState: binding.password_state } : null;
}

export function hasSignupAuthBindingMarker(user: AuthUserWithMetadata): boolean {
  return (
    isRecord(user.app_metadata) &&
    Object.prototype.hasOwnProperty.call(user.app_metadata, SIGNUP_BINDING_KEY)
  );
}

/** Metadata gravada apenas pela Admin API; o browser não escolhe este vínculo. */
export function createPendingSignupAppMetadata(
  signupRef: string,
  initialPassword = false,
): Record<string, unknown> {
  if (!SIGNUP_REFERENCE_PATTERN.test(signupRef)) {
    throw new Error('[signup] invalid signup auth reference');
  }
  return {
    [SIGNUP_BINDING_KEY]: {
      version: SIGNUP_BINDING_VERSION,
      kind: 'self_service',
      signup_ref: signupRef,
      password_state: 'pending',
      ...(initialPassword ? { initial_password_ref: signupRef } : {}),
    } satisfies SignupBinding,
  };
}

/** Only an email code proved in the browser that created this credential may trust it. */
export function hasInitialSignupPassword(user: AuthUserWithMetadata, signupRef: string): boolean {
  const binding = readBinding(user);
  return (
    binding?.signup_ref === signupRef &&
    binding.password_state === 'pending' &&
    binding.initial_password_ref === signupRef
  );
}

export function hasUntrustedInitialSignupPassword(user: AuthUserWithMetadata): boolean {
  const binding = readBinding(user);
  return (
    binding?.password_state === 'pending' &&
    typeof binding.initial_password_ref === 'string' &&
    SIGNUP_REFERENCE_PATTERN.test(binding.initial_password_ref)
  );
}

/**
 * Instala o marker numa conta legada somente depois da prova do e-mail e do
 * claim autoritativo do draft. Preserva metadata de outros providers.
 */
export function bindLegacyVerifiedSignupAppMetadata(
  user: AuthUserWithMetadata,
  signupRef: string,
): Record<string, unknown> {
  if (!SIGNUP_REFERENCE_PATTERN.test(signupRef)) {
    throw new Error('[signup] invalid verified legacy signup auth reference');
  }
  if (hasSignupAuthBindingMarker(user)) {
    throw new Error('[signup] verified legacy signup auth binding already exists');
  }
  const current = isRecord(user.app_metadata) ? user.app_metadata : {};
  return { ...current, ...createPendingSignupAppMetadata(signupRef) };
}

export function readSignupPasswordState(
  user: AuthUserWithMetadata,
  signupRef: string,
): SignupPasswordState | null {
  if (!SIGNUP_REFERENCE_PATTERN.test(signupRef)) return null;
  const binding = readBinding(user);
  return binding?.signup_ref === signupRef ? binding.password_state : null;
}

export function readPendingSignupReference(user: AuthUserWithMetadata): string | null {
  const binding = readBinding(user);
  return binding?.password_state === 'pending' ? binding.signup_ref : null;
}

/** O callback só aceita a conta passwordless ainda presa à referência emitida. */
export function isPendingSignupUserBound(user: AuthUserWithMetadata, signupRef: string): boolean {
  return readSignupPasswordState(user, signupRef) === 'pending';
}

/** Transição idempotente: depois de `set`, novas chamadas nunca trocam a senha. */
export function markSignupPasswordSet(
  user: AuthUserWithMetadata,
  signupRef: string,
): Record<string, unknown> {
  const passwordState = readSignupPasswordState(user, signupRef);
  if (passwordState !== 'pending' && passwordState !== 'set') {
    throw new Error('[signup] invalid pending signup auth binding');
  }
  const current = isRecord(user.app_metadata) ? user.app_metadata : {};
  return {
    ...current,
    [SIGNUP_BINDING_KEY]: {
      version: SIGNUP_BINDING_VERSION,
      kind: 'self_service',
      signup_ref: signupRef,
      password_state: 'set',
    } satisfies SignupBinding,
  };
}

/**
 * Compatibilidade estrita para quem acabou de provar a senha antiga no login.
 * O chamador precisa confirmar antes que o mesmo user possui um draft verificado;
 * sem essas duas provas este helper não pode ser usado.
 */
export function markPasswordAuthenticatedSignupReady(
  user: AuthUserWithMetadata,
  signupRef: string,
): Record<string, unknown> {
  if (!SIGNUP_REFERENCE_PATTERN.test(signupRef)) {
    throw new Error('[signup] invalid password-authenticated signup reference');
  }
  if (hasSignupAuthBindingMarker(user) && readBinding(user) === null) {
    throw new Error('[signup] malformed signup auth binding');
  }
  const current = isRecord(user.app_metadata) ? user.app_metadata : {};
  return {
    ...current,
    [SIGNUP_BINDING_KEY]: {
      version: SIGNUP_BINDING_VERSION,
      kind: 'self_service',
      signup_ref: signupRef,
      password_state: 'set',
    } satisfies SignupBinding,
  };
}

/** Só deve ser chamada depois de uma prova Auth do e-mail. */
export function rebindPendingSignupAppMetadata(
  user: AuthUserWithMetadata,
  signupRef: string,
): Record<string, unknown> {
  if (!SIGNUP_REFERENCE_PATTERN.test(signupRef) || readPendingSignupReference(user) === null) {
    throw new Error('[signup] invalid pending signup auth rebind');
  }
  const current = isRecord(user.app_metadata) ? user.app_metadata : {};
  const initialPasswordRef = readBinding(user)?.initial_password_ref;
  return {
    ...current,
    [SIGNUP_BINDING_KEY]: {
      version: SIGNUP_BINDING_VERSION,
      kind: 'self_service',
      signup_ref: signupRef,
      password_state: 'pending',
      ...(initialPasswordRef ? { initial_password_ref: initialPasswordRef } : {}),
    } satisfies SignupBinding,
  };
}

/**
 * Prova curta lida no e-mail e digitada na aba original. Ela não entra na URL:
 * possuir apenas o cookie do draft não basta para instalar a senha definitiva.
 */
export function deriveSignupHandoffCode(signupRef: string, attemptEpoch: number): string {
  if (
    !SIGNUP_REFERENCE_PATTERN.test(signupRef) ||
    !Number.isSafeInteger(attemptEpoch) ||
    attemptEpoch <= 0
  ) {
    throw new Error('[signup] invalid signup handoff reference');
  }
  const secret = env.MAGIC_TOKEN_SECRET;
  if (!secret) throw new Error('[signup] handoff secret unavailable');
  const digest = createHmac('sha256', secret)
    .update(`qoro/signup-handoff/v2:${signupRef}:${attemptEpoch}`, 'utf8')
    .digest();
  return (digest.readUInt32BE(0) % 100_000_000).toString().padStart(8, '0');
}

export function verifySignupHandoffCode(
  signupRef: string,
  attemptEpoch: number,
  candidate: string,
): boolean {
  if (!SIGNUP_HANDOFF_CODE_PATTERN.test(candidate)) return false;
  let expected: string;
  try {
    expected = deriveSignupHandoffCode(signupRef, attemptEpoch);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, 'ascii'), Buffer.from(candidate, 'ascii'));
}
