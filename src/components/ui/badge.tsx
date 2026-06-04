import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Badge/pill — DS §08.9. Tons fiéis ao `.badge` do Design System (com dark mode). */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border border-transparent px-[9px] py-1 text-xs font-medium leading-none tracking-[-0.01em] whitespace-nowrap',
  {
    variants: {
      tone: {
        gray: 'border-border bg-surface-inset text-fg-muted',
        blue: 'bg-primary-50 text-primary-700 dark:bg-primary-600/20 dark:text-primary-300',
        green: 'bg-success-50 text-success-700 dark:bg-success-500/20 dark:text-success-100',
        amber: 'bg-warning-50 text-warning-700 dark:bg-warning-500/20 dark:text-warning-100',
        red: 'bg-danger-50 text-danger-700 dark:bg-danger-500/20 dark:text-danger-100',
        teal: 'bg-accent-500/15 text-accent-600 dark:bg-accent-500/20 dark:text-accent-400',
        violet:
          'bg-[oklch(0.95_0.03_300)] text-[oklch(0.45_0.16_300)] dark:bg-[oklch(0.35_0.08_300)] dark:text-[oklch(0.82_0.1_300)]',
      },
    },
    defaultVariants: { tone: 'gray' },
  },
);

type BadgeProps = ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    dot?: boolean;
  };

export function Badge({ className, tone, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
