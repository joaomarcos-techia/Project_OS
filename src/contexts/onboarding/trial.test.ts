import { describe, expect, it } from 'vitest';

import { QORO_TRIAL_DAYS } from './trial';

describe('onboarding trial', () => {
  it('mantém o trial público alinhado ao site do Qoro', () => {
    expect(QORO_TRIAL_DAYS).toBe(14);
  });
});
