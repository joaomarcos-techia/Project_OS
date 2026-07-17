import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Badge — DS v2 §badge, recriado em Tailwind. Os nomes de tone são os
 * históricos (compat com telas/status-badge); as cores vêm da paleta DS v2:
 * gray=neutro, blue=primary(petrol), green=success, amber=warning, red=danger,
 * teal/violet=tints de --viz-8/--viz-3 (extensão documentada no
 * design-system-map), ai=superfície de IA (clay).
 */
export const badgeVariants = cva(
  'inline-flex h-5.25 items-center gap-1.25 rounded-(--r-sm) border px-2 text-(length:--fs-2xs) font-semibold tracking-[0.01em] whitespace-nowrap',
  {
    variants: {
      tone: {
        gray: 'border-border bg-surface-inset text-fg-muted',
        blue: 'border-[color-mix(in_oklch,var(--primary)_26%,transparent)] bg-(--primary-soft) text-(--primary-active) dark:text-fg',
        green:
          'border-[color-mix(in_oklch,var(--success-500)_28%,transparent)] bg-success-50 text-success-700 dark:border-[color-mix(in_oklch,var(--success-500)_40%,transparent)] dark:bg-[color-mix(in_oklch,var(--success-500)_18%,transparent)] dark:text-success-200',
        amber:
          'border-[color-mix(in_oklch,var(--warning-500)_32%,transparent)] bg-warning-50 text-warning-700 dark:border-[color-mix(in_oklch,var(--warning-500)_42%,transparent)] dark:bg-[color-mix(in_oklch,var(--warning-500)_20%,transparent)] dark:text-warning-200',
        red: 'border-[color-mix(in_oklch,var(--danger-500)_28%,transparent)] bg-danger-50 text-danger-700 dark:border-[color-mix(in_oklch,var(--danger-500)_42%,transparent)] dark:bg-[color-mix(in_oklch,var(--danger-500)_20%,transparent)] dark:text-danger-200',
        teal: 'border-[color-mix(in_oklch,var(--viz-8)_30%,transparent)] bg-[color-mix(in_oklch,var(--viz-8)_14%,var(--surface))] text-[oklch(0.42_0.08_180)] dark:bg-[color-mix(in_oklch,var(--viz-8)_20%,transparent)] dark:text-[oklch(0.85_0.07_180)]',
        violet:
          'border-[color-mix(in_oklch,var(--viz-3)_30%,transparent)] bg-[color-mix(in_oklch,var(--viz-3)_12%,var(--surface))] text-[oklch(0.44_0.12_300)] dark:bg-[color-mix(in_oklch,var(--viz-3)_20%,transparent)] dark:text-[oklch(0.83_0.09_300)]',
        ai: 'border-(--ai-border) bg-(--ai-soft) text-accent-700 dark:text-accent-200',
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
