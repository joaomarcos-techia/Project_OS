'use client';

// Segment-level error boundary (C16). Captura erros de render/efeito das rotas
// do app e reporta ao Sentry; oferece retry via reset().
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2>Algo deu errado.</h2>
      <p>O erro foi registrado. Tente novamente.</p>
      <button type="button" onClick={() => reset()}>
        Tentar novamente
      </button>
    </div>
  );
}
