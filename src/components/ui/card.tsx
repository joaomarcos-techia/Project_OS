import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Card — DS v2 §card (`--card-bg/border/radius` + elevação card). */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-(--card-radius) border border-(--card-border) bg-(--card-bg) shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-(--card-pad) pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-(length:--fs-h4) font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-(length:--fs-sm) text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-(--card-pad)', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2.5 rounded-b-(--card-radius) border-t border-border bg-surface-2 px-(--card-pad) py-4',
        className,
      )}
      {...props}
    />
  );
}
