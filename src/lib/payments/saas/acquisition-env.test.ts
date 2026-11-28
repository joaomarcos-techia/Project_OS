import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('real environment parsing for the acquisition cohort', () => {
  it.each([undefined, '', 'invalid'])(
    'distinguishes an omitted cohort from invalid configuration %s',
    async (configured) => {
      vi.stubEnv('ABACATEPAY_STORE_ID', 'store_synthetic');
      vi.stubEnv('ABACATEPAY_CHECKOUT_CLINIC_IDS', configured);
      vi.stubEnv('ABACATEPAY_NEW_CHECKOUTS_ENABLED', undefined);
      vi.stubEnv('VERCEL_ENV', undefined);
      const { env } = await import('@/lib/env');
      const { abacatePayCheckoutAllowed } = await import('./acquisition');
      expect(env.ABACATEPAY_CHECKOUT_CLINIC_IDS).toBe(configured);
      expect(abacatePayCheckoutAllowed('11111111-1111-4111-8111-111111111111')).toBe(
        configured === undefined,
      );
    },
  );
});
