import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/** Empty state — DS v2 §empty, recriado em Tailwind. API preservada. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1.5 px-(--sp-6) py-(--sp-12) text-center',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-2.5 grid size-14 place-items-center rounded-(--r-lg) border border-border bg-surface-inset text-fg-subtle [&>svg]:size-6"
        >
          {icon}
        </span>
      ) : null}
      <b className="text-(length:--fs-h4) font-semibold">{title}</b>
      {description ? (
        <p className="max-w-[38ch] text-(length:--fs-sm) text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-3 flex gap-2.5">{action}</div> : null}
    </div>
  );
}
