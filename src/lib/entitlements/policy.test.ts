import { describe, expect, it } from 'vitest';
import {
  evaluateModuleAccess,
  type CommercialSubscription,
  type OperationalModule,
} from './policy';

const now = new Date('2026-11-11T12:00:00Z');
const paid: CommercialSubscription = {
  clinic_status: 'active',
  billing_status: 'active',
  plan_code: 'clinica_2026_2',
  period_start: new Date('2026-11-01T12:00:00Z'),
  period_end: new Date('2026-12-01T12:00:00Z'),
  enrolled: true,
  verified_release: true,
  grace_until: null,
  cancel_at_period_end: false,
};
describe('commercial operational entitlements', () => {
  it.each(['patient_payments', 'ai_agents', 'health_insurance'] as const)(
    'denies %s throughout trial, including its last and expired days',
    (module) => {
      for (const day of [0, 13, 14, 15]) {
        const clock = new Date(now.getTime() + day * 86400000);
        expect(
          evaluateModuleAccess(
            { ...paid, billing_status: 'trial', verified_release: false },
            module,
            clock,
          ),
        ).toEqual({ allowed: false, reason: 'payment_required' });
      }
    },
  );
  it.each(['patient_payments', 'ai_agents'] as const)('allows verified paid %s', (module) => {
    expect(evaluateModuleAccess(paid, module, now)).toEqual({ allowed: true });
    expect(evaluateModuleAccess({ ...paid, verified_release: false }, module, now).allowed).toBe(
      false,
    );
  });
  it('preserves existing paid-contract grace without inventing a paid period', () => {
    const overdue = {
      ...paid,
      billing_status: 'past_due',
      period_end: now,
      grace_until: new Date(now.getTime() + 1000),
    };
    expect(evaluateModuleAccess(overdue, 'ai_agents', now).allowed).toBe(true);
    expect(evaluateModuleAccess({ ...overdue, grace_until: now }, 'ai_agents', now).allowed).toBe(
      false,
    );
    expect(
      evaluateModuleAccess({ ...overdue, cancel_at_period_end: true }, 'ai_agents', now).allowed,
    ).toBe(false);
    expect(overdue.period_end).toBe(now);
  });
  it('never releases unapproved TISS from payment alone', () => {
    expect(evaluateModuleAccess(paid, 'health_insurance', now)).toEqual({
      allowed: false,
      reason: 'module_unavailable',
    });
  });
  it.each(['trial', 'cancelled', 'pending'])('denies subscription state %s', (billing_status) => {
    expect(evaluateModuleAccess({ ...paid, billing_status }, 'ai_agents', now).allowed).toBe(false);
  });
  it.each(['suspended', 'suspended_readonly', 'cancelled', 'pending_payment', 'trial'])(
    'denies clinic state %s',
    (clinic_status) => {
      expect(
        evaluateModuleAccess({ ...paid, clinic_status }, 'patient_payments', now).allowed,
      ).toBe(false);
    },
  );
  it('denies missing contracts, unknown plans and invalid or ended periods', () => {
    expect(evaluateModuleAccess(null, 'ai_agents', now).allowed).toBe(false);
    for (const change of [
      { billing_status: null },
      { plan_code: 'unknown' },
      { period_end: now },
      { period_start: new Date(now.getTime() + 1) },
      { period_end: null },
    ])
      expect(evaluateModuleAccess({ ...paid, ...change }, 'ai_agents', now).allowed).toBe(false);
    expect(evaluateModuleAccess(paid, 'ai_agents', new Date('invalid')).allowed).toBe(false);
  });
  it('preserves authoritative active legacy contracts without retroactive enrollment', () => {
    for (const plan_code of ['solo', 'clinica', 'pro']) {
      const legacy = {
        ...paid,
        enrolled: false,
        verified_release: false,
        period_start: null,
        period_end: null,
        plan_code,
      };
      expect(evaluateModuleAccess(legacy, 'ai_agents', now).allowed).toBe(true);
      expect(
        evaluateModuleAccess({ ...legacy, billing_status: 'trial' }, 'ai_agents', now).allowed,
      ).toBe(false);
    }
  });
  it.each(['patient_payments', 'ai_agents'] satisfies OperationalModule[])(
    'a trial-to-paid transition changes %s only after the verified release',
    (module) => {
      expect(evaluateModuleAccess({ ...paid, billing_status: 'trial' }, module, now).allowed).toBe(
        false,
      );
      expect(evaluateModuleAccess({ ...paid, verified_release: false }, module, now).allowed).toBe(
        false,
      );
      expect(evaluateModuleAccess(paid, module, now).allowed).toBe(true);
    },
  );
});
