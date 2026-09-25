/** Prova curta para reparar claim/binding depois que o OTP ja foi consumido. */
import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';

export const SIGNUP_CONFIRMATION_GRANT_COOKIE = 'qoro_signup_confirm';
export const SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS = 15 * 60;

const VERSION = 'v1';
const SEP = '.';
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SIGNUP_REFERENCE_PATTERN = /^[a-f0-9]{64}$/u;

export interface SignupConfirmationGrant {
  userId: string;
  signupRef: string;
  expiresAt: number;
}

function key(): Buffer {
  const base = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) {
    throw new Error('[auth/signup-confirmation-grant] Supabase admin key ausente.');
  }
  return createHmac('sha256', base).update('qoro/signup-confirmation-grant/v1').digest();
}

function mac(payload: string): string {
  return createHmac('sha256', key()).update(payload).digest('hex');
}

/** O valor assinado fica em cookie HttpOnly; referencia e user id nao vao para a URL. */
export function signSignupConfirmationGrant(grant: SignupConfirmationGrant): string {
  if (
    !USER_ID_PATTERN.test(grant.userId) ||
    !SIGNUP_REFERENCE_PATTERN.test(grant.signupRef) ||
    !Number.isInteger(grant.expiresAt)
  ) {
    throw new Error('[auth/signup-confirmation-grant] invalid grant');
  }
  const payload = [VERSION, grant.userId, grant.signupRef, String(grant.expiresAt)].join(SEP);
  return `${payload}${SEP}${mac(payload)}`;
}

export function readSignupConfirmationGrant(
  value: string | undefined,
  now: number = Date.now(),
): SignupConfirmationGrant | null {
  if (!value) return null;
  const idx = value.lastIndexOf(SEP);
  if (idx <= 0) return null;
  const payload = value.slice(0, idx);
  const signature = value.slice(idx + 1);
  const expected = mac(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  const [version, userId, signupRef, expiresRaw, ...rest] = payload.split(SEP);
  const expiresAt = Number(expiresRaw);
  if (
    rest.length > 0 ||
    version !== VERSION ||
    !userId ||
    !USER_ID_PATTERN.test(userId) ||
    !signupRef ||
    !SIGNUP_REFERENCE_PATTERN.test(signupRef) ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= now
  ) {
    return null;
  }
  return { userId, signupRef, expiresAt };
}
