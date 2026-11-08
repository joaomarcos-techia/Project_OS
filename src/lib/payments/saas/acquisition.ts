import 'server-only';

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
