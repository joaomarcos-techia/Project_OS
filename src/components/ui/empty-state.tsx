import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/** Empty state — placeholder quando não há dados. */
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
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface-2 px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="flex size-11 items-center justify-center rounded-full bg-surface-inset text-fg-subtle [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="font-medium text-fg">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
