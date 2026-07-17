'use client';

// Error boundary de segmento (C16 + ADR-031): captura no Sentry e oferece
// recuperação no lugar — nunca tela branca.
import * as Sentry from '@sentry/nextjs';
import { CircleAlert } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export function RouteError({
  error,
  reset,
  title = 'Algo deu errado.',
  description = 'O erro foi registrado e a equipe foi notificada. Tente novamente — se persistir, recarregue a página.',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-1.5 px-(--sp-6) py-(--sp-12) text-center">
      <span
        aria-hidden="true"
        className="mb-2.5 grid size-14 place-items-center rounded-(--r-lg) bg-danger-50 text-danger-600 dark:bg-[color-mix(in_oklch,var(--danger-500)_18%,transparent)] dark:text-danger-200"
      >
        <CircleAlert className="size-6" />
      </span>
      <b className="text-(length:--fs-h4) font-semibold">{title}</b>
      <p className="max-w-[44ch] text-(length:--fs-sm) text-fg-muted">{description}</p>
      {error.digest ? (
        <span className="mt-1 font-mono text-(length:--fs-2xs) text-fg-subtle">
          ref: {error.digest}
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
