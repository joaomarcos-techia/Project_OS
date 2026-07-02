'use client';

// Error boundary global (fora do shell: auth, join, PDFs). Sentry + retry.
import { RouteError } from '@/components/shared/route-error';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas">
      <RouteError error={error} reset={reset} />
    </main>
  );
}
