import 'server-only';

import { z } from 'zod';
import { env } from '@/lib/env';

/** Explicit acquisition selection. Existing obligations keep their persisted origin. */
export function deferredSaasSignupEnabled(): boolean {
  if (
    env.SAAS_SIGNUP_PROVIDER !== 'abacatepay_sandbox' &&
    env.SAAS_SIGNUP_PROVIDER !== 'abacatepay_production'
  )
    return false;
  if (
    (env.SAAS_SIGNUP_PROVIDER === 'abacatepay_sandbox' && abacatePayEnvironment() !== 'sandbox') ||
    (env.SAAS_SIGNUP_PROVIDER === 'abacatepay_production' &&
      abacatePayEnvironment() !== 'production')
  )
    throw new Error('Deferred SaaS signup configuration unavailable');
  assertAbacatePayRuntime();
  return true;
}

/** Existing bindings remain readable when acquisition is stopped. */
export function isAbacatePaySandboxRuntime(): boolean {
  return (
    env.VERCEL_ENV !== 'production' &&
    env.ABACATEPAY_ENVIRONMENT !== 'production' &&
    (env.NODE_ENV !== 'production' || env.VERCEL_ENV === 'preview') &&
    Boolean(env.ABACATEPAY_STORE_ID)
  );
}

/** Live requires an explicit environment and the actual Production runtime.
 * Neither a key nor an acquisition flag can select a different account mode.
 * Consumers intentionally remain available when new acquisition is paused.
 */
export function abacatePayEnvironment(): 'sandbox' | 'production' {
  if (
    env.ABACATEPAY_ENVIRONMENT === 'production' &&
    env.VERCEL_ENV === 'production' &&
    env.NODE_ENV === 'production' &&
    env.ABACATEPAY_STORE_ID
  )
    return 'production';
  if (isAbacatePaySandboxRuntime()) return 'sandbox';
  throw new Error('Deferred SaaS signup configuration unavailable');
}

export function isAbacatePayRuntime(): boolean {
  try {
    abacatePayEnvironment();
    return true;
  } catch {
    return false;
  }
}

export function assertAbacatePayRuntime(): void {
  abacatePayEnvironment();
}

export function abacatePayPlanProducts(): string | undefined {
  return abacatePayEnvironment() === 'production'
    ? env.ABACATEPAY_PLAN_PRODUCTS
    : env.ABACATEPAY_SANDBOX_PLAN_PRODUCTS;
}

/** Reuse an approved live catalog product for mode attestation; no test product in live. */
export function abacatePayProbeProductId(): string | undefined {
  if (abacatePayEnvironment() === 'sandbox') return env.ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID;
  try {
    return z
      .object({ consultorio_2026: z.string().regex(/^prod_[A-Za-z0-9_-]+$/) })
      .parse(JSON.parse(env.ABACATEPAY_PLAN_PRODUCTS ?? '{}')).consultorio_2026;
  } catch {
    throw new Error('Deferred SaaS signup configuration unavailable');
  }
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
    !isAbacatePayRuntime() ||
    env.ABACATEPAY_NEW_CHECKOUTS_ENABLED === false
  )
    return false;
  const configured = env.ABACATEPAY_CHECKOUT_CLINIC_IDS;
  if (
    abacatePayEnvironment() === 'production' &&
    (env.ABACATEPAY_NEW_CHECKOUTS_ENABLED !== true || configured === undefined)
  )
    return false;
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
