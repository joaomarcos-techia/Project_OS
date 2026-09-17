import { describe, expect, it } from 'vitest';

import { formatTrialDays, QORO_SELF_SERVICE_TRIAL_DAYS, QORO_TRIAL_DAYS } from './trial';

describe('onboarding trial', () => {
  it('centraliza o período exibido e aplicado no onboarding', () => {
    expect(QORO_TRIAL_DAYS).toBe(14);
    expect(formatTrialDays()).toBe('14 dias grátis');
  });

  it('mantém o trial autônomo separado do convite', () => {
    expect(QORO_SELF_SERVICE_TRIAL_DAYS).toBe(7);
    expect(formatTrialDays(QORO_SELF_SERVICE_TRIAL_DAYS)).toBe('7 dias grátis');
  });
});
