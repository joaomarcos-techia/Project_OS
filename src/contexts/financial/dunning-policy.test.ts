import { describe, expect, it } from 'vitest';

import { routeDunning } from './dunning-policy';

describe('routeDunning', () => {
  it('mantem D+3 e D+7 automaticos', () => {
    expect(routeDunning(3)).toEqual({ mode: 'automatic', stages: [3] });
    expect(routeDunning(7)).toEqual({ mode: 'automatic', stages: [3, 7] });
  });

  it('encaminha D+15 e casos acima de 30 dias para fila humana', () => {
    expect(routeDunning(15)).toEqual({ mode: 'manual', stage: 'd15_review' });
    expect(routeDunning(31)).toEqual({ mode: 'manual', stage: 'd30_manual' });
    expect(routeDunning(365)).toEqual({ mode: 'manual', stage: 'd30_manual' });
  });
});

