import { describe, expect, it } from 'vitest';

import {
  createOnboardingInvitePath,
  isOnboardingInviteToken,
  readOnboardingInviteToken,
} from './onboarding-invite-fragment';

const TOKEN = 'a'.repeat(43);

describe('onboarding invite fragment', () => {
  it('constrói e lê o formato canônico sem segredo no path ou query', () => {
    expect(createOnboardingInvitePath(TOKEN)).toBe(`/join#invite=${TOKEN}`);
    expect(readOnboardingInviteToken(`#invite=${TOKEN}`)).toBe(TOKEN);
  });

  it.each([
    ['', 'vazio'],
    ['short', 'curto'],
    [`#invite=${TOKEN}&next=/dashboard`, 'parâmetro adicional'],
    [`#token=${TOKEN}`, 'nome de parâmetro diferente'],
    [`#invite=${TOKEN.slice(0, -1)}!`, 'caractere inválido'],
  ])('rejeita token ou fragmento %s (%s)', (value, _reason) => {
    expect(isOnboardingInviteToken(value)).toBe(false);
    expect(readOnboardingInviteToken(value)).toBeNull();
  });
});
