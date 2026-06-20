import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';

/** Card de métrica simples (sem gráfico) — dashboard e /metricas. */
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="text-sm text-fg-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="mt-1 text-xs text-fg-subtle">{hint}</div> : null}
    </Card>
  );
}
