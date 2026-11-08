import { afterEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  SAAS_SIGNUP_PROVIDER: 'asaas',
  NODE_ENV: 'test',
  VERCEL_ENV: undefined as string | undefined,
  ABACATEPAY_STORE_ID: undefined as string | undefined,
}));
vi.mock('@/lib/env', () => ({ env: config }));
import { deferredSaasSignupEnabled, isAbacatePaySandboxRuntime } from './acquisition';

afterEach(() => {
  config.SAAS_SIGNUP_PROVIDER = 'asaas';
  config.NODE_ENV = 'test';
  config.VERCEL_ENV = undefined;
  config.ABACATEPAY_STORE_ID = undefined;
});

describe('deferred acquisition composition', () => {
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
