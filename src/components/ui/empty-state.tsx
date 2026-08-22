import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/** Empty state — DS v2 §empty, recriado em Tailwind. API preservada. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  variant?: 'default' | 'compact';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1.5 text-center',
        variant === 'compact' ? 'px-(--sp-4) py-(--sp-5)' : 'px-(--sp-6) py-(--sp-8)',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            'grid place-items-center border border-border bg-surface-inset text-fg-subtle',
            variant === 'compact'
              ? 'mb-1.5 size-8 rounded-(--r-md) [&>svg]:size-4'
              : 'mb-2 size-10 rounded-(--r-lg) [&>svg]:size-5',
          )}
        >
          {icon}
        </span>
      ) : null}
      <b className="text-(length:--fs-h4) font-semibold">{title}</b>
      {description ? (
        <p className="max-w-[38ch] text-pretty text-(length:--fs-sm) text-fg-muted">
          {description}
        </p>
      ) : null}
      {action ? (
        <div className={cn('flex gap-2.5', variant === 'compact' ? 'mt-2' : 'mt-3')}>{action}</div>
      ) : null}
    </div>
  );
}
