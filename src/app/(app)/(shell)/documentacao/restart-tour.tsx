'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import type { TourState } from '@/contexts/onboarding';

import { submitOnboardingAction } from '../_painel/onboarding-actions';

/**
 * Reabre o tour do produto.
 *
 * Fica na central de ajuda, e não no dashboard, porque o checklist de ativação
 * some quando a clínica termina de se ativar — um botão ali desapareceria junto
 * e o tour ficaria sem porta de volta. Aqui ele está sempre a um clique do menu.
 *
 * O `router.refresh()` é o que faz a janela abrir: quem monta o tour é o layout,
 * então revalidar o servidor entrega o novo estado ao componente que já está
 * montado. Sem isso, seria preciso um store de cliente paralelo à autoridade.
 */
export function RestartTour({ state }: { state: TourState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // `tour_reopen` só sai de estado terminal. Oferecer o botão em `in_progress`
  // prometeria uma ação que o servidor recusaria — o tour já está aberto.
  if (state !== 'completed' && state !== 'skipped') return null;

  return (
    <Button
      type="button"
      variant="secondary"
      loading={pending}
      data-testid="restart-tour"
      onClick={() =>
        startTransition(async () => {
          await submitOnboardingAction({ action: 'tour_reopen' });
          router.refresh();
        })
      }
    >
      Refazer o tour
    </Button>
  );
}
