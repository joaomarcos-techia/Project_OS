import { afterEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  SAAS_SIGNUP_PROVIDER: 'asaas',
  NODE_ENV: 'test',
  VERCEL_ENV: undefined as string | undefined,
  ABACATEPAY_STORE_ID: undefined as string | undefined,
  ABACATEPAY_NEW_CHECKOUTS_ENABLED: true,
  ABACATEPAY_CHECKOUT_CLINIC_IDS: undefined as string | undefined,
}));
vi.mock('@/lib/env', () => ({ env: config }));
import {
  deferredSaasSignupEnabled,
  isAbacatePaySandboxRuntime,
  abacatePayCheckoutAllowed,
} from './acquisition';

afterEach(() => {
  config.SAAS_SIGNUP_PROVIDER = 'asaas';
  config.NODE_ENV = 'test';
  config.VERCEL_ENV = undefined;
  config.ABACATEPAY_STORE_ID = undefined;
  config.ABACATEPAY_NEW_CHECKOUTS_ENABLED = true;
  config.ABACATEPAY_CHECKOUT_CLINIC_IDS = undefined;
});

describe('deferred acquisition composition', () => {
  const clinic = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  it('stops new checkouts without stopping existing consumers or deferred trial routing', () => {
    Object.assign(config, {
      SAAS_SIGNUP_PROVIDER: 'abacatepay_sandbox',
      ABACATEPAY_STORE_ID: 'store_fixture',
      ABACATEPAY_NEW_CHECKOUTS_ENABLED: false,
    });
    expect(abacatePayCheckoutAllowed(clinic)).toBe(false);
    expect(isAbacatePaySandboxRuntime()).toBe(true);
    expect(deferredSaasSignupEnabled()).toBe(true);
  });
  it('allows only the explicit clinic cohort', () => {
    Object.assign(config, {
      ABACATEPAY_STORE_ID: 'store_fixture',
      ABACATEPAY_CHECKOUT_CLINIC_IDS: clinic,
    });
    expect(abacatePayCheckoutAllowed(clinic)).toBe(true);
    expect(abacatePayCheckoutAllowed(other)).toBe(false);
  });
  it('normalizes UUID case while refusing duplicate identities', () => {
    const lower = 'a1111111-1111-4111-8111-111111111111';
    Object.assign(config, {
      ABACATEPAY_STORE_ID: 'store_fixture',
      ABACATEPAY_CHECKOUT_CLINIC_IDS: lower.toUpperCase(),
    });
    expect(abacatePayCheckoutAllowed(lower)).toBe(true);
    config.ABACATEPAY_CHECKOUT_CLINIC_IDS = lower + ',' + lower.toUpperCase();
    expect(abacatePayCheckoutAllowed(lower)).toBe(false);
  });
  it.each(['', 'invalid', clinic + ',', clinic + ',' + clinic])(
    'fails closed for a malformed cohort %s',
    (configured) => {
      Object.assign(config, {
        ABACATEPAY_STORE_ID: 'store_fixture',
        ABACATEPAY_CHECKOUT_CLINIC_IDS: configured,
      });
      expect(abacatePayCheckoutAllowed(clinic)).toBe(false);
    },
  );
  it('does not turn a cohort or enabled flag into Production authorization', () => {
    Object.assign(config, {
      VERCEL_ENV: 'production',
      ABACATEPAY_STORE_ID: 'store_fixture',
      ABACATEPAY_CHECKOUT_CLINIC_IDS: clinic,
    });
    expect(abacatePayCheckoutAllowed(clinic)).toBe(false);
  });
  it('does not activate from the presence of an API key or store', () => {
    config.ABACATEPAY_STORE_ID = 'store_synthetic';
    expect(deferredSaasSignupEnabled()).toBe(false);
  });
  it('fails closed with no origin account rather than creating an Asaas obligation', () => {
    config.SAAS_SIGNUP_PROVIDER = 'abacatepay_sandbox';
    expect(deferredSaasSignupEnabled).toThrow('configuration unavailable');
    expect(isAbacatePaySandboxRuntime()).toBe(false);
  });
  it.each([
    ['production', 'production'],
    ['production', undefined],
    ['development', 'production'],
  ])('refuses a production target (%s/%s)', (node, vercel) => {
    Object.assign(config, {
      SAAS_SIGNUP_PROVIDER: 'abacatepay_sandbox',
      ABACATEPAY_STORE_ID: 'store_synthetic',
      NODE_ENV: node,
      VERCEL_ENV: vercel,
    });
    expect(deferredSaasSignupEnabled).toThrow('configuration unavailable');
  });
  it.each([
    ['test', undefined],
    ['development', undefined],
    ['production', 'preview'],
  ])('enables an explicitly configured test target (%s/%s)', (node, vercel) => {
    Object.assign(config, {
      SAAS_SIGNUP_PROVIDER: 'abacatepay_sandbox',
      ABACATEPAY_STORE_ID: 'store_synthetic',
      NODE_ENV: node,
      VERCEL_ENV: vercel,
    });
    expect(deferredSaasSignupEnabled()).toBe(true);
    expect(isAbacatePaySandboxRuntime()).toBe(true);
  });
});
