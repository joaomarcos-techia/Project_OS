import { describe, expect, it } from 'vitest';

import { EMPTY_STEP_STATE, advanceStep, parseStepState } from './step-state';

describe('onboarding step-state', () => {
  it('parseStepState: fallback seguro p/ null/lixo/inválido', () => {
    expect(parseStepState(null)).toEqual(EMPTY_STEP_STATE);
    expect(parseStepState('not-json')).toEqual(EMPTY_STEP_STATE);
    expect(parseStepState({ currentStep: 'desconhecido' })).toEqual(EMPTY_STEP_STATE);
  });

  it('parseStepState: aceita estado válido', () => {
    const s = { currentStep: 'owner' as const, completed: ['clinic' as const] };
    expect(parseStepState(s)).toMatchObject(s);
  });

  it('advanceStep: idempotente em completed + avança currentStep', () => {
    let s = EMPTY_STEP_STATE;
    s = advanceStep(s, 'clinic', 'owner');
    expect(s.currentStep).toBe('owner');
    expect(s.completed).toEqual(['clinic']);

    // re-marcar o mesmo passo não duplica
    s = advanceStep(s, 'clinic', 'owner');
    expect(s.completed).toEqual(['clinic']);

    s = advanceStep(s, 'owner', 'plan');
    expect(s.completed).toEqual(['clinic', 'owner']);
    expect(s.currentStep).toBe('plan');
  });
});
