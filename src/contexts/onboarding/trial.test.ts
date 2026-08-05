import { describe, expect, it } from 'vitest';

import { formatTrialDays, QORO_TRIAL_DAYS } from './trial';

describe('onboarding trial', () => {
  it('centraliza o período exibido e aplicado no onboarding', () => {
    expect(QORO_TRIAL_DAYS).toBe(14);
    expect(formatTrialDays()).toBe('14 dias grátis');
  });
});
