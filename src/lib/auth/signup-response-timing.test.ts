import { describe, expect, it } from 'vitest';

import { signupAccountResponseDelayMs } from './signup-response-timing';

describe('signup response timing', () => {
  it('mantem o piso de tres segundos e limita o jitter', () => {
    expect(signupAccountResponseDelayMs(0, 0)).toBe(3_000);
    expect(signupAccountResponseDelayMs(500, 200)).toBe(2_700);
    expect(signupAccountResponseDelayMs(0, 99_999)).toBe(3_400);
  });

  it('nunca devolve atraso negativo nem aceita tempo/jitter negativos', () => {
    expect(signupAccountResponseDelayMs(4_000, 300)).toBe(0);
    expect(signupAccountResponseDelayMs(-10, -20)).toBe(3_000);
  });
});
