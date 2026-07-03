import type { ReactNode } from 'react';

import { StatCard as UiStatCard } from '@/components/ui/stat-card';

/**
 * Stat tile do console — ADAPTER de compatibilidade sobre o StatCard canônico
 * do DS (ui/stat-card). Mantém a API antiga das páginas admin (icon string é
 * ignorado — o DS v2 usa o label mono como âncora visual); `delta`+`deltaTone`
 * viram a variação colorida; `hint` continua neutro.
 */
export function StatCard({
  label,
  value,
  hint,
  delta,
  deltaTone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: ReactNode;
  deltaTone?: 'up' | 'down';
  icon?: string;
  tone?: 'teal' | 'green' | 'amber' | 'red';
}) {
  return (
    <UiStatCard
      label={label}
      value={value}
      {...(delta && deltaTone
        ? { delta: { direction: deltaTone, label: delta } }
        : { hint: delta ?? hint })}
    />
  );
}
