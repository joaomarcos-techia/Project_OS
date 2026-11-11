import 'server-only';

import { z } from 'zod';
import { env } from '@/lib/env';

/** Explicit test-only composition. Missing configuration never falls back to Asaas. */
export function deferredSaasSignupEnabled(): boolean {
  if (env.SAAS_SIGNUP_PROVIDER !== 'abacatepay_sandbox') return false;
  assertAbacatePaySandboxRuntime();
  return true;
}

/** Existing bindings remain readable when acquisition is stopped. */
export function isAbacatePaySandboxRuntime(): boolean {
  return (
    env.VERCEL_ENV !== 'production' &&
    (env.NODE_ENV !== 'production' || env.VERCEL_ENV === 'preview') &&
    Boolean(env.ABACATEPAY_STORE_ID)
  );
}

export function assertAbacatePaySandboxRuntime(): void {
  if (!isAbacatePaySandboxRuntime()) {
    throw new Error('Deferred SaaS signup configuration unavailable');
  }
}

/** Stops only NEW financial obligations. Existing consumers keep their bindings. */
export function abacatePayCheckoutAllowed(clinicId: string): boolean {
  if (
    !z.uuid().safeParse(clinicId).success ||
    !isAbacatePaySandboxRuntime() ||
    env.ABACATEPAY_NEW_CHECKOUTS_ENABLED === false
  )
    return false;
  const configured = env.ABACATEPAY_CHECKOUT_CLINIC_IDS;
  // Unset preserves the existing Sandbox cohort; it does not enable Production.
  if (configured === undefined) return true;
  const parsed = z
    .array(z.uuid())
    .min(1)
    .max(100)
    .safeParse(configured.split(',').map((v) => v.trim().toLowerCase()));
  return (
    parsed.success &&
    new Set(parsed.data).size === parsed.data.length &&
    parsed.data.includes(clinicId.toLowerCase())
  );
}
