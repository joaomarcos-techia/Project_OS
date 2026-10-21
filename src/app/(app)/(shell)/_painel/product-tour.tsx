'use client';

import { useCallback, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
// Somente TIPOS vêm do contexto: o barril público reexporta módulos
// `server-only` (checkout, provisionamento), e um import de VALOR aqui
// arrastaria tudo isso para o bundle do cliente — o build quebra, e com razão.
// Os passos chegam como prop, renderizados pelo servidor que já os conhece.
import type { OnboardingAction, OnboardingProgressState, TourStep } from '@/contexts/onboarding';

import { fetchOnboardingProgress, submitOnboardingAction } from './onboarding-actions';

/**
 * O-7 — tour do produto. Mora no shell, então sobrevive à troca de rota: mudar
 * de tela NÃO mata o fluxo, que era o requisito mais fácil de quebrar montando
 * o tour dentro de uma página.
 *
 * A AUTORIDADE É O SERVIDOR, e por isso não existe um `open` independente: a
 * janela abre somente no estado persistido `in_progress`. O primeiro login fica
 * livre de interrupção; quem iniciar o tour pela Ajuda pode retomá-lo depois de
 * um refresh, em outra aba ou em outro navegador.
 *
 * FECHAR É PULAR. Não são dois estados: se fechar deixasse `in_progress`, ou o
 * tour reabriria na próxima navegação (e fechar não significaria nada), ou não
 * reabriria nunca (e o refresh perderia o fluxo). Pular preserva o passo, então
 * quem reabrir pelo dashboard volta de onde parou.
 */
export function ProductTour({
  initial,
  steps,
}: {
  initial: OnboardingProgressState;
  steps: readonly TourStep[];
}) {
  const [progress, setProgress] = useState(initial);
  const [closing, setClosing] = useState(false);
  const [dismissError, setDismissError] = useState(false);
  const [seenVersion, setSeenVersion] = useState(initial.rowVersion);
  const [pending, startTransition] = useTransition();

  // Props novas chegam quando o dashboard reabre o tour e revalida o layout.
  // Adotá-las durante o render (padrão de estado derivado do React) é o que faz
  // o botão "Retomar" de OUTRA tela abrir esta janela sem um store paralelo.
  if (initial.rowVersion !== seenVersion) {
    setSeenVersion(initial.rowVersion);
    setProgress(initial);
    setClosing(false);
    setDismissError(false);
  }

  const send = useCallback((input: OnboardingAction) => {
    startTransition(async () => {
      const result = await submitOnboardingAction(input);
      if (result.ok || result.progress) {
        // `stale` (outra aba andou primeiro) chega com o estado real: adotá-lo é
        // a recuperação, e insistir no palpite local seria o bug.
        setProgress(result.progress ?? progressFallback);
        return;
      }
      const fresh = await fetchOnboardingProgress();
      if (fresh.ok) setProgress(fresh.progress);
    });
  }, []);

  const lastStep = steps.length - 1;
  const step = Math.min(progress.tourStep, lastStep);
  const current = steps[step];
  if (!current) return null;

  // `shouldAutoOpenTour` é a MESMA regra do servidor (`in_progress`);
  // recalculá-la aqui abriria espaço para as duas versões divergirem.
  const open = progress.shouldAutoOpenTour && !closing;
  const isLast = step >= lastStep;

  /** X, Esc e clique no scrim só fecham após o servidor persistir "pular". */
  const dismiss = () => {
    if (pending) return;
    setDismissError(false);
    startTransition(async () => {
      try {
        const result = await submitOnboardingAction({ action: 'tour_skip' });
        const persisted = result.progress;
        if (persisted) {
          setProgress(persisted);
          if (persisted.tourState === 'skipped' || persisted.tourState === 'completed') {
            setClosing(true);
            return;
          }
        }
        const fresh = await fetchOnboardingProgress();
        if (fresh.ok) {
          setProgress(fresh.progress);
          if (fresh.progress.tourState === 'skipped' || fresh.progress.tourState === 'completed') {
            setClosing(true);
            return;
          }
        }
      } catch {
        // A janela permanece aberta e mostra a falha, sem fingir que salvou.
      }
      setDismissError(true);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) dismiss();
      }}
    >
      <DialogContent aria-describedby={undefined} data-testid="product-tour">
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>
            Passo {step + 1} de {steps.length}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-pretty text-(length:--fs-sm) text-fg-muted">{current.body}</p>
          {dismissError ? (
            <p role="alert" className="text-(length:--fs-xs) text-danger-600">
              Não foi possível fechar o tour. Tente novamente.
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            disabled={pending}
            data-testid="tour-skip"
            onClick={dismiss}
          >
            Pular
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={pending || step === 0}
            data-testid="tour-previous"
            onClick={() => send({ action: 'tour_previous', fromStep: step })}
          >
            Voltar
          </Button>
          {isLast ? (
            <Button
              type="button"
              loading={pending}
              data-testid="tour-complete"
              onClick={() => {
                setClosing(true);
                send({ action: 'tour_complete' });
              }}
            >
              Concluir
            </Button>
          ) : (
            <Button
              type="button"
              loading={pending}
              data-testid="tour-next"
              onClick={() => send({ action: 'tour_next', fromStep: step })}
            >
              Próximo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Só alcançável se o servidor recusar sem devolver estado — hoje `invalid`, que
 * a UI não consegue produzir porque as ações saem daqui tipadas. Manter o tour
 * aberto no passo 0 é a degradação certa: nada foi concluído.
 */
const progressFallback: OnboardingProgressState = {
  tourState: 'not_started',
  tourStep: 0,
  tourFinishedAt: null,
  docsVisitedAt: null,
  checklistDismissedAt: null,
  rowVersion: 0,
  shouldAutoOpenTour: false,
};
