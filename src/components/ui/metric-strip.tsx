import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Métricas em uma única superfície densa, responsiva à largura disponível. */
export function MetricStrip({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      aria-label="Métricas principais"
      className={cn(
        'grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-px overflow-hidden rounded-(--r-lg) border border-border bg-border shadow-xs',
        '[&>[data-slot=stat-card]]:rounded-none [&>[data-slot=stat-card]]:border-0 [&>[data-slot=stat-card]]:shadow-none',
        className,
      )}
      {...props}
    />
  );
}
