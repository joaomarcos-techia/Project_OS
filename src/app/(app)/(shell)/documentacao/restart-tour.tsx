'use client';

import { PlayCircle } from 'lucide-react';
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

  // Em `in_progress` a janela já está aberta no shell. Não oferecemos uma
  // segunda ação concorrente na página que fica atrás dela.
  if (state === 'in_progress') return null;

  const firstRun = state === 'not_started';

  return (
    <Button
      type="button"
      variant="secondary"
      loading={pending}
      data-testid="restart-tour"
      className="active:scale-[0.96]"
      onClick={() =>
        startTransition(async () => {
          await submitOnboardingAction({ action: firstRun ? 'tour_start' : 'tour_reopen' });
          router.refresh();
        })
      }
    >
      <PlayCircle aria-hidden="true" className="size-4" />
      {firstRun ? 'Iniciar tour guiado' : 'Refazer tour guiado'}
    </Button>
  );
}
