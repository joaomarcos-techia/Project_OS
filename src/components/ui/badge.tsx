import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Badge/pill — classes do Design System (`ds.css` `.badge`). CVA preservado. */
export const badgeVariants = cva('badge', {
  variants: {
    tone: {
      gray: 'gray',
      blue: 'blue',
      green: 'green',
      amber: 'amber',
      red: 'red',
      teal: 'teal',
      violet: 'violet',
    },
  },
  defaultVariants: { tone: 'gray' },
});

type BadgeProps = ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    dot?: boolean;
  };

export function Badge({ className, tone, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span className="bdot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
