/**
 * Formato compartilhado do convite pré-clínica. O token fica no fragmento da
 * URL: navegadores nunca o enviam na requisição inicial, nem em Referer.
 */
const ONBOARDING_INVITE_TOKEN = /^[A-Za-z0-9_-]{32,512}$/;

export function isOnboardingInviteToken(value: string): boolean {
  return ONBOARDING_INVITE_TOKEN.test(value);
}

export function createOnboardingInvitePath(rawToken: string): string {
  if (!isOnboardingInviteToken(rawToken)) {
    throw new Error('[onboarding-invite] token is invalid');
  }
  return `/join#invite=${rawToken}`;
}

/** Lê somente o formato canônico `#invite=<token>`; não aceita parâmetros extras. */
export function readOnboardingInviteToken(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  if (params.size !== 1) return null;

  const rawToken = params.get('invite');
  return rawToken && isOnboardingInviteToken(rawToken) ? rawToken : null;
}
