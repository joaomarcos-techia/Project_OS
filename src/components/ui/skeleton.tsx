import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Skeleton shimmer — DS v2 §sk. Dimensione via className (ex.: h-4 w-32). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-(--r-sm) bg-[linear-gradient(100deg,var(--surface-inset)_30%,var(--surface-2)_50%,var(--surface-inset)_70%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

/** Pré-composição: card em carregamento (para loading.tsx). */
export function SkeletonCard({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-(--card-radius) border border-(--card-border) bg-(--card-bg) p-(--card-pad) shadow-sm',
        className,
      )}
    >
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  );
}

/** Pré-composição: tabela em carregamento (para loading.tsx). */
export function SkeletonTable({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-(--r-lg) border border-border bg-surface',
        className,
      )}
    >
      <div className="border-b border-border bg-surface-2 px-3.5 py-3">
        <Skeleton className="h-3.5 w-1/4" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex h-(--row-h) items-center gap-6 border-b border-border px-3.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-3 w-1/6" />
          <Skeleton className="h-3 w-1/5" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
