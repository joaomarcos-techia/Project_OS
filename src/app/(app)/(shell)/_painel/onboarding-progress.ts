import 'server-only';

import { cache } from 'react';

import { readOnboardingProgress, type OnboardingProgressState } from '@/contexts/onboarding';
import { getCurrentUser } from '@/lib/auth/tenant-context';

/**
 * Progresso de onboarding da pessoa autenticada, memoizado por request.
 *
 * O layout monta o tour e o dashboard decide se ainda mostra o checklist —
 * dois segmentos, a mesma linha. `cache()` faz disso UMA ida ao banco por
 * navegação, o mesmo mecanismo que `getCurrentUser` já usa.
 *
 * Devolve `null` para quem não tem clínica (super_admin sem impersonate): não
 * existe onboarding de tenant sem tenant, e inventar um estado vazio faria o
 * tour aparecer no lugar errado.
 */
export const currentOnboardingProgress = cache(
  async (): Promise<OnboardingProgressState | null> => {
    const user = await getCurrentUser();
    if (!user?.clinicId) return null;
    return readOnboardingProgress(user.clinicId, user.userId);
  },
);
