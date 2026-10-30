'use client';

import { PlayCircle } from 'lucide-react';
import { useState, useTransition } from 'react';

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
 * O tour mora no layout compartilhado, que o App Router pode preservar depois
 * de uma Server Action. Uma navegação completa ao primeiro passo lê o estado
 * confirmado do banco e monta a janela sem depender do cache do layout.
 */
export function RestartTour({ state }: { state: TourState }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Em `in_progress` a janela já está aberta no shell. Não oferecemos uma
  // segunda ação concorrente na página que fica atrás dela.
  if (state === 'in_progress') return null;

  const firstRun = state === 'not_started';

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="secondary"
        loading={pending}
        data-testid="restart-tour"
        className="active:scale-[0.96]"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              const result = await submitOnboardingAction({
                action: firstRun ? 'tour_start' : 'tour_reopen',
              });
              if (result.ok || result.progress?.tourState === 'in_progress') {
                window.location.assign('/dashboard');
                return;
              }
            } catch {
              // A falha de rede fica visível e não navega para um tour que não iniciou.
            }
            setError('Não foi possível abrir o tour. Atualize a página e tente novamente.');
          })
        }
      >
        <PlayCircle aria-hidden="true" className="size-4" />
        {firstRun ? 'Iniciar tour guiado' : 'Refazer tour guiado'}
      </Button>
      {error ? (
        <p role="alert" className="text-(length:--fs-xs) text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
