'use client';

import { RouteError } from '@/components/shared/route-error';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="O Dashboard não carregou"
      description="Confira a internet e tente de novo. Os dados da clínica estão salvos."
    />
  );
}
