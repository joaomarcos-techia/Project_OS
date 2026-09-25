/** Grant one-time emitido apenas depois de `verifyOtp(type: 'recovery')`. */
import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';

export const RECOVERY_GRANT_COOKIE = 'qoro_rcv';
export const RECOVERY_GRANT_TTL_SECONDS = 15 * 60;

const VERSION = 'v2';
const SEP = '.';
const SIGNUP_REFERENCE_PATTERN = /^[a-f0-9]{64}$/u;

function key(): Buffer {
  const base = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) {
    throw new Error('[auth/recovery-grant] SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY ausente.');
  }
  return createHmac('sha256', base).update('qoro/recovery-grant/v2').digest();
}

function mac(payload: string): string {
  return createHmac('sha256', key()).update(payload).digest('hex');
}

interface RecoveryGrantBase {
  userId: string;
  /** Epoch autoritativo no instante da emissao. */
  epoch: number;
  /** Epoch ms de expiracao. */
  expiresAt: number;
}

export interface ProfileRecoveryGrant extends RecoveryGrantBase {
  kind: 'profile';
}

export interface PreTenantRecoveryGrant extends RecoveryGrantBase {
  kind: 'pretenant';
  signupRef: string;
}

/** Conta pré-tenant pronta cujo draft expirou; o epoch vem de Auth.updated_at. */
export interface OrphanPreTenantRecoveryGrant extends RecoveryGrantBase {
  kind: 'pretenant_orphan';
  signupRef: string;
}

export type RecoveryGrant =
  | ProfileRecoveryGrant
  | PreTenantRecoveryGrant
  | OrphanPreTenantRecoveryGrant;

/** Serializa e assina. O valor vai em cookie HttpOnly, nunca no DOM ou URL. */
export function signRecoveryGrant(grant: RecoveryGrant): string {
  if (
    !grant.userId ||
    !Number.isInteger(grant.epoch) ||
    grant.epoch < 0 ||
    !Number.isInteger(grant.expiresAt)
  ) {
    throw new Error('[auth/recovery-grant] invalid recovery grant');
  }
  if (grant.kind !== 'profile' && !SIGNUP_REFERENCE_PATTERN.test(grant.signupRef)) {
    throw new Error('[auth/recovery-grant] invalid signup reference');
  }

  const payload =
    grant.kind === 'profile'
      ? [VERSION, grant.kind, grant.userId, String(grant.epoch), String(grant.expiresAt)].join(SEP)
      : [
          VERSION,
          grant.kind,
          grant.userId,
          String(grant.epoch),
          grant.signupRef,
          String(grant.expiresAt),
        ].join(SEP);
  return `${payload}${SEP}${mac(payload)}`;
}

/** Verifica assinatura e prazo; o consumidor valida o epoch autoritativo. */
export function readRecoveryGrant(
  value: string | undefined,
  now: number = Date.now(),
): RecoveryGrant | null {
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

  const parts = payload.split(SEP);
  const [version, kind, userId, epochRaw] = parts;
  if (version !== VERSION || !userId || !epochRaw) return null;

  const expiresRaw = kind === 'profile' ? parts[4] : parts[5];
  if (
    (kind === 'profile' && parts.length !== 5) ||
    ((kind === 'pretenant' || kind === 'pretenant_orphan') && parts.length !== 6) ||
    !expiresRaw
  ) {
    return null;
  }

  const epoch = Number(epochRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(epoch) || epoch < 0 || !Number.isInteger(expiresAt) || expiresAt <= now) {
    return null;
  }

  if (kind === 'profile') return { kind, userId, epoch, expiresAt };
  if (kind !== 'pretenant' && kind !== 'pretenant_orphan') return null;
  const signupRef = parts[4];
  if (!signupRef || !SIGNUP_REFERENCE_PATTERN.test(signupRef)) return null;
  return { kind, userId, epoch, signupRef, expiresAt };
}
