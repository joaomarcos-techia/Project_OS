'use client';

// Error boundary de segmento (C16 + ADR-031): captura no Sentry e oferece
// recuperação no lugar — nunca tela branca.
import * as Sentry from '@sentry/nextjs';
import { CircleAlert } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Textos padrão (UX-010, `docs/otimização_ui_final.md`): dizem o que aconteceu e o
 * que fazer, sem prometer que "a equipe foi notificada" (onde o Sentry está
 * desligado isso não é verdade) e sem o genérico "Algo deu errado".
 */
export const ROUTE_ERROR_TITLE = 'Não conseguimos carregar esta tela agora.';
const DESCRIPTION_WITH_CODE =
  'Pode ser uma instabilidade momentânea. Tente de novo; se continuar, recarregue a página ou informe o código abaixo ao suporte.';
const DESCRIPTION_WITHOUT_CODE =
  'Pode ser uma instabilidade momentânea. Tente de novo; se continuar, recarregue a página.';

export function RouteError({
  error,
  reset,
  title = ROUTE_ERROR_TITLE,
  description,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const text = description ?? (error.digest ? DESCRIPTION_WITH_CODE : DESCRIPTION_WITHOUT_CODE);

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-1.5 px-(--sp-6) py-(--sp-12) text-center"
    >
      <span
        aria-hidden="true"
        className="mb-2.5 grid size-14 place-items-center rounded-(--r-lg) bg-danger-50 text-danger-600 dark:bg-[color-mix(in_oklch,var(--danger-500)_18%,transparent)] dark:text-danger-200"
      >
        <CircleAlert className="size-6" />
      </span>
      <h2 className="text-(length:--fs-h4) font-semibold">{title}</h2>
      <p className="max-w-[44ch] text-(length:--fs-sm) text-fg-muted">{text}</p>
      {error.digest ? (
        <span className="mt-1 font-mono text-(length:--fs-2xs) text-fg-subtle">
          Código para o suporte: {error.digest}
        </span>
      ) : null}
      <div className="mt-3">
        <Button variant="secondary" onClick={() => reset()}>
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
