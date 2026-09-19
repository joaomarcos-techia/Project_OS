import 'server-only';

import { cache } from 'react';

import { readOnboardingProgress, type OnboardingProgressState } from '@/contexts/onboarding';
import { getCurrentUser } from '@/lib/auth/tenant-context';
import { captureBackgroundError } from '@/lib/observability/capture';

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
 *
 * ===================================================================
 * POR QUE A LEITURA DEGRADA EM VEZ DE PROPAGAR
 * ===================================================================
 * Esta função é chamada pelo LAYOUT do shell — o caminho por onde passa toda
 * página autenticada. Uma falha aqui derrubava agenda, consultório, caixa e
 * dashboard de uma vez, por causa de um tour.
 *
 * Aconteceu de verdade, em 19/09/2026: o Preview respondeu `500 em /dashboard`
 * porque o banco por trás dele ainda não tinha a migration 0104. O `e2e/
 * onboarding-o7.spec.ts` pegou na primeira execução. O erro de schema era real
 * e continua sendo — o que estava errado era o RAIO: uma tabela não-lançada
 * virou dependência dura de todo tenant já existente.
 *
 * A troca aceita: sem o progresso, o shell renderiza sem o tour e o dashboard
 * mostra o checklist normalmente (ele é derivado de outra fonte). Perde-se um
 * enfeite; não se perde o produto.
 *
 * NÃO é silêncio. `captureBackgroundError` leva a falha para a observabilidade,
 * porque "o banco não tem a tabela" é exatamente o que alguém precisa ver — só
 * não às custas de um 500 para quem só queria abrir a agenda.
 */
export const currentOnboardingProgress = cache(
  async (): Promise<OnboardingProgressState | null> => {
    const user = await getCurrentUser();
    if (!user?.clinicId) return null;
    try {
      return await readOnboardingProgress(user.clinicId, user.userId);
    } catch (error) {
      captureBackgroundError(error, {
        flow: 'onboarding.progress.read',
        clinicId: user.clinicId,
      });
      return null;
    }
  },
);
