import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const config = vi.hoisted(() => ({ enabled: true, runtime: true }));
vi.mock('@/lib/env', () => ({
  env: {
    get ABACATEPAY_PILOT_PROVISIONING_ENABLED() {
      return config.enabled;
    },
  },
}));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/lib/auth/email-hash', () => ({
  hashEmail: (v: string) => (v === 'owner@example.test' ? 'a'.repeat(64) : 'b'.repeat(64)),
}));
vi.mock('@/lib/payments/saas/acquisition', () => ({ isAbacatePayRuntime: () => config.runtime }));
import {
  assertLivePilot,
  parsePilot,
  pilotIdentityCondition,
  pilotIdentitySchema,
  pilotMetadataSchema,
  pilotPriceSchema,
  PILOT_KIND,
} from './signup-pilot-repository';

const id = '11111111-1111-4111-8111-111111111111';
const price = {
  planId: id,
  priceId: id,
  code: 'consultorio_2026',
  amountMinor: 19700,
  currency: 'BRL',
  cycle: 'monthly',
};
function grant() {
  return {
    id,
    tokenHash: 'f'.repeat(64),
    status: 'pending',
    version: 0,
    email: 'owner@example.test',
    createdBy: id,
    planSnapshot: price,
    expiresAt: new Date(Date.now() + 60_000),
    startedAt: null,
    completedAt: null,
    provisionedClinicId: null,
    stepState: null,
    metadata: {
      kind: PILOT_KIND,
      ownerName: 'Synthetic owner',
      clinicName: 'Synthetic clinic',
      emailHash: 'a'.repeat(64),
      signupRef: null,
      authUserId: null,
    },
    createdAt: new Date(),
  };
}
beforeEach(() => {
  config.enabled = true;
  config.runtime = true;
});
describe('restricted pilot contracts', () => {
  it('accepts only the catalogued monthly one-doctor product', () =>
    expect(pilotPriceSchema.parse(price)).toEqual(price));
  it.each([
    { ...price, amountMinor: 0 },
    { ...price, amountMinor: 39700 },
    { ...price, cycle: 'annual' },
    { ...price, code: 'clinica_2026_2' },
    { ...price, extra: true },
  ])('rejects altered commercial terms %#', (value) =>
    expect(pilotPriceSchema.safeParse(value).success).toBe(false),
  );
  it('normalizes the indicated address without accepting extra identity fields', () => {
    expect(
      pilotIdentitySchema.parse({
        ownerName: ' Owner ',
        clinicName: ' Clinic ',
        email: 'Owner@example.test',
      }).email,
    ).toBe('owner@example.test');
    expect(
      pilotIdentitySchema.safeParse({
        ownerName: 'Owner',
        clinicName: 'Clinic',
        email: 'owner@example.test',
        role: 'super_admin',
      }).success,
    ).toBe(false);
  });
  it('requires a complete server-owned binding', () => {
    expect(
      pilotMetadataSchema.safeParse({ ...grant().metadata, signupRef: 'forged' }).success,
    ).toBe(false);
    expect(parsePilot(grant()).price.amountMinor).toBe(19700);
    expect(() => parsePilot({ ...grant(), email: 'other@example.test' })).toThrow('invalid');
  });
  it('fails closed without the independent admission gate', () => {
    config.enabled = false;
    expect(() => assertLivePilot(parsePilot(grant()))).toThrow('unavailable');
  });
  it('fails closed outside the selected runtime', () => {
    config.runtime = false;
    expect(() => assertLivePilot(parsePilot(grant()))).toThrow('unavailable');
  });
  it.each(['cancelled', 'completed', 'expired'])('refuses admission in %s', (status) =>
    expect(() => assertLivePilot(parsePilot({ ...grant(), status }))).toThrow('forbidden'),
  );
  it('refuses expired invitations', () =>
    expect(() => assertLivePilot(parsePilot({ ...grant(), expiresAt: new Date(0) }))).toThrow(
      'expired',
    ));
  it('pins email, names, expiry and state in the actual SQL mutation predicate', () => {
    const q = new PgDialect().sqlToQuery(
      pilotIdentityCondition('c'.repeat(64), {
        email: 'owner@example.test',
        ownerName: 'Synthetic owner',
        clinicName: 'Synthetic clinic',
      }),
    );
    expect(q.sql).toContain('NOT EXISTS');
    expect(q.sql).toContain('IS DISTINCT FROM');
    expect(q.sql).toContain('expires_at<=now()');
    expect(q.params).toContain('a'.repeat(64));
    expect(q.params).toContain('Synthetic owner');
    expect(q.params).toContain('Synthetic clinic');
    expect(q.params).not.toContain('owner@example.test');
  });
});
