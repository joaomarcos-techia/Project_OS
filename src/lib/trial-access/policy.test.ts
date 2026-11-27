import { describe, expect, it } from 'vitest';

import { TRIAL_RESOURCE_LIMITS, TrialAccessError, trialAccessErrorFrom } from './policy';

describe('evaluation restrictions', () => {
  it('uses only the founder-approved quotas', () => {
    expect(TRIAL_RESOURCE_LIMITS.patients.limit).toBe(10);
    for (const [metric, value] of Object.entries(TRIAL_RESOURCE_LIMITS)) {
      if (metric !== 'patients') expect(value.limit).toBe(15);
    }
    expect(Object.keys(TRIAL_RESOURCE_LIMITS)).toHaveLength(9);
  });
  for (const metric of Object.keys(TRIAL_RESOURCE_LIMITS)) {
    it(`translates only the PostgreSQL constraint for ${metric}`, () => {
      const error = trialAccessErrorFrom(
        new Error('private SQL', {
          cause: {
            code: '23514',
            constraint_name: `qoro_trial_limit_${metric}`,
            message: 'private query',
          },
        }),
      );
      expect(error).toBeInstanceOf(TrialAccessError);
      expect(error?.restriction).toBe(metric);
      expect(error?.message).toContain('pagamento');
      expect(error?.message).not.toContain('private');
    });
  }
  for (const feature of ['whatsapp', 'asaas', 'team_invites', 'expired'] as const) {
    it(`identifies ${feature} without trusting exception text`, () => {
      const error = trialAccessErrorFrom({
        code: '23514',
        constraint_name: `qoro_trial_limit_${feature}`,
      });
      expect(error?.restriction).toBe(feature);
    });
  }
  it('does not disguise unrelated errors, fake messages or recursive causes', () => {
    expect(
      trialAccessErrorFrom({ code: '23505', constraint_name: 'qoro_trial_limit_patients' }),
    ).toBeNull();
    expect(trialAccessErrorFrom(new Error('qoro_trial_limit_patients'))).toBeNull();
    expect(
      trialAccessErrorFrom({ code: '23514', constraint_name: 'another_constraint' }),
    ).toBeNull();
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(trialAccessErrorFrom(cyclic)).toBeNull();
  });
});
